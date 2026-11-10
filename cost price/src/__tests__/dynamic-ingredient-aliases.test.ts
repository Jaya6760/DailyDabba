/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Automated Tests for Phase 2 — Step 2:
 * Dynamic Database-Backed Ingredient Aliases Matching Engine.
 */

import { describe, it, expect } from 'vitest';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import {
  matchIngredient,
  areIngredientsEquivalent,
  findMatchingConversion,
} from '../services/ingredientMatcher';
import { validateKitchenIntent } from '../services/catalogValidationEngine';
import { UniversalKitchenIntent } from '../server/ai/intentSchema';

describe('Phase 2 — Step 2: Dynamic Ingredient Matcher Extension', () => {
  // Test Catalog with custom database-backed aliases
  const catalogWithAliases: Ingredient[] = [
    {
      id: 'ing_turmeric_1',
      name: 'Turmeric',
      purchaseQty: 500,
      purchaseUnit: 'g',
      purchaseCost: 150,
      costPerUnit: 0.3,
      aliases: ['Haldi', 'Indian Saffron', 'Manjal'],
    },
    {
      id: 'ing_cumin_whole_2',
      name: 'Cumin',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 320,
      costPerUnit: 0.32,
      aliases: ['Jeera', 'Sabut Zeera', 'White Cumin'],
    },
    {
      id: 'ing_onion_3',
      name: 'Onion',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 35,
      costPerUnit: 0.035,
      aliases: ['Pyaaz', 'Kanda', 'Dungri'],
    },
    {
      id: 'ing_tomato_4',
      name: 'Tomato',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 40,
      costPerUnit: 0.04,
      aliases: ['Tamatar'],
    },
    {
      id: 'ing_coriander_powder_5',
      name: 'Coriander Powder',
      purchaseQty: 200,
      purchaseUnit: 'g',
      purchaseCost: 60,
      costPerUnit: 0.3,
      aliases: ['Dhaniya Powder', 'Pisa Dhaniya'],
    },
    {
      id: 'ing_roasted_cumin_powder_6',
      name: 'Roasted Cumin Powder',
      purchaseQty: 100,
      purchaseUnit: 'g',
      purchaseCost: 50,
      costPerUnit: 0.5,
      aliases: ['Bhuna Jeera Powder', 'Sekha Jeera'],
    },
    {
      id: 'ing_atta_7',
      name: 'Wheat Flour',
      purchaseQty: 5,
      purchaseUnit: 'kg',
      purchaseCost: 210,
      costPerUnit: 0.042,
      aliases: ['Gehu Ka Atta', 'Chakki Atta'],
    },
    {
      id: 'ing_maida_8',
      name: 'Maida',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 45,
      costPerUnit: 0.045,
      aliases: ['All Purpose Flour', 'Refined Wheat Flour'],
    },
    // Ingredient with undefined aliases to test backward compatibility
    {
      id: 'ing_salt_legacy_9',
      name: 'Tata Salt',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 28,
      costPerUnit: 0.028,
      // aliases is undefined intentionally
    },
    // Ingredient with empty aliases array
    {
      id: 'ing_sugar_empty_10',
      name: 'Refined Sugar',
      purchaseQty: 1,
      purchaseUnit: 'kg',
      purchaseCost: 50,
      costPerUnit: 0.05,
      aliases: [],
    },
  ];

  describe('1. Positive Dynamic Alias Matching', () => {
    it('matches "Haldi" to "Turmeric" using database alias and returns correct ingredient ID', () => {
      const result = matchIngredient('Haldi', catalogWithAliases);
      expect(result.outcome).toBe('SYNONYM_MATCH');
      expect(result.matchedIngredient).not.toBeNull();
      expect(result.matchedIngredient?.id).toBe('ing_turmeric_1');
      expect(result.matchedIngredient?.name).toBe('Turmeric');
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('matches "Jeera" to "Cumin" using database alias', () => {
      const result = matchIngredient('Jeera', catalogWithAliases);
      expect(result.outcome).toBe('SYNONYM_MATCH');
      expect(result.matchedIngredient?.id).toBe('ing_cumin_whole_2');
      expect(result.matchedIngredient?.name).toBe('Cumin');
    });

    it('matches "Pyaaz" and spelling variant "Pyaz" to "Onion" using alias normalization', () => {
      const pyaazResult = matchIngredient('Pyaaz', catalogWithAliases);
      expect(pyaazResult.outcome).toBe('SYNONYM_MATCH');
      expect(pyaazResult.matchedIngredient?.id).toBe('ing_onion_3');

      // Pyaz normalizes/strips to equivalent token matching Pyaaz alias
      const pyazResult = matchIngredient('Pyaz', catalogWithAliases);
      expect(pyazResult.matchedIngredient?.id).toBe('ing_onion_3');
    });

    it('matches custom regional aliases such as "Kanda" or "Dungri" to "Onion"', () => {
      const kandaResult = matchIngredient('Kanda', catalogWithAliases);
      expect(kandaResult.matchedIngredient?.id).toBe('ing_onion_3');

      const dungriResult = matchIngredient('Dungri', catalogWithAliases);
      expect(dungriResult.matchedIngredient?.id).toBe('ing_onion_3');
    });

    it('handles benign modifiers with aliases (e.g. "Finely Chopped Pyaaz" -> "Onion")', () => {
      const result = matchIngredient('Finely Chopped Pyaaz', catalogWithAliases);
      expect(result.outcome).toBe('SYNONYM_MATCH');
      expect(result.matchedIngredient?.id).toBe('ing_onion_3');
    });
  });

  describe('2. Negative and Ambiguity Safeguards', () => {
    it('does not create a false match for an unknown alias', () => {
      const result = matchIngredient('Dragon Fruit', catalogWithAliases);
      expect(result.outcome).toBe('NO_MATCH');
      expect(result.matchedIngredient).toBeNull();
    });

    it('returns AMBIGUOUS_MATCH when two ingredients share the same alias', () => {
      const catalogWithDuplicateAlias: Ingredient[] = [
        {
          id: 'ing_oil_mustard',
          name: 'Sarson Ka Tel',
          purchaseQty: 1,
          purchaseUnit: 'litre',
          purchaseCost: 180,
          costPerUnit: 0.18,
          aliases: ['Cooking Oil', 'Mustard Oil'],
        },
        {
          id: 'ing_oil_sunflower',
          name: 'Sunflower Oil',
          purchaseQty: 1,
          purchaseUnit: 'litre',
          purchaseCost: 160,
          costPerUnit: 0.16,
          aliases: ['Cooking Oil', 'Refined Oil'],
        },
      ];

      const result = matchIngredient('Cooking Oil', catalogWithDuplicateAlias);
      expect(result.outcome).toBe('AMBIGUOUS_MATCH');
      expect(result.matchedIngredient).toBeNull();
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.map(c => c.id)).toContain('ing_oil_mustard');
      expect(result.candidates.map(c => c.id)).toContain('ing_oil_sunflower');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.ambiguityReason).toContain('Multiple database ingredients share the alias');
    });

    it('prevents culinary form conflicts: "Coriander Seeds" does NOT match "Coriander Powder"', () => {
      const result = matchIngredient('Coriander Seeds', catalogWithAliases);
      // Even if someone put an alias like "Dhaniya" on coriander powder, coriander seeds must never match coriander powder
      expect(result.matchedIngredient?.id).not.toBe('ing_coriander_powder_5');
      if (result.matchedIngredient) {
        expect(result.matchedIngredient.name).not.toBe('Coriander Powder');
      }
    });

    it('prevents roasted vs whole cumin conflicts through aliases', () => {
      // User inputs "Roasted Cumin Powder" -> must match "Roasted Cumin Powder", NOT whole "Cumin"
      const result = matchIngredient('Roasted Cumin Powder', catalogWithAliases);
      expect(result.matchedIngredient?.id).toBe('ing_roasted_cumin_powder_6');
      expect(result.matchedIngredient?.id).not.toBe('ing_cumin_whole_2');

      // User inputs "Sabut Jeera" -> must match whole "Cumin", NOT "Roasted Cumin Powder"
      const sabutResult = matchIngredient('Sabut Jeera', catalogWithAliases);
      expect(sabutResult.matchedIngredient?.id).toBe('ing_cumin_whole_2');
      expect(sabutResult.matchedIngredient?.id).not.toBe('ing_roasted_cumin_powder_6');
    });

    it('prevents flour variety conflicts: "Maida" does NOT match "Wheat Flour" through aliases', () => {
      const maidaResult = matchIngredient('Maida', catalogWithAliases);
      expect(maidaResult.matchedIngredient?.id).toBe('ing_maida_8');
      expect(maidaResult.matchedIngredient?.id).not.toBe('ing_atta_7');

      const attaResult = matchIngredient('Atta', catalogWithAliases);
      expect(attaResult.matchedIngredient?.id).toBe('ing_atta_7');
      expect(attaResult.matchedIngredient?.id).not.toBe('ing_maida_8');
    });

    it('handles undefined or missing aliases arrays gracefully without errors', () => {
      const result = matchIngredient('Tata Salt', catalogWithAliases);
      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedIngredient?.id).toBe('ing_salt_legacy_9');

      const sugarResult = matchIngredient('Refined Sugar', catalogWithAliases);
      expect(sugarResult.outcome).toBe('EXACT_MATCH');
      expect(sugarResult.matchedIngredient?.id).toBe('ing_sugar_empty_10');
    });
  });

  describe('3. Equivalence and Conversion Matching with Catalog Aliases', () => {
    it('recognizes equivalence via catalog aliases in areIngredientsEquivalent()', () => {
      // "Indian Saffron" is in aliases for "Turmeric"
      expect(areIngredientsEquivalent('Turmeric', 'Indian Saffron', catalogWithAliases)).toBe(true);
      expect(areIngredientsEquivalent('Indian Saffron', 'Haldi', catalogWithAliases)).toBe(true);

      // Incompatible forms or unrelated ingredients return false
      expect(areIngredientsEquivalent('Turmeric', 'Cumin', catalogWithAliases)).toBe(false);
      expect(areIngredientsEquivalent('Maida', 'Wheat Flour', catalogWithAliases)).toBe(false);
    });

    it('finds teaspoon conversion using custom database alias via findMatchingConversion()', () => {
      const conversions: TeaspoonConversion[] = [
        { id: 'conv_1', name: 'Turmeric', weightGrams: 3 },
        { id: 'conv_2', name: 'Cumin', weightGrams: 2.5 },
      ];

      // User asks for conversion of "Indian Saffron" (which is an alias of "Turmeric")
      const matchedConv = findMatchingConversion('Indian Saffron', conversions, catalogWithAliases);
      expect(matchedConv).toBeDefined();
      expect(matchedConv?.id).toBe('conv_1');
      expect(matchedConv?.weightGrams).toBe(3);
    });
  });

  describe('4. Regression: Static Canonical Concepts and Fuzzy Fallback', () => {
    it('continues to match static canonical concepts when aliases are absent', () => {
      const legacyCatalog: Ingredient[] = [
        { id: 'ing_leg_1', name: 'Turmeric', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 300, costPerUnit: 0.3 },
      ];

      // "Haldi" should match "Turmeric" via static CANONICAL_INGREDIENT_CONCEPTS
      const result = matchIngredient('Haldi', legacyCatalog);
      expect(result.outcome).toBe('SYNONYM_MATCH');
      expect(result.matchedIngredient?.id).toBe('ing_leg_1');
    });

    it('continues fuzzy matching for misspellings when no exact or alias match exists', () => {
      const result = matchIngredient('Turmaric', catalogWithAliases);
      // Typo should trigger fuzzy AMBIGUOUS_MATCH with suggestion
      expect(result.outcome).toBe('AMBIGUOUS_MATCH');
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].name).toBe('Turmeric');
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('5. Step 3A: Validation Engine Dynamic Alias Integration', () => {
    const dummyGas: GasConfig = {
      cylinderPrice: 950,
      cylinderWeightKg: 14.2,
      consumptionRateKgHour: 0.25,
    };
    const dummyRecipes: Recipe[] = [];

    it('1. Conversion lookup when a conversion is stored under an ingredient custom alias', () => {
      // Conversion is stored under alias 'Indian Saffron', which belongs to 'Turmeric'
      const customConversions: TeaspoonConversion[] = [
        { id: 'conv_alias_1', name: 'Indian Saffron', weightGrams: 3.5 },
      ];

      const intent: UniversalKitchenIntent = {
        detectedIntent: 'RECIPE_CREATION',
        userFacingExplanation: 'Recipe with turmeric using alias conversion',
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
        recipes: [
          {
            recipeName: 'Haldi Doodh',
            yieldAmount: 250,
            yieldType: 'weight',
            cookingTimeMins: 5,
            unresolvedNotes: [],
            ingredients: [
              { name: 'Turmeric', quantity: 2, unit: 'tsp' },
            ],
          },
        ],
      };

      const outcome = validateKitchenIntent(
        intent,
        catalogWithAliases,
        customConversions,
        dummyGas,
        dummyRecipes
      );

      expect(outcome.recipes[0].rows[0].status).toBe('VERIFIED');
      expect(outcome.recipes[0].rows[0].conversionGrams).toBe(3.5);
      expect(outcome.recipes[0].rows[0].effectiveQuantity).toBe(7); // 2 tsp * 3.5g
      expect(outcome.clarifications.filter(c => c.category === 'MISSING_CONVERSION')).toHaveLength(0);
    });

    it('2. Pending ingredient mutation comparison using a custom alias', () => {
      // Intent creates 'Indian Saffron' (alias of Turmeric) with explicit price and size
      // and recipe calls for 'Turmeric'
      const intent: UniversalKitchenIntent = {
        detectedIntent: 'COMPOUND',
        userFacingExplanation: 'Create alias ingredient and recipe',
        ingredientCreations: [
          {
            name: 'Indian Saffron',
            purchaseCost: 120,
            purchaseQty: 500,
            purchaseUnit: 'g',
          },
        ],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
        recipes: [
          {
            recipeName: 'Golden Latte',
            yieldAmount: 300,
            yieldType: 'weight',
            cookingTimeMins: 10,
            unresolvedNotes: [],
            ingredients: [
              { name: 'Turmeric', quantity: 10, unit: 'g' },
            ],
          },
        ],
      };

      const outcome = validateKitchenIntent(
        intent,
        catalogWithAliases,
        [],
        dummyGas,
        dummyRecipes
      );

      // Pending creation should connect to 'Turmeric' row via alias equivalence
      expect(outcome.ingredientMutations).toHaveLength(1);
      expect(outcome.recipes[0].rows[0].status).toBe('VERIFIED');
      expect(outcome.clarifications.filter(c => c.category === 'MISSING_PRICE')).toHaveLength(0);
    });

    it('3. Existing canonical conversion lookup still works without custom aliases', () => {
      const canonicalConversions: TeaspoonConversion[] = [
        { id: 'conv_haldi', name: 'Haldi', weightGrams: 3 },
      ];

      const intent: UniversalKitchenIntent = {
        detectedIntent: 'RECIPE_CREATION',
        userFacingExplanation: 'Recipe using canonical Haldi conversion',
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
        recipes: [
          {
            recipeName: 'Turmeric Rice',
            yieldAmount: 500,
            yieldType: 'weight',
            cookingTimeMins: 15,
            unresolvedNotes: [],
            ingredients: [
              { name: 'Turmeric', quantity: 1, unit: 'tsp' },
            ],
          },
        ],
      };

      const outcome = validateKitchenIntent(
        intent,
        catalogWithAliases,
        canonicalConversions,
        dummyGas,
        dummyRecipes
      );

      expect(outcome.recipes[0].rows[0].status).toBe('VERIFIED');
      expect(outcome.recipes[0].rows[0].conversionGrams).toBe(3);
    });

    it('4. Existing form and variety safeguards prevent invalid conversion matching', () => {
      // Conversion exists for 'Coriander Seeds', recipe uses 'Coriander Powder'
      const seedConversions: TeaspoonConversion[] = [
        { id: 'conv_seeds', name: 'Coriander Seeds', weightGrams: 2 },
      ];

      const intent: UniversalKitchenIntent = {
        detectedIntent: 'RECIPE_CREATION',
        userFacingExplanation: 'Recipe with powder',
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
        unresolvedNotes: [],
        recipes: [
          {
            recipeName: 'Masala Gravy',
            yieldAmount: 400,
            yieldType: 'weight',
            cookingTimeMins: 20,
            unresolvedNotes: [],
            ingredients: [
              { name: 'Coriander Powder', quantity: 1, unit: 'tsp' },
            ],
          },
        ],
      };

      const outcome = validateKitchenIntent(
        intent,
        catalogWithAliases,
        seedConversions,
        dummyGas,
        dummyRecipes
      );

      // Must NOT match coriander seeds conversion to coriander powder
      expect(outcome.recipes[0].rows[0].status).toBe('MISSING_CONVERSION');
      expect(outcome.clarifications.some(c => c.category === 'MISSING_CONVERSION')).toBe(true);
    });

    it('5. Existing behavior when no catalog is supplied to areIngredientsEquivalent', () => {
      // Without catalog: checks static canonical concepts
      expect(areIngredientsEquivalent('Haldi', 'Turmeric')).toBe(true);
      expect(areIngredientsEquivalent('Jeera', 'Cumin')).toBe(true);
      expect(areIngredientsEquivalent('Maida', 'Wheat Flour')).toBe(false);

      // findMatchingConversion without catalog
      const legacyConversions: TeaspoonConversion[] = [
        { id: 'c_haldi', name: 'Haldi', weightGrams: 3 },
      ];
      const match = findMatchingConversion('Turmeric', legacyConversions);
      expect(match).toBeDefined();
      expect(match?.weightGrams).toBe(3);
    });
  });
});

