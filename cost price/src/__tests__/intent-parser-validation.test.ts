/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Regression Tests for AI Kitchen Intent Parser Validation Fixes:
 * 1. recipes[0].recipeName normalization and empty name rejection.
 * 2. Root-level array rejection and controlled HTTP 422 error handling.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateUniversalKitchenIntent,
  AISchemaValidationError,
  IntentParsedRecipeSchema,
  UniversalKitchenIntent,
} from '../server/ai/intentSchema';
import {
  handleParseKitchenIntentRequest,
} from '../server/ai/intentHandler';
import {
  INTENT_RESPONSE_JSON_SCHEMA,
  UNIVERSAL_PARSER_SYSTEM_INSTRUCTION,
  GeminiUniversalIntentParser,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
} from '../server/ai/intentParser';
import {
  validateKitchenIntent,
} from '../services/catalogValidationEngine';
import {
  generateProposedChangeSet,
} from '../services/proposalGenerator';
import {
  findAffectedRecipeIds,
} from '../services/catalogPersistenceService';
import {
  parseKitchenIntentFromNaturalLanguage,
} from '../services/aiRecipeService';
import supabase from '../supabaseClient';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';

describe('Regression 1: recipes[0].recipeName Normalization & Validation', () => {
  it('normalizes common LLM dish keys (name, title, dishName, recipe_name) to recipeName', () => {
    // 1. LLM returned "name" instead of "recipeName"
    const parsedFromName = IntentParsedRecipeSchema.parse({
      name: 'Paneer Paratha',
      cookingTimeMins: 10,
      yieldAmount: 2,
      yieldType: 'piece',
      ingredients: [{ name: 'Paneer', quantity: 100, unit: 'g' }],
    });
    expect(parsedFromName.recipeName).toBe('Paneer Paratha');

    // 2. LLM returned "title" instead of "recipeName"
    const parsedFromTitle = IntentParsedRecipeSchema.parse({
      title: 'Homestyle Dal',
      cookingTimeMins: 15,
      yieldAmount: 500,
      yieldType: 'weight',
      ingredients: [{ name: 'Dal', quantity: 144, unit: 'g' }],
    });
    expect(parsedFromTitle.recipeName).toBe('Homestyle Dal');

    // 3. LLM returned "dishName" instead of "recipeName"
    const parsedFromDishName = IntentParsedRecipeSchema.parse({
      dishName: 'Jeera Aloo',
      ingredients: [{ name: 'Potatoes', quantity: 200, unit: 'g' }],
    });
    expect(parsedFromDishName.recipeName).toBe('Jeera Aloo');

    // 4. LLM returned "recipe_name" instead of "recipeName"
    const parsedFromSnakeCase = IntentParsedRecipeSchema.parse({
      recipe_name: 'Poha',
      ingredients: [{ name: 'Poha', quantity: 150, unit: 'g' }],
    });
    expect(parsedFromSnakeCase.recipeName).toBe('Poha');
  });

  it('validates recipeName when already properly formatted', () => {
    const parsed = IntentParsedRecipeSchema.parse({
      recipeName: 'Standard Dal Tadka',
      cookingTimeMins: 12,
      yieldAmount: 400,
      yieldType: 'weight',
      ingredients: [{ name: 'Toor Dal', quantity: 100, unit: 'g' }],
    });
    expect(parsed.recipeName).toBe('Standard Dal Tadka');
  });

  it('rejects recipes with missing or empty recipeName and does not invent fake names', () => {
    // Missing recipeName completely
    expect(() => {
      IntentParsedRecipeSchema.parse({
        description: 'Dish with no name provided',
        ingredients: [{ name: 'Salt', quantity: 5, unit: 'g' }],
      });
    }).toThrowError(/expected string, received undefined|Recipe name is required for each recipe|Recipe name cannot be empty/);

    // Empty recipeName string
    expect(() => {
      IntentParsedRecipeSchema.parse({
        recipeName: '   ',
        ingredients: [{ name: 'Salt', quantity: 5, unit: 'g' }],
      });
    }).toThrowError(/Recipe name cannot be empty/);
  });

  it('validates complete UniversalKitchenIntent when recipes have normalized names', () => {
    const rawAiOutput = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          name: 'Paneer Paratha', // LLM returned "name"
          cookingTimeMins: 8,
          yieldAmount: 2,
          yieldType: 'piece',
          ingredients: [
            { name: 'Paneer', quantity: 102, rawQuantity: '102g', unit: 'g' },
            { name: 'Kalonji', quantity: 0.2, rawQuantity: '1/5 teaspoon', unit: 'tsp' },
          ],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const validated = validateUniversalKitchenIntent(rawAiOutput);
    expect(validated.recipes[0].recipeName).toBe('Paneer Paratha');
    expect(validated.recipes[0].ingredients).toHaveLength(2);
    expect(validated.recipes[0].ingredients[1].quantity).toBe(0.2);
  });
});

