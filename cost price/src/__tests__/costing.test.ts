import { describe, it, expect } from 'vitest';
import {
  calculateRecipeCosts,
  calculateGasCosts,
  getEffectiveQuantity,
  validateRecipe,
  calculateDefaultServingCost,
  getDefaultServingAmount,
  getDefaultServingUnit,
} from '../utils';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';

describe('Stage 1: Costing and Validation Integrity Engine', () => {
  const sampleGasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  const sampleIngredients: Ingredient[] = [
    { id: '1', name: 'Rice', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 60, costPerUnit: 0.06 }, // ₹0.06 / g
    { id: '2', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 20, costPerUnit: 0.02 }, // ₹0.02 / g
    { id: '3', name: 'Refined Oil', purchaseQty: 1, purchaseUnit: 'litre', purchaseCost: 150, costPerUnit: 0.15 }, // ₹0.15 / ml
    { id: '4', name: 'Zero Price Item', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 0, costPerUnit: 0 },
    { id: '5', name: 'Wheat Flour', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 50, costPerUnit: 0.05 }, // ₹0.05 / g
    { id: '6', name: 'Ghee', purchaseQty: 500, purchaseUnit: 'ml', purchaseCost: 350, costPerUnit: 0.70 }, // ₹0.70 / ml
  ];

  const sampleConversions: TeaspoonConversion[] = [
    { id: 'tc1', name: 'Salt', weightGrams: 5 },
    { id: 'tc2', name: 'Ajwain', weightGrams: 3 },
  ];

  // 1. Correct batch and per-serving costing (weight yield)
  it('1. calculates accurate batch and per-serving costing for a fully verified weight-yield recipe', () => {
    const recipe: Recipe = {
      id: 'rec_1',
      name: 'Plain Salted Rice',
      yieldType: 'weight',
      yieldAmount: 1000, // 1000g yield
      defaultServingAmount: 150, // 150g serve
      cookingTimeMins: 10,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 200, unit: 'g' }, // 200 * 0.06 = 12
        { id: 'ri2', ingredientId: '2', name: 'Salt', quantity: 1, unit: 'tsp' }, // 1 tsp Salt = 5g -> 5 * 0.02 = 0.10
        { id: 'ri3', ingredientId: '3', name: 'Refined Oil', quantity: 10, unit: 'ml' }, // 10 * 0.15 = 1.50
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    const gas = calculateGasCosts(sampleGasConfig);
    const expectedGasCost = gas.costPerMinute * 10;
    const expectedIngredientsCost = 12 + 0.10 + 1.50; // 13.60
    const expectedTotal = expectedIngredientsCost + expectedGasCost;

    expect(breakdown.isComplete).toBe(true);
    expect(breakdown.hasMissingCosts).toBe(false);
    expect(breakdown.unresolvedIssues).toHaveLength(0);
    expect(breakdown.ingredientsCost).toBeCloseTo(expectedIngredientsCost, 2);
    expect(breakdown.gasCost).toBeCloseTo(expectedGasCost, 2);
    expect(breakdown.totalBatchCost).toBeCloseTo(expectedTotal, 2);
    expect(breakdown.costPer100g).toBeCloseTo((expectedTotal / 1000) * 100, 2);

    // Default serving calculation (150g)
    const servingCost = calculateDefaultServingCost(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(servingCost.costPrice).toBeCloseTo((expectedTotal / 1000) * 150, 2);
    expect(servingCost.defaultServingUnit).toBe('g');
  });

  // 2. Correct batch and per-serving costing (piece yield)
  it('2. calculates accurate batch and per-piece costing for a piece-yield recipe', () => {
    const recipe: Recipe = {
      id: 'rec_2',
      name: 'Batch Parathas',
      yieldType: 'piece',
      yieldAmount: 10, // 10 pieces
      defaultServingAmount: 2, // 2 pieces serve
      cookingTimeMins: 12,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '5', name: 'Wheat Flour', quantity: 500, unit: 'g' }, // 500 * 0.05 = 25
        { id: 'ri2', ingredientId: '6', name: 'Ghee', quantity: 50, unit: 'ml' }, // 50 * 0.70 = 35
        { id: 'ri3', ingredientId: '2', name: 'Ajwain', quantity: 1, unit: 'tsp' }, // 1 tsp Ajwain = 3g (using Salt price 0.02) -> 3 * 0.02 = 0.06
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    const gas = calculateGasCosts(sampleGasConfig);
    const expectedGasCost = gas.costPerMinute * 12;
    const expectedIngredientsCost = 25 + 35 + 0.06;
    const expectedTotal = expectedIngredientsCost + expectedGasCost;

    expect(breakdown.isComplete).toBe(true);
    expect(breakdown.costPerPiece).toBeCloseTo(expectedTotal / 10, 2);

    const servingCost = calculateDefaultServingCost(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(servingCost.defaultServingUnit).toBe('pieces');
    expect(servingCost.costPrice).toBeCloseTo((expectedTotal / 10) * 2, 2);
  });

  // 3. Unmatched ingredients
  it('3. flags unmatched ingredients and marks recipe as incomplete instead of silently assigning zero cost', () => {
    const recipe: Recipe = {
      id: 'rec_3',
      name: 'Unmatched Curry',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '999', name: 'Exotic Mushroom', quantity: 100, unit: 'g' },
        { id: 'ri2', ingredientId: '2', name: 'Salt', quantity: 1, unit: 'tsp' },
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);

    expect(breakdown.isComplete).toBe(false);
    expect(breakdown.hasMissingCosts).toBe(true);
    
    const unmatchedIssue = breakdown.unresolvedIssues.find(i => i.type === 'missing_ingredient');
    expect(unmatchedIssue).toBeDefined();
    expect(unmatchedIssue?.message).toContain('Exotic Mushroom');

    const mushroomRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Exotic Mushroom');
    expect(mushroomRow?.isUnresolved).toBe(true);
    expect(mushroomRow?.cost).toBe(0);
  });

  // 4. Missing ingredient prices (zero price)
  it('4. flags ingredients with zero costPerUnit as missing_price and prevents verified complete status', () => {
    const recipe: Recipe = {
      id: 'rec_4',
      name: 'Unpriced Recipe',
      yieldType: 'weight',
      yieldAmount: 200,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '4', name: 'Zero Price Item', quantity: 50, unit: 'g' },
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(false);
    expect(breakdown.hasMissingCosts).toBe(true);

    const priceIssue = breakdown.unresolvedIssues.find(i => i.type === 'missing_price');
    expect(priceIssue).toBeDefined();
    expect(priceIssue?.message).toContain('Zero Price Item');
  });

  // 5. Missing ingredient prices (NaN or negative)
  it('5. flags ingredients with negative or NaN costPerUnit as missing_price', () => {
    const corruptedIngredients: Ingredient[] = [
      { id: 'corr_1', name: 'Bad Item', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: -50, costPerUnit: -0.05 },
    ];
    const recipe: Recipe = {
      id: 'rec_5',
      name: 'Negative Price Dish',
      yieldType: 'weight',
      yieldAmount: 200,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: 'corr_1', name: 'Bad Item', quantity: 50, unit: 'g' },
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, corruptedIngredients, sampleConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(false);
    const issue = breakdown.unresolvedIssues.find(i => i.type === 'missing_price');
    expect(issue).toBeDefined();
  });

  // 6. Missing teaspoon conversion (Silent 4g fallback removed)
  it('6. does NOT silently assume 4g for missing teaspoon conversion, flags missing conversion, and provides suggested default', () => {
    const recipe: Recipe = {
      id: 'rec_6',
      name: 'Spiced Rice',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 10,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
        { id: 'ri2', ingredientId: '1', name: 'Turmeric', quantity: 1, unit: 'tsp' }, // No conversion in sampleConversions
      ],
    };

    const eff = getEffectiveQuantity({ id: 'ri2', ingredientId: '1', name: 'Turmeric', quantity: 1, unit: 'tsp' }, sampleConversions);
    expect(eff.conversionFound).toBe(false);
    expect(eff.value).toBe(0); // MUST NOT be 4
    expect(eff.isTspDefaultUsed).toBe(false);

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(false);

    const tspIssue = breakdown.unresolvedIssues.find(i => i.type === 'missing_teaspoon_conversion');
    expect(tspIssue).toBeDefined();
    expect(tspIssue?.suggestedDefaultValue).toBe(4); // Suggested default exists as an unverified option
    expect(tspIssue?.message).toContain('Turmeric');

    const tspRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Turmeric');
    expect(tspRow?.isUnresolved).toBe(true);
  });

  // 7. Verified teaspoon conversion matching (case-insensitive & trimmed)
  it('7. matches teaspoon conversion case-insensitively and handles whitespace', () => {
    const effLower = getEffectiveQuantity(
      { id: 'ri1', ingredientId: '2', name: '  salt  ', quantity: 2, unit: 'tsp' },
      sampleConversions
    );
    expect(effLower.conversionFound).toBe(true);
    expect(effLower.value).toBe(10); // 2 tsp * 5g = 10g
    expect(effLower.conversionGrams).toBe(5);

    const effUpper = getEffectiveQuantity(
      { id: 'ri2', ingredientId: '2', name: 'AJWAIN', quantity: 0.5, unit: 'tsp' },
      sampleConversions
    );
    expect(effUpper.conversionFound).toBe(true);
    expect(effUpper.value).toBe(1.5); // 0.5 tsp * 3g = 1.5g
    expect(effUpper.conversionGrams).toBe(3);
  });

  // 8. Custom user conversion resolution
  it('8. resolves cleanly when a user provides a custom teaspoon conversion', () => {
    const updatedConversions: TeaspoonConversion[] = [
      ...sampleConversions,
      { id: 'tc3', name: 'Turmeric', weightGrams: 3.5 }, // User confirmed 3.5g
    ];

    const recipe: Recipe = {
      id: 'rec_8',
      name: 'Spiced Rice',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 10,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
        { id: 'ri2', ingredientId: '2', name: 'Turmeric', quantity: 2, unit: 'tsp' },
      ],
    };

    const eff = getEffectiveQuantity(recipe.ingredients[1], updatedConversions);
    expect(eff.conversionFound).toBe(true);
    expect(eff.value).toBe(7); // 2 tsp * 3.5g = 7g

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, updatedConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(true);
    expect(breakdown.unresolvedIssues).toHaveLength(0);
  });

  // 9. Unsupported unit handling
  it('9. flags unsupported units (piece, tbsp, cup) and does NOT silently treat them as grams', () => {
    const unsupportedUnits = ['piece', 'tbsp', 'cup', 'pinch'];
    for (const unit of unsupportedUnits) {
      const eff = getEffectiveQuantity(
        { id: 'ri1', ingredientId: '1', name: 'Onion', quantity: 1, unit: unit as any },
        sampleConversions
      );
      expect(eff.isUnsupportedUnit).toBe(true);
      expect(eff.value).toBe(0); // MUST NEVER be 1g
      expect(eff.conversionFound).toBe(false);
    }

    const recipe: Recipe = {
      id: 'rec_9',
      name: 'Poha with onion',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Onion', quantity: 2, unit: 'piece' as any },
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(false);
    const unitIssue = breakdown.unresolvedIssues.find(i => i.type === 'unsupported_unit');
    expect(unitIssue).toBeDefined();
  });

  // 10. Zero quantity validation
  it('10. flags zero quantity as ambiguous_quantity and marks isValid: false', () => {
    const recipe: Recipe = {
      id: 'rec_10',
      name: 'Zero Qty Dish',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 0, unit: 'g' },
      ],
    };

    const validation = validateRecipe(recipe, sampleIngredients, sampleConversions);
    expect(validation.isValid).toBe(false);
    expect(validation.isComplete).toBe(false);

    const qtyIssue = validation.issues.find(i => i.type === 'ambiguous_quantity');
    expect(qtyIssue).toBeDefined();
  });

  // 11. Negative quantity validation
  it('11. flags negative quantity as ambiguous_quantity and marks isValid: false', () => {
    const recipe: Recipe = {
      id: 'rec_11',
      name: 'Negative Qty Dish',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 5,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: -100, unit: 'g' },
      ],
    };

    const validation = validateRecipe(recipe, sampleIngredients, sampleConversions);
    expect(validation.isValid).toBe(false);
    expect(validation.isComplete).toBe(false);

    const qtyIssue = validation.issues.find(i => i.type === 'ambiguous_quantity');
    expect(qtyIssue).toBeDefined();
  });

  // 12. Missing or non-positive recipe yield validation
  it('12. flags zero, negative, or NaN yield amount as missing_yield and marks isValid: false', () => {
    for (const badYield of [0, -500, NaN]) {
      const recipe: Recipe = {
        id: 'rec_12',
        name: 'Invalid Yield Dish',
        yieldType: 'weight',
        yieldAmount: badYield,
        cookingTimeMins: 5,
        createdAt: new Date().toISOString(),
        ingredients: [
          { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
        ],
      };

      const validation = validateRecipe(recipe, sampleIngredients, sampleConversions);
      expect(validation.isValid).toBe(false);
      expect(validation.isComplete).toBe(false);
      expect(validation.issues.some(i => i.type === 'missing_yield')).toBe(true);
    }
  });

  // 13. Invalid cooking time validation
  it('13. flags negative cooking time as missing_cooking_time and handles 0 cooking time safely', () => {
    const recipeNegative: Recipe = {
      id: 'rec_13a',
      name: 'Negative Time Dish',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: -10,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
      ],
    };
    const validationNeg = validateRecipe(recipeNegative, sampleIngredients, sampleConversions);
    expect(validationNeg.issues.some(i => i.type === 'missing_cooking_time')).toBe(true);

    // 0 cooking time is valid (no gas cost, e.g., raw salad/curd dish)
    const recipeZero: Recipe = {
      id: 'rec_13b',
      name: 'Raw Salad',
      yieldType: 'weight',
      yieldAmount: 500,
      cookingTimeMins: 0,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
      ],
    };
    const validationZero = validateRecipe(recipeZero, sampleIngredients, sampleConversions);
    expect(validationZero.issues.some(i => i.type === 'missing_cooking_time')).toBe(false);

    const breakdownZero = calculateRecipeCosts(recipeZero, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(breakdownZero.gasCost).toBe(0);
    expect(breakdownZero.isComplete).toBe(true);
  });

  // 14. Mixed valid and unresolved ingredients
  it('14. handles mixed valid and unresolved ingredients: computes partial cost for audit but marks recipe incomplete', () => {
    const recipe: Recipe = {
      id: 'rec_14',
      name: 'Mixed Poha',
      yieldType: 'weight',
      yieldAmount: 600,
      cookingTimeMins: 10,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 200, unit: 'g' }, // 200 * 0.06 = 12 (VALID)
        { id: 'ri2', ingredientId: '2', name: 'Salt', quantity: 1, unit: 'tsp' }, // 1 * 5 * 0.02 = 0.10 (VALID)
        { id: 'ri3', ingredientId: '999', name: 'Mystery Spice', quantity: 10, unit: 'g' }, // UNMATCHED
        { id: 'ri4', ingredientId: '1', name: 'Chili Powder', quantity: 0.5, unit: 'tsp' }, // MISSING TSP CONVERSION
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);

    expect(breakdown.isComplete).toBe(false);
    expect(breakdown.hasMissingCosts).toBe(true);
    expect(breakdown.unresolvedIssues).toHaveLength(2); // Mystery Spice + Chili Powder

    // Valid rows still calculate their contribution for the audit breakdown
    const riceRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Rice');
    const saltRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Salt');
    expect(riceRow?.isUnresolved).toBe(false);
    expect(riceRow?.cost).toBeCloseTo(12, 2);
    expect(saltRow?.isUnresolved).toBe(false);
    expect(saltRow?.cost).toBeCloseTo(0.10, 2);

    // Unresolved rows have cost = 0 and isUnresolved = true
    const mysteryRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Mystery Spice');
    const chiliRow = breakdown.rows.find(r => r.recipeIngredient.name === 'Chili Powder');
    expect(mysteryRow?.isUnresolved).toBe(true);
    expect(mysteryRow?.cost).toBe(0);
    expect(chiliRow?.isUnresolved).toBe(true);
    expect(chiliRow?.cost).toBe(0);

    // Partial ingredients cost should be 12 + 0.10 = 12.10
    expect(breakdown.ingredientsCost).toBeCloseTo(12.10, 2);
  });

  // 15. Draft status and incomplete-cost handling
  it('15. ensures incomplete recipes can still calculate serving costs for draft preview without crashing', () => {
    const incompleteRecipe: Recipe = {
      id: 'rec_15',
      name: 'Draft Curry',
      yieldType: 'weight',
      yieldAmount: 400,
      cookingTimeMins: 15,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 100, unit: 'g' },
        { id: 'ri2', ingredientId: '999', name: 'Unmatched Item', quantity: 50, unit: 'g' },
      ],
    };

    // calculateDefaultServingCost must succeed without throwing
    const dishCost = calculateDefaultServingCost(incompleteRecipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(dishCost.dishName).toBe('Draft Curry');
    expect(dishCost.costPrice).toBeGreaterThan(0); // Has partial cost from valid Rice + Gas

    // validateRecipe confirms it is recognized as incomplete
    const validation = validateRecipe(incompleteRecipe, sampleIngredients, sampleConversions);
    expect(validation.isComplete).toBe(false);
  });

  // 16. Volume unit conversions (litre -> ml, ml -> ml)
  it('16. converts volume units (litre, ml) accurately with baseUnit ml', () => {
    const effLitre = getEffectiveQuantity(
      { id: 'ri1', ingredientId: '3', name: 'Oil', quantity: 2, unit: 'litre' },
      sampleConversions
    );
    expect(effLitre.baseUnit).toBe('ml');
    expect(effLitre.value).toBe(2000);
    expect(effLitre.conversionFound).toBe(true);

    const effMl = getEffectiveQuantity(
      { id: 'ri2', ingredientId: '3', name: 'Oil', quantity: 250, unit: 'ml' },
      sampleConversions
    );
    expect(effMl.baseUnit).toBe('ml');
    expect(effMl.value).toBe(250);
    expect(effMl.conversionFound).toBe(true);
  });

  // 17. Mass unit conversions (kg -> g, g -> g)
  it('17. converts mass units (kg, g) accurately with baseUnit g', () => {
    const effKg = getEffectiveQuantity(
      { id: 'ri1', ingredientId: '1', name: 'Rice', quantity: 1.5, unit: 'kg' },
      sampleConversions
    );
    expect(effKg.baseUnit).toBe('g');
    expect(effKg.value).toBe(1500);
    expect(effKg.conversionFound).toBe(true);

    const effG = getEffectiveQuantity(
      { id: 'ri2', ingredientId: '1', name: 'Rice', quantity: 375, unit: 'g' },
      sampleConversions
    );
    expect(effG.baseUnit).toBe('g');
    expect(effG.value).toBe(375);
    expect(effG.conversionFound).toBe(true);
  });

  // 18. Fractional quantities and floating-point precision
  it('18. handles fractional quantities (e.g. 0.25 tsp, 0.75 g) accurately without floating point anomalies', () => {
    const effQuarterTsp = getEffectiveQuantity(
      { id: 'ri1', ingredientId: '2', name: 'Salt', quantity: 0.25, unit: 'tsp' }, // 0.25 * 5g = 1.25g
      sampleConversions
    );
    expect(effQuarterTsp.value).toBeCloseTo(1.25, 4);

    const recipe: Recipe = {
      id: 'rec_18',
      name: 'Micro-spice Batch',
      yieldType: 'weight',
      yieldAmount: 100,
      cookingTimeMins: 0,
      createdAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri1', ingredientId: '2', name: 'Salt', quantity: 0.25, unit: 'tsp' }, // 1.25g * ₹0.02 = ₹0.025
      ],
    };

    const breakdown = calculateRecipeCosts(recipe, sampleIngredients, sampleConversions, sampleGasConfig);
    expect(breakdown.isComplete).toBe(true);
    expect(breakdown.totalBatchCost).toBeCloseTo(0.025, 3);
  });
});
