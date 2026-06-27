/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe, RecipeIngredient, DishServingCost } from './types';

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
  value: number; // in final base unit (g or ml)
  baseUnit: 'g' | 'ml';
  isTsp: boolean;
  isTspDefaultUsed: boolean;
  conversionGrams: number;
}

export function getEffectiveQuantity(
  reqIngredient: RecipeIngredient,
  conversions: TeaspoonConversion[]
): EffectiveQuantityResult {
  const { quantity, unit, name } = reqIngredient;
  
  if (unit === 'kg') {
    return { value: quantity * 1000, baseUnit: 'g', isTsp: false, isTspDefaultUsed: false, conversionGrams: 0 };
  }
  if (unit === 'g') {
    return { value: quantity, baseUnit: 'g', isTsp: false, isTspDefaultUsed: false, conversionGrams: 0 };
  }
  if (unit === 'litre') {
    return { value: quantity * 1000, baseUnit: 'ml', isTsp: false, isTspDefaultUsed: false, conversionGrams: 0 };
  }
  if (unit === 'ml') {
    return { value: quantity, baseUnit: 'ml', isTsp: false, isTspDefaultUsed: false, conversionGrams: 0 };
  }
  
  // Tsp conversion
  if (unit === 'tsp') {
    const cleanName = name.trim().toLowerCase();
    const match = conversions.find(c => c.name.trim().toLowerCase() === cleanName);
    
    if (match) {
      return {
        value: quantity * match.weightGrams,
        baseUnit: 'g',
        isTsp: true,
        isTspDefaultUsed: false,
        conversionGrams: match.weightGrams,
      };
    } else {
      // Default fallback conversion (e.g. 4g per tsp)
      const defaultGrams = 4;
      return {
        value: quantity * defaultGrams,
        baseUnit: 'g',
        isTsp: true,
        isTspDefaultUsed: true,
        conversionGrams: defaultGrams,
      };
    }
  }
  
  return { value: quantity, baseUnit: 'g', isTsp: false, isTspDefaultUsed: false, conversionGrams: 0 };
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
}

export function calculateRecipeCosts(
  recipe: Recipe,
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig
): RecipeCostBreakdown {
  const gasCalcs = calculateGasCosts(gasConfig);
  const gasCost = gasCalcs.costPerMinute * recipe.cookingTimeMins;
  
  let ingredientsCost = 0;
  const rows: CalculatedIngredientRow[] = recipe.ingredients.map(ri => {
    // find matched ingredient in master base
    const matched = ingredients.find(i => i.id === ri.ingredientId);
    const eff = getEffectiveQuantity(ri, conversions);
    
    const ratePerBaseUnit = matched ? matched.costPerUnit : 0;
    const itemCost = eff.value * ratePerBaseUnit;
    
    ingredientsCost += itemCost;
    
    return {
      recipeIngredient: ri,
      matchedIngredient: matched,
      effectiveQty: eff.value,
      baseUnit: eff.baseUnit,
      ratePerBaseUnit,
      cost: itemCost,
      isTsp: eff.isTsp,
      isTspDefaultUsed: eff.isTspDefaultUsed,
      conversionGrams: eff.conversionGrams,
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