describe('Regression 2: Root-Level Schema Validation & Error Handling', () => {
  it('rejects a root-level array with a descriptive AISchemaValidationError', () => {
    const rawArrayOutput = [
      {
        recipeName: 'Paneer Paratha',
        ingredients: [{ name: 'Paneer', quantity: 100, unit: 'g' }],
      },
      {
        recipeName: 'Dal',
        ingredients: [{ name: 'Dal', quantity: 150, unit: 'g' }],
      },
    ];

    expect(() => validateUniversalKitchenIntent(rawArrayOutput)).toThrowError(AISchemaValidationError);

    try {
      validateUniversalKitchenIntent(rawArrayOutput);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AISchemaValidationError);
      expect(err.name).toBe('AISchemaValidationError');
      expect(err.message).toContain('AI returned a root array instead of the required UniversalKitchenIntent object');
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0].message).toBe('Root-level intent must be a JSON object, but received an array.');
    }
  });

  it('handleParseKitchenIntentRequest returns HTTP 422 with AI_SCHEMA_VALIDATION_ERROR instead of generic HTTP 500', async () => {
    const mockParser = {
      parseIntent: vi.fn().mockImplementation(async () => {
        // Simulate Gemini returning a root array
        throw new AISchemaValidationError(
          'AI returned a root array instead of the required UniversalKitchenIntent object with detectedIntent and category collections.',
          [
            {
              code: 'invalid_type',
              expected: 'object',
              path: [],
              message: 'Root-level intent must be a JSON object, but received an array.',
            },
          ],
          'array'
        );
      }),
    };

    const response = await handleParseKitchenIntentRequest(
      { message: 'For 2 paneer parathas 102g paneer' },
      'test-client-ip',
      mockParser as any
    );

    // Verify it is HTTP 422 (Unprocessable Entity) and NOT generic HTTP 500
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error?.code).toBe('AI_SCHEMA_VALIDATION_ERROR');
    expect(response.body.error?.message).toContain('root array');
  });

  it('handleParseKitchenIntentRequest returns HTTP 422 when a recipe is missing recipeName', async () => {
    const mockParser = {
      parseIntent: vi.fn().mockImplementation(async () => {
        // Simulate missing recipeName
        validateUniversalKitchenIntent({
          detectedIntent: 'RECIPE_CREATION',
          recipes: [
            {
              description: 'Recipe with no title or name',
              ingredients: [{ name: 'Dal', quantity: 100, unit: 'g' }],
            },
          ],
        });
      }),
    };

    const response = await handleParseKitchenIntentRequest(
      { message: '100g dal cooked for 10 mins' },
      'test-client-ip',
      mockParser as any
    );

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error?.code).toBe('AI_SCHEMA_VALIDATION_ERROR');
    expect(response.body.error?.message).toContain('recipes.0.recipeName');
    expect(response.body.error?.message).toContain('expected string, received undefined');
  });

  it('does not leak API keys, tokens, or authorization headers in error diagnostics', async () => {
    const mockParser = {
      parseIntent: vi.fn().mockImplementation(async () => {
        throw new AISchemaValidationError(
          'Schema validation failure on field recipes',
          [],
          'object'
        );
      }),
    };

    const response = await handleParseKitchenIntentRequest(
      { message: 'Test message' },
      'test-client-ip',
      mockParser as any
    );

    const stringified = JSON.stringify(response);
    expect(stringified).not.toContain('AIzaSy'); // Google API key prefix
    expect(stringified).not.toContain('Bearer');
    expect(stringified).not.toContain('GEMINI_API_KEY');
    expect(response.status).toBe(422);
  });
});

