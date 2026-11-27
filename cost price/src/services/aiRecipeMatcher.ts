/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Bridges untrusted AI parsed recipe data to deterministic Supabase master ingredients,
 * conversions, and validation logic.
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe, RecipeIngredient } from '../types';
import { RawAIParsedRecipe, RawAIParsedIngredient } from '../server/ai/types';
import { calculateRecipeCosts, RecipeCostBreakdown, SUPPORTED_UNITS } from '../utils';
import { matchIngredient, findMatchingConversion } from './ingredientMatcher';

export interface MatchedIngredientDetail {
  extractedIngredient: RawAIParsedIngredient;
  matchedIngredient: Ingredient | null;
  candidateIngredients: Ingredient[];
  normalizedUnit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' | null;
  rawUnit: string;
  isMatched: boolean;
  isUnsupportedUnit: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  missingConversion: boolean;
}

export interface IngestedRecipeReview {
  draftRecipe: Recipe;
  breakdown: RecipeCostBreakdown;
  matchedDetails: MatchedIngredientDetail[];
  unresolvedCount: number;
}

/**
 * Normalizes input unit strings to supported app units.
 */
export function normalizeUnit(unitStr: string | null | undefined): 'g' | 'kg' | 'ml' | 'litre' | 'tsp' | null {
  if (!unitStr) return null;
  const clean = unitStr.trim().toLowerCase();

  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(clean)) return 'g';
  if (['kg', 'kgs', 'kilo', 'kilogram', 'kilograms'].includes(clean)) return 'kg';
  if (['ml', 'mls', 'millilitre', 'milliliter', 'millilitres'].includes(clean)) return 'ml';
  if (['l', 'litre', 'liter', 'litres', 'liters'].includes(clean)) return 'litre';
  if (['tsp', 'tsps', 'teaspoon', 'teaspoons'].includes(clean)) return 'tsp';

  return null;
}

/**
 * Attempts candidate matching of an extracted ingredient name against the database
 * using the single canonical ingredient matching engine.
 */
export function findCandidateMatches(
  extractedName: string,
  ingredientsList: Ingredient[]
): { bestMatch: Ingredient | null; candidates: Ingredient[] } {
  const result = matchIngredient(extractedName, ingredientsList);
  return {
    bestMatch: result.matchedIngredient,
    candidates: result.candidates,
  };
}

/**
 * Transforms untrusted AI parsed recipe data into a reviewable draft recipe
 * evaluated against the deterministic costing engine.
 */
export function ingestAIRecipe(
  aiRecipe: RawAIParsedRecipe,
  ingredientsList: Ingredient[],
  conversionsList: TeaspoonConversion[],
  gasConfig: GasConfig
): IngestedRecipeReview {
  const matchedDetails: MatchedIngredientDetail[] = [];
  const recipeIngredients: RecipeIngredient[] = [];

  aiRecipe.ingredients.forEach((ing, index) => {
    const { bestMatch, candidates } = findCandidateMatches(ing.name, ingredientsList);
    const normalized = normalizeUnit(ing.unit);
    const isUnsupported = !normalized && ing.unit.trim().length > 0;

    // Check if teaspoon conversion is missing
    let missingConversion = false;
    if (normalized === 'tsp') {
      const matchedConv = findMatchingConversion(bestMatch?.name || ing.name, conversionsList);
      missingConversion = !matchedConv || matchedConv.weightGrams <= 0;
    }

    const detail: MatchedIngredientDetail = {
      extractedIngredient: ing,
      matchedIngredient: bestMatch,
      candidateIngredients: candidates,
      normalizedUnit: normalized,
      rawUnit: ing.unit,
      isMatched: !!bestMatch,
      isUnsupportedUnit: isUnsupported,
      isAmbiguous: ing.isAmbiguous || ing.quantity === null || ing.quantity <= 0 || isUnsupported,
      ambiguityReason: ing.ambiguityReason || (isUnsupported ? `Unsupported unit "${ing.unit}"` : undefined),
      missingConversion,
    };
    matchedDetails.push(detail);

    // Build RecipeIngredient row
    recipeIngredients.push({
      id: `ai_ri_${index}_${Date.now()}`,
      ingredientId: bestMatch ? bestMatch.id : `unmatched_${index}`,
      name: bestMatch ? bestMatch.name : ing.name,
      quantity: ing.quantity && ing.quantity > 0 ? ing.quantity : 0,
      unit: (normalized || 'g') as any,
    });
  });

  const yieldType: 'weight' | 'piece' = aiRecipe.yieldType === 'piece' ? 'piece' : 'weight';
  const yieldAmount = aiRecipe.yieldAmount && aiRecipe.yieldAmount > 0 ? aiRecipe.yieldAmount : 1000;
  const cookingTimeMins = aiRecipe.cookingTimeMins !== null && aiRecipe.cookingTimeMins >= 0 ? aiRecipe.cookingTimeMins : 10;

  const draftRecipe: Recipe = {
    id: `rec_ai_${Date.now()}`,
    name: aiRecipe.recipeName.trim(),
    yieldType,
    yieldAmount,
    cookingTimeMins,
    createdAt: new Date().toISOString(),
    ingredients: recipeIngredients,
  };

  const breakdown = calculateRecipeCosts(draftRecipe, ingredientsList, conversionsList, gasConfig);

  return {
    draftRecipe,
    breakdown,
    matchedDetails,
    unresolvedCount: breakdown.unresolvedIssues.length,
  };
}
