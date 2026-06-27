/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Ingredient {
  id: string;
  name: string;
  purchaseQty: number; // e.g., 1
  purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
  purchaseCost: number; // e.g., 59.8
  costPerUnit: number; // calculated cost per base unit (g or ml)
}

export interface TeaspoonConversion {
  id: string;
  name: string; // Ingredient name (case-insensitive matched)
  weightGrams: number; // Weight in grams for 1 Teaspoon (tsp)
}

export interface GasConfig {
  cylinderPrice: number; // ₹ e.g. 950
  cylinderWeightKg: number; // kg e.g. 14.2
  consumptionRateKgHour: number; // kg per hour e.g. 0.25
}

export interface RecipeIngredient {
  id: string; // local UI id
  ingredientId: string; // reference to Ingredient id
  name: string; // Ingredient Name at creation (or typed query)
  quantity: number;
  unit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp';
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  yieldType: 'weight' | 'piece';
  yieldAmount: number; // e.g., 1350 (grams) or 12 (pieces)
  defaultServingAmount?: number; // e.g., 100 grams or 1 piece
  cookingTimeMins: number; // e.g., 10 (minutes)
  createdAt: string;
}

export interface DishServingCost {
  id: string;
  recipeId: string;
  dishName: string;
  defaultServingAmount: number;
  defaultServingUnit: 'g' | 'pieces';
  costPrice: number;
  totalBatchCost: number;
  updatedAt: string;
}
