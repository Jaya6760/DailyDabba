/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialIngredients,
  initialConversions,
  initialGasConfig,
  initialRecipes,
} from '../data';
import {
  calculateGasCosts,
  getEffectiveQuantity,
  calculateRecipeCosts,
  calculateDefaultServingCost,
} from '../utils';
import { ToolExecutor } from '../server/ai/tools';
import { ContextSnapshot } from '../server/ai/types';

function createMockContext(): ContextSnapshot {
  return {
    ingredients: JSON.parse(JSON.stringify(initialIngredients)),
    conversions: JSON.parse(JSON.stringify(initialConversions)),
    gasConfig: JSON.parse(JSON.stringify(initialGasConfig)),
    recipes: JSON.parse(JSON.stringify(initialRecipes)),
  };
}

test('Costing Formulas: calculateGasCosts produces accurate fuel rates', () => {
  const gas = calculateGasCosts(initialGasConfig);
  // cylinderPrice: 950, cylinderWeightKg: 14.2, consumptionRateKgHour: 0.25
  const expectedCostPerKg = 950 / 14.2;
  const expectedCostPerHour = expectedCostPerKg * 0.25;
  const expectedCostPerMinute = expectedCostPerHour / 60;

  assert.equal(gas.costPerKg.toFixed(4), expectedCostPerKg.toFixed(4));
  assert.equal(gas.costPerHour.toFixed(4), expectedCostPerHour.toFixed(4));
  assert.equal(gas.costPerMinute.toFixed(4), expectedCostPerMinute.toFixed(4));
});

test('Costing Formulas: getEffectiveQuantity handles units and conversions', () => {
  const conversions = initialConversions;

  // Salt has conversion of 5g per tsp
  const saltEff = getEffectiveQuantity(
    { id: '1', ingredientId: '3', name: 'Salt', quantity: 2, unit: 'tsp' },
    conversions
  );
  assert.equal(saltEff.value, 10);
  assert.equal(saltEff.baseUnit, 'g');
  assert.equal(saltEff.isTsp, true);
  assert.equal(saltEff.isTspDefaultUsed, false);

  // Haldi has NO conversion in initialConversions; fallback default 4g should be used
  const haldiEff = getEffectiveQuantity(
    { id: '2', ingredientId: '45', name: 'Haldi', quantity: 1, unit: 'tsp' },
    conversions
  );
  assert.equal(haldiEff.value, 4);
  assert.equal(haldiEff.baseUnit, 'g');
  assert.equal(haldiEff.isTsp, true);
  assert.equal(haldiEff.isTspDefaultUsed, true);

  // Grams and ml
  const kgEff = getEffectiveQuantity(
    { id: '3', ingredientId: '1', name: 'Rice', quantity: 0.5, unit: 'kg' },
    conversions
  );
  assert.equal(kgEff.value, 500);
  assert.equal(kgEff.baseUnit, 'g');
});

test('Tool: calculate_recipe_cost returns accurate backend calculation for Jeera Poha', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  const { result, sideEffects } = executor.executeTool('calculate_recipe_cost', {
    recipeName: 'Jeera Poha',
  });

  assert.equal(result.recipeName, 'Jeera Poha');
  assert.ok(result.totalBatchCost > 0);
  assert.ok(result.servingCostPrice > 0);
  assert.ok(result.itemizedIngredients.length > 0);

  // Compare with direct calculation
  const recipe = context.recipes.find(r => r.name === 'Jeera Poha')!;
  const expectedBreakdown = calculateRecipeCosts(
    recipe,
    context.ingredients,
    context.conversions,
    context.gasConfig
  );
  assert.equal(result.totalBatchCost, Number(expectedBreakdown.totalBatchCost.toFixed(2)));
  assert.ok(sideEffects?.costBreakdown);
});

test('Tool: calculate_recipe_cost supports simulated price overrides without mutating state', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  const original = executor.executeTool('calculate_recipe_cost', { recipeName: 'Standard Moong Dal' });

  // Simulate Moong Dal price rising to ₹300/kg
  const simulated = executor.executeTool('calculate_recipe_cost', {
    recipeName: 'Standard Moong Dal',
    ingredientPriceOverrides: [{ name: 'Moong Dal', simulatedPrice: 300, purchaseQty: 1, purchaseUnit: 'kg' }],
  });

  assert.ok(simulated.result.totalBatchCost > original.result.totalBatchCost);

  // Ensure master context was NOT modified
  const moongDal = context.ingredients.find(i => i.name === 'Moong Dal')!;
  assert.equal(moongDal.purchaseCost, 153);
});

