/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Universal Natural Language Culinary Intent Parser powered by Google Gemini.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { UniversalKitchenIntent, validateUniversalKitchenIntent, AISchemaValidationError } from './intentSchema';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_TIMEOUT_MS = 25000;
export const PRIMARY_TIMEOUT_MS = 8000;
export const RESPONSE_BUFFER_MS = 1000;

export interface IntentParserConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  primaryTimeoutMs?: number;
  genAi?: {
    models: {
      generateContent: (params: any) => Promise<any>;
    };
  };
}

export const UNIVERSAL_PARSER_SYSTEM_INSTRUCTION = `You are the lead culinary information extraction engine for Daily Dabba commercial cloud kitchen costing.
Your responsibility is to extract structured intent from unrestricted natural language messages into a single JSON object adhering strictly to the schema.

ROOT JSON STRUCTURE REQUIREMENT:
The response MUST ALWAYS be a single JSON object. NEVER return a top-level array.
The root object MUST contain these top-level keys:
- detectedIntent: one of "RECIPE_CREATION", "INGREDIENT_MUTATION", "GAS_MUTATION", "CONVERSION_MUTATION", "CLARIFICATION_ANSWER", "COMPOUND", "UNKNOWN"
- recipes: array of recipe objects
- ingredientCreations: array of new ingredient objects
- ingredientUpdates: array of updated ingredient objects
- conversionUpdates: array of teaspoon conversion objects
- gasConfigUpdate: gas config object or null
- clarificationAnswers: array of clarification answer objects
- userFacingExplanation: optional string
- unresolvedNotes: array of strings

DATA CATEGORY DETAILS & FORMATTING:
1. RECIPES:
   - For every recipe, the dish name MUST be provided in the "recipeName" field (NOT "name" or "title").
   - If user does not explicitly label the recipe name (e.g., "144g dal, 1/2 tsp haldi, 1 tsp salt, 10 min cooking"), identify the main dish from ingredients and set recipeName (e.g. "Dal", "Paneer Paratha").
   - Extract cookingTimeMins, yieldAmount, yieldType ("weight", "piece", "serving", "unknown"), and rawYieldAmount.
   - Ingredients: array of objects with "name", "quantity" (as decimal number, e.g. 0.5), "rawQuantity" (e.g. "1/2"), "unit", and "isAmbiguous".
   - Fractions: Convert "1/2" -> quantity: 0.5; "1/5" -> 0.2; "1/3" -> 0.3333; "1/4" -> 0.25.
   - Ambiguous items: Count items without gram weight (e.g. "one onion", "1/2 pyaaz") -> quantity: 0.5, unit: "piece", isAmbiguous: true.
   - Pouches (e.g. "1 pouch maggi masala") -> quantity: 1, unit: "pouch", isAmbiguous: true.
   - Preserves volumetric units like "tsp", "tbsp", "cup" as written. DO NOT assume teaspoon gram weight.
   - Yield: "For 2 paneer parathas" -> yieldAmount: 2, yieldType: "piece", rawYieldAmount: "2 parathas". "Yield is 500g" -> yieldAmount: 500, yieldType: "weight".

2. INGREDIENT ADDITIONS & PRICE UPDATES:
   - "Add poha 500 g for ₹40" -> ingredientCreations: [{ name: "Poha", purchaseQty: 500, purchaseUnit: "g", purchaseCost: 40 }]
   - "Change the purchase price of paneer to ₹105 for 200 g" -> ingredientUpdates: [{ name: "Paneer", purchaseQty: 200, purchaseUnit: "g", purchaseCost: 105 }]
   - "Update paneer to ₹110 for 200g" -> ingredientUpdates: [{ name: "Paneer", purchaseQty: 200, purchaseUnit: "g", purchaseCost: 110 }]

3. GAS CYLINDER CONFIGURATION:
   - "Set the gas cylinder price to ₹1,000. It weighs 14.2 kg, consumption 0.25 kg/hr" -> gasConfigUpdate: { cylinderPrice: 1000, cylinderWeightKg: 14.2, consumptionRateKgHour: 0.25 }

4. TEASPOON CONVERSION WEIGHTS:
   - "One teaspoon of jeera weighs 2 grams" -> conversionUpdates: [{ name: "Jeera", weightGrams: 2 }]
   - "1 tsp salt = 5g" -> conversionUpdates: [{ name: "Salt", weightGrams: 5 }]

5. CLARIFICATION ANSWERS & CORRECTIONS:
   - If user is answering a previous question or correcting values (e.g. "Onion weighs 60 grams and pouch is 10g"):
     extract into clarificationAnswers: [{ targetEntity: "Onion", field: "weightGrams", value: "60", unit: "g" }, { targetEntity: "Maggi masala", field: "weightGrams", value: "10", unit: "g" }]
   - If user is answering a teaspoon weight question (e.g. "1 tsp kalonji is 2g"):
     extract into conversionUpdates: [{ name: "Kalonji", weightGrams: 2 }] or clarificationAnswers: [{ targetEntity: "Kalonji", field: "tspWeightGrams", value: "2", unit: "g" }]
   - If user is clarifying which ingredient form or variety they meant (e.g. "Coriander powder" for "Dhaniya", or "Moong dal" for "Dal"):
     extract into clarificationAnswers: [{ targetEntity: "Dhaniya", field: "ingredientName", value: "Coriander powder" }]

6. COMPOUND REQUESTS:
   - A single message can contain combinations of recipes, new ingredient prices, gas settings, and conversions. Extract all detected categories simultaneously.

CRITICAL RULES:
- The root output MUST be a JSON object matching the schema. NEVER return a root array.
- In every recipe, the dish name MUST be in the "recipeName" property.
- NEVER calculate cost prices, mathematical totals, or fuel cost yourself.
- NEVER invent prices, pack sizes, or conversions not supplied by the user.
- Handle Indian culinary vocabulary and transliteration smoothly (e.g., panner -> Paneer, pyaaz -> Onion, dhaniya -> Coriander/Dhaniya, haldi -> Turmeric/Haldi, namak -> Salt, cheeni -> Sugar).`;

