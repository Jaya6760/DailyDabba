/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Proposal Generator: Assembles validated intents and database diffs into structured change sets
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  ProposedChangeSet,
  ProposedIngredientCreate,
  ProposedIngredientUpdate,
  ProposedConversionCreate,
  ProposedConversionUpdate,
  ProposedGasUpdate,
  ProposedRecipeCreate,
  ProposedRecipeCost,
} from '../server/ai/proposalTypes';
import { ConversationTurnResult } from './conversationManager';
import {
  calculateRecipeCosts,
  calculateDefaultServingCost,
  validateRecipe,
} from '../utils';
import {
  areIngredientsEquivalent,
  findMatchingConversion,
} from './ingredientMatcher';

/**
 * Creates a fast deterministic fingerprint of current database records to detect stale proposals
 */
export function generateDatabaseSnapshotHash(
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig,
  recipes: Recipe[]
): string {
  const ingSummary = ingredients
    .map(i => `${i.id}:${i.name}:${i.purchaseCost}:${i.purchaseQty}:${i.purchaseUnit}`)
    .sort()
    .join('|');
  const convSummary = conversions
    .map(c => `${c.id || c.name}:${c.name}:${c.weightGrams}`)
    .sort()
    .join('|');
  const gasSummary = `${gasConfig.cylinderPrice}:${gasConfig.cylinderWeightKg}:${gasConfig.consumptionRateKgHour}`;
  const recSummary = recipes
    .map(r => `${r.id}:${r.name}:${r.ingredients.length}:${r.yieldAmount}:${r.cookingTimeMins}`)
    .sort()
    .join('|');
  const full = `${ingSummary}#${convSummary}#${gasSummary}#${recSummary}`;

  // Simple deterministic 32-bit FNV-1a hash formatted as hex
  let hash = 2166136261;
  for (let i = 0; i < full.length; i++) {
    hash ^= full.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function generateProposedChangeSet(
  turnResult: ConversationTurnResult,
  currentIngredients: Ingredient[],
  currentConversions: TeaspoonConversion[],
  currentGasConfig: GasConfig,
  currentRecipes: Recipe[]
): ProposedChangeSet {
  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const snapshotHash = generateDatabaseSnapshotHash(
    currentIngredients,
    currentConversions,
    currentGasConfig,
    currentRecipes
  );

  const newIngredients: ProposedIngredientCreate[] = [];
  const updatedIngredients: ProposedIngredientUpdate[] = [];
  const newConversions: ProposedConversionCreate[] = [];
  const updatedConversions: ProposedConversionUpdate[] = [];
  let gasConfigUpdate: ProposedGasUpdate | undefined;
  const recipesToCreate: ProposedRecipeCreate[] = [];

  const warnings: string[] = [];
  const missingInfo: string[] = [];

  const { validationOutcome, pendingClarifications } = turnResult;

  // 1. Process Ingredient Mutations from ValidationOutcome
  for (const mut of validationOutcome.ingredientMutations) {
    if (mut.type === 'CREATE') {
      newIngredients.push({
        tempId: `temp_ing_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        name: mut.name,
        purchaseQty: mut.purchaseQty,
        purchaseUnit: mut.purchaseUnit,
        purchaseCost: mut.purchaseCost,
        costPerUnit: mut.costPerUnit,
        aliases: [],
      });
    } else if (mut.type === 'UPDATE' && mut.previousRecord && mut.targetId) {
      updatedIngredients.push({
        id: mut.targetId,
        name: mut.name,
        previous: {
          purchaseQty: mut.previousRecord.purchaseQty,
          purchaseUnit: mut.previousRecord.purchaseUnit,
          purchaseCost: mut.previousRecord.purchaseCost,
          costPerUnit: mut.previousRecord.costPerUnit,
        },
        proposed: {
          purchaseQty: mut.purchaseQty,
          purchaseUnit: mut.purchaseUnit,
          purchaseCost: mut.purchaseCost,
          costPerUnit: mut.costPerUnit,
        },
        aliases: mut.previousRecord.aliases,
      });
    }
  }

  // 2. Process Teaspoon Conversions from ValidationOutcome
  for (const conv of validationOutcome.conversionMutations) {
    if (conv.existingId && conv.previousWeightGrams !== undefined) {
      updatedConversions.push({
        id: conv.existingId,
        name: conv.name,
        previousWeightGrams: conv.previousWeightGrams,
        proposedWeightGrams: conv.weightGrams,
      });
    } else {
      newConversions.push({
        name: conv.name,
        weightGrams: conv.weightGrams,
      });
    }
  }

  // 3. Process Gas Mutation from ValidationOutcome
  if (validationOutcome.gasMutation) {
    gasConfigUpdate = {
      previous: validationOutcome.gasMutation.previousConfig,
      proposed: {
        cylinderPrice: validationOutcome.gasMutation.cylinderPrice,
        cylinderWeightKg: validationOutcome.gasMutation.cylinderWeightKg,
        consumptionRateKgHour: validationOutcome.gasMutation.consumptionRateKgHour,
      },
    };
  }

  // 4. Build Effective Virtual Catalogs to Accurately Cost Proposed Recipes
  const effectiveGasConfig = gasConfigUpdate ? gasConfigUpdate.proposed : currentGasConfig;

  // Combine current ingredients with proposed updates and newly registered ingredients
  const effectiveIngredients: Ingredient[] = currentIngredients.map(ing => {
    const update = updatedIngredients.find(u => u.id === ing.id);
    if (update) {
      return {
        ...ing,
        purchaseCost: update.proposed.purchaseCost,
        purchaseQty: update.proposed.purchaseQty,
        purchaseUnit: update.proposed.purchaseUnit,
        costPerUnit: update.proposed.costPerUnit,
      };
    }
    return ing;
  });

  newIngredients.forEach(n => {
    effectiveIngredients.push({
      id: n.tempId,
      name: n.name,
      purchaseCost: n.purchaseCost,
      purchaseQty: n.purchaseQty,
      purchaseUnit: n.purchaseUnit,
      costPerUnit: n.costPerUnit,
      aliases: n.aliases || [],
    });
  });

  const effectiveConversions: TeaspoonConversion[] = currentConversions.map(c => {
    const upd = updatedConversions.find(u => u.id === c.id);
    if (upd) {
      return { ...c, weightGrams: upd.proposedWeightGrams };
    }
    return c;
  });

  newConversions.forEach((nc, i) => {
    effectiveConversions.push({
      id: `temp_conv_${i}`,
      name: nc.name,
      weightGrams: nc.weightGrams,
    });
  });

  // 5. Process Validated Recipes from ValidationOutcome
  for (const vr of validationOutcome.recipes) {
    const recipeIngredients = vr.rows.map((row, idx) => {
      let resolvedId = row.matchedMaster?.id;
      let resolvedName = row.matchedMaster ? row.matchedMaster.name : row.raw.name;

      if (!resolvedId && row.status !== 'AMBIGUOUS_INGREDIENT') {
        const matchedNew = newIngredients.find(
          n =>
            n.name.toLowerCase().trim() === row.raw.name.toLowerCase().trim() ||
            areIngredientsEquivalent(n.name, row.raw.name, effectiveIngredients)
        );
        if (matchedNew) {
          resolvedId = matchedNew.tempId;
          resolvedName = matchedNew.name;
        } else {
          const matchedExisting = effectiveIngredients.find(
            e =>
              e.name.toLowerCase().trim() === row.raw.name.toLowerCase().trim() ||
              areIngredientsEquivalent(e.name, row.raw.name, effectiveIngredients)
          );
          if (matchedExisting) {
            resolvedId = matchedExisting.id;
            resolvedName = matchedExisting.name;
          } else {
            resolvedId = `unknown_${idx}`;
          }
        }
      } else if (!resolvedId) {
        resolvedId = `unknown_${idx}`;
      }

      // Ensure effectiveConversions has a canonical name entry if a synonym conversion exists
      const finalUnit = (row.normalizedUnit || row.raw.unit || 'g') as any;
      if (finalUnit === 'tsp') {
        const exactConv = effectiveConversions.some(
          c => c.name.trim().toLowerCase() === resolvedName.trim().toLowerCase()
        );
        if (!exactConv) {
          const canonicalConv = findMatchingConversion(resolvedName, effectiveConversions, effectiveIngredients);
          if (canonicalConv) {
            effectiveConversions.push({
              id: `syn_conv_${idx}`,
              name: resolvedName,
              weightGrams: canonicalConv.weightGrams,
            });
          }
        }
      }

      return {
        id: `ri_${idx}_${Date.now()}`,
        ingredientId: resolvedId,
        name: resolvedName,
        quantity: row.raw.quantity || 1,
        unit: finalUnit,
      };
    });

    const draftRecipe: Recipe = {
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name: vr.recipeName,
      ingredients: recipeIngredients,
      yieldType: vr.yieldType,
      yieldAmount: vr.yieldAmount > 0 ? vr.yieldAmount : vr.yieldType === 'piece' ? 1 : 100,
      cookingTimeMins: vr.cookingTimeMins,
      createdAt: new Date().toISOString(),
    };

    // Calculate cost deterministically using src/utils.ts
    const validation = validateRecipe(draftRecipe, effectiveIngredients, effectiveConversions);
    const recipeCosts = calculateRecipeCosts(
      draftRecipe,
      effectiveIngredients,
      effectiveConversions,
      effectiveGasConfig
    );
    const defaultServing = calculateDefaultServingCost(
      draftRecipe,
      effectiveIngredients,
      effectiveConversions,
      effectiveGasConfig
    );

    const calculatedCost: ProposedRecipeCost = {
      totalBatchCost: recipeCosts.totalBatchCost,
      servingCost: defaultServing.costPrice,
      servingAmount: defaultServing.defaultServingAmount,
      servingUnit: defaultServing.defaultServingUnit,
      costPer100g:
        draftRecipe.yieldType === 'weight' && draftRecipe.yieldAmount > 0
          ? recipeCosts.costPer100g
          : undefined,
      costPerPiece:
        draftRecipe.yieldType === 'piece' && draftRecipe.yieldAmount > 0
          ? recipeCosts.costPerPiece
          : undefined,
      isComplete: validation.isComplete && recipeCosts.isComplete,
      incompleteReasons: validation.issues.map(iss => iss.message),
    };

    if (!validation.isComplete) {
      warnings.push(...validation.issues.map(iss => `Recipe "${vr.recipeName}": ${iss.message}`));
    }

    recipesToCreate.push({
      recipe: draftRecipe,
      calculatedCost,
      newIngredientsToRegister: newIngredients,
      newConversionsToRegister: newConversions,
    });
  }

  // 6. Missing Info and Clarifications
  if (pendingClarifications && pendingClarifications.length > 0) {
    for (const c of pendingClarifications) {
      missingInfo.push(c.question);
    }
  }

  const hasBlockingIssues =
    missingInfo.length > 0 ||
    warnings.some(
      w =>
        w.includes('Cannot update') ||
        w.includes('Missing verified teaspoon') ||
        w.includes('Unsupported unit') ||
        w.includes('not matched to any master database record')
    );

  // 7. Generate Summary
  const summaryParts: string[] = [];
  if (recipesToCreate.length > 0) summaryParts.push(`Create ${recipesToCreate.length} recipe(s)`);
  if (newIngredients.length > 0) summaryParts.push(`Add ${newIngredients.length} new ingredient(s)`);
  if (updatedIngredients.length > 0)
    summaryParts.push(`Update ${updatedIngredients.length} ingredient price(s)`);
  if (newConversions.length > 0) summaryParts.push(`Add ${newConversions.length} conversion(s)`);
  if (updatedConversions.length > 0)
    summaryParts.push(`Update ${updatedConversions.length} conversion(s)`);
  if (gasConfigUpdate) summaryParts.push(`Update gas configuration`);

  const summary =
    summaryParts.length > 0 ? summaryParts.join(', ') : 'No database modifications requested';

  return {
    id: proposalId,
    createdAt: new Date().toISOString(),
    summary,
    operations: {
      newIngredients,
      updatedIngredients,
      newConversions,
      updatedConversions,
      gasConfigUpdate,
      recipesToCreate,
      recipesToUpdate: [],
    },
    warnings,
    missingInfo,
    hasBlockingIssues,
    status: hasBlockingIssues ? 'draft' : 'ready_for_review',
    databaseSnapshotHash: snapshotHash,
  };
}
