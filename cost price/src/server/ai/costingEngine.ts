/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../../types';
import {
  calculateGasCosts,
  getEffectiveQuantity,
  calculateRecipeCosts,
  calculateDefaultServingCost,
  getDefaultServingAmount,
  getDefaultServingUnit,
  RecipeCostBreakdown,
} from '../../utils';
import { getCostPerUnit } from '../../data';
import { ContextSnapshot } from './types';

export {
  calculateGasCosts,
  getEffectiveQuantity,
  calculateRecipeCosts,
  calculateDefaultServingCost,
  getDefaultServingAmount,
  getDefaultServingUnit,
  getCostPerUnit,
};

export interface RecipeImpact {
  recipeName: string;
  oldBatchCost: number;
  newBatchCost: number;
  oldServingCost: number;
  newServingCost: number;
}

/**
 * Calculates recipe cost breakdown for an existing recipe or modified snapshot.
 */
export function getRecipeBreakdown(
  recipe: Recipe,
  context: ContextSnapshot
): RecipeCostBreakdown {
  return calculateRecipeCosts(
    recipe,
    context.ingredients,
    context.conversions,
    context.gasConfig
  );
}

/**
 * Finds all recipes using an ingredient and computes the exact cost impact if that ingredient changes.
 */
export function calculateIngredientChangeImpact(
  ingredientId: string,
  newCostPerUnit: number,
  context: ContextSnapshot
): RecipeImpact[] {
  const impacts: RecipeImpact[] = [];

  const tempIngredients = context.ingredients.map(ing =>
    ing.id === ingredientId ? { ...ing, costPerUnit: newCostPerUnit } : ing
  );

  for (const recipe of context.recipes) {
    const uses = recipe.ingredients.some(ri => ri.ingredientId === ingredientId);
    if (!uses) continue;

    const oldCost = calculateDefaultServingCost(
      recipe,
      context.ingredients,
      context.conversions,
      context.gasConfig
    );
    const newCost = calculateDefaultServingCost(
      recipe,
      tempIngredients,
      context.conversions,
      context.gasConfig
    );

    impacts.push({
      recipeName: recipe.name,
      oldBatchCost: Number(oldCost.totalBatchCost.toFixed(2)),
      newBatchCost: Number(newCost.totalBatchCost.toFixed(2)),
      oldServingCost: Number(oldCost.costPrice.toFixed(2)),
      newServingCost: Number(newCost.costPrice.toFixed(2)),
    });
  }

  return impacts;
}

/**
 * Computes exact cost impacts on all recipes if gas config changes.
 */
export function calculateGasChangeImpact(
  newGasConfig: GasConfig,
  context: ContextSnapshot
): RecipeImpact[] {
  return context.recipes.map(recipe => {
    const oldCost = calculateDefaultServingCost(
      recipe,
      context.ingredients,
      context.conversions,
      context.gasConfig
    );
    const newCost = calculateDefaultServingCost(
      recipe,
      context.ingredients,
      context.conversions,
      newGasConfig
    );

    return {
      recipeName: recipe.name,
      oldBatchCost: Number(oldCost.totalBatchCost.toFixed(2)),
      newBatchCost: Number(newCost.totalBatchCost.toFixed(2)),
      oldServingCost: Number(oldCost.costPrice.toFixed(2)),
      newServingCost: Number(newCost.costPrice.toFixed(2)),
    };
  });
}
