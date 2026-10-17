/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Ingredient,
  TeaspoonConversion,
  GasConfig,
  Recipe,
  RecipeIngredient,
  DishServingCost,
  RecipeValidationIssue,
  RecipeValidationResult,
} from './types';

export interface GasCalculated {
  costPerKg: number;
  costPerHour: number;
  costPerMinute: number;
}

export function calculateGasCosts(config: GasConfig): GasCalculated {
  const { cylinderPrice, cylinderWeightKg, consumptionRateKgHour } = config;
  if (cylinderWeightKg <= 0) return { costPerKg: 0, costPerHour: 0, costPerMinute: 0 };
  
  const costPerKg = cylinderPrice / cylinderWeightKg;
  const costPerHour = costPerKg * consumptionRateKgHour;
  const costPerMinute = costPerHour / 60;
  
  return {
    costPerKg,
    costPerHour,
    costPerMinute,
  };
}

export interface EffectiveQuantityResult {
  value: number; // in final base unit (g or ml). 0 if unconvertible or missing
  baseUnit: 'g' | 'ml';
  isTsp: boolean;
  conversionFound: boolean;
  conversionGrams: number;
  isUnsupportedUnit?: boolean;
  error?: string;
  /** @deprecated Kept for backward compatibility. Always false now that silent 4g fallback is removed. */
  isTspDefaultUsed: boolean;
}

/**
 * Standard supported units in the application.
 */
export const SUPPORTED_UNITS = ['g', 'kg', 'ml', 'litre', 'tsp'] as const;

export function getEffectiveQuantity(
  reqIngredient: RecipeIngredient,
  conversions: TeaspoonConversion[]
): EffectiveQuantityResult {
  const { quantity, unit, name } = reqIngredient;

  if (quantity <= 0 || isNaN(quantity)) {
    return {
      value: 0,
      baseUnit: unit === 'litre' || unit === 'ml' ? 'ml' : 'g',
      isTsp: unit === 'tsp',
      conversionFound: false,
      conversionGrams: 0,
      isTspDefaultUsed: false,
      error: `Invalid quantity "${quantity}" for "${name}".`,
    };
  }
  
  if (unit === 'kg') {
    return { value: quantity * 1000, baseUnit: 'g', isTsp: false, conversionFound: true, conversionGrams: 0, isTspDefaultUsed: false };
  }
  if (unit === 'g') {
    return { value: quantity, baseUnit: 'g', isTsp: false, conversionFound: true, conversionGrams: 0, isTspDefaultUsed: false };
  }
  if (unit === 'litre') {
    return { value: quantity * 1000, baseUnit: 'ml', isTsp: false, conversionFound: true, conversionGrams: 0, isTspDefaultUsed: false };
  }
  if (unit === 'ml') {
    return { value: quantity, baseUnit: 'ml', isTsp: false, conversionFound: true, conversionGrams: 0, isTspDefaultUsed: false };
  }
  
  // Tsp conversion - REMOVED SILENT 4g FALLBACK
  if (unit === 'tsp') {
    const cleanName = (name || '').trim().toLowerCase();
    const match = conversions.find(c => c.name.trim().toLowerCase() === cleanName);
    
    if (match && match.weightGrams > 0) {
      return {
        value: quantity * match.weightGrams,
        baseUnit: 'g',
        isTsp: true,
        conversionFound: true,
        conversionGrams: match.weightGrams,
        isTspDefaultUsed: false,
      };
    } else {
      // Return 0 and flag conversionFound: false. Never assume 4g silently.
      return {
        value: 0,
        baseUnit: 'g',
        isTsp: true,
        conversionFound: false,
        conversionGrams: 0,
        isTspDefaultUsed: false,
        error: `Missing verified teaspoon conversion for "${name}".`,
      };
    }
  }
  
  // Unsupported unit - REMOVED SILENT FALLBACK TO GRAMS
  return {
    value: 0,
    baseUnit: 'g',
    isTsp: false,
    conversionFound: false,
    conversionGrams: 0,
    isTspDefaultUsed: false,
    isUnsupportedUnit: true,
    error: `Unsupported unit "${unit}" for "${name}". Supported units are g, kg, ml, litre, and tsp with verified conversion.`,
  };
}

/**
 * Validates a recipe against database records and required parameters.
 * Identifies missing ingredients, unverified teaspoon conversions, invalid prices,
 * unsupported units, and ambiguous quantities.
 */