describe('Regression 3: Prompt & Response Schema Consistency', () => {
  it('enforces top-level required fields in INTENT_RESPONSE_JSON_SCHEMA', () => {
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('detectedIntent');
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('recipes');
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('ingredientCreations');
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('ingredientUpdates');
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('conversionUpdates');
    expect(INTENT_RESPONSE_JSON_SCHEMA.required).toContain('clarificationAnswers');
  });

  it('enforces recipeName in recipe item required properties in INTENT_RESPONSE_JSON_SCHEMA', () => {
    const recipeItemSchema = INTENT_RESPONSE_JSON_SCHEMA.properties.recipes.items;
    expect(recipeItemSchema.required).toContain('recipeName');
    expect(recipeItemSchema.required).toContain('ingredients');
  });

  it('explicitly forbids root array output in UNIVERSAL_PARSER_SYSTEM_INSTRUCTION', () => {
    expect(UNIVERSAL_PARSER_SYSTEM_INSTRUCTION).toContain('NEVER return a top-level array');
    expect(UNIVERSAL_PARSER_SYSTEM_INSTRUCTION).toContain('The response MUST ALWAYS be a single JSON object');
    expect(UNIVERSAL_PARSER_SYSTEM_INSTRUCTION).toContain('recipeName');
  });

  it('allows gasConfigUpdate to be nullable in INTENT_RESPONSE_JSON_SCHEMA', () => {
    expect((INTENT_RESPONSE_JSON_SCHEMA.properties as any).gasConfigUpdate.nullable).toBe(true);
  });
});

