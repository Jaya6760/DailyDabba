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

export type ValidationIssueSeverity = 'error' | 'warning';

export type ValidationIssueType =
  | 'missing_ingredient'          // Ingredient not found in master database
  | 'missing_price'               // Ingredient price is missing, <= 0, or invalid
  | 'missing_teaspoon_conversion' // Unit is tsp, but no verified conversion exists in conversions table
  | 'unsupported_unit'            // Unit is not one of 'g', 'kg', 'ml', 'litre', 'tsp'
  | 'ambiguous_quantity'          // Quantity is <= 0 or invalid
  | 'missing_yield'               // Yield amount is <= 0 or invalid
  | 'missing_cooking_time';       // Cooking time is < 0 or invalid

export interface RecipeValidationIssue {
  type: ValidationIssueType;
  severity: ValidationIssueSeverity;
  message: string;
  ingredientId?: string;
  ingredientLocalId?: string;
  ingredientName?: string;
  currentUnit?: string;
  currentQuantity?: number;
  suggestedDefaultValue?: number; // e.g., 4g for tsp (clearly labeled as unverified suggestion)
}

export interface RecipeValidationResult {
  isComplete: boolean; // True ONLY if all required pricing, conversions, quantities and yield are verified
  isValid: boolean;    // False if critical errors (e.g. yield <= 0, quantity <= 0)
  issues: RecipeValidationIssue[];
}

