/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Multi-Turn Conversational State and Clarification Manager.
 * Preserves pending recipe and kitchen entities across turns, merges follow-up answers,
 * resolves canonical ingredient ambiguities, and maintains conversational context
 * without requiring users to repeat earlier inputs.
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  UniversalKitchenIntent,
  IntentClarificationAnswer,
} from '../server/ai/intentSchema';
import {
  validateKitchenIntent,
  ValidationOutcome,
  ClarificationPrompt,
} from './catalogValidationEngine';
import { normalizeUnit } from './aiRecipeMatcher';
import {
  matchIngredient,
  areIngredientsEquivalent,
  normalizeIngredientText,
} from './ingredientMatcher';
import { parseKitchenIntentFromNaturalLanguage } from './aiRecipeService';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  clarifications?: ClarificationPrompt[];
  isProposalReady?: boolean;
}

export interface ConversationTurnResult {
  validatedIntent: UniversalKitchenIntent;
  validationOutcome: ValidationOutcome;
  pendingClarifications: ClarificationPrompt[];
  assistantReply: string;
}

export interface ConversationSession {
  sessionId: string;
  messages: ChatMessage[];
  pendingIntent: UniversalKitchenIntent | null;
  lastValidation: ValidationOutcome | null;
  isComplete: boolean;
}

/**
 * Parses purchase cost, pack quantity, and pack unit from a clarification answer and/or raw user text.
 * Examples handled:
 * - { value: 40, purchaseQty: 500, purchaseUnit: 'g' }
 * - { value: 40, unit: '500g' }
 * - { value: '₹40 for 500g' }
 * - userText: "Add poha 500g for ₹40" or "Poha is ₹40 for 500g"
 */
function parsePurchaseDetails(
  ans: IntentClarificationAnswer,
  userText: string
): {
  purchaseCost?: number;
  purchaseQty?: number;
  purchaseUnit?: 'kg' | 'g' | 'litre' | 'ml';
} {
  let purchaseCost: number | undefined;
  let purchaseQty: number | undefined = ans.purchaseQty;
  let purchaseUnit: 'kg' | 'g' | 'litre' | 'ml' | undefined = ans.purchaseUnit;

  // 1. Parse ans.value
  if (typeof ans.value === 'number' && !isNaN(ans.value)) {
    if (ans.field === 'purchaseQty') {
      purchaseQty = ans.value;
    } else {
      purchaseCost = ans.value;
    }
  } else if (typeof ans.value === 'string') {
    const valStr = ans.value.trim();
    const costMatch = valStr.match(/(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)/i);
    if (costMatch) {
      const parsed = parseFloat(costMatch[1]);
      if (!isNaN(parsed)) {
        if (ans.field === 'purchaseQty') {
          purchaseQty = parsed;
        } else {
          purchaseCost = parsed;
        }
      }
    }
    const packMatch = valStr.match(/(?:for|per|\/)\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|litre|liter|l|ml)\b/i);
    if (packMatch) {
      purchaseQty = parseFloat(packMatch[1]);
      const u = normalizeUnit(packMatch[2]);
      if (u && u !== 'tsp') purchaseUnit = u;
    }
  }

  // 2. Parse ans.unit if it contains quantity+unit (e.g. "500g" or "200 g") or just unit ("g", "kg")
  if (ans.unit) {
    const unitClean = ans.unit.trim();
    const qtyUnitMatch = unitClean.match(/^(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|litre|liter|l|ml)$/i);
    if (qtyUnitMatch) {
      if (purchaseQty === undefined) purchaseQty = parseFloat(qtyUnitMatch[1]);
      const u = normalizeUnit(qtyUnitMatch[2]);
      if (u && u !== 'tsp' && !purchaseUnit) purchaseUnit = u;
    } else {
      const u = normalizeUnit(unitClean);
      if (u && u !== 'tsp' && !purchaseUnit) purchaseUnit = u;
    }
  }

  // 3. Check userText for explicit pack specs tied to this entity if still missing
  if ((purchaseQty === undefined || !purchaseUnit) && userText) {
    const packInText = userText.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|litre|liter|l|ml)\b/i);
    if (packInText) {
      const qtyCandidate = parseFloat(packInText[1]);
      const unitCandidate = normalizeUnit(packInText[2]);
      if (!isNaN(qtyCandidate) && qtyCandidate > 0 && unitCandidate && unitCandidate !== 'tsp') {
        if (purchaseQty === undefined) purchaseQty = qtyCandidate;
        if (!purchaseUnit) purchaseUnit = unitCandidate;
      }
    }
  }

  return { purchaseCost, purchaseQty, purchaseUnit };
}