export const INTENT_RESPONSE_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedIntent: {
      type: Type.STRING,
      enum: [
        'RECIPE_CREATION',
        'INGREDIENT_MUTATION',
        'GAS_MUTATION',
        'CONVERSION_MUTATION',
        'CLARIFICATION_ANSWER',
        'COMPOUND',
        'UNKNOWN',
      ],
    },
    recipes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          recipeName: { type: Type.STRING },
          description: { type: Type.STRING },
          cookingTimeMins: { type: Type.NUMBER },
          yieldAmount: { type: Type.NUMBER },
          rawYieldAmount: { type: Type.STRING },
          yieldType: { type: Type.STRING, enum: ['weight', 'piece', 'serving', 'unknown'] },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                rawQuantity: { type: Type.STRING },
                unit: { type: Type.STRING },
                originalText: { type: Type.STRING },
                notes: { type: Type.STRING },
                isAmbiguous: { type: Type.BOOLEAN },
                ambiguityReason: { type: Type.STRING },
              },
              required: ['name', 'unit'],
            },
          },
          unresolvedNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['recipeName', 'ingredients'],
      },
    },
    ingredientCreations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          purchaseQty: { type: Type.NUMBER },
          purchaseUnit: { type: Type.STRING, enum: ['kg', 'g', 'litre', 'ml'] },
          purchaseCost: { type: Type.NUMBER },
          notes: { type: Type.STRING },
        },
        required: ['name'],
      },
    },
    ingredientUpdates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          purchaseQty: { type: Type.NUMBER },
          purchaseUnit: { type: Type.STRING, enum: ['kg', 'g', 'litre', 'ml'] },
          purchaseCost: { type: Type.NUMBER },
          notes: { type: Type.STRING },
        },
        required: ['name'],
      },
    },
    conversionUpdates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          weightGrams: { type: Type.NUMBER },
        },
        required: ['name', 'weightGrams'],
      },
    },
    gasConfigUpdate: {
      type: Type.OBJECT,
      nullable: true,
      description: 'Updated gas cylinder settings if explicitly requested, or null if omitted',
      properties: {
        cylinderPrice: { type: Type.NUMBER },
        cylinderWeightKg: { type: Type.NUMBER },
        consumptionRateKgHour: { type: Type.NUMBER },
      },
    },
    clarificationAnswers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          targetEntity: { type: Type.STRING },
          field: { type: Type.STRING },
          value: { type: Type.STRING },
          unit: { type: Type.STRING },
        },
        required: ['targetEntity', 'field', 'value'],
      },
    },
    userFacingExplanation: { type: Type.STRING },
    unresolvedNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'detectedIntent',
    'recipes',
    'ingredientCreations',
    'ingredientUpdates',
    'conversionUpdates',
    'clarificationAnswers',
  ],
};

