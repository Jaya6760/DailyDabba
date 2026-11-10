/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Automated Tests for Phase 1:
 * - Step 1: Four Bug Fixes (Conversion follow-up, Purchase details follow-up, Name mismatch, Stale snapshot guard)
 * - Step 2 & 3: Single Canonical Ingredient Matching Engine, Form Disambiguation, and Multi-turn Clarification
 * - Step 4: Deterministic Recipe Costing Verification across Hindi/English Synonyms
 */

import { describe, it, expect, vi } from 'vitest';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  matchIngredient,
  areIngredientsEquivalent,
  hasFormOrVarietyConflict,
} from '../services/ingredientMatcher';
import { validateKitchenIntent } from '../services/catalogValidationEngine';
import { KitchenConversationManager } from '../services/conversationManager';
import {
  generateProposedChangeSet,
  generateDatabaseSnapshotHash,
} from '../services/proposalGenerator';
import { persistProposedChangeSet } from '../services/catalogPersistenceService';
import { calculateRecipeCosts, calculateDefaultServingCost, calculateGasCosts } from '../utils';
import { UniversalKitchenIntent } from '../server/ai/intentSchema';
import supabase from '../supabaseClient';

describe('Step 1: Regression Tests for the Four Existing Bugs', () => {
  const masterIngredients: Ingredient[] = [
    { id: 'ing_paneer', name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.4 },
    { id: 'ing_kalonji', name: 'Kalonji', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 43.5, costPerUnit: 0.435 },
    { id: 'ing_haldi', name: 'Haldi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.3 },
    { id: 'ing_salt', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 89, costPerUnit: 0.089 },
    { id: 'ing_onion', name: 'Onion', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 35, costPerUnit: 0.035 },
  ];

  const conversions: TeaspoonConversion[] = [
    { id: 'tc_salt', name: 'Salt', weightGrams: 5 },
    { id: 'tc_haldi', name: 'Haldi', weightGrams: 3 },
  ];

  const gasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  const existingRecipes: Recipe[] = [];

  it('Bug 1 Fix: preserves original recipe quantity (1/5 tsp Kalonji = 0.2 tsp) when user provides conversion (1 tsp = 2g) and converts to 0.4g', () => {
    const manager = new KitchenConversationManager('bug1_session');

    // Turn 1: Recipe has 1/5 tsp (0.2 tsp) Kalonji; Kalonji has no tsp conversion yet
    const turn1Intent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Kalonji Paratha',
          yieldAmount: 2,
          yieldType: 'piece',
          cookingTimeMins: 10,
          ingredients: [
            { name: 'Paneer', quantity: 100, rawQuantity: '100', unit: 'g' },
            { name: 'Kalonji', quantity: 0.2, rawQuantity: '1/5', unit: 'tsp' },
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
      '2 parathas with 100g paneer and 1/5 tsp kalonji',
      turn1Intent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    expect(outcome1.isComplete).toBe(false);
    expect(outcome1.clarifications.some(c => c.category === 'MISSING_CONVERSION' && c.targetEntity === 'Kalonji')).toBe(true);

    // Turn 2: User provides "1 tsp kalonji is 2g" via clarificationAnswers (even if LLM uses field: "weightGrams")
    const turn2Intent: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [
        { targetEntity: 'Kalonji', field: 'weightGrams', value: 2, unit: 'g' },
      ],
      unresolvedNotes: [],
    };

    const outcome2 = manager.processTurn(
      '1 tsp kalonji weighs 2 grams',
      turn2Intent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    expect(outcome2.isComplete).toBe(true);

    // Verify recipe ingredient quantity is STILL 0.2 tsp (NOT overwritten with 2g!)
    const pendingRecipe = manager.getSession().pendingIntent!.recipes[0];
    const kalonjiIng = pendingRecipe.ingredients.find(i => i.name === 'Kalonji')!;
    expect(kalonjiIng.quantity).toBeCloseTo(0.2, 4);
    expect(kalonjiIng.unit).toBe('tsp');

    // Verify validated effective quantity is 0.2 * 2g = 0.4g
    const validatedKalonjiRow = outcome2.recipes[0].rows.find(r => r.raw.name === 'Kalonji')!;
    expect(validatedKalonjiRow.conversionGrams).toBe(2);
    expect(validatedKalonjiRow.effectiveQuantity).toBeCloseTo(0.4, 4);

    // Verify proposal generator passes 0.2 tsp to deterministic costing engine and calculates 0.4g * 0.435
    const proposal = generateProposedChangeSet(
      {
        validatedIntent: manager.getSession().pendingIntent!,
        validationOutcome: outcome2,
        pendingClarifications: outcome2.clarifications,
        assistantReply: 'Ready',
      },
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    const proposedKalonji = proposal.operations.recipesToCreate[0].recipe.ingredients.find(i => i.name === 'Kalonji')!;
    expect(proposedKalonji.quantity).toBeCloseTo(0.2, 4);
    expect(proposedKalonji.unit).toBe('tsp');
    expect(proposal.operations.newConversions).toEqual([{ name: 'Kalonji', weightGrams: 2 }]);
  });

  it('Bug 2 Fix: preserves original ingredient purchase details (500g Poha for ₹40) across clarification messages and never assumes 1kg', () => {
    const manager = new KitchenConversationManager('bug2_session');

    // Scenario A: User enters "Add poha 500g for ₹40" alongside a recipe missing yield
    const turn1Intent: UniversalKitchenIntent = {
      detectedIntent: 'COMPOUND',
      recipes: [
        {
          recipeName: 'Kanda Poha',
          cookingTimeMins: 10,
          yieldAmount: null, // missing yield triggers clarification
          yieldType: 'unknown',
          ingredients: [
            { name: 'Poha', quantity: 200, unit: 'g' },
            { name: 'Salt', quantity: 1, unit: 'tsp' },
          ],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [
        { name: 'Poha', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 40 },
      ],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome1 = manager.processTurn(
      'Add poha 500g for ₹40. Recipe Kanda Poha: 200g poha, 1 tsp salt, 10 mins.',
      turn1Intent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );
    expect(outcome1.isComplete).toBe(false);

    // Turn 2: User answers yield clarification; incoming intent also mentions Poha without pack size
    const turn2Intent: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [
        { name: 'Poha', purchaseCost: 40 }, // undefined purchaseQty/purchaseUnit must NOT wipe 500g!
      ],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [
        { targetEntity: 'Kanda Poha', field: 'yieldAmount', value: 450, unit: 'g' },
      ],
      unresolvedNotes: [],
    };

    const outcome2 = manager.processTurn(
      'Cooked yield is 450g',
      turn2Intent,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    expect(outcome2.isComplete).toBe(true);
    const pohaMutation = outcome2.ingredientMutations.find(m => m.name === 'Poha')!;
    expect(pohaMutation.purchaseQty).toBe(500);
    expect(pohaMutation.purchaseUnit).toBe('g');
    expect(pohaMutation.purchaseCost).toBe(40);
    expect(pohaMutation.costPerUnit).toBeCloseTo(40 / 500, 5); // ₹0.08/g, NOT ₹0.04/g (1kg)

    // Scenario B: User provides "Poha is ₹40 for 500g" in a follow-up clarification answer
    const managerB = new KitchenConversationManager('bug2_session_b');
    const turn1B: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Simple Poha',
          cookingTimeMins: 8,
          yieldAmount: 350,
          yieldType: 'weight',
          ingredients: [{ name: 'Poha', quantity: 150, unit: 'g' }],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };
    managerB.processTurn('Simple Poha: 150g poha, yield 350g, 8 mins', turn1B, masterIngredients, conversions, gasConfig, existingRecipes);

    const turn2B: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [
        { targetEntity: 'Poha', field: 'purchaseCost', value: '₹40 for 500g' },
      ],
      unresolvedNotes: [],
    };
    const outcome2B = managerB.processTurn('Poha is ₹40 for 500g', turn2B, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome2B.isComplete).toBe(true);
    expect(outcome2B.ingredientMutations[0].purchaseQty).toBe(500);
    expect(outcome2B.ingredientMutations[0].purchaseUnit).toBe('g');
    expect(outcome2B.ingredientMutations[0].purchaseCost).toBe(40);
    expect(outcome2B.ingredientMutations[0].costPerUnit).toBeCloseTo(0.08, 5);
  });

  it('Bug 4 Fix: compares proposal original snapshot against live database state and rejects stale proposals even if caller passes proposal.databaseSnapshotHash', async () => {
    const turnResult = {
      validatedIntent: {
        detectedIntent: 'INGREDIENT_MUTATION' as const,
        recipes: [],
        ingredientCreations: [],
        ingredientUpdates: [{ name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg' as const, purchaseCost: 420 }],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
      },
      validationOutcome: validateKitchenIntent(
        {
          detectedIntent: 'INGREDIENT_MUTATION',
          recipes: [],
          ingredientCreations: [],
          ingredientUpdates: [{ name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 420 }],
          conversionUpdates: [],
          clarificationAnswers: [],
          unresolvedNotes: [],
        },
        masterIngredients,
        conversions,
        gasConfig,
        existingRecipes
      ),
      pendingClarifications: [],
      assistantReply: 'Ready',
    };

    const proposal = generateProposedChangeSet(
      turnResult,
      masterIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    // Simulate concurrent database modification to target ingredient (Paneer changed from ₹400 to ₹450)
    const concurrentlyModifiedIngredients = masterIngredients.map(i =>
      i.id === 'ing_paneer' ? { ...i, purchaseCost: 450 } : i
    );

    // Live OCC check rejects the proposal because target ingredient was modified concurrently
    const result = await persistProposedChangeSet(
      proposal,
      proposal.databaseSnapshotHash,
      concurrentlyModifiedIngredients,
      conversions,
      gasConfig,
      existingRecipes
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database state has changed since this proposal was prepared');
    expect(result.error).toContain('Paneer');
  });
});

describe('Step 2 & Step 3: Canonical Ingredient Matching & Form Disambiguation', () => {
  const catalog: Ingredient[] = [
    { id: 'ing_turmeric', name: 'Turmeric', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.3 },
    { id: 'ing_cumin', name: 'Cumin', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 162, costPerUnit: 0.324 },
    { id: 'ing_roasted_cumin_pdr', name: 'Bhuna Jeera Powder', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 170, costPerUnit: 0.34 },
    { id: 'ing_onion', name: 'Onion', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 35, costPerUnit: 0.035 },
    { id: 'ing_tomato', name: 'Tomato', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 40, costPerUnit: 0.04 },
    { id: 'ing_coriander_seeds', name: 'Coriander Seeds', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 21, costPerUnit: 0.21 },
    { id: 'ing_coriander_powder', name: 'Coriander Powder', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 25, costPerUnit: 0.25 },
    { id: 'ing_coriander_leaves', name: 'Coriander Leaves', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 15, costPerUnit: 0.15 },
    { id: 'ing_black_pepper_whole', name: 'Kali Mirch', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 225, costPerUnit: 1.125 },
    { id: 'ing_black_pepper_powder', name: 'Kali Mirch Powder', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 240, costPerUnit: 1.2 },
    { id: 'ing_methi_seeds', name: 'Methi Dana', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.3 },
    { id: 'ing_kasuri_methi', name: 'Kastoori Methi', purchaseQty: 100, purchaseUnit: 'g', purchaseCost: 63, costPerUnit: 0.63 },
    { id: 'ing_wheat_flour', name: 'Wheat Flour', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 48.3, costPerUnit: 0.0483 },
    { id: 'ing_maida', name: 'Maida', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 41, costPerUnit: 0.041 },
    { id: 'ing_moong_dal', name: 'Moong Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 153, costPerUnit: 0.153 },
    { id: 'ing_toor_dal', name: 'Tur Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 183, costPerUnit: 0.183 },
    { id: 'ing_chana_dal', name: 'Chana Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 110, costPerUnit: 0.11 },
    { id: 'ing_paneer', name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.4 },
    { id: 'ing_refined_oil', name: 'Refined Oil', purchaseQty: 1, purchaseUnit: 'litre', purchaseCost: 150, costPerUnit: 0.15 },
  ];

  it('matches Haldi <-> Turmeric bidirectionally via SYNONYM_MATCH', () => {
    // Catalog has "Turmeric", user enters "Haldi"
    const res1 = matchIngredient('Haldi', catalog);
    expect(res1.outcome).toBe('SYNONYM_MATCH');
    expect(res1.matchedIngredient?.id).toBe('ing_turmeric');
    expect(res1.requiresConfirmation).toBe(false);

    // Catalog has "Haldi", user enters "Turmeric"
    const hindiCatalog: Ingredient[] = [
      { id: 'ing_haldi', name: 'Haldi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.3 },
    ];
    const res2 = matchIngredient('Turmeric', hindiCatalog);
    expect(res2.outcome).toBe('SYNONYM_MATCH');
    expect(res2.matchedIngredient?.id).toBe('ing_haldi');
    expect(res2.requiresConfirmation).toBe(false);
  });

  it('matches Jeera <-> Cumin bidirectionally via SYNONYM_MATCH', () => {
    const res1 = matchIngredient('Jeera', catalog);
    expect(res1.outcome).toBe('SYNONYM_MATCH');
    expect(res1.matchedIngredient?.id).toBe('ing_cumin');

    const hindiCatalog: Ingredient[] = [
      { id: 'ing_jeera', name: 'Jeera', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 162, costPerUnit: 0.324 },
    ];
    const res2 = matchIngredient('Cumin', hindiCatalog);
    expect(res2.outcome).toBe('SYNONYM_MATCH');
    expect(res2.matchedIngredient?.id).toBe('ing_jeera');
  });

  it('matches Pyaaz / Pyaz <-> Onion', () => {
    const pyaazRes = matchIngredient('Pyaaz', catalog);
    expect(pyaazRes.outcome).toBe('SYNONYM_MATCH');
    expect(pyaazRes.matchedIngredient?.id).toBe('ing_onion');

    const pyazRes = matchIngredient('Pyaz', catalog);
    expect(pyazRes.outcome).toBe('SPELLING_VARIATION_MATCH');
    expect(pyazRes.matchedIngredient?.id).toBe('ing_onion');
  });

  it('matches Tamatar <-> Tomato bidirectionally', () => {
    const tamatarRes = matchIngredient('Tamatar', catalog);
    expect(tamatarRes.outcome).toBe('SYNONYM_MATCH');
    expect(tamatarRes.matchedIngredient?.id).toBe('ing_tomato');

    const hindiCatalog: Ingredient[] = [
      { id: 'ing_tamatar', name: 'Tamatar', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 40, costPerUnit: 0.04 },
    ];
    const tomatoRes = matchIngredient('Tomato', hindiCatalog);
    expect(tomatoRes.outcome).toBe('SYNONYM_MATCH');
    expect(tomatoRes.matchedIngredient?.id).toBe('ing_tamatar');
  });

  it('distinguishes Coriander Seeds, Coriander Powder, and Coriander Leaves when form is clear', () => {
    const seedsRes = matchIngredient('Sabut Dhaniya', catalog);
    expect(seedsRes.matchedIngredient?.id).toBe('ing_coriander_seeds');

    const powderRes = matchIngredient('Dhaniya Powder', catalog);
    expect(powderRes.matchedIngredient?.id).toBe('ing_coriander_powder');

    const leavesRes = matchIngredient('Dhaniya Patti', catalog);
    expect(leavesRes.matchedIngredient?.id).toBe('ing_coriander_leaves');

    expect(hasFormOrVarietyConflict('Coriander Seeds', 'Coriander Powder')).toBe(true);
    expect(hasFormOrVarietyConflict('Coriander Powder', 'Coriander Leaves')).toBe(true);
    expect(hasFormOrVarietyConflict('Coriander Seeds', 'Coriander Leaves')).toBe(true);
  });

  it('flags bare "Dhaniya" as AMBIGUOUS_MATCH when database contains seeds, powder, and leaves, and resolves naturally in conversation', () => {
    const bareDhaniyaRes = matchIngredient('Dhaniya', catalog);
    expect(bareDhaniyaRes.outcome).toBe('AMBIGUOUS_MATCH');
    expect(bareDhaniyaRes.matchedIngredient).toBeNull();
    expect(bareDhaniyaRes.requiresConfirmation).toBe(true);
    expect(bareDhaniyaRes.candidates.map(c => c.id)).toEqual([
      'ing_coriander_seeds',
      'ing_coriander_powder',
      'ing_coriander_leaves',
    ]);

    // Test multi-turn natural-language resolution in KitchenConversationManager
    const manager = new KitchenConversationManager('dhaniya_session');
    const conversions: TeaspoonConversion[] = [
      { id: 'tc_cor_pdr', name: 'Coriander Powder', weightGrams: 3 },
    ];
    const gasConfig: GasConfig = { cylinderPrice: 950, cylinderWeightKg: 14.2, consumptionRateKgHour: 0.25 };

    const turn1Intent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Masala Paneer',
          cookingTimeMins: 10,
          yieldAmount: 300,
          yieldType: 'weight',
          ingredients: [
            { name: 'Paneer', quantity: 200, unit: 'g' },
            { name: 'Dhaniya', quantity: 1.5, rawQuantity: '1 1/2', unit: 'tsp' },
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
      'Masala Paneer: 200g paneer, 1.5 tsp dhaniya, yield 300g, 10 mins',
      turn1Intent,
      catalog,
      conversions,
      gasConfig,
      []
    );

    expect(outcome1.isComplete).toBe(false);
    const ambigClar = outcome1.clarifications.find(c => c.category === 'AMBIGUOUS_INGREDIENT');
    expect(ambigClar).toBeDefined();
    expect(ambigClar?.targetEntity).toBe('Dhaniya');
    expect(ambigClar?.question).toContain('Coriander Seeds');
    expect(ambigClar?.question).toContain('Coriander Powder');
    expect(ambigClar?.question).toContain('Coriander Leaves');

    // User replies naturally: "I meant coriander powder"
    const turn2Intent: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome2 = manager.processTurn(
      'I meant coriander powder',
      turn2Intent,
      catalog,
      conversions,
      gasConfig,
      []
    );

    expect(outcome2.isComplete).toBe(true);
    const resolvedRow = outcome2.recipes[0].rows.find(r => r.matchedMaster?.id === 'ing_coriander_powder');
    expect(resolvedRow).toBeDefined();
    expect(resolvedRow?.raw.quantity).toBe(1.5); // Original quantity 1.5 tsp preserved!
    expect(resolvedRow?.raw.unit).toBe('tsp');
    expect(resolvedRow?.effectiveQuantity).toBeCloseTo(4.5, 4); // 1.5 tsp * 3g = 4.5g
  });

  it('strictly separates Whole Cumin vs Roasted Cumin Powder', () => {
    expect(hasFormOrVarietyConflict('Whole Cumin', 'Roasted Cumin Powder')).toBe(true);
    expect(hasFormOrVarietyConflict('Jeera', 'Bhuna Jeera Powder')).toBe(true);

    const wholeMatch = matchIngredient('Sabut Jeera', catalog);
    expect(wholeMatch.matchedIngredient?.id).toBe('ing_cumin');

    const roastedMatch = matchIngredient('Roasted Cumin Powder', catalog);
    expect(roastedMatch.matchedIngredient?.id).toBe('ing_roasted_cumin_pdr');

    // If catalog only has Whole Cumin, "Roasted Cumin Powder" must NOT match Whole Cumin
    const onlyWholeCuminCatalog = [catalog.find(i => i.id === 'ing_cumin')!];
    const noFalseMatch = matchIngredient('Roasted Cumin Powder', onlyWholeCuminCatalog);
    expect(noFalseMatch.outcome).toBe('NO_MATCH');
    expect(noFalseMatch.matchedIngredient).toBeNull();
  });

  it('strictly separates Whole Black Pepper vs Black Pepper Powder', () => {
    expect(hasFormOrVarietyConflict('Black Pepper', 'Black Pepper Powder')).toBe(true);
    expect(hasFormOrVarietyConflict('Kali Mirch', 'Kali Mirch Powder')).toBe(true);

    const wholePepper = matchIngredient('Whole Black Pepper', catalog);
    expect(wholePepper.matchedIngredient?.id).toBe('ing_black_pepper_whole');

    const powderPepper = matchIngredient('Black Pepper Powder', catalog);
    expect(powderPepper.matchedIngredient?.id).toBe('ing_black_pepper_powder');
  });

  it('strictly separates Methi Seeds (Methi Dana) vs Kasuri Methi (dried fenugreek leaves)', () => {
    expect(hasFormOrVarietyConflict('Methi Seeds', 'Kasuri Methi')).toBe(true);
    expect(hasFormOrVarietyConflict('Fenugreek Seeds', 'Dried Fenugreek Leaves')).toBe(true);

    const seeds = matchIngredient('Fenugreek Seeds', catalog);
    expect(seeds.matchedIngredient?.id).toBe('ing_methi_seeds');

    const driedLeaves = matchIngredient('Kasuri Methi', catalog);
    expect(driedLeaves.matchedIngredient?.id).toBe('ing_kasuri_methi');
  });

  it('strictly separates Maida vs Wheat Flour (Atta)', () => {
    expect(hasFormOrVarietyConflict('Maida', 'Wheat Flour')).toBe(true);
    expect(areIngredientsEquivalent('Maida', 'Wheat Flour')).toBe(false);

    const attaMatch = matchIngredient('Gehu Atta', catalog);
    expect(attaMatch.matchedIngredient?.id).toBe('ing_wheat_flour');

    const maidaMatch = matchIngredient('All Purpose Flour', catalog);
    expect(maidaMatch.matchedIngredient?.id).toBe('ing_maida');
  });

  it('strictly separates Moong Dal, Toor Dal, and Chana Dal, and flags bare "Dal" as AMBIGUOUS_MATCH', () => {
    expect(hasFormOrVarietyConflict('Moong Dal', 'Toor Dal')).toBe(true);
    expect(hasFormOrVarietyConflict('Toor Dal', 'Chana Dal')).toBe(true);
    expect(hasFormOrVarietyConflict('Moong Dal', 'Chana Dal')).toBe(true);

    expect(matchIngredient('Yellow Moong Dal', catalog).matchedIngredient?.id).toBe('ing_moong_dal');
    expect(matchIngredient('Arhar Dal', catalog).matchedIngredient?.id).toBe('ing_toor_dal');
    expect(matchIngredient('Toor Dal', catalog).matchedIngredient?.id).toBe('ing_toor_dal');
    expect(matchIngredient('Channa Dal', catalog).matchedIngredient?.id).toBe('ing_chana_dal');

    // Bare "Dal" must ask which dal the user means
    const bareDal = matchIngredient('Dal', catalog);
    expect(bareDal.outcome).toBe('AMBIGUOUS_MATCH');
    expect(bareDal.requiresConfirmation).toBe(true);
    expect(bareDal.candidates.map(c => c.id)).toEqual(['ing_moong_dal', 'ing_toor_dal', 'ing_chana_dal']);
  });

  it('handles common spelling variations, fuzzy typos requiring confirmation, and completely new ingredients', () => {
    // 1. Known spelling variations (SPELLING_VARIATION_MATCH)
    const pannerRes = matchIngredient('panner', catalog);
    expect(pannerRes.outcome).toBe('SPELLING_VARIATION_MATCH');
    expect(pannerRes.matchedIngredient?.id).toBe('ing_paneer');

    const zeeraRes = matchIngredient('zeera', catalog);
    expect(zeeraRes.outcome).toBe('SPELLING_VARIATION_MATCH');
    expect(zeeraRes.matchedIngredient?.id).toBe('ing_cumin');

    const kastoriRes = matchIngredient('kastori methi', catalog);
    expect(kastoriRes.outcome).toBe('SPELLING_VARIATION_MATCH');
    expect(kastoriRes.matchedIngredient?.id).toBe('ing_kasuri_methi');

    // 2. Fuzzy typo match (AMBIGUOUS_MATCH requiring user confirmation)
    const typoTurmeric = matchIngredient('Turmaric', catalog);
    expect(typoTurmeric.outcome).toBe('AMBIGUOUS_MATCH');
    expect(typoTurmeric.requiresConfirmation).toBe(true);
    expect(typoTurmeric.candidates[0]?.id).toBe('ing_turmeric');

    // 3. Completely new ingredient (NO_MATCH)
    const newIng = matchIngredient('Avocado', catalog);
    expect(newIng.outcome).toBe('NO_MATCH');
    expect(newIng.matchedIngredient).toBeNull();
    expect(newIng.candidates).toHaveLength(0);

    // 4. Boiled potato must NEVER false-match "Refined Oil" via substring "oil"
    const boiledPotato = matchIngredient('Boiled Potato', catalog);
    expect(boiledPotato.outcome).toBe('NO_MATCH');
    expect(boiledPotato.matchedIngredient).toBeNull();
  });
});

describe('Step 4: Deterministic Recipe Costing Verification Across Synonyms', () => {
  const masterIngredients: Ingredient[] = [
    { id: 'ing_toor_dal', name: 'Tur Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 180, costPerUnit: 0.18 },
    { id: 'ing_turmeric', name: 'Turmeric', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.3 },
    { id: 'ing_cumin', name: 'Cumin', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 150, costPerUnit: 0.3 },
    { id: 'ing_onion', name: 'Onion', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 40, costPerUnit: 0.04 },
    { id: 'ing_tomato', name: 'Tomato', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 50, costPerUnit: 0.05 },
    { id: 'ing_salt', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 20, costPerUnit: 0.02 },
    { id: 'ing_ghee', name: 'Amul Ghee', purchaseQty: 1, purchaseUnit: 'litre', purchaseCost: 600, costPerUnit: 0.6 },
  ];

  const conversions: TeaspoonConversion[] = [
    { id: 'tc_turmeric', name: 'Turmeric', weightGrams: 3 },
    { id: 'tc_cumin', name: 'Cumin', weightGrams: 2.5 },
    { id: 'tc_salt', name: 'Salt', weightGrams: 5 },
  ];

  const gasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  it('produces identical deterministic batch and per-serving costs whether recipe uses Hindi names or English names, with zero duplicate database writes', () => {
    const upsertSpy = vi.spyOn(supabase, 'from');

    // Recipe 1: Entered with Hindi names (Arhar Dal, Haldi, Jeera, Pyaaz, Tamatar, Namak, Desi Ghee)
    const hindiIntent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Dal Tadka',
          cookingTimeMins: 15,
          yieldAmount: 1000,
          yieldType: 'weight',
          ingredients: [
            { name: 'Arhar Dal', quantity: 200, unit: 'g' },
            { name: 'Haldi', quantity: 0.5, unit: 'tsp' },
            { name: 'Jeera', quantity: 1, unit: 'tsp' },
            { name: 'Pyaaz', quantity: 80, unit: 'g' },
            { name: 'Tamatar', quantity: 100, unit: 'g' },
            { name: 'Namak', quantity: 1, unit: 'tsp' },
            { name: 'Desi Ghee', quantity: 20, unit: 'ml' },
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

    // Recipe 2: Entered with English names (Toor Dal, Turmeric, Cumin, Onion, Tomato, Salt, Amul Ghee)
    const englishIntent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Dal Tadka',
          cookingTimeMins: 15,
          yieldAmount: 1000,
          yieldType: 'weight',
          ingredients: [
            { name: 'Toor Dal', quantity: 200, unit: 'g' },
            { name: 'Turmeric', quantity: 0.5, unit: 'tsp' },
            { name: 'Cumin', quantity: 1, unit: 'tsp' },
            { name: 'Onion', quantity: 80, unit: 'g' },
            { name: 'Tomato', quantity: 100, unit: 'g' },
            { name: 'Salt', quantity: 1, unit: 'tsp' },
            { name: 'Amul Ghee', quantity: 20, unit: 'ml' },
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

    const hindiOutcome = validateKitchenIntent(hindiIntent, masterIngredients, conversions, gasConfig, []);
    const englishOutcome = validateKitchenIntent(englishIntent, masterIngredients, conversions, gasConfig, []);

    expect(hindiOutcome.isComplete).toBe(true);
    expect(englishOutcome.isComplete).toBe(true);

    const hindiProposal = generateProposedChangeSet(
      {
        validatedIntent: hindiIntent,
        validationOutcome: hindiOutcome,
        pendingClarifications: [],
        assistantReply: 'Ready',
      },
      masterIngredients,
      conversions,
      gasConfig,
      []
    );

    const englishProposal = generateProposedChangeSet(
      {
        validatedIntent: englishIntent,
        validationOutcome: englishOutcome,
        pendingClarifications: [],
        assistantReply: 'Ready',
      },
      masterIngredients,
      conversions,
      gasConfig,
      []
    );

    // No duplicate ingredients or conversions proposed
    expect(hindiProposal.operations.newIngredients).toHaveLength(0);
    expect(hindiProposal.operations.newConversions).toHaveLength(0);

    // Verify mapped ingredient IDs match canonical DB records
    const hindiRecipe = hindiProposal.operations.recipesToCreate[0].recipe;
    const englishRecipe = englishProposal.operations.recipesToCreate[0].recipe;
    expect(hindiRecipe.ingredients.map(i => i.ingredientId)).toEqual([
      'ing_toor_dal',
      'ing_turmeric',
      'ing_cumin',
      'ing_onion',
      'ing_tomato',
      'ing_salt',
      'ing_ghee',
    ]);
    expect(hindiRecipe.ingredients.map(i => i.ingredientId)).toEqual(
      englishRecipe.ingredients.map(i => i.ingredientId)
    );

    // Manual math verification:
    // 1. Tur Dal: 200g * ₹0.18/g = ₹36.00
    // 2. Turmeric (Haldi): 0.5 tsp * 3g/tsp = 1.5g * ₹0.30/g = ₹0.45
    // 3. Cumin (Jeera): 1 tsp * 2.5g/tsp = 2.5g * ₹0.30/g = ₹0.75
    // 4. Onion (Pyaaz): 80g * ₹0.04/g = ₹3.20
    // 5. Tomato (Tamatar): 100g * ₹0.05/g = ₹5.00
    // 6. Salt (Namak): 1 tsp * 5g/tsp = 5g * ₹0.02/g = ₹0.10
    // 7. Amul Ghee (Desi Ghee): 20ml * ₹0.60/ml = ₹12.00
    // Expected Ingredients Cost = 36 + 0.45 + 0.75 + 3.20 + 5.00 + 0.10 + 12.00 = ₹57.50
    // Gas Cost (15 mins) = (950 / 14.2 * 0.25 / 60) * 15 = ₹4.181338...
    // Expected Total Batch Cost (1000g) = 57.50 + 4.181338 = ₹61.681338
    // Expected Per-Serving Cost (100g default) = ₹6.1681338
    const expectedGasCost = calculateGasCosts(gasConfig).costPerMinute * 15;
    const expectedBatchCost = 57.5 + expectedGasCost;
    const expectedServingCost = (expectedBatchCost / 1000) * 100;

    const hindiCost = hindiProposal.operations.recipesToCreate[0].calculatedCost;
    const englishCost = englishProposal.operations.recipesToCreate[0].calculatedCost;

    expect(hindiCost.isComplete).toBe(true);
    expect(hindiCost.totalBatchCost).toBeCloseTo(expectedBatchCost, 4);
    expect(hindiCost.servingCost).toBeCloseTo(expectedServingCost, 4);
    expect(hindiCost.totalBatchCost).toBeCloseTo(englishCost.totalBatchCost, 6);
    expect(hindiCost.servingCost).toBeCloseTo(englishCost.servingCost, 6);

    // Verify no database mutation happened during parsing, validation, or proposal generation
    expect(upsertSpy).not.toHaveBeenCalled();
    upsertSpy.mockRestore();
  });
});

