/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from './types';

// Let's helper function to calculate cost per unit (base unit: g or ml)
export function getCostPerUnit(qty: number, unit: 'kg' | 'g' | 'litre' | 'ml', cost: number): number {
  if (qty <= 0) return 0;
  if (unit === 'kg' || unit === 'litre') {
    return cost / (qty * 1000); // Cost per gram or per ml
  }
  return cost / qty; // Cost per gram or per ml
}

// Initial ingredients parsed from spreadsheet
export const initialIngredients: Ingredient[] = [
  { id: '1', name: 'Rice', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 59.8, costPerUnit: 59.8 / 1000 },
  { id: '2', name: 'Wheat Flour', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 48.3, costPerUnit: 48.3 / 1000 },
  { id: '3', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 89, costPerUnit: 89 / 1000 },
  { id: '4', name: 'Amul Ghee', purchaseQty: 1, purchaseUnit: 'litre', purchaseCost: 620, costPerUnit: 620 / 1000 },
  { id: '5', name: 'Chole', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 159, costPerUnit: 159 / 1000 },
  { id: '6', name: 'Chana', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 90, costPerUnit: 90 / 1000 },
  { id: '7', name: 'Moong Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 153, costPerUnit: 153 / 1000 },
  { id: '8', name: 'Rajma', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 85, costPerUnit: 85 / 500 },
  { id: '9', name: 'Tur Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 183, costPerUnit: 183 / 1000 },
  { id: '10', name: 'Mix Dal', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 72, costPerUnit: 72 / 500 },
  { id: '11', name: 'Badam', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 925, costPerUnit: 925 / 1000 },
  { id: '12', name: 'Kaju', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 475, costPerUnit: 475 / 500 },
  { id: '13', name: 'Kali Mirch', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 225, costPerUnit: 225 / 200 },
  { id: '14', name: 'Red Chilli Flakes', purchaseQty: 50, purchaseUnit: 'g', purchaseCost: 40, costPerUnit: 40 / 50 },
  { id: '15', name: 'Khand Dhaniya', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 21, costPerUnit: 21 / 100 },
  { id: '16', name: 'Jeera', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 162, costPerUnit: 162 / 500 },
  { id: '17', name: 'Kalonji', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 43.5, costPerUnit: 43.5 / 100 },
  { id: '18', name: 'Star Fish', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 103, costPerUnit: 103 / 100 },
  { id: '19', name: 'Garam Masala', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 96, costPerUnit: 96 / 100 },
  { id: '20', name: 'Chole Masala', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 83, costPerUnit: 83 / 100 },
  { id: '21', name: 'Kitchen King Masala', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 87, costPerUnit: 87 / 100 },
  { id: '22', name: 'Maggi Magic Masala', purchaseQty: 120, purchaseUnit: 'g', purchaseCost: 90, costPerUnit: 90 / 120 },
  { id: '23', name: 'Kastoori Methi', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 63, costPerUnit: 63 / 100 },
  { id: '24', name: 'Maida', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 41, costPerUnit: 41 / 1000 },
  { id: '25', name: 'Besan', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 39, costPerUnit: 39 / 500 },
  { id: '26', name: 'Groundnut', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 174, costPerUnit: 174 / 1000 },
  { id: '27', name: 'Rai', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 29, costPerUnit: 29 / 200 },
  { id: '28', name: 'Refined Oil', purchaseQty: 800, purchaseUnit: 'g', purchaseCost: 165, costPerUnit: 165 / 800 },
  { id: '29', name: 'Mustard Oil', purchaseQty: 910, purchaseUnit: 'g', purchaseCost: 195, costPerUnit: 195 / 910 },
  { id: '30', name: 'Sugar', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 57 / 1000 },
  { id: '31', name: 'Poha', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 70, costPerUnit: 70 / 1000 },
  { id: '32', name: 'Red Chilli Sauce', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 49, costPerUnit: 49 / 200 },
  { id: '33', name: 'Green Chilli Sauce', purchaseQty: 190, purchaseUnit: 'g', purchaseCost: 49, costPerUnit: 49 / 190 },
  { id: '34', name: 'Oregano', purchaseQty: 50, purchaseUnit: 'g', purchaseCost: 34.5, costPerUnit: 34.5 / 50 },
  { id: '35', name: 'Soya Chunks', purchaseQty: 400, purchaseUnit: 'g', purchaseCost: 90, costPerUnit: 90 / 400 },
  { id: '36', name: 'Bondi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 55, costPerUnit: 55 / 200 },
  { id: '37', name: 'Suji', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 45, costPerUnit: 45 / 1000 },
  { id: '38', name: 'Black Salt', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 30, costPerUnit: 30 / 200 },
  { id: '39', name: 'Ajwain', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 37, costPerUnit: 37 / 100 },
  { id: '40', name: 'Kashmiri Laal Mirch Powder', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 102, costPerUnit: 102 / 100 },
  { id: '41', name: 'Teekhi Laal Mirch', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 98, costPerUnit: 98 / 200 },
  { id: '42', name: 'Bhuna Jeera Powder', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 170, costPerUnit: 170 / 500 },
  { id: '43', name: 'Jeera Powder', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 162, costPerUnit: 162 / 500 },
  { id: '44', name: 'Kali Mirch Powder', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 225, costPerUnit: 225 / 200 },
  { id: '45', name: 'Haldi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 60 / 200 },
  { id: '46', name: 'Jeera Kali Mirch Powder', purchaseQty: 600, purchaseUnit: 'g', purchaseCost: 354, costPerUnit: 354 / 600 },
  { id: '47', name: 'Barik Dhaniya Powder', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 21, costPerUnit: 21 / 100 },
  { id: '48', name: 'Methi Dana', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 60 / 200 },
  { id: '49', name: 'Chat Masala', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 81, costPerUnit: 81 / 100 },
];

// Initial teaspoon weight conversions
export const initialConversions: TeaspoonConversion[] = [
  { id: 'tc1', name: 'Sugar', weightGrams: 4 },
  { id: 'tc2', name: 'Salt', weightGrams: 5 },
  { id: 'tc3', name: 'Black Salt', weightGrams: 2 },
  { id: 'tc4', name: 'Ajwain', weightGrams: 3 },
  { id: 'tc5', name: 'Kashmiri Laal Mirch Powder', weightGrams: 2 },
  { id: 'tc6', name: 'Teekhi Laal Mirch', weightGrams: 2 },
  { id: 'tc7', name: 'Bhuna Jeera Powder', weightGrams: 2 },
  { id: 'tc8', name: 'Jeera Powder', weightGrams: 2 },
  { id: 'tc9', name: 'Kitchen King Masala', weightGrams: 2 },
  { id: 'tc10', name: 'Garam Masala', weightGrams: 2 },
  { id: 'tc11', name: 'Red Chilli Flakes', weightGrams: 1 },
  { id: 'tc12', name: 'Oregano', weightGrams: 3 },
];

// Initial gas cost configurations
export const initialGasConfig: GasConfig = {
  cylinderPrice: 950,
  cylinderWeightKg: 14.2,
  consumptionRateKgHour: 0.25,
};

// Initial Recipes matching seed data
export const initialRecipes: Recipe[] = [
  {
    id: 'r1',
    name: 'Jeera Poha',
    yieldType: 'weight',
    yieldAmount: 1100, // weight cooked poha
    cookingTimeMins: 12,
    createdAt: new Date().toISOString(),
    ingredients: [
      { id: 'ri1', ingredientId: '31', name: 'Poha', quantity: 400, unit: 'g' },
      { id: 'ri2', ingredientId: '16', name: 'Jeera', quantity: 1, unit: 'tsp' }, // conversion exists
      { id: 'ri3', ingredientId: '3', name: 'Salt', quantity: 1.5, unit: 'tsp' }, // conversion exists
      { id: 'ri4', ingredientId: '26', name: 'Groundnut', quantity: 75, unit: 'g' },
      { id: 'ri5', ingredientId: '28', name: 'Refined Oil', quantity: 30, unit: 'ml' },
      { id: 'ri6', ingredientId: '45', name: 'Haldi', quantity: 0.5, unit: 'tsp' }, // default conversion will apply (e.g. default 4g)
    ],
  },
  {
    id: 'r2',
    name: 'Standard Moong Dal',
    yieldType: 'weight',
    yieldAmount: 1500, // cooked dal
    cookingTimeMins: 25,
    createdAt: new Date().toISOString(),
    ingredients: [
      { id: 'ri7', ingredientId: '7', name: 'Moong Dal', quantity: 350, unit: 'g' },
      { id: 'ri8', ingredientId: '3', name: 'Salt', quantity: 2, unit: 'tsp' },
      { id: 'ri9', ingredientId: '4', name: 'Amul Ghee', quantity: 25, unit: 'ml' },
      { id: 'ri10', ingredientId: '16', name: 'Jeera', quantity: 1, unit: 'tsp' },
      { id: 'ri11', ingredientId: '19', name: 'Garam Masala', quantity: 0.5, unit: 'tsp' },
    ],
  },
  {
    id: 'r3',
    name: 'Premium Paratha (Batch)',
    yieldType: 'piece',
    yieldAmount: 8, // pieces produced
    cookingTimeMins: 15,
    createdAt: new Date().toISOString(),
    ingredients: [
      { id: 'ri12', ingredientId: '2', name: 'Wheat Flour', quantity: 500, unit: 'g' },
      { id: 'ri13', ingredientId: '3', name: 'Salt', quantity: 1, unit: 'tsp' },
      { id: 'ri14', ingredientId: '4', name: 'Amul Ghee', quantity: 60, unit: 'ml' },
      { id: 'ri15', ingredientId: '39', name: 'Ajwain', quantity: 0.5, unit: 'tsp' },
    ],
  },
];