export function validateRecipe(
  recipe: Recipe,
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[]
): RecipeValidationResult {
  const issues: RecipeValidationIssue[] = [];

  // 1. Yield validation
  if (typeof recipe.yieldAmount !== 'number' || isNaN(recipe.yieldAmount) || recipe.yieldAmount <= 0) {
    issues.push({
      type: 'missing_yield',
      severity: 'error',
      message: 'Recipe yield must be a positive number greater than 0.',
    });
  }

  // 2. Cooking time validation
  if (typeof recipe.cookingTimeMins !== 'number' || isNaN(recipe.cookingTimeMins) || recipe.cookingTimeMins < 0) {
    issues.push({
      type: 'missing_cooking_time',
      severity: 'error',
      message: 'Cooking time must be 0 minutes or greater.',
    });
  }

  // 3. Ingredients presence
  if (!recipe.ingredients || recipe.ingredients.length === 0) {
    issues.push({
      type: 'missing_ingredient',
      severity: 'error',
      message: 'Recipe must contain at least one ingredient.',
    });
  } else {
    for (const ri of recipe.ingredients) {
      // Quantity validation
      if (typeof ri.quantity !== 'number' || isNaN(ri.quantity) || ri.quantity <= 0) {
        issues.push({
          type: 'ambiguous_quantity',
          severity: 'error',
          ingredientId: ri.ingredientId,
          ingredientLocalId: ri.id,
          ingredientName: ri.name,
          currentQuantity: ri.quantity,
          currentUnit: ri.unit,
          message: `Ingredient "${ri.name || 'unnamed'}" has an invalid or zero quantity (${ri.quantity}).`,
        });
      }

      // Unit conversion validation
      const eff = getEffectiveQuantity(ri, conversions);
      if (eff.isUnsupportedUnit) {
        issues.push({
          type: 'unsupported_unit',
          severity: 'error',
          ingredientId: ri.ingredientId,
          ingredientLocalId: ri.id,
          ingredientName: ri.name,
          currentQuantity: ri.quantity,
          currentUnit: ri.unit,
          message: `Unit "${ri.unit}" for "${ri.name}" is not supported. Please convert to g, kg, ml, or litre.`,
        });
      } else if (ri.unit === 'tsp' && !eff.conversionFound) {
        issues.push({
          type: 'missing_teaspoon_conversion',
          severity: 'error',
          ingredientId: ri.ingredientId,
          ingredientLocalId: ri.id,
          ingredientName: ri.name,
          currentQuantity: ri.quantity,
          currentUnit: ri.unit,
          suggestedDefaultValue: 4, // Clearly labeled unverified suggestion
          message: `We don't have a verified weight for 1 teaspoon of "${ri.name}".`,
        });
      }

      // Master database match validation
      const matched = ingredients.find(i => i.id === ri.ingredientId);
      if (!matched) {
        issues.push({
          type: 'missing_ingredient',
          severity: 'error',
          ingredientId: ri.ingredientId,
          ingredientLocalId: ri.id,
          ingredientName: ri.name,
          currentQuantity: ri.quantity,
          currentUnit: ri.unit,
          message: `Ingredient "${ri.name}" is not matched to any master database record.`,
        });
      } else {
        // Pricing validity
        if (typeof matched.costPerUnit !== 'number' || isNaN(matched.costPerUnit) || matched.costPerUnit <= 0) {
          issues.push({
            type: 'missing_price',
            severity: 'error',
            ingredientId: ri.ingredientId,
            ingredientLocalId: ri.id,
            ingredientName: ri.name,
            currentQuantity: ri.quantity,
            currentUnit: ri.unit,
            message: `Ingredient "${matched.name}" has no valid purchase price or cost per unit.`,
          });
        }
      }
    }
  }

  const hasCriticalErrors = issues.some(
    i => i.severity === 'error' && (i.type === 'missing_yield' || i.type === 'ambiguous_quantity')
  );
  const isComplete = issues.length === 0;

  return {
    isComplete,
    isValid: !hasCriticalErrors,
    issues,
  };
}

export interface CalculatedIngredientRow {
  recipeIngredient: RecipeIngredient;
  matchedIngredient: Ingredient | undefined;
  effectiveQty: number; // in g or ml
  baseUnit: 'g' | 'ml';
  ratePerBaseUnit: number; // ₹ per g or ₹ per ml
  cost: number;
  isTsp: boolean;
  isTspDefaultUsed: boolean;
  conversionGrams: number;
  isUnresolved: boolean;
  unresolvedReason?: string;
  issues: RecipeValidationIssue[];
}

