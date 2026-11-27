/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Automated Tests for Optimistic Concurrency Control (OCC),
 * Stale Proposal Rejection, Non-Conflicting Merge, Atomic Rollback, and Cross-Tab Synchronization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  persistProposedChangeSet,
  validateProposalAgainstLiveDatabase,
  LiveCatalogState,
} from '../services/catalogPersistenceService';
import { ProposedChangeSet } from '../server/ai/proposalTypes';
import { generateDatabaseSnapshotHash } from '../services/proposalGenerator';
import {
  broadcastCatalogMutation,
  subscribeToCatalogMutations,
  CURRENT_TAB_ID,
} from '../services/crossTabSync';
import supabase from '../supabaseClient';

const baselineIngredients: Ingredient[] = [
  { id: 'ing_sugar', name: 'Sugar', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 0.057 },
  { id: 'ing_salt', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 25, costPerUnit: 0.025 },
  { id: 'ing_dal', name: 'Dal', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 120, costPerUnit: 0.12 },
  { id: 'ing_haldi', name: 'Haldi', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 100, costPerUnit: 0.2 },
];

const baselineConversions: TeaspoonConversion[] = [
  { id: 'conv_jeera', name: 'Jeera', weightGrams: 2.5 },
  { id: 'conv_haldi', name: 'Haldi', weightGrams: 3.0 },
];

const baselineGasConfig: GasConfig = {
  cylinderPrice: 950,
  cylinderWeightKg: 14.2,
  consumptionRateKgHour: 0.25,
};