export class KitchenConversationManager {
  private session: ConversationSession;

  constructor(sessionId = `session_${Date.now()}`) {
    this.session = {
      sessionId,
      messages: [],
      pendingIntent: null,
      lastValidation: null,
      isComplete: false,
    };
  }

  getSession(): ConversationSession {
    return this.session;
  }

  reset(): void {
    this.session.messages = [];
    this.session.pendingIntent = null;
    this.session.lastValidation = null;
    this.session.isComplete = false;
  }

  clear(): void {
    this.reset();
  }

  /**
   * High-level entrypoint: parses natural language, manages conversation history,
   * merges pending entities, and validates against database.
   */
  async processUserTurn(
    userText: string,
    masterIngredients: Ingredient[],
    conversions: TeaspoonConversion[],
    gasConfig: GasConfig,
    recipes: Recipe[]
  ): Promise<ConversationTurnResult> {
    const history = this.session.messages.map(m => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      content: m.content,
    }));

    const { intent } = await parseKitchenIntentFromNaturalLanguage(userText, history);
    const outcome = this.processTurn(userText, intent, masterIngredients, conversions, gasConfig, recipes);
    const lastMsg = this.session.messages[this.session.messages.length - 1];

    return {
      validatedIntent: this.session.pendingIntent || intent,
      validationOutcome: outcome,
      pendingClarifications: outcome.clarifications,
      assistantReply: lastMsg ? lastMsg.content : '',
    };
  }

  /**
   * Initializes or updates pending intent from an AI parse and performs DB validation.
   */
  processTurn(
    userText: string,
    extractedIntent: UniversalKitchenIntent,
    masterIngredients: Ingredient[],
    conversions: TeaspoonConversion[],
    gasConfig: GasConfig,
    recipes: Recipe[]
  ): ValidationOutcome {
    const previousClarifications = this.session.lastValidation?.clarifications || [];

    // Record user message
    this.session.messages.push({
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toISOString(),
    });

    let mergedIntent: UniversalKitchenIntent;

    if (this.session.pendingIntent) {
      mergedIntent = this.mergeFollowUpIntent(this.session.pendingIntent, extractedIntent);
    } else {
      mergedIntent = {
        ...extractedIntent,
        recipes: extractedIntent.recipes.map(r => ({
          ...r,
          ingredients: r.ingredients.map(i => ({ ...i })),
        })),
        ingredientCreations: extractedIntent.ingredientCreations.map(c => ({ ...c })),
        ingredientUpdates: extractedIntent.ingredientUpdates.map(u => ({ ...u })),
        conversionUpdates: extractedIntent.conversionUpdates.map(c => ({ ...c })),
        clarificationAnswers: [...(extractedIntent.clarificationAnswers || [])],
      };
    }

    // Apply any explicit clarification answers
    if (extractedIntent.clarificationAnswers && extractedIntent.clarificationAnswers.length > 0) {
      mergedIntent = this.applyClarificationAnswers(
        mergedIntent,
        extractedIntent.clarificationAnswers,
        userText,
        masterIngredients
      );
    }

    // Resolve any pending AMBIGUOUS_INGREDIENT clarifications if the user answered naturally in text
    if (previousClarifications.some(c => c.category === 'AMBIGUOUS_INGREDIENT')) {
      mergedIntent = this.resolveNaturalLanguageAmbiguities(
        mergedIntent,
        userText,
        previousClarifications,
        masterIngredients
      );
    }

    // Re-validate against database
    const validation = validateKitchenIntent(
      mergedIntent,
      masterIngredients,
      conversions,
      gasConfig,
      recipes
    );

    this.session.pendingIntent = mergedIntent;
    this.session.lastValidation = validation;
    this.session.isComplete = validation.isComplete;

    // Generate assistant reply
    const assistantReply = this.generateAssistantReply(validation);

    this.session.messages.push({
      id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date().toISOString(),
      clarifications: validation.clarifications,
      isProposalReady: validation.isComplete,
    });

    return validation;
  }

  /**
   * Merges a follow-up intent into the active pending intent without losing
   * previously provided recipe quantities or ingredient purchase details.
   */
  private mergeFollowUpIntent(
    base: UniversalKitchenIntent,
    incoming: UniversalKitchenIntent
  ): UniversalKitchenIntent {
    const hasExplicitIncomingGas =
      !!incoming.gasConfigUpdate &&
      (incoming.gasConfigUpdate.cylinderPrice !== undefined ||
        incoming.gasConfigUpdate.cylinderWeightKg !== undefined ||
        incoming.gasConfigUpdate.consumptionRateKgHour !== undefined);

    const merged: UniversalKitchenIntent = {
      detectedIntent: 'COMPOUND',
      recipes: base.recipes.map(r => ({
        ...r,
        ingredients: r.ingredients.map(i => ({ ...i })),
      })),
      ingredientCreations: base.ingredientCreations.map(c => ({ ...c })),
      ingredientUpdates: base.ingredientUpdates.map(u => ({ ...u })),
      conversionUpdates: base.conversionUpdates.map(c => ({ ...c })),
      gasConfigUpdate: hasExplicitIncomingGas ? incoming.gasConfigUpdate : (base.gasConfigUpdate || null),
      clarificationAnswers: [...base.clarificationAnswers, ...incoming.clarificationAnswers],
      userFacingExplanation: incoming.userFacingExplanation || base.userFacingExplanation,
      unresolvedNotes: [...base.unresolvedNotes, ...incoming.unresolvedNotes],
    };

    // If incoming contains recipes, append or carefully merge without overwriting existing ingredient quantities
    if (incoming.recipes.length > 0) {
      incoming.recipes.forEach(incomingRec => {
        const existingIdx = merged.recipes.findIndex(
          r => r.recipeName.toLowerCase() === incomingRec.recipeName.toLowerCase()
        );
        if (existingIdx !== -1) {
          const existingRec = merged.recipes[existingIdx];
          const mergedIngredients = existingRec.ingredients.map(i => ({ ...i }));

          for (const incIng of incomingRec.ingredients) {
            const matchIdx = mergedIngredients.findIndex(
              existIng =>
                existIng.name.toLowerCase() === incIng.name.toLowerCase() ||
                areIngredientsEquivalent(existIng.name, incIng.name)
            );
            if (matchIdx === -1) {
              mergedIngredients.push({ ...incIng });
            }
          }

          merged.recipes[existingIdx] = {
            ...existingRec,
            description: incomingRec.description ?? existingRec.description,
            cookingTimeMins: incomingRec.cookingTimeMins ?? existingRec.cookingTimeMins,
            yieldAmount: incomingRec.yieldAmount ?? existingRec.yieldAmount,
            rawYieldAmount: incomingRec.rawYieldAmount || existingRec.rawYieldAmount,
            yieldType:
              incomingRec.yieldType && incomingRec.yieldType !== 'unknown'
                ? incomingRec.yieldType
                : existingRec.yieldType,
            ingredients: mergedIngredients,
          };
        } else {
          merged.recipes.push({
            ...incomingRec,
            ingredients: incomingRec.ingredients.map(i => ({ ...i })),
          });
        }
      });
    }

    // Merge ingredient additions while preserving previously provided purchaseQty, purchaseUnit, purchaseCost
    incoming.ingredientCreations.forEach(incCreate => {
      const existingIdx = merged.ingredientCreations.findIndex(
        c =>
          c.name.toLowerCase() === incCreate.name.toLowerCase() ||
          areIngredientsEquivalent(c.name, incCreate.name)
      );
      if (existingIdx !== -1) {
        const prev = merged.ingredientCreations[existingIdx];
        merged.ingredientCreations[existingIdx] = {
          ...prev,
          name: prev.name,
          purchaseQty: incCreate.purchaseQty ?? prev.purchaseQty,
          purchaseUnit: incCreate.purchaseUnit ?? prev.purchaseUnit,
          purchaseCost: incCreate.purchaseCost ?? prev.purchaseCost,
          costPerUnit: incCreate.costPerUnit ?? prev.costPerUnit,
          notes: incCreate.notes ?? prev.notes,
        };
      } else {
        merged.ingredientCreations.push({ ...incCreate });
      }
    });

    // Merge ingredient updates while preserving previously provided details
    incoming.ingredientUpdates.forEach(incUpdate => {
      const existingIdx = merged.ingredientUpdates.findIndex(
        u =>
          u.name.toLowerCase() === incUpdate.name.toLowerCase() ||
          areIngredientsEquivalent(u.name, incUpdate.name)
      );
      if (existingIdx !== -1) {
        const prev = merged.ingredientUpdates[existingIdx];
        merged.ingredientUpdates[existingIdx] = {
          ...prev,
          name: prev.name,
          purchaseQty: incUpdate.purchaseQty ?? prev.purchaseQty,
          purchaseUnit: incUpdate.purchaseUnit ?? prev.purchaseUnit,
          purchaseCost: incUpdate.purchaseCost ?? prev.purchaseCost,
          costPerUnit: incUpdate.costPerUnit ?? prev.costPerUnit,
          notes: incUpdate.notes ?? prev.notes,
        };
      } else {
        merged.ingredientUpdates.push({ ...incUpdate });
      }
    });

    // Merge conversions using canonical equivalence
    incoming.conversionUpdates.forEach(incConv => {
      const existingIdx = merged.conversionUpdates.findIndex(
        c =>
          c.name.toLowerCase() === incConv.name.toLowerCase() ||
          areIngredientsEquivalent(c.name, incConv.name)
      );
      if (existingIdx !== -1) {
        merged.conversionUpdates[existingIdx] = { ...incConv };
      } else {
        merged.conversionUpdates.push({ ...incConv });
      }
    });

    return merged;
  }

  /**
   * Applies structured clarification answers to pending recipes or master records.
   */
  private applyClarificationAnswers(
    intent: UniversalKitchenIntent,
    answers: IntentClarificationAnswer[],
    userText: string,
    masterIngredients: Ingredient[]
  ): UniversalKitchenIntent {
    const updated = { ...intent };

    for (const ans of answers) {
      if (ans.value === undefined || ans.value === null) continue;
      const targetClean = ans.targetEntity.trim().toLowerCase();

      // 0. If clarifying an ambiguous ingredient identity/form (e.g. "Dhaniya" -> "Coriander Powder")
      if (
        ans.field === 'ingredientName' ||
        ans.field === 'name' ||
        ans.field === 'form' ||
        ans.field === 'canonicalName' ||
        ans.field === 'ingredient'
      ) {
        const chosenStr = String(ans.value).trim();
        if (chosenStr) {
          const matched = matchIngredient(chosenStr, masterIngredients).matchedIngredient;
          const resolvedName = matched ? matched.name : chosenStr;
          this.replaceAmbiguousIngredientName(updated, ans.targetEntity, resolvedName);
        }
        continue;
      }

      const numVal = typeof ans.value === 'number' ? ans.value : parseFloat(String(ans.value));

      // 1. Teaspoon conversion vs. Ambiguous unit gram weight clarification
      if ((ans.field === 'tspWeightGrams' || ans.field === 'weightGrams') && !isNaN(numVal) && numVal > 0) {
        // Find matching recipe ingredients in pending recipes
        const matchingRecipeIngredients: Array<{
          ing: UniversalKitchenIntent['recipes'][0]['ingredients'][0];
          normUnit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' | null;
        }> = [];

        updated.recipes.forEach(rec => {
          rec.ingredients.forEach(ing => {
            const ingLow = ing.name.toLowerCase();
            if (
              ingLow === targetClean ||
              areIngredientsEquivalent(ing.name, ans.targetEntity) ||
              ingLow.includes(targetClean) ||
              targetClean.includes(ingLow)
            ) {
              matchingRecipeIngredients.push({
                ing,
                normUnit: normalizeUnit(ing.unit),
              });
            }
          });
        });

        const hasAmbiguousNonTspIngredient = matchingRecipeIngredients.some(
          m => m.normUnit === null || (m.ing.isAmbiguous && m.normUnit !== 'tsp')
        );
        const hasTspIngredient = matchingRecipeIngredients.some(m => m.normUnit === 'tsp');

        if (ans.field === 'tspWeightGrams' || (hasTspIngredient && !hasAmbiguousNonTspIngredient)) {
          // Teaspoon conversion ONLY: preserve the original recipe ingredient quantity (e.g., 1/5 tsp)
          const existingConvIdx = updated.conversionUpdates.findIndex(
            c =>
              c.name.toLowerCase() === targetClean ||
              areIngredientsEquivalent(c.name, ans.targetEntity)
          );
          if (existingConvIdx !== -1) {
            updated.conversionUpdates[existingConvIdx].weightGrams = numVal;
          } else {
            updated.conversionUpdates.push({ name: ans.targetEntity, weightGrams: numVal });
          }
        } else if (hasAmbiguousNonTspIngredient) {
          // Count/package unit clarification (e.g., 1/2 onion = 60g, 1 pouch = 10g):
          // Update the ambiguous recipe ingredient to grams and DO NOT pollute teaspoon conversions
          matchingRecipeIngredients.forEach(({ ing, normUnit }) => {
            if (normUnit === null || ing.isAmbiguous) {
              ing.quantity = numVal;
              ing.unit = 'g';
              ing.isAmbiguous = false;
              ing.ambiguityReason = null;
            }
          });
        } else {
          // Standalone teaspoon conversion definition
          const existingConvIdx = updated.conversionUpdates.findIndex(
            c =>
              c.name.toLowerCase() === targetClean ||
              areIngredientsEquivalent(c.name, ans.targetEntity)
          );
          if (existingConvIdx !== -1) {
            updated.conversionUpdates[existingConvIdx].weightGrams = numVal;
          } else {
            updated.conversionUpdates.push({ name: ans.targetEntity, weightGrams: numVal });
          }
        }
      }

      // 2. If purchaseCost / purchasePrice / purchaseQty clarification
      if (
        ans.field === 'purchaseCost' ||
        ans.field === 'purchasePrice' ||
        ans.field === 'purchaseQty'
      ) {
        const parsedSpecs = parsePurchaseDetails(ans, userText);
        const existingCreate = updated.ingredientCreations.find(
          c =>
            c.name.toLowerCase() === targetClean ||
            areIngredientsEquivalent(c.name, ans.targetEntity) ||
            c.name.toLowerCase().includes(targetClean) ||
            targetClean.includes(c.name.toLowerCase())
        );

        if (existingCreate) {
          if (parsedSpecs.purchaseCost !== undefined && !isNaN(parsedSpecs.purchaseCost)) {
            existingCreate.purchaseCost = parsedSpecs.purchaseCost;
          }
          if (parsedSpecs.purchaseQty !== undefined && !isNaN(parsedSpecs.purchaseQty)) {
            existingCreate.purchaseQty = parsedSpecs.purchaseQty;
          }
          if (parsedSpecs.purchaseUnit) {
            existingCreate.purchaseUnit = parsedSpecs.purchaseUnit;
          }
        } else if (parsedSpecs.purchaseCost !== undefined && !isNaN(parsedSpecs.purchaseCost)) {
          updated.ingredientCreations.push({
            name: ans.targetEntity,
            purchaseCost: parsedSpecs.purchaseCost,
            purchaseQty: parsedSpecs.purchaseQty,
            purchaseUnit: parsedSpecs.purchaseUnit,
          });
        }
      }

      // 3. If yieldAmount clarification
      if (ans.field === 'yieldAmount' && !isNaN(numVal) && numVal > 0) {
        updated.recipes.forEach(rec => {
          if (
            rec.recipeName.toLowerCase().includes(targetClean) ||
            targetClean.includes(rec.recipeName.toLowerCase()) ||
            updated.recipes.length === 1
          ) {
            rec.yieldAmount = numVal;
            if (ans.unit === 'piece' || ans.unit === 'pieces' || ans.unit === 'parathas') {
              rec.yieldType = 'piece';
            } else if (ans.unit === 'g' || ans.unit === 'grams') {
              rec.yieldType = 'weight';
            }
          }
        });
      }
    }

    return updated;
  }

  /**
   * Resolves pending AMBIGUOUS_INGREDIENT clarifications when the user replies naturally
   * in the conversation (e.g., "Coriander powder", "I meant dhaniya patti", "Use Toor dal").
   */
  private resolveNaturalLanguageAmbiguities(
    intent: UniversalKitchenIntent,
    userText: string,
    previousClarifications: ClarificationPrompt[],
    masterIngredients: Ingredient[]
  ): UniversalKitchenIntent {
    const normUserText = normalizeIngredientText(userText);
    if (!normUserText) return intent;

    const updated = { ...intent };
    const ambiguousClarifications = previousClarifications.filter(
      c => c.category === 'AMBIGUOUS_INGREDIENT'
    );

    for (const clar of ambiguousClarifications) {
      const candidateNames = clar.candidates || [];
      let chosenCandidate: string | null = null;

      // 1. Check if userText directly names or matches one of the candidate ingredients
      for (const candName of candidateNames) {
        const normCand = normalizeIngredientText(candName);
        if (
          normUserText === normCand ||
          normUserText.includes(normCand) ||
          areIngredientsEquivalent(userText, candName)
        ) {
          chosenCandidate = candName;
          break;
        }
      }

      // 2. Check if any token phrase in userText resolves to one of the candidate ingredients via matchIngredient
      if (!chosenCandidate && candidateNames.length > 0) {
        const candidateObjects = masterIngredients.filter(m => candidateNames.includes(m.name));
        const directMatch = matchIngredient(userText, candidateObjects);
        if (directMatch.matchedIngredient) {
          chosenCandidate = directMatch.matchedIngredient.name;
        }
      }

      // 3. If single candidate (fuzzy typo confirmation) and user replies affirmatively ("yes", "correct", "confirm")
      if (
        !chosenCandidate &&
        candidateNames.length === 1 &&
        /\b(yes|yeah|yep|correct|right|confirm|use existing|same)\b/i.test(userText)
      ) {
        chosenCandidate = candidateNames[0];
      }

      if (chosenCandidate) {
        this.replaceAmbiguousIngredientName(updated, clar.targetEntity, chosenCandidate);
      }
    }

    return updated;
  }

  /**
   * Replaces an ambiguous ingredient name with the confirmed canonical ingredient name
   * while preserving original recipe quantities and units.
   */
  private replaceAmbiguousIngredientName(
    intent: UniversalKitchenIntent,
    ambiguousName: string,
    resolvedName: string
  ): void {
    const targetLow = ambiguousName.trim().toLowerCase();

    intent.recipes.forEach(rec => {
      rec.ingredients.forEach(ing => {
        if (ing.name.trim().toLowerCase() === targetLow) {
          ing.name = resolvedName;
        }
      });
    });

    intent.ingredientCreations.forEach(c => {
      if (c.name.trim().toLowerCase() === targetLow) {
        c.name = resolvedName;
      }
    });

    intent.ingredientUpdates.forEach(u => {
      if (u.name.trim().toLowerCase() === targetLow) {
        u.name = resolvedName;
      }
    });

    intent.conversionUpdates.forEach(c => {
      if (c.name.trim().toLowerCase() === targetLow) {
        c.name = resolvedName;
      }
    });
  }

  /**
   * Builds conversational assistant response.
   */
  private generateAssistantReply(validation: ValidationOutcome): string {
    if (validation.isComplete) {
      let reply = `✅ I have verified all ingredients, conversions, and parameters for your request.\n\n`;
      if (validation.recipes.length > 0) {
        const r = validation.recipes[0];
        reply += `**Recipe Ready for Review:** "${r.recipeName}" (${r.rows.length} ingredients, yield: ${r.yieldAmount} ${r.yieldType === 'piece' ? 'pieces' : 'g'}).\n`;
      }
      if (validation.ingredientMutations.length > 0) {
        reply += `**Proposed Ingredients:** ${validation.ingredientMutations.map(m => `${m.name} (₹${m.purchaseCost}/${m.purchaseQty}${m.purchaseUnit})`).join(', ')}.\n`;
      }
      if (validation.conversionMutations.length > 0) {
        reply += `**Proposed Conversions:** ${validation.conversionMutations.map(c => `1 tsp ${c.name} = ${c.weightGrams}g`).join(', ')}.\n`;
      }
      if (validation.gasMutation) {
        reply += `**Proposed Gas Rate:** ₹${validation.gasMutation.cylinderPrice} for ${validation.gasMutation.cylinderWeightKg}kg cylinder.\n`;
      }
      reply += `\nPlease review the complete proposal below and confirm to save it to your database.`;
      return reply;
    }

    // Clarifications needed
    let reply = `I've parsed your input, but need a few details to calculate accurate costing:\n\n`;
    validation.clarifications.forEach((c, idx) => {
      reply += `${idx + 1}. **${c.targetEntity}**: ${c.question}`;
      if (c.suggestedDefault) {
        reply += ` *(Suggested default: ${c.suggestedDefault.description})*`;
      }
      reply += `\n`;
    });
    reply += `\nYou can reply in plain words (e.g. "Onion is 60g, 1 tsp kalonji is 2g, paneer price is ₹110 for 200g").`;
    return reply;
  }
}