export class GeminiUniversalIntentParser {
  private getApiKey(): string | null {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      return process.env.GEMINI_API_KEY.trim();
    }
    return null;
  }

  async parseIntent(
    userMessage: string,
    conversationHistory: { role: 'user' | 'model'; content: string }[] = [],
    config?: IntentParserConfig
  ): Promise<UniversalKitchenIntent> {
    const apiKey = config?.apiKey || this.getApiKey();
    if (!apiKey && !config?.genAi) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    const primaryModel = config?.model || DEFAULT_MODEL;
    const totalTimeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const primaryBudgetMs = Math.min(config?.primaryTimeoutMs ?? PRIMARY_TIMEOUT_MS, totalTimeoutMs);
    const ai = config?.genAi || new GoogleGenAI({ apiKey: apiKey! });

    // Build multi-turn context
    const formattedHistory = conversationHistory
      .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n\n');
    const prompt = conversationHistory.length > 0
      ? `Conversation context so far:\n${formattedHistory}\n\nLatest user message to parse:\n"""\n${userMessage.trim()}\n"""`
      : `Parse culinary intent from user message:\n"""\n${userMessage.trim()}\n"""`;

    const startTime = Date.now();
    let rawResponse: any;

    const invokeModel = async (model: string, signal: AbortSignal) => {
      return await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: UNIVERSAL_PARSER_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseJsonSchema: INTENT_RESPONSE_JSON_SCHEMA,
          temperature: 0.1,
          maxOutputTokens: 3000,
          abortSignal: signal,
        },
      });
    };

    // 1. Attempt Primary Model within primaryBudgetMs
    const primaryAbortController = new AbortController();
    let primaryTimer: ReturnType<typeof setTimeout> | undefined;

    const primaryCallPromise = invokeModel(primaryModel, primaryAbortController.signal);
    // Suppress unhandled rejection if aborted or late settled
    primaryCallPromise.catch(() => {});

    const primaryTimeoutPromise = new Promise<never>((_, reject) => {
      primaryTimer = setTimeout(() => {
        primaryAbortController.abort();
        reject(new Error(`Primary model ${primaryModel} timed out after ${primaryBudgetMs}ms`));
      }, primaryBudgetMs);
    });

    try {
      rawResponse = await Promise.race([primaryCallPromise, primaryTimeoutPromise]);
    } catch (primaryErr) {
      primaryAbortController.abort();

      const shouldAttemptFallback = primaryModel !== FALLBACK_MODEL;
      if (!shouldAttemptFallback) {
        throw primaryErr;
      }

      // Check remaining budget for fallback model
      const elapsed = Date.now() - startTime;
      const bufferMs = Math.min(RESPONSE_BUFFER_MS, Math.floor(totalTimeoutMs * 0.1));
      const fallbackBudgetMs = totalTimeoutMs - elapsed - bufferMs;
      if (fallbackBudgetMs <= 0) {
        throw new Error(`AI intent parser timed out after ${totalTimeoutMs}ms`);
      }

      // 2. Attempt Fallback Model immediately with remaining budget
      const fallbackAbortController = new AbortController();
      let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

      const fallbackCallPromise = invokeModel(FALLBACK_MODEL, fallbackAbortController.signal);
      fallbackCallPromise.catch(() => {});

      const fallbackTimeoutPromise = new Promise<never>((_, reject) => {
        fallbackTimer = setTimeout(() => {
          fallbackAbortController.abort();
          reject(new Error(`AI intent parser timed out after ${totalTimeoutMs}ms`));
        }, fallbackBudgetMs);
      });

      try {
        rawResponse = await Promise.race([fallbackCallPromise, fallbackTimeoutPromise]);
      } catch (fallbackErr) {
        fallbackAbortController.abort();
        throw fallbackErr;
      } finally {
        if (fallbackTimer) clearTimeout(fallbackTimer);
      }
    } finally {
      if (primaryTimer) clearTimeout(primaryTimer);
    }

    const text = rawResponse?.text?.trim() || '';
    if (!text) throw new Error('AI returned an empty response.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('AI returned invalid JSON.');
    }
    return validateUniversalKitchenIntent(parsed);
  }
}