export interface RecipeCostBreakdown {
  recipe: Recipe;
  ingredientsCost: number;
  gasCost: number;
  totalBatchCost: number;
  rows: CalculatedIngredientRow[];
  yieldType: 'weight' | 'piece';
  yieldAmount: number;
  costPer100g: number;
  costPerPiece: number;
  isComplete: boolean;
  unresolvedIssues: RecipeValidationIssue[];
  hasMissingCosts: boolean;
}

export function calculateRecipeCosts(
  recipe: Recipe,
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig
): RecipeCostBreakdown {
  const validation = validateRecipe(recipe, ingredients, conversions);
  const gasCalcs = calculateGasCosts(gasConfig);
  const gasCost = gasCalcs.costPerMinute * (recipe.cookingTimeMins > 0 ? recipe.cookingTimeMins : 0);
  
  let ingredientsCost = 0;
  let hasMissingCosts = false;

  const rows: CalculatedIngredientRow[] = (recipe.ingredients || []).map(ri => {
    const matched = ingredients.find(i => i.id === ri.ingredientId);
    const eff = getEffectiveQuantity(ri, conversions);
    
    // Row-specific issues
    const rowIssues = validation.issues.filter(
      issue => issue.ingredientLocalId === ri.id || (issue.ingredientId && issue.ingredientId === ri.ingredientId)
    );

    const isRowUnresolved =
      !matched ||
      !matched.costPerUnit ||
      matched.costPerUnit <= 0 ||
      (ri.unit === 'tsp' && !eff.conversionFound) ||
      !!eff.isUnsupportedUnit ||
      ri.quantity <= 0;

    let ratePerBaseUnit = 0;
    let itemCost = 0;

    if (!isRowUnresolved && matched) {
      ratePerBaseUnit = matched.costPerUnit;
      itemCost = eff.value * ratePerBaseUnit;
      ingredientsCost += itemCost;
    } else {
      hasMissingCosts = true;
    }

    return {
      recipeIngredient: ri,
      matchedIngredient: matched,
      effectiveQty: eff.value,
      baseUnit: eff.baseUnit,
      ratePerBaseUnit,
      cost: itemCost,
      isTsp: eff.isTsp,
      isTspDefaultUsed: false,
      conversionGrams: eff.conversionGrams,
      isUnresolved: isRowUnresolved,
      unresolvedReason: rowIssues.map(i => i.message).join('; ') || (isRowUnresolved ? 'Unresolved calculation' : undefined),
      issues: rowIssues,
    };
  });
  
  const totalBatchCost = ingredientsCost + gasCost;
  
  // Cost per 100g
  let costPer100g = 0;
  if (recipe.yieldType === 'weight' && recipe.yieldAmount > 0) {
    costPer100g = (totalBatchCost / recipe.yieldAmount) * 100;
  }
  
  // Cost per piece
  let costPerPiece = 0;
  if (recipe.yieldType === 'piece' && recipe.yieldAmount > 0) {
    costPerPiece = totalBatchCost / recipe.yieldAmount;
  }

  const isComplete = validation.isComplete && !hasMissingCosts;
  
  return {
    recipe,
    ingredientsCost,
    gasCost,
    totalBatchCost,
    rows,
    yieldType: recipe.yieldType,
    yieldAmount: recipe.yieldAmount,
    costPer100g,
    costPerPiece,
    isComplete,
    unresolvedIssues: validation.issues,
    hasMissingCosts,
  };
}

export function getDefaultServingAmount(recipe: Recipe): number {
  if (recipe.defaultServingAmount && recipe.defaultServingAmount > 0) {
    return recipe.defaultServingAmount;
  }
  return recipe.yieldType === 'weight' ? 100 : 1;
}

export function getDefaultServingUnit(recipe: Recipe): 'g' | 'pieces' {
  return recipe.yieldType === 'weight' ? 'g' : 'pieces';
}

export function calculateDefaultServingCost(
  recipe: Recipe,
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig
): DishServingCost {
  const breakdown = calculateRecipeCosts(recipe, ingredients, conversions, gasConfig);
  const defaultServingAmount = getDefaultServingAmount(recipe);
  const costPrice = recipe.yieldAmount > 0
    ? (breakdown.totalBatchCost / recipe.yieldAmount) * defaultServingAmount
    : 0;

  return {
    id: recipe.id,
    recipeId: recipe.id,
    dishName: recipe.name,
    defaultServingAmount,
    defaultServingUnit: getDefaultServingUnit(recipe),
    costPrice,
    totalBatchCost: breakdown.totalBatchCost,
    updatedAt: new Date().toISOString(),
  };
}
