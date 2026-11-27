/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Database Validation Engine for Natural Language Kitchen Intents.
 * Cross-references AI-extracted entities against master records using the
 * centralized canonical ingredient matcher, detects ambiguity, identifies
 * missing prices/conversions, and generates structured follow-up clarifications.
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import { UniversalKitchenIntent, IntentParsedIngredient } from '../server/ai/intentSchema';
import { normalizeUnit } from './aiRecipeMatcher';
import {
  matchIngredient,
  areIngredientsEquivalent,
  findMatchingConversion,
  resolveCanonicalAlias,
  IngredientMatchOutcome,
} from './ingredientMatcher';

export interface ClarificationPrompt {
  id: string;
  category:
    | 'MISSING_PRICE'
    | 'MISSING_CONVERSION'
    | 'AMBIGUOUS_UNIT'
    | 'MISSING_YIELD'
    | 'AMBIGUOUS_INGREDIENT';
  targetEntity: string;
  field: string;
  question: string;
  candidates?: string[];
  context?: string;
  suggestedDefault?: {
    value: number | string;
    description: string;
  };
}

export interface ValidatedIngredientRow {
  raw: IntentParsedIngredient;
  matchedMaster: Ingredient | null;
  matchOutcome?: IngredientMatchOutcome;
  candidates?: Ingredient[];
  normalizedUnit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' | null;
  effectiveQuantity: number | null;
  conversionGrams: number | null;
  status:
    | 'VERIFIED'
    | 'MISSING_PRICE'
    | 'MISSING_CONVERSION'
    | 'AMBIGUOUS_UNIT'
    | 'AMBIGUOUS_INGREDIENT'
    | 'UNMATCHED';
  issues: string[];
}

export interface ValidatedRecipeProposal {
  recipeName: string;
  cookingTimeMins: number;
  yieldAmount: number;
  yieldType: 'weight' | 'piece';
  rows: ValidatedIngredientRow[];
  isComplete: boolean;
  issues: string[];
}

export interface ValidatedIngredientMutation {
  type: 'CREATE' | 'UPDATE';
  name: string;
  enteredName?: string;
  targetId?: string;
  purchaseQty: number;
  purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
  purchaseCost: number;
  costPerUnit: number;
  previousRecord?: Ingredient;
  isDuplicate?: boolean;
  matchOutcome?: IngredientMatchOutcome;
}

export interface ValidatedConversionMutation {
  name: string;
  weightGrams: number;
  existingId?: string;
  previousWeightGrams?: number;
}

export interface ValidatedGasMutation {
  cylinderPrice: number;
  cylinderWeightKg: number;
  consumptionRateKgHour: number;
  previousConfig: GasConfig;
}

export interface ValidationOutcome {
  intent: UniversalKitchenIntent;
  recipes: ValidatedRecipeProposal[];
  ingredientMutations: ValidatedIngredientMutation[];
  conversionMutations: ValidatedConversionMutation[];
  gasMutation: ValidatedGasMutation | null;
  clarifications: ClarificationPrompt[];
  isComplete: boolean;
  unresolvedCount: number;
  userSummary: string;
}

/**
 * Resolves an ingredient name to its canonical alias key using the centralized matcher.
 */
export function resolveAlias(name: string): string {
  return resolveCanonicalAlias(name);
}

