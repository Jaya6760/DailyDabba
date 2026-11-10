// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Supabase Edge Function: parse-catalog-intent
 *
 * Invoked via: supabase.functions.invoke('parse-catalog-intent', { body: { message, history } })
 * Secrets required in Supabase Vault: GEMINI_API_KEY
 */

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRIMARY_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB max input
const TOTAL_TIMEOUT_MS = 25000;
const PRIMARY_TIMEOUT_MS = 8000;

export const SYSTEM_INSTRUCTION = `You are the lead culinary information extraction engine for Daily Dabba commercial cloud kitchen costing.
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

export const RESPONSE_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    detectedIntent: {
      type: 'STRING',
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
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          recipeName: { type: 'STRING' },
          description: { type: 'STRING' },
          cookingTimeMins: { type: 'NUMBER' },
          yieldAmount: { type: 'NUMBER' },
          rawYieldAmount: { type: 'STRING' },
          yieldType: { type: 'STRING', enum: ['weight', 'piece', 'serving', 'unknown'] },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                quantity: { type: 'NUMBER' },
                rawQuantity: { type: 'STRING' },
                unit: { type: 'STRING' },
                originalText: { type: 'STRING' },
                notes: { type: 'STRING' },
                isAmbiguous: { type: 'BOOLEAN' },
                ambiguityReason: { type: 'STRING' },
              },
              required: ['name', 'unit'],
            },
          },
          unresolvedNotes: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['recipeName', 'ingredients'],
      },
    },
    ingredientCreations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          purchaseQty: { type: 'NUMBER' },
          purchaseUnit: { type: 'STRING', enum: ['kg', 'g', 'litre', 'ml'] },
          purchaseCost: { type: 'NUMBER' },
          notes: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    ingredientUpdates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          purchaseQty: { type: 'NUMBER' },
          purchaseUnit: { type: 'STRING', enum: ['kg', 'g', 'litre', 'ml'] },
          purchaseCost: { type: 'NUMBER' },
          notes: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    conversionUpdates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          weightGrams: { type: 'NUMBER' },
        },
        required: ['name', 'weightGrams'],
      },
    },
    gasConfigUpdate: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        cylinderPrice: { type: 'NUMBER' },
        cylinderWeightKg: { type: 'NUMBER' },
        consumptionRateKgHour: { type: 'NUMBER' },
      },
    },
    clarificationAnswers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          targetEntity: { type: 'STRING' },
          field: { type: 'STRING' },
          value: { type: 'STRING' },
          unit: { type: 'STRING' },
        },
        required: ['targetEntity', 'field', 'value'],
      },
    },
    userFacingExplanation: { type: 'STRING' },
    unresolvedNotes: { type: 'ARRAY', items: { type: 'STRING' } },
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

function parseFractionalNumber(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim();
    if (!clean) return null;
    if (clean.includes('/')) {
      const parts = clean.split(/\s+/);
      if (parts.length === 2) {
        const whole = parseFloat(parts[0]);
        const fracParts = parts[1].split('/');
        if (fracParts.length === 2) {
          const num = parseFloat(fracParts[0]);
          const den = parseFloat(fracParts[1]);
          if (!isNaN(whole) && !isNaN(num) && !isNaN(den) && den !== 0) {
            return whole + num / den;
          }
        }
      } else if (parts.length === 1) {
        const fracParts = clean.split('/');
        if (fracParts.length === 2) {
          const num = parseFloat(fracParts[0]);
          const den = parseFloat(fracParts[1]);
          if (!isNaN(num) && !isNaN(den) && den !== 0) {
            return num / den;
          }
        }
      }
    }
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Deno-compatible validation and normalization matching validateUniversalKitchenIntent in src/server/ai/intentSchema.ts
 */
export function validateAndNormalizeEdgeIntent(data: unknown): Record<string, any> {
  if (Array.isArray(data)) {
    throw new Error(
      'AI returned a root array instead of the required UniversalKitchenIntent object with detectedIntent and category collections.'
    );
  }
  if (!data || typeof data !== 'object') {
    throw new Error('AI output failed schema validation: root must be a JSON object.');
  }

  const raw = data as Record<string, any>;
  const validIntents = new Set([
    'RECIPE_CREATION',
    'INGREDIENT_MUTATION',
    'GAS_MUTATION',
    'CONVERSION_MUTATION',
    'CLARIFICATION_ANSWER',
    'COMPOUND',
    'UNKNOWN',
  ]);
  const detectedIntent =
    typeof raw.detectedIntent === 'string' && validIntents.has(raw.detectedIntent)
      ? raw.detectedIntent
      : 'UNKNOWN';

  // 1. Validate & normalize recipes
  const rawRecipes = Array.isArray(raw.recipes) ? raw.recipes : [];
  const recipes = rawRecipes.map((rec: any, rIdx: number) => {
    if (!rec || typeof rec !== 'object') {
      throw new Error(`AI output failed schema validation: recipes.${rIdx} must be an object.`);
    }
    const resolvedName = (
      rec.recipeName ||
      rec.name ||
      rec.title ||
      rec.dishName ||
      rec.recipe_name ||
      ''
    )
      .toString()
      .trim();
    if (!resolvedName) {
      throw new Error(`AI output failed schema validation: recipes.${rIdx}.recipeName: Recipe name cannot be empty`);
    }

    // Normalize yieldAmount: 0 or "0" from LLM is normalized to null (unspecified yield)
    let yieldAmount: number | null = null;
    if (rec.yieldAmount !== undefined && rec.yieldAmount !== null && rec.yieldAmount !== 0 && String(rec.yieldAmount).trim() !== '0') {
      const parsedYield = parseFractionalNumber(rec.yieldAmount);
      if (parsedYield === null || !Number.isFinite(parsedYield) || parsedYield <= 0) {
        throw new Error(
          `AI output failed schema validation: recipes.${rIdx}.yieldAmount: Too small: expected number to be >0`
        );
      }
      yieldAmount = parsedYield;
    }

    const rawIngredients = Array.isArray(rec.ingredients) ? rec.ingredients : [];
    const ingredients = rawIngredients.map((ing: any, iIdx: number) => {
      const ingName = (ing?.name || '').toString().trim();
      if (!ingName) {
        throw new Error(
          `AI output failed schema validation: recipes.${rIdx}.ingredients.${iIdx}.name: Ingredient name cannot be empty`
        );
      }
      let quantity: number | null = null;
      if (ing.quantity !== undefined && ing.quantity !== null) {
        const parsedQty = parseFractionalNumber(ing.quantity);
        if (parsedQty !== null) {
          if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
            throw new Error(
              `AI output failed schema validation: recipes.${rIdx}.ingredients.${iIdx}.quantity: Too small: expected number to be >0`
            );
          }
          quantity = parsedQty;
        }
      }
      return {
        name: ingName,
        ...(quantity !== null ? { quantity } : {}),
        ...(typeof ing.rawQuantity === 'string' ? { rawQuantity: ing.rawQuantity.trim() } : {}),
        ...(typeof ing.unit === 'string' ? { unit: ing.unit.trim() } : {}),
        ...(typeof ing.originalText === 'string' ? { originalText: ing.originalText.trim() } : {}),
        ...(ing.notes !== undefined ? { notes: ing.notes ? String(ing.notes).trim() : null } : {}),
        ...(typeof ing.isAmbiguous === 'boolean' ? { isAmbiguous: ing.isAmbiguous } : {}),
        ...(ing.ambiguityReason !== undefined
          ? { ambiguityReason: ing.ambiguityReason ? String(ing.ambiguityReason).trim() : null }
          : {}),
      };
    });

    const validYieldTypes = new Set(['weight', 'piece', 'serving', 'unknown']);
    const yieldType =
      typeof rec.yieldType === 'string' && validYieldTypes.has(rec.yieldType) ? rec.yieldType : 'unknown';

    return {
      recipeName: resolvedName,
      ...(rec.description !== undefined ? { description: rec.description ? String(rec.description).trim() : null } : {}),
      ...(typeof rec.cookingTimeMins === 'number' && rec.cookingTimeMins >= 0
        ? { cookingTimeMins: rec.cookingTimeMins }
        : { cookingTimeMins: null }),
      yieldAmount,
      ...(typeof rec.rawYieldAmount === 'string' ? { rawYieldAmount: rec.rawYieldAmount.trim() } : {}),
      yieldType,
      ingredients,
      unresolvedNotes: Array.isArray(rec.unresolvedNotes)
        ? rec.unresolvedNotes.map((n: any) => String(n).trim())
        : [],
    };
  });

  // 2. Validate & normalize ingredientCreations & ingredientUpdates
  const validateMutations = (arr: unknown, label: string) => {
    if (!Array.isArray(arr)) return [];
    return arr.map((item: any, idx: number) => {
      const name = (item?.name || '').toString().trim();
      if (!name) {
        throw new Error(`AI output failed schema validation: ${label}.${idx}.name: Ingredient name cannot be empty`);
      }
      if (item.purchaseQty !== undefined && (typeof item.purchaseQty !== 'number' || item.purchaseQty <= 0)) {
        throw new Error(`AI output failed schema validation: ${label}.${idx}.purchaseQty: expected number to be >0`);
      }
      if (item.purchaseCost !== undefined && (typeof item.purchaseCost !== 'number' || item.purchaseCost < 0)) {
        throw new Error(`AI output failed schema validation: ${label}.${idx}.purchaseCost: expected number to be >=0`);
      }
      return {
        name,
        ...(item.purchaseQty !== undefined ? { purchaseQty: item.purchaseQty } : {}),
        ...(typeof item.purchaseUnit === 'string' ? { purchaseUnit: item.purchaseUnit } : {}),
        ...(item.purchaseCost !== undefined ? { purchaseCost: item.purchaseCost } : {}),
        ...(item.costPerUnit !== undefined ? { costPerUnit: item.costPerUnit } : {}),
        ...(typeof item.notes === 'string' ? { notes: item.notes.trim() } : {}),
      };
    });
  };

  const ingredientCreations = validateMutations(raw.ingredientCreations, 'ingredientCreations');
  const ingredientUpdates = validateMutations(raw.ingredientUpdates, 'ingredientUpdates');

  // 3. Validate conversionUpdates
  const conversionUpdates = Array.isArray(raw.conversionUpdates)
    ? raw.conversionUpdates.map((conv: any, idx: number) => {
        const name = (conv?.name || '').toString().trim();
        if (!name) {
          throw new Error(`AI output failed schema validation: conversionUpdates.${idx}.name cannot be empty`);
        }
        if (typeof conv?.weightGrams !== 'number' || !Number.isFinite(conv.weightGrams) || conv.weightGrams <= 0) {
          throw new Error(
            `AI output failed schema validation: conversionUpdates.${idx}.weightGrams: expected number to be >0`
          );
        }
        return { name, weightGrams: conv.weightGrams };
      })
    : [];

  // 4. Validate gasConfigUpdate
  let gasConfigUpdate = null;
  if (raw.gasConfigUpdate && typeof raw.gasConfigUpdate === 'object') {
    const g = raw.gasConfigUpdate;
    if (g.cylinderPrice !== undefined && (typeof g.cylinderPrice !== 'number' || g.cylinderPrice <= 0)) {
      throw new Error('AI output failed schema validation: gasConfigUpdate.cylinderPrice: expected number to be >0');
    }
    if (g.cylinderWeightKg !== undefined && (typeof g.cylinderWeightKg !== 'number' || g.cylinderWeightKg <= 0)) {
      throw new Error('AI output failed schema validation: gasConfigUpdate.cylinderWeightKg: expected number to be >0');
    }
    if (
      g.consumptionRateKgHour !== undefined &&
      (typeof g.consumptionRateKgHour !== 'number' || g.consumptionRateKgHour <= 0)
    ) {
      throw new Error(
        'AI output failed schema validation: gasConfigUpdate.consumptionRateKgHour: expected number to be >0'
      );
    }
    gasConfigUpdate = {
      ...(g.cylinderPrice !== undefined ? { cylinderPrice: g.cylinderPrice } : {}),
      ...(g.cylinderWeightKg !== undefined ? { cylinderWeightKg: g.cylinderWeightKg } : {}),
      ...(g.consumptionRateKgHour !== undefined ? { consumptionRateKgHour: g.consumptionRateKgHour } : {}),
    };
  }

  // 5. Validate clarificationAnswers
  const clarificationAnswers = Array.isArray(raw.clarificationAnswers)
    ? raw.clarificationAnswers.map((ans: any, idx: number) => {
        const targetEntity = (ans?.targetEntity || '').toString().trim();
        const field = (ans?.field || '').toString().trim();
        if (!targetEntity || !field) {
          throw new Error(
            `AI output failed schema validation: clarificationAnswers.${idx} requires targetEntity and field`
          );
        }
        return {
          targetEntity,
          field,
          ...(ans.value !== undefined ? { value: ans.value } : {}),
          ...(typeof ans.unit === 'string' ? { unit: ans.unit.trim() } : {}),
          ...(typeof ans.purchaseQty === 'number' && ans.purchaseQty > 0 ? { purchaseQty: ans.purchaseQty } : {}),
          ...(typeof ans.purchaseUnit === 'string' ? { purchaseUnit: ans.purchaseUnit } : {}),
        };
      })
    : [];

  return {
    detectedIntent,
    recipes,
    ingredientCreations,
    ingredientUpdates,
    conversionUpdates,
    gasConfigUpdate,
    clarificationAnswers,
    ...(typeof raw.userFacingExplanation === 'string'
      ? { userFacingExplanation: raw.userFacingExplanation.trim() }
      : {}),
    unresolvedNotes: Array.isArray(raw.unresolvedNotes)
      ? raw.unresolvedNotes.map((n: any) => String(n).trim())
      : [],
  };
}

async function callGeminiModel(
  model: string,
  promptText: string,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    return await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0.1,
          maxOutputTokens: 3000,
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'Method not allowed' } }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'AUTH_ERROR', message: 'GEMINI_API_KEY secret is not configured in Supabase.' },
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const message = body?.message;
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!message || typeof message !== 'string' || !message.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'Message cannot be empty.' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new TextEncoder().encode(message).length > MAX_PAYLOAD_BYTES) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Message exceeds 16KB limit.' },
        }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formattedHistory = history
      .filter((h: any) => h && typeof h.content === 'string')
      .map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n\n');

    const promptText = formattedHistory
      ? `Conversation context so far:\n${formattedHistory}\n\nLatest user message to parse:\n"""\n${message.trim()}\n"""\nExtract structured kitchen operations as a single JSON object.`
      : `Parse culinary intent from user message:\n"""\n${message.trim()}\n"""`;

    const startTime = Date.now();
    let geminiRes: Response | null = null;
    let usedModel = PRIMARY_MODEL;

    // 1. Attempt primary model within primary timeout budget
    try {
      const res = await callGeminiModel(PRIMARY_MODEL, promptText, GEMINI_API_KEY, PRIMARY_TIMEOUT_MS);
      if (res.ok || (res.status !== 404 && res.status !== 503 && res.status !== 429 && res.status < 500)) {
        geminiRes = res;
      }
    } catch {
      // Primary timed out or network failed; proceed to fallback if budget remains
    }

    // 2. Attempt fallback model if primary did not succeed and primary !== FALLBACK_MODEL
    if (!geminiRes && PRIMARY_MODEL !== FALLBACK_MODEL) {
      const elapsed = Date.now() - startTime;
      const remainingMs = Math.max(1000, TOTAL_TIMEOUT_MS - elapsed);
      usedModel = FALLBACK_MODEL;
      geminiRes = await callGeminiModel(FALLBACK_MODEL, promptText, GEMINI_API_KEY, remainingMs);
    }

    if (!geminiRes || !geminiRes.ok) {
      const status = geminiRes?.status === 429 ? 429 : 502;
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR',
            message:
              status === 429
                ? 'AI rate limit exceeded. Please wait a moment and try again.'
                : 'Failed to parse natural language intent from AI provider.',
          },
        }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiJson = await geminiRes.json();
    let candidateText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    candidateText = candidateText.trim();
    if (candidateText.startsWith('```')) {
      candidateText = candidateText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    if (!candidateText) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'PROVIDER_ERROR', message: 'AI returned an empty response.' },
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(candidateText);
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'AI_SCHEMA_VALIDATION_ERROR', message: 'AI returned invalid JSON.' },
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const validatedData = validateAndNormalizeEdgeIntent(parsedData);
      return new Response(
        JSON.stringify({
          success: true,
          provider: `Google Gemini (${usedModel} via Supabase Edge)`,
          data: validatedData,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (validationErr: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'AI_SCHEMA_VALIDATION_ERROR',
            message: validationErr?.message || 'AI output failed schema validation.',
          },
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: isTimeout ? 'TIMEOUT' : 'SERVER_ERROR',
          message: isTimeout
            ? 'AI request timed out. Please try again with a shorter message.'
            : 'Internal server error while parsing kitchen intent.',
        },
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
