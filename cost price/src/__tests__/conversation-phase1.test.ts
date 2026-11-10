/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Automated Tests for Phase 1: Unrestricted AI Parsing,
 * Database Validation, and Multi-Turn Conversational Clarifications.
 */

import { describe, it, expect } from 'vitest';
import {
  UniversalKitchenIntent,
  validateUniversalKitchenIntent,
  FractionalQuantitySchema,
} from '../server/ai/intentSchema';
import {
  validateKitchenIntent,
  resolveAlias,
} from '../services/catalogValidationEngine';
import { KitchenConversationManager } from '../services/conversationManager';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';

describe('Phase 1: Unrestricted Parsing, Database Validation, and Clarifications', () => {
  const masterIngredients: Ingredient[] = [
    { id: 'ing_1', name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.40 },
    { id: 'ing_2', name: 'Chat Masala', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 81, costPerUnit: 0.81 },
    { id: 'ing_3', name: 'Dhaniya Powder', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 21, costPerUnit: 0.21 },
    { id: 'ing_4', name: 'Kali Mirch', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 225, costPerUnit: 1.125 },
    { id: 'ing_5', name: 'Red Chilli Flakes', purchaseQty: 50, purchaseUnit: 'g', purchaseCost: 40, costPerUnit: 0.80 },
    { id: 'ing_6', name: 'Oregano', purchaseQty: 50, purchaseUnit: 'g', purchaseCost: 34.5, costPerUnit: 0.69 },
    { id: 'ing_7', name: 'Jeera Powder', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 162, costPerUnit: 0.324 },
    { id: 'ing_8', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 89, costPerUnit: 0.089 },
    { id: 'ing_9', name: 'Black Salt', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 30, costPerUnit: 0.15 },
    { id: 'ing_10', name: 'Ajwain', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 37, costPerUnit: 0.37 },
    { id: 'ing_11', name: 'Kastoori Methi', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 63, costPerUnit: 0.63 },
    { id: 'ing_12', name: 'Moong Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 153, costPerUnit: 0.153 },
    { id: 'ing_13', name: 'Haldi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.30 },
    { id: 'ing_14', name: 'Onion', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 35, costPerUnit: 0.035 },
  ];

  const conversions: TeaspoonConversion[] = [
    { id: 'tc_1', name: 'Salt', weightGrams: 5 },
    { id: 'tc_2', name: 'Black Salt', weightGrams: 2 },
    { id: 'tc_3', name: 'Ajwain', weightGrams: 3 },
    { id: 'tc_4', name: 'Jeera Powder', weightGrams: 2 },
    { id: 'tc_5', name: 'Oregano', weightGrams: 3 },
    { id: 'tc_6', name: 'Red Chilli Flakes', weightGrams: 1 },
    { id: 'tc_7', name: 'Chat Masala', weightGrams: 2.5 },
  ];

  const gasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  const existingRecipes: Recipe[] = [];

  // 1. Fractional quantity parser verification
  it('1. correctly parses standard fractions into precise floating-point decimals', () => {
    expect(FractionalQuantitySchema.parse('1/2')).toBeCloseTo(0.5, 4);
    expect(FractionalQuantitySchema.parse('1/4')).toBeCloseTo(0.25, 4);
    expect(FractionalQuantitySchema.parse('1/5')).toBeCloseTo(0.2, 4);
    expect(FractionalQuantitySchema.parse('1/3')).toBeCloseTo(0.3333, 4);
    expect(FractionalQuantitySchema.parse('2 1/2')).toBeCloseTo(2.5, 4);
    expect(FractionalQuantitySchema.parse('102')).toBe(102);
  });

  // 2. Example A: Paneer Paratha parsing and validation
  it('2. validates Example A (Paneer Paratha: 14 ingredients, fractional tsp, pieces, pouches, yield=2)', () => {
    const paneerParathaIntent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Paneer Paratha',
          yieldAmount: 2,
          rawYieldAmount: '2 paneer parathas',
          yieldType: 'piece',
          cookingTimeMins: 15,
          ingredients: [
            { name: 'panner', quantity: 102, rawQuantity: '102', unit: 'g' },
            { name: 'Chat masala', quantity: 0.5, rawQuantity: '1/2', unit: 'tsp' },
            { name: 'Kalonji', quantity: 0.2, rawQuantity: '1/5', unit: 'tsp' },
            { name: 'Dhaniya powder', quantity: 1, rawQuantity: '1', unit: 'tsp' },
            { name: 'Kali mirch', quantity: 0.25, rawQuantity: '1/4', unit: 'tsp' },
            { name: 'Chilli flakes', quantity: 1, rawQuantity: '1', unit: 'tsp' },
            { name: 'Oregano', quantity: 0.25, rawQuantity: '1/4', unit: 'tsp' },
            { name: 'Jeera powder', quantity: 1, rawQuantity: '1', unit: 'tsp' },
            { name: 'Salt', quantity: 0.3333, rawQuantity: '1/3', unit: 'tsp' },
            { name: 'Kala namak', quantity: 0.3333, rawQuantity: '1/3', unit: 'tsp' },
            { name: 'Ajwain', quantity: 0.2, rawQuantity: '1/5', unit: 'tsp' },
            { name: 'Kastori methi', quantity: 0.5, rawQuantity: '1/2', unit: 'tsp' },
            { name: 'Maggi masala', quantity: 1, rawQuantity: '1', unit: 'pouch', isAmbiguous: true, ambiguityReason: 'Pouch unit requires verified weight' },
            { name: 'Pyaaz', quantity: 0.5, rawQuantity: '1/2', unit: 'piece', isAmbiguous: true, ambiguityReason: 'Half onion requires weight in grams' },
            { name: 'Dhaniya patti', quantity: 1, rawQuantity: '1', unit: 'tsp' },
          ],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const validated = validateUniversalKitchenIntent(paneerParathaIntent);
    expect(validated.recipes[0].ingredients).toHaveLength(15);
    expect(validated.recipes[0].yieldAmount).toBe(2);
    expect(validated.recipes[0].yieldType).toBe('piece');

    const outcome = validateKitchenIntent(validated, masterIngredients, conversions, gasConfig, existingRecipes);

    // Yield preserved as 2 pieces
    expect(outcome.recipes[0].yieldAmount).toBe(2);
    expect(outcome.recipes[0].yieldType).toBe('piece');

    // panner -> Paneer alias matching
    const paneerRow = outcome.recipes[0].rows.find(r => r.raw.name === 'panner');
    expect(paneerRow?.matchedMaster?.name).toBe('Paneer');

    // Ambiguous units flagged: Pyaaz (piece) and Maggi masala (pouch)
    const onionClarification = outcome.clarifications.find(c => c.targetEntity === 'Pyaaz');
    expect(onionClarification?.category).toBe('AMBIGUOUS_UNIT');

    const pouchClarification = outcome.clarifications.find(c => c.targetEntity === 'Maggi masala');
    expect(pouchClarification?.category).toBe('AMBIGUOUS_UNIT');

    // Missing teaspoon conversions flagged (e.g. Kalonji)
    const kalonjiClarification = outcome.clarifications.find(c => c.targetEntity === 'Kalonji');
    expect(kalonjiClarification?.category).toBe('MISSING_CONVERSION');

    expect(outcome.isComplete).toBe(false);
  });

  // 3. Example B: Dal parsing and validation
  it('3. validates Example B (Dal: 144g dal, 1/2 tsp haldi, 1 tsp salt, 10 mins cook)', () => {
    const dalIntent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Standard Dal',
          cookingTimeMins: 10,
          yieldAmount: null, // User omitted yield
          yieldType: 'unknown',
          ingredients: [
            { name: 'dal', quantity: 144, rawQuantity: '144', unit: 'g' },
            { name: 'Haldi', quantity: 0.5, rawQuantity: '1/2', unit: 'tsp' },
            { name: 'Salt', quantity: 1, rawQuantity: '1', unit: 'tsp' },
          ],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(dalIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.recipes[0].cookingTimeMins).toBe(10);

    // Dal matched to Moong Dal or flagged
    const saltRow = outcome.recipes[0].rows.find(r => r.raw.name === 'Salt');
    expect(saltRow?.conversionGrams).toBe(5); // Salt has verified 5g in conversions
    expect(saltRow?.status).toBe('VERIFIED');

    // Missing yield flagged as essential clarification
    const yieldClarification = outcome.clarifications.find(c => c.category === 'MISSING_YIELD');
    expect(yieldClarification).toBeDefined();
    expect(outcome.isComplete).toBe(false);
  });

  // 4. Ingredient additions & updates validation
  it('4. validates new ingredient additions and existing price updates', () => {
    const mutationIntent: UniversalKitchenIntent = {
      detectedIntent: 'INGREDIENT_MUTATION',
      recipes: [],
      ingredientCreations: [
        { name: 'Poha', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 40 },
        { name: 'Jeera', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 60 },
      ],
      ingredientUpdates: [
        { name: 'Paneer', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 105 },
      ],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(mutationIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.ingredientMutations).toHaveLength(3);

    const paneerUpdate = outcome.ingredientMutations.find(m => m.name === 'Paneer');
    expect(paneerUpdate?.type).toBe('UPDATE');
    expect(paneerUpdate?.previousRecord?.purchaseCost).toBe(400); // was 400 for 1kg
    expect(paneerUpdate?.purchaseCost).toBe(105);
    expect(paneerUpdate?.costPerUnit).toBe(105 / 200);

    const pohaCreate = outcome.ingredientMutations.find(m => m.name === 'Poha');
    expect(pohaCreate?.type).toBe('CREATE');
    expect(pohaCreate?.costPerUnit).toBe(40 / 500);
  });

  // 5. Gas configuration mutation validation
  it('5. validates gas cylinder configuration updates', () => {
    const gasIntent: UniversalKitchenIntent = {
      detectedIntent: 'GAS_MUTATION',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: {
        cylinderPrice: 1000,
        cylinderWeightKg: 14.2,
        consumptionRateKgHour: 0.25,
      },
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(gasIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.gasMutation).toBeDefined();
    expect(outcome.gasMutation?.cylinderPrice).toBe(1000);
    expect(outcome.gasMutation?.previousConfig.cylinderPrice).toBe(950);
  });

  // 6. Teaspoon conversion updates
  it('6. validates teaspoon-to-gram conversion definitions', () => {
    const convIntent: UniversalKitchenIntent = {
      detectedIntent: 'CONVERSION_MUTATION',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [
        { name: 'Jeera', weightGrams: 2 },
      ],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(convIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.conversionMutations).toHaveLength(1);
    expect(outcome.conversionMutations[0].name).toBe('Jeera');
    expect(outcome.conversionMutations[0].weightGrams).toBe(2);
  });

  // 7. Compound request validation (recipe + gas + conversion + ingredient in one message)
  it('7. processes compound requests with recipe, new ingredient, conversion, and gas configuration simultaneously', () => {
    const compoundIntent: UniversalKitchenIntent = {
      detectedIntent: 'COMPOUND',
      recipes: [
        {
          recipeName: 'Jeera Rice',
          cookingTimeMins: 12,
          yieldAmount: 800,
          yieldType: 'weight',
          ingredients: [
            { name: 'Rice', quantity: 200, unit: 'g' },
            { name: 'Jeera', quantity: 1, unit: 'tsp' },
          ],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [
        { name: 'Rice', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 65 },
      ],
      ingredientUpdates: [],
      conversionUpdates: [
        { name: 'Jeera', weightGrams: 2 },
      ],
      gasConfigUpdate: { cylinderPrice: 980 },
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(compoundIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.recipes).toHaveLength(1);
    expect(outcome.ingredientMutations).toHaveLength(1);
    expect(outcome.conversionMutations).toHaveLength(1);
    expect(outcome.gasMutation).toBeDefined();
    expect(outcome.gasMutation?.cylinderPrice).toBe(980);
  });

  // 8. Multi-turn conversation manager follow-up & clarification merging
  it('8. preserves pending recipe and resolves missing values across turns without repeating recipe', () => {
    const manager = new KitchenConversationManager('test_session_1');

    // Turn 1: User enters raw recipe with missing onion weight and missing pouch weight
    const initialIntent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Masala Pyaaz Paratha',
          yieldAmount: 2,
          yieldType: 'piece',
          cookingTimeMins: 10,
          ingredients: [
            { name: 'panner', quantity: 100, unit: 'g' },
            { name: 'Pyaaz', quantity: 0.5, unit: 'piece', isAmbiguous: true },
            { name: 'Maggi masala', quantity: 1, unit: 'pouch', isAmbiguous: true },
          ],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome1 = manager.processTurn(
      '2 masala pyaaz paratha with 100g panner, 1/2 pyaaz, 1 pouch maggi masala',
      initialIntent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    expect(outcome1.isComplete).toBe(false);
    expect(outcome1.clarifications.length).toBeGreaterThan(0);
    expect(manager.getSession().pendingIntent?.recipes[0].recipeName).toBe('Masala Pyaaz Paratha');

    // Turn 2: User answers follow-up with weights for onion and pouch
    const followUpIntent: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [
        { name: 'Maggi masala', purchaseQty: 10, purchaseUnit: 'g', purchaseCost: 10 },
      ],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [
        { targetEntity: 'Pyaaz', field: 'weightGrams', value: 60, unit: 'g' },
        { targetEntity: 'Maggi masala', field: 'weightGrams', value: 10, unit: 'g' },
      ],
      unresolvedNotes: [],
    };

    const outcome2 = manager.processTurn(
      'Half onion is 60 grams and maggi masala pouch is 10g for ₹10',
      followUpIntent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    // Verify onion converted to 60g and pouch to 10g
    const pendingRecipe = manager.getSession().pendingIntent?.recipes[0];
    const onionRow = pendingRecipe?.ingredients.find(i => i.name.toLowerCase().includes('pyaaz'));
    expect(onionRow?.unit).toBe('g');
    expect(onionRow?.quantity).toBe(60);

    const pouchRow = pendingRecipe?.ingredients.find(i => i.name.toLowerCase().includes('maggi'));
    expect(pouchRow?.unit).toBe('g');
    expect(pouchRow?.quantity).toBe(10);

    // Proposal is now ready for explicit confirmation
    expect(outcome2.isComplete).toBe(true);
    expect(manager.getSession().isComplete).toBe(true);
  });

  // 9. Alias resolver verification
  it('9. resolves Hindi and culinary transliterations to standard master ingredient names', () => {
    expect(resolveAlias('panner')).toBe('paneer');
    expect(resolveAlias('pyaaz')).toBe('onion');
    expect(resolveAlias('namak')).toBe('salt');
    expect(resolveAlias('kala namak')).toBe('black salt');
    expect(resolveAlias('haldi powder')).toBe('haldi');
    expect(resolveAlias('cheeni')).toBe('sugar');
  });
});
