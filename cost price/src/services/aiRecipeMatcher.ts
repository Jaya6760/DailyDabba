/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Bridges untrusted AI parsed recipe data to deterministic Supabase master ingredients,
 * conversions, and validation logic.
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe, RecipeIngredient } from '../types';
import { RawAIParsedRecipe, RawAIParsedIngredient } from '../server/ai/types';
import { calculateRecipeCosts, RecipeCostBreakdown, SUPPORTED_UNITS } from '../utils';

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

const COMMON_ALIASES: Record<string, string[]> = {
  poha: ['poha'],
  rice: ['rice'],
  'wheat flour': ['wheat flour', 'atta', 'gehu atta', 'flour'],
  salt: ['salt', 'namak'],
  haldi: ['haldi', 'turmeric'],
  jeera: ['jeera', 'cumin', 'jeera seeds'],
  'refined oil': ['refined oil', 'oil', 'cooking oil'],
  'mustard oil': ['mustard oil', 'sarson oil'],
  'amul ghee': ['amul ghee', 'ghee', 'desi ghee'],
  groundnut: ['groundnut', 'peanut', 'peanuts', 'mungfali'],
  sugar: ['sugar', 'cheeni'],
  'moong dal': ['moong dal', 'moong'],
  'tur dal': ['tur dal', 'arhar dal', 'toor dal'],
  rajma: ['rajma', 'kidney beans'],
  chole: ['chole', 'chickpeas', 'kabuli chana'],
  chana: ['chana', 'kala chana'],
  ajwain: ['ajwain', 'carom seeds'],
  'garam masala': ['garam masala'],
  'black salt': ['black salt', 'kala namak'],
  'red chilli flakes': ['red chilli flakes', 'chilli flakes', 'chili flakes'],
};

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
 * Attempts candidate matching of an extracted ingredient name against the database.
 */
export function findCandidateMatches(
  extractedName: string,
  ingredientsList: Ingredient[]
): { bestMatch: Ingredient | null; candidates: Ingredient[] } {
  const clean = extractedName.trim().toLowerCase();

  // 1. Exact match
  const exact = ingredientsList.find(i => i.name.trim().toLowerCase() === clean);
  if (exact) {
    return { bestMatch: exact, candidates: [exact] };
  }

  // 2. Alias lookup
  for (const [masterKey, aliases] of Object.entries(COMMON_ALIASES)) {
    if (aliases.some(a => clean === a || clean.includes(a) || a.includes(clean))) {
      const aliasMatch = ingredientsList.find(i => i.name.trim().toLowerCase() === masterKey);
      if (aliasMatch) {
        return { bestMatch: aliasMatch, candidates: [aliasMatch] };
      }
    }
  }

  // 3. Substring / partial matches
  const partials = ingredientsList.filter(
    i => clean.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(clean)
  );

  return {
    bestMatch: partials.length === 1 ? partials[0] : null,
    candidates: partials.slice(0, 5),
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
      const cleanName = (bestMatch?.name || ing.name).trim().toLowerCase();
      const hasConv = conversionsList.some(c => c.name.trim().toLowerCase() === cleanName && c.weightGrams > 0);
      missingConversion = !hasConv;
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