describe('Regression 4: Primary Timeout Budget & Immediate Fallback', () => {
  const validMockIntent: UniversalKitchenIntent = {
    detectedIntent: 'RECIPE_CREATION',
    recipes: [
      {
        recipeName: 'Simple Poha',
        cookingTimeMins: 10,
        yieldAmount: 250,
        yieldType: 'weight',
        ingredients: [
          { name: 'Poha', quantity: 150, unit: 'g' },
        ],
        unresolvedNotes: [],
      },
    ],
    ingredientCreations: [],
    ingredientUpdates: [],
    conversionUpdates: [],
    gasConfigUpdate: null,
    clarificationAnswers: [],
    unresolvedNotes: [],
  };

  it('successful primary response does not call the fallback model', async () => {
    const mockGenerateContent = vi.fn().mockImplementation(async (params: any) => {
      if (params.model === DEFAULT_MODEL) {
        return {
          text: JSON.stringify(validMockIntent),
        };
      }
      throw new Error('Fallback should not be called');
    });

    const mockAi = { models: { generateContent: mockGenerateContent } };
    const parser = new GeminiUniversalIntentParser();

    const result = await parser.parseIntent('Make poha', [], {
      apiKey: 'test-api-key',
      genAi: mockAi as any,
    });

    expect(result.detectedIntent).toBe('RECIPE_CREATION');
    expect(result.recipes[0].recipeName).toBe('Simple Poha');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_MODEL })
    );
  });

  it('failing primary attempt triggers the fallback immediately within remaining budget', async () => {
    const mockGenerateContent = vi.fn().mockImplementation(async (params: any) => {
      if (params.model === DEFAULT_MODEL) {
        throw new Error('503 Service Unavailable: High load on primary model');
      }
      if (params.model === FALLBACK_MODEL) {
        return {
          text: JSON.stringify(validMockIntent),
        };
      }
      throw new Error(`Unexpected model ${params.model}`);
    });

    const mockAi = { models: { generateContent: mockGenerateContent } };
    const parser = new GeminiUniversalIntentParser();

    const result = await parser.parseIntent('Make poha', [], {
      apiKey: 'test-api-key',
      genAi: mockAi as any,
    });

    expect(result.detectedIntent).toBe('RECIPE_CREATION');
    expect(result.recipes[0].recipeName).toBe('Simple Poha');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0][0].model).toBe(DEFAULT_MODEL);
    expect(mockGenerateContent.mock.calls[1][0].model).toBe(FALLBACK_MODEL);
  });

  it('slow primary attempt triggers fallback within remaining budget and aborts primary', async () => {
    let primarySignalAborted = false;

    const mockGenerateContent = vi.fn().mockImplementation(async (params: any) => {
      if (params.model === DEFAULT_MODEL) {
        const signal: AbortSignal = params.config?.abortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            primarySignalAborted = true;
          });
        }
        // Simulate slow primary call exceeding primary timeout budget
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ text: JSON.stringify(validMockIntent) });
          }, 300);
        });
      }
      if (params.model === FALLBACK_MODEL) {
        return {
          text: JSON.stringify(validMockIntent),
        };
      }
      throw new Error(`Unexpected model ${params.model}`);
    });

    const mockAi = { models: { generateContent: mockGenerateContent } };
    const parser = new GeminiUniversalIntentParser();

    const result = await parser.parseIntent('Make poha', [], {
      apiKey: 'test-api-key',
      primaryTimeoutMs: 50,
      timeoutMs: 1000,
      genAi: mockAi as any,
    });

    expect(result.detectedIntent).toBe('RECIPE_CREATION');
    expect(primarySignalAborted).toBe(true);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0][0].model).toBe(DEFAULT_MODEL);
    expect(mockGenerateContent.mock.calls[1][0].model).toBe(FALLBACK_MODEL);
  });

  it('slow fallback returns a controlled timeout rather than hanging', async () => {
    let fallbackSignalAborted = false;

    const mockGenerateContent = vi.fn().mockImplementation(async (params: any) => {
      if (params.model === DEFAULT_MODEL) {
        throw new Error('Primary failed immediately');
      }
      if (params.model === FALLBACK_MODEL) {
        const signal: AbortSignal = params.config?.abortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            fallbackSignalAborted = true;
          });
        }
        // Fallback hangs indefinitely
        return new Promise(() => {});
      }
      throw new Error(`Unexpected model ${params.model}`);
    });

    const mockAi = { models: { generateContent: mockGenerateContent } };
    const parser = new GeminiUniversalIntentParser();

    await expect(
      parser.parseIntent('Make poha', [], {
        apiKey: 'test-api-key',
        primaryTimeoutMs: 50,
        timeoutMs: 1200,
        genAi: mockAi as any,
      })
    ).rejects.toThrowError(/timed out after 1200ms/);

    expect(fallbackSignalAborted).toBe(true);
  });

  it('prevent abandoned primary requests from causing unhandled rejections', async () => {
    let unhandledRejectionCaught = false;
    const onUnhandled = () => {
      unhandledRejectionCaught = true;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const mockGenerateContent = vi.fn().mockImplementation(async (params: any) => {
        if (params.model === DEFAULT_MODEL) {
          return new Promise((_, reject) => {
            // Late rejection after primary timeout
            setTimeout(() => {
              reject(new Error('Late network disconnect on primary'));
            }, 80);
          });
        }
        if (params.model === FALLBACK_MODEL) {
          return {
            text: JSON.stringify(validMockIntent),
          };
        }
      });

      const mockAi = { models: { generateContent: mockGenerateContent } };
      const parser = new GeminiUniversalIntentParser();

      const result = await parser.parseIntent('Make poha', [], {
        apiKey: 'test-api-key',
        primaryTimeoutMs: 30,
        timeoutMs: 1000,
        genAi: mockAi as any,
      });

      expect(result.detectedIntent).toBe('RECIPE_CREATION');

      // Wait 100ms for late rejection
      await new Promise((r) => setTimeout(r, 100));
      expect(unhandledRejectionCaught).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('Regression 5: Gas Configuration Validation & Mutation Guarding', () => {
  const masterIngredients: Ingredient[] = [
    { id: 'ing_1', name: 'Paneer', purchaseQty: 1, purchaseUnit: 'kg', purchaseCost: 400, costPerUnit: 0.4 },
  ];
  const conversions: TeaspoonConversion[] = [];
  const gasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };
  const existingRecipes: Recipe[] = [];

  it('treats omitted optional gas updates (null or undefined) as absent and does not create gas mutations', () => {
    const intent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Simple Dish',
          yieldAmount: 200,
          yieldType: 'weight',
          cookingTimeMins: 10,
          ingredients: [{ name: 'Paneer', quantity: 100, unit: 'g' }],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: null,
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(intent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.gasMutation).toBeNull();

    const turnResult = {
      validatedIntent: intent,
      validationOutcome: outcome,
      pendingClarifications: [],
      assistantReply: 'Recipe validated.',
    };

    const proposal = generateProposedChangeSet(turnResult, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(proposal.operations.gasConfigUpdate).toBeUndefined();

    // Verify affected recipes calculation does not flag gas change
    const isGasChanged = !!proposal.operations.gasConfigUpdate;
    expect(isGasChanged).toBe(false);
    const affected = findAffectedRecipeIds(existingRecipes, [], [], isGasChanged);
    expect(affected).toHaveLength(0);
  });

  it('treats empty gas configuration object as absent and does not mutate gas settings', () => {
    const intent: UniversalKitchenIntent = {
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Simple Dish',
          yieldAmount: 200,
          yieldType: 'weight',
          cookingTimeMins: 10,
          ingredients: [{ name: 'Paneer', quantity: 100, unit: 'g' }],
          unresolvedNotes: [],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: {},
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(intent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.gasMutation).toBeNull();

    const turnResult = {
      validatedIntent: intent,
      validationOutcome: outcome,
      pendingClarifications: [],
      assistantReply: 'Recipe validated.',
    };

    const proposal = generateProposedChangeSet(turnResult, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(proposal.operations.gasConfigUpdate).toBeUndefined();
  });

  it('rejects invalid explicit cylinderPrice (0 or negative) with clear validation error rather than silently converting to null', () => {
    // 1. In validateUniversalKitchenIntent schema validation
    expect(() => {
      validateUniversalKitchenIntent({
        detectedIntent: 'GAS_MUTATION',
        recipes: [],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        gasConfigUpdate: { cylinderPrice: 0 },
        clarificationAnswers: [],
        unresolvedNotes: [],
      });
    }).toThrowError(/>0|greater than 0/);

    expect(() => {
      validateUniversalKitchenIntent({
        detectedIntent: 'GAS_MUTATION',
        recipes: [],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        gasConfigUpdate: { cylinderPrice: -50 },
        clarificationAnswers: [],
        unresolvedNotes: [],
      });
    }).toThrowError(/>0|greater than 0/);

    // 2. In catalogValidationEngine
    expect(() => {
      validateKitchenIntent(
        {
          detectedIntent: 'GAS_MUTATION',
          recipes: [],
          ingredientCreations: [],
          ingredientUpdates: [],
          conversionUpdates: [],
          gasConfigUpdate: { cylinderPrice: 0 } as any,
          clarificationAnswers: [],
          unresolvedNotes: [],
        },
        masterIngredients,
        conversions,
        gasConfig,
        existingRecipes
      );
    }).toThrowError(/Gas cylinder price must be greater than 0/);
  });

  it('preserves valid explicit user gas updates and generates correct proposals', () => {
    const validGasIntent: UniversalKitchenIntent = {
      detectedIntent: 'GAS_MUTATION',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: { cylinderPrice: 1050 },
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const outcome = validateKitchenIntent(validGasIntent, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(outcome.gasMutation).toBeDefined();
    expect(outcome.gasMutation?.cylinderPrice).toBe(1050);
    expect(outcome.gasMutation?.previousConfig.cylinderPrice).toBe(950);
    expect(outcome.gasMutation?.cylinderWeightKg).toBe(14.2);
    expect(outcome.gasMutation?.consumptionRateKgHour).toBe(0.25);

    const turnResult = {
      validatedIntent: validGasIntent,
      validationOutcome: outcome,
      pendingClarifications: [],
      assistantReply: 'Gas rate updated.',
    };

    const proposal = generateProposedChangeSet(turnResult, masterIngredients, conversions, gasConfig, existingRecipes);
    expect(proposal.operations.gasConfigUpdate).toBeDefined();
    expect(proposal.operations.gasConfigUpdate?.proposed.cylinderPrice).toBe(1050);
    expect(proposal.operations.gasConfigUpdate?.previous.cylinderPrice).toBe(950);
  });
});

describe('Regression 6: Missing Yield (0 / null) Handling & Zero-Quantity Rejection', () => {
  const masterIngredients: Ingredient[] = [
    { id: 'ing_poha', name: 'Poha', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 40, costPerUnit: 0.08 },
  ];
  const conversions: TeaspoonConversion[] = [];
  const gasConfig: GasConfig = {
    cylinderPrice: 950,
    cylinderWeightKg: 14.2,
    consumptionRateKgHour: 0.25,
  };

  it('1. preserves missing yield returned as null', () => {
    const validated = validateUniversalKitchenIntent({
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Poha',
          yieldAmount: null,
          yieldType: 'unknown',
          ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
    });

    expect(validated.recipes[0].yieldAmount).toBeNull();
  });

  it('2. normalizes Gemini returning zero (0 or "0") for an unspecified yield to null', () => {
    const validatedNumericZero = validateUniversalKitchenIntent({
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Poha',
          yieldAmount: 0,
          yieldType: 'unknown',
          ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
    });
    expect(validatedNumericZero.recipes[0].yieldAmount).toBeNull();

    const validatedStringZero = validateUniversalKitchenIntent({
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Poha',
          yieldAmount: '0',
          yieldType: 'unknown',
          ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
    });
    expect(validatedStringZero.recipes[0].yieldAmount).toBeNull();
  });

  it('3. preserves valid positive yield values (including fractional strings)', () => {
    const validated = validateUniversalKitchenIntent({
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Poha',
          yieldAmount: 250,
          yieldType: 'weight',
          ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
    });
    expect(validated.recipes[0].yieldAmount).toBe(250);
  });

  it('4. rejects explicitly invalid zero or negative ingredient quantities and negative yields', () => {
    // Zero ingredient quantity must be rejected
    expect(() =>
      validateUniversalKitchenIntent({
        detectedIntent: 'RECIPE_CREATION',
        recipes: [
          {
            recipeName: 'Poha',
            yieldAmount: 200,
            yieldType: 'weight',
            ingredients: [{ name: 'Poha', quantity: 0, unit: 'g' }],
          },
        ],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
      })
    ).toThrowError(AISchemaValidationError);

    // Negative ingredient quantity must be rejected
    expect(() =>
      validateUniversalKitchenIntent({
        detectedIntent: 'RECIPE_CREATION',
        recipes: [
          {
            recipeName: 'Poha',
            yieldAmount: 200,
            yieldType: 'weight',
            ingredients: [{ name: 'Poha', quantity: -10, unit: 'g' }],
          },
        ],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
      })
    ).toThrowError(AISchemaValidationError);

    // Negative yieldAmount must be rejected
    expect(() =>
      validateUniversalKitchenIntent({
        detectedIntent: 'RECIPE_CREATION',
        recipes: [
          {
            recipeName: 'Poha',
            yieldAmount: -2,
            yieldType: 'piece',
            ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
          },
        ],
        ingredientCreations: [],
        ingredientUpdates: [],
        conversionUpdates: [],
        clarificationAnswers: [],
      })
    ).toThrowError(AISchemaValidationError);
  });

  it('5. generates MISSING_YIELD clarification when yield is missing or normalized from 0', () => {
    const validated = validateUniversalKitchenIntent({
      detectedIntent: 'RECIPE_CREATION',
      recipes: [
        {
          recipeName: 'Poha',
          yieldAmount: 0,
          yieldType: 'unknown',
          ingredients: [{ name: 'Poha', quantity: 100, unit: 'g' }],
        },
      ],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      clarificationAnswers: [],
    });

    const outcome = validateKitchenIntent(validated, masterIngredients, conversions, gasConfig, []);
    expect(outcome.isComplete).toBe(false);
    const yieldClarification = outcome.clarifications.find(c => c.category === 'MISSING_YIELD');
    expect(yieldClarification).toBeDefined();
    expect(yieldClarification?.targetEntity).toBe('Poha');
    expect(yieldClarification?.field).toBe('yieldAmount');
  });
});

describe('Regression 7: Supabase Edge Function Fallback (parse-catalog-intent)', () => {
  const sampleValidIntent: UniversalKitchenIntent = {
    detectedIntent: 'RECIPE_CREATION',
    recipes: [
      {
        recipeName: 'Dal Tadka',
        cookingTimeMins: 15,
        yieldAmount: 2,
        yieldType: 'serving',
        ingredients: [{ name: 'Toor Dal', quantity: 100, unit: 'g' }],
        unresolvedNotes: [],
      },
    ],
    ingredientCreations: [],
    ingredientUpdates: [],
    conversionUpdates: [],
    gasConfigUpdate: null,
    clarificationAnswers: [],
    unresolvedNotes: [],
  };

  it('1. local endpoint success (200) returns validated intent without invoking Supabase Edge Function', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        provider: 'Google Gemini 3.8 Flash',
        data: sampleValidIntent,
      }),
    } as any);

    const mockInvoke = vi.fn();
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const res = await parseKitchenIntentFromNaturalLanguage('Make Dal Tadka', []);
    expect(res.intent.detectedIntent).toBe('RECIPE_CREATION');
    expect(res.intent.recipes[0].recipeName).toBe('Dal Tadka');
    expect(res.provider).toBe('Google Gemini 3.8 Flash');
    expect(mockInvoke).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  it('2. local endpoint 404 falls back to parse-catalog-intent with message and history', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    const history = [{ role: 'user' as const, content: '1 tsp Dhaniya' }];
    const clarificationIntent: UniversalKitchenIntent = {
      detectedIntent: 'CLARIFICATION_ANSWER',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: null,
      clarificationAnswers: [
        { targetEntity: 'Dhaniya', field: 'ingredientName', value: 'Coriander Powder' },
      ],
      unresolvedNotes: [],
    };

    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: { success: true, provider: 'Google Gemini (Supabase Edge)', data: clarificationIntent },
      error: null,
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const res = await parseKitchenIntentFromNaturalLanguage('I meant Coriander Powder', history);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('parse-catalog-intent', {
      body: { message: 'I meant Coriander Powder', history },
    });
    expect(res.intent.detectedIntent).toBe('CLARIFICATION_ANSWER');
    expect(res.intent.clarificationAnswers).toHaveLength(1);
    expect(res.intent.clarificationAnswers[0].value).toBe('Coriander Powder');

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  it('3. local AUTH_ERROR (503) falls back to parse-catalog-intent when Supabase Edge Function is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        error: { code: 'AUTH_ERROR', message: 'GEMINI_API_KEY is not configured on the server.' },
      }),
    } as any);

    const ingredientMutationIntent: UniversalKitchenIntent = {
      detectedIntent: 'INGREDIENT_MUTATION',
      recipes: [],
      ingredientCreations: [{ name: 'Poha', purchaseQty: 500, purchaseUnit: 'g', purchaseCost: 40 }],
      ingredientUpdates: [],
      conversionUpdates: [],
      gasConfigUpdate: null,
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: { success: true, provider: 'Supabase AI Edge', data: ingredientMutationIntent },
      error: null,
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const res = await parseKitchenIntentFromNaturalLanguage('Add poha 500g for ₹40', []);
    expect(mockInvoke).toHaveBeenCalledWith('parse-catalog-intent', {
      body: { message: 'Add poha 500g for ₹40', history: [] },
    });
    expect(res.intent.detectedIntent).toBe('INGREDIENT_MUTATION');
    expect(res.intent.ingredientCreations[0]).toEqual({
      name: 'Poha',
      purchaseQty: 500,
      purchaseUnit: 'g',
      purchaseCost: 40,
    });

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  it('4. does NOT fall back on local schema validation (422), rate limit (429), or bad input (400) errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        error: { code: 'AI_SCHEMA_VALIDATION_ERROR', message: 'AI returned a root array.' },
      }),
    } as any);

    const mockInvoke = vi.fn();
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    await expect(parseKitchenIntentFromNaturalLanguage('Invalid output test', [])).rejects.toThrow(
      'AI returned a root array.'
    );
    expect(mockInvoke).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  it('5. supports conversion updates and gas configuration updates through the parse-catalog-intent fallback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    const compoundIntent = {
      detectedIntent: 'COMPOUND',
      recipes: [],
      ingredientCreations: [],
      ingredientUpdates: [],
      conversionUpdates: [{ name: 'Kalonji', weightGrams: 2 }],
      gasConfigUpdate: { cylinderPrice: 1100, cylinderWeightKg: 14.2, consumptionRateKgHour: 0.25 },
      clarificationAnswers: [],
      unresolvedNotes: [],
    };

    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: { success: true, provider: 'Supabase AI Edge', data: compoundIntent },
      error: null,
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    const res = await parseKitchenIntentFromNaturalLanguage(
      '1 tsp kalonji = 2g and gas cylinder price is ₹1100 for 14.2kg at 0.25kg/hr',
      []
    );
    expect(res.intent.conversionUpdates).toEqual([{ name: 'Kalonji', weightGrams: 2 }]);
    expect(res.intent.gasConfigUpdate).toEqual({
      cylinderPrice: 1100,
      cylinderWeightKg: 14.2,
      consumptionRateKgHour: 0.25,
    });

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });

  it('6. validates Edge Function responses with validateUniversalKitchenIntent and rejects malformed payloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    // Simulate Edge Function returning invalid root array
    const mockInvoke = vi.fn().mockResolvedValueOnce({
      data: { success: true, provider: 'Supabase AI Edge', data: [{ recipeName: 'Bad Array' }] },
      error: null,
    });
    const functionsSpy = vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any);

    await expect(parseKitchenIntentFromNaturalLanguage('Make dal', [])).rejects.toThrow(
      /root array/i
    );

    fetchSpy.mockRestore();
    functionsSpy.mockRestore();
  });
});


