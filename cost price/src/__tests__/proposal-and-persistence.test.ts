/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Automated Tests for Phase 2 & Phase 3 & Phase 4:
 * Proposals, Confirmation Binding, Targeted Persistence, and Deterministic Recalculations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  generateProposedChangeSet,
  generateDatabaseSnapshotHash,
} from '../services/proposalGenerator';
import {
  persistProposedChangeSet,
  findAffectedRecipeIds,
} from '../services/catalogPersistenceService';
import {
  handleApplyKitchenMutationsRequest,
  ProposalMutationSchema,
} from '../server/ai/mutationHandler';
import { ConversationTurnResult } from '../services/conversationManager';
import { calculateRecipeCosts } from '../utils';

// Mock Master Database
const mockIngredients: Ingredient[] = [
  { id: 'ing_paneer', name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.4 },
  { id: 'ing_dal', name: 'Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 120, costPerUnit: 0.12 },
  { id: 'ing_turmeric', name: 'Haldi', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 100, costPerUnit: 0.2 },
  { id: 'ing_salt', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 25, costPerUnit: 0.025 },
];

const mockConversions: TeaspoonConversion[] = [
  { id: 'conv_haldi', name: 'Haldi', weightGrams: 3 },
  { id: 'conv_salt', name: 'Salt', weightGrams: 5 },
  { id: 'conv_jeera', name: 'Jeera', weightGrams: 2.5 },
];

const mockGasConfig: GasConfig = {
  cylinderPrice: 950,
  cylinderWeightKg: 14.2,
  consumptionRateKgHour: 0.25,
};

const mockRecipes: Recipe[] = [
  {
    id: 'rec_dal_fry',
    name: 'Dal Fry',
    ingredients: [
      { id: 'ri_1', ingredientId: 'ing_dal', name: 'Dal', quantity: 150, unit: 'g' },
      { id: 'ri_2', ingredientId: 'ing_turmeric', name: 'Haldi', quantity: 1, unit: 'tsp' },
      { id: 'ri_3', ingredientId: 'ing_salt', name: 'Salt', quantity: 1, unit: 'tsp' },
    ],
    yieldType: 'weight',
    yieldAmount: 450,
    cookingTimeMins: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'rec_paneer_bhurji',
    name: 'Paneer Bhurji',
    ingredients: [
      { id: 'ri_4', ingredientId: 'ing_paneer', name: 'Paneer', quantity: 200, unit: 'g' },
      { id: 'ri_5', ingredientId: 'ing_salt', name: 'Salt', quantity: 0.5, unit: 'tsp' },
    ],
    yieldType: 'weight',
    yieldAmount: 250,
    cookingTimeMins: 8,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Phase 2 & Phase 3: Proposal Generation and Review Diffs', () => {
  it('generates a complete proposed change set with previous vs proposed values for ingredient price updates', () => {
    const mockTurnResult: ConversationTurnResult = {
      validatedIntent: {
        detectedIntent: 'INGREDIENT_MUTATION',
        recipes: [],
        ingredientCreations: [],
        ingredientUpdates: [
          { name: 'Paneer', purchaseCost: 110, purchaseQty: 200, purchaseUnit: 'g' },
        ],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
      },
      validationOutcome: {
        intent: {
          detectedIntent: 'INGREDIENT_MUTATION',
          recipes: [],
          ingredientCreations: [],
          ingredientUpdates: [
            { name: 'Paneer', purchaseCost: 110, purchaseQty: 200, purchaseUnit: 'g' },
          ],
          conversionUpdates: [],
          clarificationAnswers: [],
          unresolvedNotes: [],
        },
        isComplete: true,
        unresolvedCount: 0,
        userSummary: 'Paneer price update',
        recipes: [],
        ingredientMutations: [
          {
            type: 'UPDATE',
            name: 'Paneer',
            targetId: 'ing_paneer',
            purchaseCost: 110,
            purchaseQty: 200,
            purchaseUnit: 'g',
            costPerUnit: 0.55,
            previousRecord: mockIngredients[0],
          },
        ],
        conversionMutations: [],
        gasMutation: null,
        clarifications: [],
      },
      pendingClarifications: [],
      assistantReply: 'Paneer price update ready for review.',
    };

    const proposal = generateProposedChangeSet(
      mockTurnResult,
      mockIngredients,
      mockConversions,
      mockGasConfig,
      mockRecipes
    );

    expect(proposal.operations.updatedIngredients).toHaveLength(1);
    const updated = proposal.operations.updatedIngredients[0];
    expect(updated.name).toBe('Paneer');
    expect(updated.previous.purchaseCost).toBe(400);
    expect(updated.previous.purchaseQty).toBe(1);
    expect(updated.previous.purchaseUnit).toBe('kg');
    expect(updated.previous.costPerUnit).toBe(0.4);

    expect(updated.proposed.purchaseCost).toBe(110);
    expect(updated.proposed.purchaseQty).toBe(200);
    expect(updated.proposed.purchaseUnit).toBe('g');
    expect(updated.proposed.costPerUnit).toBe(0.55);

    expect(proposal.hasBlockingIssues).toBe(false);
    expect(proposal.status).toBe('ready_for_review');
  });

  it('marks proposal as draft with hasBlockingIssues: true when clarifications or missing info are pending', () => {
    const mockTurnResult: ConversationTurnResult = {
      validatedIntent: {
        detectedIntent: 'RECIPE_CREATION',
        recipes: [],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
      },
      validationOutcome: {
        intent: {
          detectedIntent: 'RECIPE_CREATION',
          recipes: [],
          ingredientCreations: [],
          ingredientUpdates: [],
          conversionUpdates: [],
          clarificationAnswers: [],
          unresolvedNotes: [],
        },
        isComplete: false,
        unresolvedCount: 1,
        userSummary: 'Incomplete onion recipe',
        recipes: [],
        ingredientMutations: [],
        conversionMutations: [],
        gasMutation: null,
        clarifications: [
          {
            id: 'clarif_1',
            category: 'AMBIGUOUS_UNIT',
            targetEntity: 'pyaaz',
            field: 'quantity',
            question: 'How many grams does half an onion weigh?',
          },
        ],
      },
      pendingClarifications: [
        {
          id: 'clarif_1',
          category: 'AMBIGUOUS_UNIT',
          targetEntity: 'pyaaz',
          field: 'quantity',
          question: 'How many grams does half an onion weigh?',
        },
      ],
      assistantReply: 'Please specify the gram weight of half an onion.',
    };

    const proposal = generateProposedChangeSet(
      mockTurnResult,
      mockIngredients,
      mockConversions,
      mockGasConfig,
      mockRecipes
    );

    expect(proposal.hasBlockingIssues).toBe(true);
    expect(proposal.status).toBe('draft');
    expect(proposal.missingInfo).toContain('How many grams does half an onion weigh?');
  });

  it('generates a stable deterministic snapshot hash and detects concurrent state modifications', () => {
    const hash1 = generateDatabaseSnapshotHash(mockIngredients, mockConversions, mockGasConfig, mockRecipes);
    const hash2 = generateDatabaseSnapshotHash(mockIngredients, mockConversions, mockGasConfig, mockRecipes);
    expect(hash1).toBe(hash2);

    // Modify an ingredient price concurrently
    const modifiedIngredients = mockIngredients.map(i => (i.id === 'ing_dal' ? { ...i, purchaseCost: 150 } : i));
    const modifiedHash = generateDatabaseSnapshotHash(modifiedIngredients, mockConversions, mockGasConfig, mockRecipes);
    expect(modifiedHash).not.toBe(hash1);
  });
});

describe('Phase 3 & Phase 4: Targeted Persistence and Atomic Recalculations', () => {
  it('identifies affected recipes when an ingredient price changes', () => {
    // Changing 'ing_dal' should affect 'Dal Fry' but not 'Paneer Bhurji'
    const affected = findAffectedRecipeIds(mockRecipes, ['ing_dal'], [], false);
    expect(affected).toEqual(['rec_dal_fry']);

    // Changing 'ing_salt' should affect both recipes
    const affectedSalt = findAffectedRecipeIds(mockRecipes, ['ing_salt'], [], false);
    expect(affectedSalt).toContain('rec_dal_fry');
    expect(affectedSalt).toContain('rec_paneer_bhurji');
  });

  it('identifies affected recipes when gas config changes', () => {
    // Both recipes have cookingTimeMins > 0, so gas change affects both
    const affectedGas = findAffectedRecipeIds(mockRecipes, [], [], true);
    expect(affectedGas).toContain('rec_dal_fry');
    expect(affectedGas).toContain('rec_paneer_bhurji');
  });

  it('rejects persistence if proposal is stale (database state modified concurrently)', async () => {
    const currentHash = generateDatabaseSnapshotHash(mockIngredients, mockConversions, mockGasConfig, mockRecipes);
    const staleProposal = {
      id: 'prop_test_1',
      createdAt: new Date().toISOString(),
      summary: 'Update paneer price',
      operations: {
        newIngredients: [],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review' as const,
      databaseSnapshotHash: 'stale_hash_12345',
    };

    const result = await persistProposedChangeSet(
      staleProposal,
      currentHash,
      mockIngredients,
      mockConversions,
      mockGasConfig,
      mockRecipes
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database state has changed since this proposal was prepared');
  });

  it('rejects persistence if proposal has blocking issues', async () => {
    const currentHash = generateDatabaseSnapshotHash(mockIngredients, mockConversions, mockGasConfig, mockRecipes);
    const blockedProposal = {
      id: 'prop_test_blocked',
      createdAt: new Date().toISOString(),
      summary: 'Incomplete recipe',
      operations: {
        newIngredients: [],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: ['Please provide price for new spice'],
      hasBlockingIssues: true,
      status: 'draft' as const,
      databaseSnapshotHash: currentHash,
    };

    const result = await persistProposedChangeSet(
      blockedProposal,
      currentHash,
      mockIngredients,
      mockConversions,
      mockGasConfig,
      mockRecipes
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot apply proposal with blocking issues');
  });
});

describe('Phase 3: Backend Mutation Allowlisting & Security', () => {
  it('validates a correct mutation request successfully', async () => {
    const validProposal = {
      id: 'prop_valid_101',
      createdAt: new Date().toISOString(),
      summary: 'Update paneer price to ₹110 for 200g',
      operations: {
        newIngredients: [],
        updatedIngredients: [
          {
            id: 'ing_paneer',
            name: 'Paneer',
            previous: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.4 },
            proposed: { purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 110, costPerUnit: 0.55 },
          },
        ],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review',
      databaseSnapshotHash: 'abc123hash',
    };

    const res = await handleApplyKitchenMutationsRequest({ proposal: validProposal }, '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.proposalId).toBe('prop_valid_101');
  });

  it('rejects malformed mutation payloads with negative costs or invalid units', async () => {
    const malformedProposal = {
      id: 'prop_malformed',
      operations: {
        newIngredients: [
          {
            tempId: 'temp_1',
            name: 'Invalid Item',
            purchaseQty: -5, // Invalid negative quantity
            purchaseUnit: 'gallons', // Invalid unallowlisted unit
            purchaseCost: -100, // Invalid negative cost
            costPerUnit: -20,
          },
        ],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review',
      databaseSnapshotHash: 'hash123',
    };

    const res = await handleApplyKitchenMutationsRequest({ proposal: malformedProposal }, '127.0.0.1');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects proposals marked with blocking issues from backend execution', async () => {
    const blockedProposal = {
      id: 'prop_blocked',
      operations: {
        newIngredients: [],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: ['Missing weight for pouch'],
      missingInfo: ['What is pouch size?'],
      hasBlockingIssues: true, // Blocking
      status: 'draft',
      databaseSnapshotHash: 'hash123',
    };

    const res = await handleApplyKitchenMutationsRequest({ proposal: blockedProposal }, '127.0.0.1');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('BLOCKING_ISSUES_PRESENT');
  });
});

describe('Phase 4: Deterministic Cost Calculation Precision & Integrity', () => {
  it('correctly recalculates Dal Fry cost after Haldi teaspoon conversion change', () => {
    const initialCost = calculateRecipeCosts(mockRecipes[0], mockIngredients, mockConversions, mockGasConfig);
    expect(initialCost.isComplete).toBe(true);
    // Haldi was 3g at ₹0.2/g = ₹0.6
    // Dal was 150g at ₹0.12/g = ₹18.0
    // Salt was 5g at ₹0.025/g = ₹0.125
    // Ingredients total = 18 + 0.6 + 0.125 = ₹18.725
    // Gas cost: (950 / 14.2 * 0.25 / 60) * 12 mins = 0.278755 * 12 = ₹3.345
    // Total batch = 18.725 + 3.345 = ~₹22.07
    expect(initialCost.totalBatchCost).toBeCloseTo(22.07, 1);

    // Increase Haldi conversion to 6g per tsp
    const updatedConversions: TeaspoonConversion[] = mockConversions.map(c =>
      c.name === 'Haldi' ? { ...c, weightGrams: 6 } : c
    );

    const updatedCost = calculateRecipeCosts(mockRecipes[0], mockIngredients, updatedConversions, mockGasConfig);
    // Haldi cost should double from ₹0.6 to ₹1.2 (an increase of ₹0.6)
    expect(updatedCost.totalBatchCost - initialCost.totalBatchCost).toBeCloseTo(0.6, 2);
  });

  it('marks recipe cost as incomplete if an ingredient has no price or conversion is missing', () => {
    const incompleteRecipe: Recipe = {
      id: 'rec_incomplete',
      name: 'Mystery Dish',
      ingredients: [
        { id: 'ri_x', ingredientId: 'unknown_id', name: 'Unknown Herb', quantity: 10, unit: 'g' },
      ],
      yieldType: 'weight',
      yieldAmount: 100,
      cookingTimeMins: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const costBreakdown = calculateRecipeCosts(incompleteRecipe, mockIngredients, mockConversions, mockGasConfig);
    expect(costBreakdown.isComplete).toBe(false);
    expect(costBreakdown.hasMissingCosts).toBe(true);
  });
});
