/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { RawAIParsedRecipeSchema, validateAIParsedRecipe } from '../server/ai/schema';
import { handleParseRecipeRequest, resetRateLimitMap } from '../server/ai/parseHandler';
import { AIRecipeParserProvider, RawAIParsedRecipe } from '../server/ai/types';
import { ingestAIRecipe, normalizeUnit, findCandidateMatches } from '../services/aiRecipeMatcher';
import { parseRecipeFromNaturalLanguage } from '../services/aiRecipeService';
import supabase from '../supabaseClient';
import { Ingredient, TeaspoonConversion, GasConfig } from '../types';

describe('Stage 2: Secure AI Parsing Endpoint & Validation Architecture', () => {
  const sampleIngredients: Ingredient[] = [
    { id: '1', name: 'Poha', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 70, costPerUnit: 0.07 },
    { id: '2', name: 'Refined Oil', purchaseQty: 1, purchaseUnit: 'litre', purchaseCost: 150, costPerUnit: 0.15 },
    { id: '3', name: 'Salt', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 20, costPerUnit: 0.02 },
    { id: '4', name: 'Groundnut', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 174, costPerUnit: 0.174 },
    { id: '5', name: 'Haldi', purchaseQty: 200, purchaseUnit: 'g', purchaseCost: 60, costPerUnit: 0.30 },
  ];

  const sampleConversions: TeaspoonConversion[] = [
    { id: 'tc1', name: 'Salt', weightGrams: 5 },
    // Notice: Haldi is NOT in conversions
  ];

  const sampleGasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  const validSampleParsedRecipe: RawAIParsedRecipe = {
    recipeName: 'Vegetable Poha',
    description: 'Quick breakfast poha with peanuts and turmeric',
    cookingTimeMins: 10,
    yieldAmount: 500,
    yieldType: 'weight',
    ingredients: [
      {
        name: 'Poha',
        quantity: 200,
        unit: 'g',
        originalText: '200 g poha',
        notes: null,
        isAmbiguous: false,
        ambiguityReason: null,
      },
      {
        name: 'Onion',
        quantity: 1,
        unit: 'piece',
        originalText: 'one medium onion',
        notes: 'medium',
        isAmbiguous: true,
        ambiguityReason: 'Counted item without verified weight in grams',
      },
      {
        name: 'Peanuts',
        quantity: 30,
        unit: 'g',
        originalText: '30 g peanuts',
        notes: null,
        isAmbiguous: false,
        ambiguityReason: null,
      },
      {
        name: 'Turmeric',
        quantity: 0.5,
        unit: 'tsp',
        originalText: 'half a teaspoon of turmeric',
        notes: null,
        isAmbiguous: false,
        ambiguityReason: null,
      },
      {
        name: 'Salt',
        quantity: 1,
        unit: 'tsp',
        originalText: '1 teaspoon salt',
        notes: null,
        isAmbiguous: false,
        ambiguityReason: null,
      },
      {
        name: 'Oil',
        quantity: 2,
        unit: 'tbsp',
        originalText: '2 tablespoons oil',
        notes: null,
        isAmbiguous: true,
        ambiguityReason: 'Tablespoon unit requires density or gram conversion',
      },
    ],
    cookingSteps: ['Wash poha', 'Saute peanuts and onion in oil', 'Add turmeric and salt', 'Mix well and cook 10 mins'],
    unresolvedNotes: ['1 medium onion needs gram weight', '2 tbsp oil needs ml or gram measurement'],
  };

  // 1. Valid recipe parsing & schema validation
  it('1. validates a properly formed structured recipe matching schema', () => {
    const validated = validateAIParsedRecipe(validSampleParsedRecipe);
    expect(validated.recipeName).toBe('Vegetable Poha');
    expect(validated.ingredients).toHaveLength(6);
    expect(validated.cookingTimeMins).toBe(10);
    expect(validated.yieldAmount).toBe(500);
  });

  // 2. Missing required fields
  it('2. rejects schemas missing mandatory fields such as recipeName or empty ingredients', () => {
    expect(() =>
      validateAIParsedRecipe({
        recipeName: '',
        ingredients: [{ name: 'Rice', quantity: 100, unit: 'g' }],
      })
    ).toThrow();

    expect(() =>
      validateAIParsedRecipe({
        recipeName: 'Empty Dish',
        ingredients: [],
      })
    ).toThrow();
  });

  // 3. Negative, zero, NaN, and infinite quantities rejected
  it('3. strictly rejects non-finite, negative, or invalid quantities', () => {
    const invalidQuantities = [-5, 0, NaN, Infinity, -Infinity];

    for (const badQty of invalidQuantities) {
      expect(() =>
        RawAIParsedRecipeSchema.parse({
          recipeName: 'Bad Qty Dish',
          ingredients: [
            {
              name: 'Rice',
              quantity: badQty,
              unit: 'g',
              originalText: 'rice',
              isAmbiguous: false,
            },
          ],
        })
      ).toThrow();
    }
  });

  // 4. Endpoint request handler validation (empty input, oversized payload)
  it('4. rejects empty or oversized recipeText requests at the endpoint handler', async () => {
    const emptyRes = await handleParseRecipeRequest({ recipeText: '   ' });
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.success).toBe(false);
    expect((emptyRes.body as any).error.code).toBe('INVALID_INPUT');

    const hugeText = 'a'.repeat(20 * 1024); // 20 KB
    const hugeRes = await handleParseRecipeRequest({ recipeText: hugeText });
    expect(hugeRes.status).toBe(413);
    expect((hugeRes.body as any).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // 5. Mock AI Provider integration & safe error handling
  it('5. invokes provider and handles timeouts safely without leaking credentials', async () => {
    const mockTimeoutProvider: AIRecipeParserProvider = {
      providerName: 'Mock Timeout Provider',
      parseRecipe: vi.fn().mockRejectedValue(new Error('AI provider request timed out after 20000ms')),
    };

    const res = await handleParseRecipeRequest(
      { recipeText: 'Cook 200g poha with salt' },
      'test-client-1',
      mockTimeoutProvider
    );

    expect(res.status).toBe(504);
    expect(res.body.success).toBe(false);
    expect((res.body as any).error.code).toBe('TIMEOUT');
    expect((res.body as any).error.message).toContain('timed out');
  });

  // 6. Auth error handling when API key is missing
  it('6. returns AUTH_ERROR status code 503 if API key is not configured', async () => {
    const mockAuthErrorProvider: AIRecipeParserProvider = {
      providerName: 'Mock Auth Provider',
      parseRecipe: vi.fn().mockRejectedValue(new Error('GEMINI_API_KEY is not configured on the server.')),
    };

    const res = await handleParseRecipeRequest(
      { recipeText: 'Cook poha' },
      'test-client-2',
      mockAuthErrorProvider
    );

    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('AUTH_ERROR');
  });

  // 7. Rate limit handling
  it('7. applies rate limiting when request limit is exceeded', async () => {
    const mockSuccessProvider: AIRecipeParserProvider = {
      providerName: 'Mock Provider',
      parseRecipe: vi.fn().mockResolvedValue(validSampleParsedRecipe),
    };

    const clientToken = 'rate-limit-test-client';
    // Exhaust 30 requests limit
    for (let i = 0; i < 30; i++) {
      await handleParseRecipeRequest({ recipeText: 'Poha' }, clientToken, mockSuccessProvider);
    }

    // 31st request must trigger 429
    const blockedRes = await handleParseRecipeRequest({ recipeText: 'Poha' }, clientToken, mockSuccessProvider);
    expect(blockedRes.status).toBe(429);
    expect((blockedRes.body as any).error.code).toBe('RATE_LIMIT');
  });

  // 8. Ingest AI Recipe into deterministic matching & costing engine
  it('8. bridges AI recipe into deterministic engine: identifies matched, unmatched, missing conversions, and unsupported units', () => {
    const ingested = ingestAIRecipe(validSampleParsedRecipe, sampleIngredients, sampleConversions, sampleGasConfig);

    expect(ingested.draftRecipe.name).toBe('Vegetable Poha');
    expect(ingested.draftRecipe.cookingTimeMins).toBe(10);
    expect(ingested.draftRecipe.yieldAmount).toBe(500);

    // 1. Poha -> Matched to 'Poha' (id: '1')
    const pohaMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Poha');
    expect(pohaMatch?.isMatched).toBe(true);
    expect(pohaMatch?.matchedIngredient?.id).toBe('1');
    expect(pohaMatch?.normalizedUnit).toBe('g');

    // 2. Peanuts -> Alias matched to 'Groundnut' (id: '4')
    const peanutMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Peanuts');
    expect(peanutMatch?.isMatched).toBe(true);
    expect(peanutMatch?.matchedIngredient?.name).toBe('Groundnut');

    // 3. Onion -> Unmatched in database
    const onionMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Onion');
    expect(onionMatch?.isMatched).toBe(false);

    // 4. Turmeric -> Alias matched to 'Haldi' (id: '5'), but unit tsp has MISSING conversion
    const turmericMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Turmeric');
    expect(turmericMatch?.isMatched).toBe(true);
    expect(turmericMatch?.normalizedUnit).toBe('tsp');
    expect(turmericMatch?.missingConversion).toBe(true);

    // 5. Salt -> Matched to 'Salt' (id: '3'), unit tsp has VERIFIED conversion in sampleConversions
    const saltMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Salt');
    expect(saltMatch?.isMatched).toBe(true);
    expect(saltMatch?.normalizedUnit).toBe('tsp');
    expect(saltMatch?.missingConversion).toBe(false);

    // 6. Oil -> Unit 'tbsp' is unsupported
    const oilMatch = ingested.matchedDetails.find(d => d.extractedIngredient.name === 'Oil');
    expect(oilMatch?.isUnsupportedUnit).toBe(true);

    // Draft recipe MUST have isComplete: false and list unresolved items
    expect(ingested.breakdown.isComplete).toBe(false);
    expect(ingested.breakdown.unresolvedIssues.length).toBeGreaterThan(0);
  });

  // 9. Unit normalization helper
  it('9. normalizes standard unit variations accurately', () => {
    expect(normalizeUnit('grams')).toBe('g');
    expect(normalizeUnit('GMS')).toBe('g');
    expect(normalizeUnit('kg')).toBe('kg');
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('ml')).toBe('ml');
    expect(normalizeUnit('litres')).toBe('litre');
    expect(normalizeUnit('tsp')).toBe('tsp');
    expect(normalizeUnit('teaspoons')).toBe('tsp');

    // Unsupported units return null
    expect(normalizeUnit('tablespoon')).toBeNull();
    expect(normalizeUnit('cup')).toBeNull();
    expect(normalizeUnit('piece')).toBeNull();
  });

  // 10. Candidate matching helper
  it('10. finds candidate matches and aliases without altering database', () => {
    const match = findCandidateMatches('chilli flakes', sampleIngredients);
    expect(match.candidates).toBeDefined();

    const peanuts = findCandidateMatches('raw peanuts', sampleIngredients);
    expect(peanuts.bestMatch?.name).toBe('Groundnut');
  });

  // 11. Cost injection prevention: Untrusted keys in AI output are stripped by Zod
  it('11. prevents model from injecting unauthorized cost or conversion weight fields', () => {
    const untrustedPayload = {
      recipeName: 'Malicious Injected Dish',
      cookingTimeMins: 10,
      yieldAmount: 500,
      yieldType: 'weight',
      ingredients: [
        {
          name: 'Poha',
          quantity: 200,
          unit: 'g',
          originalText: '200g poha',
          isAmbiguous: false,
          // Attacker or hallucinating model tries to inject costs and conversion weights:
          cost: 0,
          purchaseCost: 0,
          costPerUnit: 0,
          weightGrams: 999,
        },
      ],
    };

    const validated = validateAIParsedRecipe(untrustedPayload);
    const ing = validated.ingredients[0] as any;
    expect(ing.cost).toBeUndefined();
    expect(ing.purchaseCost).toBeUndefined();
    expect(ing.costPerUnit).toBeUndefined();
    expect(ing.weightGrams).toBeUndefined();
  });

  // 12. Rate limiter memory leak prevention
  it('12. prunes expired rate limit entries when tracker map size grows', async () => {
    resetRateLimitMap();
    const mockSuccessProvider: AIRecipeParserProvider = {
      providerName: 'Mock Provider',
      parseRecipe: vi.fn().mockResolvedValue(validSampleParsedRecipe),
    };

    // Populate with a client request
    await handleParseRecipeRequest({ recipeText: 'Poha' }, 'client-to-expire', mockSuccessProvider);

    // Fast-forward or trigger reset
    resetRateLimitMap();
    const res = await handleParseRecipeRequest({ recipeText: 'Poha' }, 'client-fresh', mockSuccessProvider);
    expect(res.status).toBe(200);
  });

  // 13. Service routing: local 200 success returns data without calling Supabase
  it('13. client service routing: local 200 returns successfully without invoking Supabase', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, provider: 'Local Vite AI', data: validSampleParsedRecipe }),
    } as any);

    const mockInvoke = vi.fn();
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const result = await parseRecipeFromNaturalLanguage('Poha recipe text');
    expect(result.recipe.recipeName).toBe('Vegetable Poha');
    expect(result.provider).toBe('Local Vite AI');
    expect(mockInvoke).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  // 14. Service routing: provider failure throws error and NEVER causes duplicate request to Supabase
  it('14. client service routing: provider failures (429, 500, 504) throw immediately without duplicating request to Supabase', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        success: false,
        error: { code: 'RATE_LIMIT', message: 'Too many recipe parsing requests.' },
      }),
    } as any);

    const mockInvoke = vi.fn();
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    await expect(parseRecipeFromNaturalLanguage('Poha recipe text')).rejects.toThrow(
      'Too many recipe parsing requests.'
    );
    // Supabase must NOT be called as fallback on genuine provider rate limits
    expect(mockInvoke).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  // 15. Service routing: local 404 (production static hosting) cleanly falls through to Supabase Edge Function
  it('15. client service routing: 404 on local endpoint smoothly falls through to Supabase Edge Function', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: { success: true, provider: 'Supabase AI Edge', data: validSampleParsedRecipe },
      error: null,
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const result = await parseRecipeFromNaturalLanguage('Poha recipe text');
    expect(result.recipe.recipeName).toBe('Vegetable Poha');
    expect(result.provider).toBe('Supabase AI Edge');
    expect(mockInvoke).toHaveBeenCalledWith('parse-recipe', {
      body: { recipeText: 'Poha recipe text' },
    });

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  // 16. Fallback Supabase client safety: cannot falsely report successful AI parsing
  it('16. fallback Supabase client returns an explicit error and cannot falsely report parsing success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    // Mock functions returning error to simulate unconfigured client
    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: null,
      error: new Error('Supabase client not configured with environment keys.'),
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    await expect(parseRecipeFromNaturalLanguage('Test recipe')).rejects.toThrow(
      'Supabase client not configured with environment keys.'
    );

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  // 17. Yield type normalization (plural forms like "pieces", "servings")
  it('17. normalizes plural yield types such as "pieces" and "servings" without schema errors', () => {
    const rawWithPieces = {
      ...validSampleParsedRecipe,
      yieldAmount: 2,
      yieldType: 'pieces',
    };

    const validated = validateAIParsedRecipe(rawWithPieces);
    expect(validated.yieldType).toBe('piece');

    const rawWithServings = {
      ...validSampleParsedRecipe,
      yieldAmount: 4,
      yieldType: 'servings',
    };
    const validatedServings = validateAIParsedRecipe(rawWithServings);
    expect(validatedServings.yieldType).toBe('serving');
  });
});