test('Tool: propose_add_ingredient validates and detects duplicate ingredients', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  // New ingredient
  const addRes = executor.executeTool('propose_add_ingredient', {
    name: 'Amul Butter',
    purchaseQty: 1,
    purchaseUnit: 'kg',
    purchaseCost: 550,
  });

  assert.equal(addRes.result.success, true);
  assert.equal(addRes.sideEffects?.proposedAction?.type, 'ADD_INGREDIENT');
  assert.equal(addRes.sideEffects?.proposedAction?.requiresConfirmation, true);

  // Duplicate ingredient (Rice already exists)
  const dupRes = executor.executeTool('propose_add_ingredient', {
    name: 'Rice',
    purchaseQty: 1,
    purchaseUnit: 'kg',
    purchaseCost: 65,
  });

  assert.equal(dupRes.result.duplicateDetected, true);
  assert.ok(dupRes.sideEffects?.clarifications);
});

test('Tool: propose_update_ingredient computes exact recipe impact deltas', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  // Refined Oil is used in Jeera Poha
  const updateRes = executor.executeTool('propose_update_ingredient', {
    name: 'Refined Oil',
    purchaseCost: 200,
  });

  assert.equal(updateRes.result.success, true);
  assert.equal(updateRes.sideEffects?.proposedAction?.type, 'UPDATE_INGREDIENT');
  assert.ok(updateRes.result.affectedRecipes.length > 0);
  const pohaImpact = updateRes.result.affectedRecipes.find((r: any) => r.recipeName === 'Jeera Poha');
  assert.ok(pohaImpact);
  assert.ok(pohaImpact.newBatchCost > pohaImpact.oldBatchCost);
});

test('Tool: propose_save_recipe prevents saving with unknown ingredients and requests price clarification', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  const saveRes = executor.executeTool('propose_save_recipe', {
    name: 'Special Smoothie',
    yieldType: 'weight',
    yieldAmount: 400,
    cookingTimeMins: 0,
    ingredients: [
      { name: 'Sugar', quantity: 20, unit: 'g' },
      { name: 'Dragonfruit Puree', quantity: 200, unit: 'g' }, // Unknown ingredient!
    ],
  });

  assert.equal(saveRes.result.success, false);
  assert.deepEqual(saveRes.result.missingIngredients, ['Dragonfruit Puree']);
  assert.ok(saveRes.sideEffects?.clarifications);
  assert.ok(saveRes.sideEffects.clarifications[0].question.includes('Dragonfruit Puree'));
});

test('Tool: propose_save_recipe calculates exact costs and flags tsp conversions with defaults', () => {
  const context = createMockContext();
  const executor = new ToolExecutor(context);

  // Recipe with existing ingredients
  const saveRes = executor.executeTool('propose_save_recipe', {
    name: 'Quick Khichdi',
    yieldType: 'weight',
    yieldAmount: 800,
    cookingTimeMins: 15,
    defaultServingAmount: 200,
    ingredients: [
      { name: 'Rice', quantity: 150, unit: 'g' },
      { name: 'Moong Dal', quantity: 100, unit: 'g' },
      { name: 'Salt', quantity: 1, unit: 'tsp' }, // conversion exists
      { name: 'Haldi', quantity: 0.5, unit: 'tsp' }, // no conversion, fallback default
    ],
  });

  assert.equal(saveRes.result.success, true);
  assert.equal(saveRes.sideEffects?.proposedAction?.type, 'SAVE_RECIPE');
  assert.ok(saveRes.result.totalBatchCost > 0);
  assert.ok(saveRes.result.servingCostPrice > 0);
  // Default clarification was generated for Haldi
  assert.ok(saveRes.sideEffects?.clarifications);
  assert.ok(saveRes.sideEffects.clarifications.some(c => c.id === 'tsp_conversions_default'));
});