export function validateKitchenIntent(
  intent: UniversalKitchenIntent,
  masterIngredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig,
  _existingRecipes: Recipe[]
): ValidationOutcome {
  const clarifications: ClarificationPrompt[] = [];
  const validatedRecipes: ValidatedRecipeProposal[] = [];
  const ingredientMutations: ValidatedIngredientMutation[] = [];
  const conversionMutations: ValidatedConversionMutation[] = [];
  let validatedGasMutation: ValidatedGasMutation | null = null;

  // 1. Process Ingredient Mutations (Creations & Updates)
  for (const creation of intent.ingredientCreations) {
    const matchResult = matchIngredient(creation.name, masterIngredients);

    if (matchResult.outcome === 'AMBIGUOUS_MATCH') {
      const candidateNames = matchResult.candidates.map(c => c.name);
      clarifications.push({
        id: `clarify_ambiguous_create_${creation.name}`,
        category: 'AMBIGUOUS_INGREDIENT',
        targetEntity: creation.name,
        field: 'ingredientName',
        candidates: candidateNames,
        question:
          matchResult.candidates.length > 1
            ? `Which existing ingredient do you mean for "${creation.name}": ${candidateNames.join(', ')}?`
            : `Did you mean existing ingredient "${candidateNames[0]}" for "${creation.name}", or should we create "${creation.name}" as a separate ingredient?`,
      });
      continue;
    }

    const existing = matchResult.matchedIngredient || undefined;
    const hasExplicitPackQty = creation.purchaseQty !== undefined && creation.purchaseQty > 0;
    const purchaseQty = hasExplicitPackQty ? creation.purchaseQty! : (existing?.purchaseQty || 1);
    const purchaseUnit = creation.purchaseUnit || existing?.purchaseUnit || 'kg';
    const purchaseCost = creation.purchaseCost !== undefined ? creation.purchaseCost : 0;
    const costPerUnit =
      purchaseUnit === 'kg' || purchaseUnit === 'litre'
        ? purchaseCost / (purchaseQty * 1000)
        : purchaseCost / purchaseQty;

    if (creation.purchaseCost === undefined || creation.purchaseCost <= 0) {
      clarifications.push({
        id: `clarify_price_${creation.name}`,
        category: 'MISSING_PRICE',
        targetEntity: creation.name,
        field: 'purchaseCost',
        question: `What is the purchase price and pack size for "${creation.name}"? (e.g. ₹50 for 500g)`,
      });
    } else if (!hasExplicitPackQty && !existing) {
      clarifications.push({
        id: `clarify_pack_${creation.name}`,
        category: 'MISSING_PRICE',
        targetEntity: creation.name,
        field: 'purchaseQty',
        question: `What is the purchase pack quantity and unit for "${creation.name}" at ₹${creation.purchaseCost}? (e.g. 500g or 1kg)`,
      });
    }

    ingredientMutations.push({
      type: existing ? 'UPDATE' : 'CREATE',
      name: existing ? existing.name : creation.name,
      enteredName: creation.name,
      targetId: existing?.id,
      purchaseQty,
      purchaseUnit,
      purchaseCost,
      costPerUnit,
      previousRecord: existing,
      isDuplicate: !!existing,
      matchOutcome: matchResult.outcome,
    });
  }

  for (const update of intent.ingredientUpdates) {
    const matchResult = matchIngredient(update.name, masterIngredients);

    if (matchResult.outcome === 'AMBIGUOUS_MATCH') {
      const candidateNames = matchResult.candidates.map(c => c.name);
      clarifications.push({
        id: `clarify_ambiguous_update_${update.name}`,
        category: 'AMBIGUOUS_INGREDIENT',
        targetEntity: update.name,
        field: 'ingredientName',
        candidates: candidateNames,
        question:
          matchResult.candidates.length > 1
            ? `Which existing ingredient do you want to update for "${update.name}": ${candidateNames.join(', ')}?`
            : `Did you mean to update existing ingredient "${candidateNames[0]}" for "${update.name}"?`,
      });
      continue;
    }

    const existing = matchResult.matchedIngredient || undefined;
    const purchaseQty = update.purchaseQty || existing?.purchaseQty || 1;
    const purchaseUnit = update.purchaseUnit || existing?.purchaseUnit || 'kg';
    const purchaseCost =
      update.purchaseCost !== undefined ? update.purchaseCost : (existing?.purchaseCost || 0);
    const costPerUnit =
      purchaseUnit === 'kg' || purchaseUnit === 'litre'
        ? purchaseCost / (purchaseQty * 1000)
        : purchaseCost / purchaseQty;

    ingredientMutations.push({
      type: existing ? 'UPDATE' : 'CREATE',
      name: existing ? existing.name : update.name,
      enteredName: update.name,
      targetId: existing?.id,
      purchaseQty,
      purchaseUnit,
      purchaseCost,
      costPerUnit,
      previousRecord: existing,
      matchOutcome: matchResult.outcome,
    });
  }

  // 2. Process Conversion Mutations
  for (const conv of intent.conversionUpdates) {
    const existingConv = findMatchingConversion(conv.name, conversions, masterIngredients);
    const matchedIng = matchIngredient(conv.name, masterIngredients).matchedIngredient;

    // Align conversion name with existing conversion or matched master ingredient name
    const resolvedConvName = existingConv
      ? existingConv.name
      : matchedIng
        ? matchedIng.name
        : conv.name;

    conversionMutations.push({
      name: resolvedConvName,
      weightGrams: conv.weightGrams,
      existingId: existingConv?.id,
      previousWeightGrams: existingConv?.weightGrams,
    });
  }

  // 3. Process Gas Config Mutations
  const hasExplicitGasUpdate =
    !!intent.gasConfigUpdate &&
    (intent.gasConfigUpdate.cylinderPrice !== undefined ||
      intent.gasConfigUpdate.cylinderWeightKg !== undefined ||
      intent.gasConfigUpdate.consumptionRateKgHour !== undefined);

  if (hasExplicitGasUpdate && intent.gasConfigUpdate) {
    if (
      intent.gasConfigUpdate.cylinderPrice !== undefined &&
      intent.gasConfigUpdate.cylinderPrice <= 0
    ) {
      throw new Error('Gas cylinder price must be greater than 0.');
    }
    if (
      intent.gasConfigUpdate.cylinderWeightKg !== undefined &&
      intent.gasConfigUpdate.cylinderWeightKg <= 0
    ) {
      throw new Error('Gas cylinder weight must be greater than 0.');
    }
    if (
      intent.gasConfigUpdate.consumptionRateKgHour !== undefined &&
      intent.gasConfigUpdate.consumptionRateKgHour <= 0
    ) {
      throw new Error('Gas consumption rate must be greater than 0.');
    }

    validatedGasMutation = {
      cylinderPrice: intent.gasConfigUpdate.cylinderPrice ?? gasConfig.cylinderPrice,
      cylinderWeightKg: intent.gasConfigUpdate.cylinderWeightKg ?? gasConfig.cylinderWeightKg,
      consumptionRateKgHour:
        intent.gasConfigUpdate.consumptionRateKgHour ?? gasConfig.consumptionRateKgHour,
      previousConfig: gasConfig,
    };
  }

  // 4. Process Recipes
  for (const rec of intent.recipes) {
    const recipeIssues: string[] = [];
    const rows: ValidatedIngredientRow[] = [];

    // Check yield
    const yieldAmount = rec.yieldAmount && rec.yieldAmount > 0 ? rec.yieldAmount : 0;
    const yieldType = rec.yieldType === 'piece' ? 'piece' : 'weight';
    if (yieldAmount <= 0) {
      recipeIssues.push('Recipe yield is missing or unspecified.');
      clarifications.push({
        id: `clarify_yield_${rec.recipeName}`,
        category: 'MISSING_YIELD',
        targetEntity: rec.recipeName,
        field: 'yieldAmount',
        question: `What is the final cooked yield for "${rec.recipeName}"? (e.g., 500g cooked weight or 2 pieces)`,
        suggestedDefault: { value: 1000, description: '1000g cooked yield' },
      });
    }

    for (const ing of rec.ingredients) {
      const rowIssues: string[] = [];
      const matchResult = matchIngredient(ing.name, masterIngredients);
      const matched = matchResult.matchedIngredient;

      // Check if user also provided an ingredient creation/update in the same intent
      const pendingCreation = ingredientMutations.find(
        m =>
          m.name.toLowerCase() === ing.name.toLowerCase() ||
          (m.enteredName && m.enteredName.toLowerCase() === ing.name.toLowerCase()) ||
          areIngredientsEquivalent(m.name, ing.name, masterIngredients)
      );

      const normUnit = normalizeUnit(ing.unit);
      let status: ValidatedIngredientRow['status'] = 'VERIFIED';
      let conversionGrams: number | null = null;
      let effectiveQuantity: number | null = null;

      // Handle ambiguous ingredient match (e.g. bare "Dhaniya", bare "Dal", or fuzzy typo candidate)
      if (matchResult.outcome === 'AMBIGUOUS_MATCH' && !pendingCreation) {
        status = 'AMBIGUOUS_INGREDIENT';
        const candidateNames = matchResult.candidates.map(c => c.name);
        const reason =
          matchResult.ambiguityReason ||
          `Ambiguous ingredient "${ing.name}". Candidates: ${candidateNames.join(', ')}.`;
        rowIssues.push(reason);

        if (
          !clarifications.some(
            c =>
              c.category === 'AMBIGUOUS_INGREDIENT' &&
              c.targetEntity.toLowerCase() === ing.name.toLowerCase()
          )
        ) {
          clarifications.push({
            id: `clarify_ambiguous_${ing.name}`,
            category: 'AMBIGUOUS_INGREDIENT',
            targetEntity: ing.name,
            field: 'ingredientName',
            candidates: candidateNames,
            question:
              candidateNames.length > 1
                ? `Which "${ing.name}" do you mean: ${candidateNames.join(', ')}?`
                : `Did you mean existing ingredient "${candidateNames[0]}" for "${ing.name}", or is it a separate new ingredient?`,
          });
        }

        // Also check if the unit itself is an unconvertible count/pouch unit
        if (!normUnit) {
          rowIssues.push(
            `Unit "${ing.unit}" cannot be automatically converted to grams without verified weight.`
          );
          clarifications.push({
            id: `clarify_unit_${ing.name}`,
            category: 'AMBIGUOUS_UNIT',
            targetEntity: ing.name,
            field: 'weightGrams',
            question: `What is the weight in grams for ${ing.rawQuantity || ing.quantity || 1} ${ing.unit} of "${ing.name}"?`,
          });
        }
      } else {
        // Handle unverified units (e.g. piece, pouch, tbsp, cup)
        if (!normUnit) {
          status = 'AMBIGUOUS_UNIT';
          rowIssues.push(
            `Unit "${ing.unit}" cannot be automatically converted to grams without verified weight.`
          );
          clarifications.push({
            id: `clarify_unit_${ing.name}`,
            category: 'AMBIGUOUS_UNIT',
            targetEntity: ing.name,
            field: 'weightGrams',
            question: `What is the weight in grams for ${ing.rawQuantity || ing.quantity || 1} ${ing.unit} of "${ing.name}"?`,
          });
        } else if (normUnit === 'tsp') {
          // Look up verified teaspoon conversion in pending conversion mutations or DB conversions
          const lookupName = matched?.name || pendingCreation?.name || ing.name;
          const convMatch =
            conversionMutations.find(
              c =>
                c.name.toLowerCase() === lookupName.toLowerCase() ||
                c.name.toLowerCase() === ing.name.toLowerCase() ||
                areIngredientsEquivalent(c.name, lookupName, masterIngredients) ||
                areIngredientsEquivalent(c.name, ing.name, masterIngredients)
            ) ||
            findMatchingConversion(lookupName, conversions, masterIngredients) ||
            findMatchingConversion(ing.name, conversions, masterIngredients);

          if (convMatch && convMatch.weightGrams > 0) {
            conversionGrams = convMatch.weightGrams;
            effectiveQuantity = (ing.quantity || 1) * conversionGrams;
          } else {
            status = 'MISSING_CONVERSION';
            rowIssues.push(`Missing verified teaspoon conversion for "${ing.name}".`);
            clarifications.push({
              id: `clarify_tsp_${ing.name}`,
              category: 'MISSING_CONVERSION',
              targetEntity: ing.name,
              field: 'tspWeightGrams',
              question: `We don't have a verified weight for 1 teaspoon of "${ing.name}". How many grams is 1 tsp?`,
              suggestedDefault: { value: 4, description: 'Standard 4g per teaspoon' },
            });
          }
        } else if (normUnit === 'kg' || normUnit === 'litre') {
          effectiveQuantity = (ing.quantity || 0) * 1000;
        } else {
          effectiveQuantity = ing.quantity || 0;
        }

        // Check price availability
        const hasValidPrice =
          (matched && matched.costPerUnit > 0) ||
          (pendingCreation && pendingCreation.costPerUnit > 0);
        if (!hasValidPrice) {
          status = 'MISSING_PRICE';
          rowIssues.push(`"${ing.name}" is not in the master price database.`);
          if (
            !clarifications.some(
              c =>
                (c.targetEntity.toLowerCase() === ing.name.toLowerCase() ||
                  areIngredientsEquivalent(c.targetEntity, ing.name, masterIngredients)) &&
                c.field === 'purchaseCost'
            )
          ) {
            clarifications.push({
              id: `clarify_price_${ing.name}`,
              category: 'MISSING_PRICE',
              targetEntity: ing.name,
              field: 'purchaseCost',
              question: `What is the purchase price and pack size for "${ing.name}"? (e.g. ₹60 for 500g)`,
            });
          }
        }
      }

      rows.push({
        raw: ing,
        matchedMaster: matched,
        matchOutcome: matchResult.outcome,
        candidates: matchResult.candidates,
        normalizedUnit: normUnit,
        effectiveQuantity,
        conversionGrams,
        status,
        issues: rowIssues,
      });

      if (rowIssues.length > 0) {
        recipeIssues.push(...rowIssues);
      }
    }

    const isRecipeComplete = recipeIssues.length === 0;
    validatedRecipes.push({
      recipeName: rec.recipeName,
      cookingTimeMins: rec.cookingTimeMins ?? 10,
      yieldAmount: yieldAmount > 0 ? yieldAmount : 1000,
      yieldType,
      rows,
      isComplete: isRecipeComplete,
      issues: recipeIssues,
    });
  }

  const isComplete = clarifications.length === 0;

  // Build clean user summary
  let userSummary = '';
  if (validatedRecipes.length > 0) {
    userSummary += `Parsed ${validatedRecipes.length} recipe(s): ${validatedRecipes.map(r => r.recipeName).join(', ')}. `;
  }
  if (ingredientMutations.length > 0) {
    userSummary += `${ingredientMutations.length} ingredient update/creation proposed. `;
  }
  if (conversionMutations.length > 0) {
    userSummary += `${conversionMutations.length} conversion(s) defined. `;
  }
  if (validatedGasMutation) {
    userSummary += `Gas configuration update proposed. `;
  }

  return {
    intent,
    recipes: validatedRecipes,
    ingredientMutations,
    conversionMutations,
    gasMutation: validatedGasMutation,
    clarifications,
    isComplete,
    unresolvedCount: clarifications.length,
    userSummary: userSummary.trim(),
  };
}