const baselineRecipes: Recipe[] = [
  {
    id: 'rec_sweet_dal',
    name: 'Sweet Dal',
    ingredients: [
      { id: 'ri_1', ingredientId: 'ing_dal', name: 'Dal', quantity: 100, unit: 'g' },
      { id: 'ri_2', ingredientId: 'ing_sugar', name: 'Sugar', quantity: 20, unit: 'g' },
      { id: 'ri_3', ingredientId: 'ing_salt', name: 'Salt', quantity: 5, unit: 'g' },
    ],
    yieldType: 'weight',
    yieldAmount: 200,
    cookingTimeMins: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Phase 1 & Phase 2: Database-Level Optimistic Concurrency Control (OCC) & Stale Proposal Protection', () => {
  const baseHash = generateDatabaseSnapshotHash(
    baselineIngredients,
    baselineConversions,
    baselineGasConfig,
    baselineRecipes
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock global fetch so Supabase REST calls succeed in sandbox test environment
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '[]',
      } as any;
    });
  });

  it('Requirement 1: Rejects proposal when targeted ingredient was modified concurrently in the database', async () => {
    // Proposal: prepared when Sugar was ₹57/kg, proposing to update Sugar to ₹65/kg
    const sugarProposal: ProposedChangeSet = {
      id: 'prop_sugar_65',
      createdAt: new Date().toISOString(),
      summary: 'Update Sugar price to ₹65 for 1kg',
      operations: {
        newIngredients: [],
        updatedIngredients: [
          {
            id: 'ing_sugar',
            name: 'Sugar',
            previous: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 0.057 },
            proposed: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 65, costPerUnit: 0.065 },
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
      databaseSnapshotHash: baseHash,
    };

    // Live Database: Another tab or user modified Sugar to ₹60/kg in the meantime!
    const liveCatalogWithConcurrentUpdate: LiveCatalogState = {
      ingredients: baselineIngredients.map(i =>
        i.id === 'ing_sugar' ? { ...i, purchaseCost: 60, costPerUnit: 0.06 } : i
      ),
      conversions: baselineConversions,
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      sugarProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalogWithConcurrentUpdate }
    );

    // MUST be rejected!
    expect(result.success).toBe(false);
    expect(result.error).toContain('Database state has changed since this proposal was prepared');
    expect(result.error).toContain('Sugar');
    expect(result.error).toContain('60'); // current DB value
    expect(result.error).toContain('57'); // proposal baseline value
    expect(result.conflictDetails).toBeDefined();
    expect(result.conflictDetails?.length).toBeGreaterThan(0);
    expect(result.conflictDetails?.[0].targetName).toBe('Sugar');
  });

  it('Requirement 2: Rejects proposal when targeted teaspoon conversion was modified concurrently', async () => {
    // Proposal prepared when 1 tsp Jeera = 2.5g, proposing to change to 3.0g
    const conversionProposal: ProposedChangeSet = {
      id: 'prop_conv_jeera',
      createdAt: new Date().toISOString(),
      summary: 'Update Jeera conversion to 3g',
      operations: {
        newIngredients: [],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [
          {
            id: 'conv_jeera',
            name: 'Jeera',
            previousWeightGrams: 2.5,
            proposedWeightGrams: 3.0,
          },
        ],
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review',
      databaseSnapshotHash: baseHash,
    };

    // Live DB: Jeera was changed concurrently to 3.5g
    const liveCatalogWithConcurrentConv: LiveCatalogState = {
      ingredients: baselineIngredients,
      conversions: baselineConversions.map(c =>
        c.id === 'conv_jeera' ? { ...c, weightGrams: 3.5 } : c
      ),
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      conversionProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalogWithConcurrentConv }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Teaspoon conversion "Jeera" was modified in the database');
    expect(result.error).toContain('3.5');
    expect(result.error).toContain('2.5');
  });

  it('Requirement 3: Rejects proposal when gas configuration was modified concurrently', async () => {
    // Proposal prepared when gas cylinder price was ₹950, proposing ₹1000
    const gasProposal: ProposedChangeSet = {
      id: 'prop_gas_update',
      createdAt: new Date().toISOString(),
      summary: 'Update cylinder price to ₹1000',
      operations: {
        newIngredients: [],
        updatedIngredients: [],
        newConversions: [],
        updatedConversions: [],
        gasConfigUpdate: {
          previous: baselineGasConfig,
          proposed: { ...baselineGasConfig, cylinderPrice: 1000 },
        },
        recipesToCreate: [],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review',
      databaseSnapshotHash: baseHash,
    };

    // Live DB: Gas cylinder was changed concurrently to ₹980
    const liveCatalogWithConcurrentGas: LiveCatalogState = {
      ingredients: baselineIngredients,
      conversions: baselineConversions,
      gasConfig: { ...baselineGasConfig, cylinderPrice: 980 },
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      gasProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalogWithConcurrentGas }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Gas configuration was modified in the database');
    expect(result.error).toContain('980');
    expect(result.error).toContain('950');
  });

  it('Requirement 4: Preserves unrelated concurrent updates and merges non-conflicting changes onto latest database state', async () => {
    // Proposal: update Sugar from ₹57 to ₹65
    const sugarProposal: ProposedChangeSet = {
      id: 'prop_sugar_nonconflict',
      createdAt: new Date().toISOString(),
      summary: 'Update Sugar price to ₹65 for 1kg',
      operations: {
        newIngredients: [],
        updatedIngredients: [
          {
            id: 'ing_sugar',
            name: 'Sugar',
            previous: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 0.057 },
            proposed: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 65, costPerUnit: 0.065 },
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
      databaseSnapshotHash: baseHash,
    };

    // Live DB: Salt was modified to ₹35/kg in Tab B, but Sugar is STILL ₹57/kg (no conflict on Sugar!)
    const liveCatalogWithUnrelatedChange: LiveCatalogState = {
      ingredients: baselineIngredients.map(i =>
        i.id === 'ing_salt' ? { ...i, purchaseCost: 35, costPerUnit: 0.035 } : i
      ),
      conversions: baselineConversions,
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      sugarProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalogWithUnrelatedChange }
    );

    // Proposal should succeed because Sugar had no conflict!
    expect(result.success).toBe(true);

    // AND both changes must be present in the returned catalog!
    const sugarInCatalog = result.updatedIngredients.find(i => i.id === 'ing_sugar');
    const saltInCatalog = result.updatedIngredients.find(i => i.id === 'ing_salt');

    expect(sugarInCatalog?.purchaseCost).toBe(65); // Tab A's change applied
    expect(saltInCatalog?.purchaseCost).toBe(35);  // Tab B's concurrent change preserved!
  });

  it('Requirement 5: Rejects duplicate ingredient creation when an ingredient with the same canonical name already exists', async () => {
    // Proposal proposes to add "Turmeric" (which matches existing "Haldi")
    const duplicateProposal: ProposedChangeSet = {
      id: 'prop_dup_turmeric',
      createdAt: new Date().toISOString(),
      summary: 'Add Turmeric 500g for ₹120',
      operations: {
        newIngredients: [
          {
            tempId: 'temp_turmeric',
            name: 'Turmeric', // Synonym of Haldi
            purchaseQty: 500,
            purchaseUnit: 'g',
            purchaseCost: 120,
            costPerUnit: 0.24,
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
      databaseSnapshotHash: baseHash,
    };

    const liveCatalog: LiveCatalogState = {
      ingredients: baselineIngredients,
      conversions: baselineConversions,
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      duplicateProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalog }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists in the database');
  });

  it('Requirement 6: Guarantees zero database writes when a conflict is detected', async () => {
    const upsertSpy = vi.spyOn(supabase.from('ingredients'), 'upsert');

    const conflictedProposal: ProposedChangeSet = {
      id: 'prop_conflict_nowrite',
      createdAt: new Date().toISOString(),
      summary: 'Update Sugar',
      operations: {
        newIngredients: [],
        updatedIngredients: [
          {
            id: 'ing_sugar',
            name: 'Sugar',
            previous: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 0.057 },
            proposed: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 65, costPerUnit: 0.065 },
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
      databaseSnapshotHash: baseHash,
    };

    // Live catalog has conflicting price 60
    const liveCatalog: LiveCatalogState = {
      ingredients: baselineIngredients.map(i =>
        i.id === 'ing_sugar' ? { ...i, purchaseCost: 60 } : i
      ),
      conversions: baselineConversions,
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    const result = await persistProposedChangeSet(
      conflictedProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalog }
    );

    expect(result.success).toBe(false);
    // Verified: zero upserts called!
    expect(upsertSpy).not.toHaveBeenCalled();
    upsertSpy.mockRestore();
  });

  it('Requirement 7: Executes atomic rollback when a sequential persistence step fails', async () => {
    // Proposal that updates an ingredient and creates a recipe
    const multiOpProposal: ProposedChangeSet = {
      id: 'prop_multi_op',
      createdAt: new Date().toISOString(),
      summary: 'Update Sugar and Create Recipe',
      operations: {
        newIngredients: [],
        updatedIngredients: [
          {
            id: 'ing_sugar',
            name: 'Sugar',
            previous: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 57, costPerUnit: 0.057 },
            proposed: { purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 65, costPerUnit: 0.065 },
          },
        ],
        newConversions: [],
        updatedConversions: [],
        recipesToCreate: [
          {
            recipe: {
              id: 'rec_fail_test',
              name: 'Failed Dish',
              ingredients: [{ id: 'ri_x', ingredientId: 'ing_sugar', name: 'Sugar', quantity: 10, unit: 'g' }],
              yieldType: 'piece',
              yieldAmount: 1,
              cookingTimeMins: 5,
              createdAt: new Date().toISOString(),
            },
            newIngredientsToRegister: [],
            newConversionsToRegister: [],
            calculatedCost: {
              totalBatchCost: 10,
              costPerPiece: 10,
              costPer100g: undefined,
              servingCost: 10,
              servingAmount: 1,
              servingUnit: 'piece',
              isComplete: true,
              incompleteReasons: [],
            },
          },
        ],
        recipesToUpdate: [],
      },
      warnings: [],
      missingInfo: [],
      hasBlockingIssues: false,
      status: 'ready_for_review',
      databaseSnapshotHash: baseHash,
    };

    const liveCatalog: LiveCatalogState = {
      ingredients: baselineIngredients,
      conversions: baselineConversions,
      gasConfig: baselineGasConfig,
      recipes: baselineRecipes,
    };

    // Mock fetch so recipe upsert fails, but ingredient upsert and rollback upsert succeed
    let recipeAttempted = false;
    let rollbackAttempted = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/recipes')) {
        recipeAttempted = true;
        return {
          ok: false,
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ message: 'PostgreSQL recipes connection timeout' }),
          json: async () => ({ message: 'PostgreSQL recipes connection timeout' }),
        } as any;
      }
      if (recipeAttempted && urlStr.includes('/ingredients')) {
        rollbackAttempted = true;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '[]',
      } as any;
    });

    const result = await persistProposedChangeSet(
      multiOpProposal,
      baseHash,
      baselineIngredients,
      baselineConversions,
      baselineGasConfig,
      baselineRecipes,
      { liveCatalogOverride: liveCatalog }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Persistence failed and any partial changes were rolled back');
    expect(recipeAttempted).toBe(true);
    expect(rollbackAttempted).toBe(true);
  });
});

describe('Phase 3: Cross-Tab Synchronization and Messaging', () => {
  it('Requirement 8: Broadcasts mutation events and receives them via subscription without echo', () => {
    // Setup a mock storage event listener on globalThis for Node testing
    const listeners = new Map<string, Set<(e: any) => void>>();
    (globalThis as any).addEventListener = (type: string, cb: any) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    };
    (globalThis as any).removeEventListener = (type: string, cb: any) => {
      listeners.get(type)?.delete(cb);
    };

    const receivedEvents: any[] = [];
    const unsubscribe = subscribeToCatalogMutations(event => {
      receivedEvents.push(event);
    });

    // Simulate an event arriving from ANOTHER tab (different sourceTabId)
    const otherTabEvent = {
      type: 'CATALOG_MUTATED' as const,
      timestamp: Date.now(),
      sourceTabId: 'tab_other_99999',
      details: { action: 'update_ingredient', id: 'ing_sugar' },
    };

    const storageCallbacks = listeners.get('storage');
    storageCallbacks?.forEach(cb => {
      cb({
        key: 'dailydabba_catalog_mutation_ping',
        newValue: JSON.stringify(otherTabEvent),
      });
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].sourceTabId).toBe('tab_other_99999');
    expect(receivedEvents[0].details.id).toBe('ing_sugar');

    // Simulate an event originating from THIS tab (same sourceTabId)
    const thisTabEvent = {
      type: 'CATALOG_MUTATED' as const,
      timestamp: Date.now(),
      sourceTabId: CURRENT_TAB_ID, // same tab!
      details: { action: 'local_action' },
    };

    storageCallbacks?.forEach(cb => {
      cb({
        key: 'dailydabba_catalog_mutation_ping',
        newValue: JSON.stringify(thisTabEvent),
      });
    });

    // Must NOT echo back to the same tab
    expect(receivedEvents.length).toBe(1);

    unsubscribe();
  });
});

