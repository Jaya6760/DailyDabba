/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { AIRecipeParserProvider, AIProviderConfig, RawAIParsedRecipe } from './types';
import { validateAIParsedRecipe } from './schema';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 20000; // 20 seconds
const MAX_OUTPUT_TOKENS = 2048;

const PARSER_SYSTEM_INSTRUCTION = `You are a professional culinary recipe parser for a commercial cloud kitchen costing engine.
Your single responsibility is to interpret natural-language recipe descriptions and extract structured recipe parameters.

CRITICAL RULES:
1. Do NOT calculate recipe costs, prices, or ingredient expenses.
2. Do NOT invent prices or purchase pack sizes.
3. Do NOT assume unverified conversions:
   - Do NOT assume counted items like "one onion" have a fixed gram weight unless stated. Set quantity=1, unit="piece", isAmbiguous=true, and explain why.
   - Do NOT assume volume-to-weight conversions (e.g. tablespoons or cups to grams). Preserve the user's unit as entered (e.g., unit="tbsp", unit="cup") and flag as requiring user confirmation.
   - For teaspoon measurements, set unit="tsp" and do NOT assume a gram weight.
4. Extract cooking time in minutes if mentioned. If absent, set cookingTimeMins=null.
5. Extract final yield and whether it is weight (grams) or pieces. If absent, set yieldAmount=null, yieldType="unknown".
6. Return only the requested structured JSON.
`;

export class GeminiRecipeParserProvider implements AIRecipeParserProvider {
  readonly providerName = 'Google Gemini';

  async parseRecipe(rawText: string, config?: Partial<AIProviderConfig>): Promise<RawAIParsedRecipe> {
    let apiKey = config?.apiKey || process.env.GEMINI_API_KEY;

    // Direct fallback if process.env was not populated by runner
    if (!apiKey && typeof process !== 'undefined') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const envPath = path.resolve(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
          if (match) {
            apiKey = match[1].trim();
            process.env.GEMINI_API_KEY = apiKey;
          }
        }
      } catch {
        // ignore
      }
    }

    if (!apiKey || !apiKey.trim()) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    const modelName = config?.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const timeoutMs = config?.timeoutMs || DEFAULT_TIMEOUT_MS;

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const prompt = `Please extract structured recipe data from the following natural language recipe description:\n\n"""\n${rawText.trim()}\n"""`;

    const generatePromise = (async () => {
      try {
        return await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction: PARSER_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: Type.OBJECT,
              properties: {
                recipeName: { type: Type.STRING, description: 'Title or dish name of the recipe' },
                description: { type: Type.STRING, description: 'Brief description of the dish if mentioned' },
                cookingTimeMins: { type: Type.NUMBER, description: 'Cooking or preparation time in minutes' },
                yieldAmount: { type: Type.NUMBER, description: 'Final cooked yield amount (weight or piece count)' },
                yieldType: {
                  type: Type.STRING,
                  enum: ['weight', 'piece', 'serving', 'unknown'],
                  description: 'Type of yield: weight (grams/kg), piece (count), or serving',
                },
                ingredients: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: 'Ingredient name (e.g., Poha, Onion, Turmeric, Salt)' },
                      quantity: { type: Type.NUMBER, description: 'Numeric quantity entered (null if unstated or unknown)' },
                      unit: { type: Type.STRING, description: 'Raw unit as entered (e.g. g, kg, ml, litre, tsp, tbsp, piece, cup)' },
                      originalText: { type: Type.STRING, description: 'Verbatim phrase from the text (e.g. "one medium onion")' },
                      notes: { type: Type.STRING, description: 'Preparation notes (e.g. chopped, diced, roasted)' },
                      isAmbiguous: { type: Type.BOOLEAN, description: 'True if quantity or unit needs user clarification' },
                      ambiguityReason: { type: Type.STRING, description: 'Explanation if ambiguous' },
                    },
                    required: ['name', 'unit', 'originalText', 'isAmbiguous'],
                  },
                  description: 'List of raw ingredients used in the recipe',
                },
                cookingSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Cooking instructions in sequential order if provided',
                },
                unresolvedNotes: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Any missing, ambiguous, or unstated items that require kitchen attention',
                },
              },
              required: ['recipeName', 'ingredients'],
            },
            maxOutputTokens: config?.maxOutputTokens || MAX_OUTPUT_TOKENS,
            temperature: 0.1,
          },
        });
      } catch (err: any) {
        // If default model is unavailable, experiencing high demand (503), or not found, attempt graceful fallback
        const isTemporaryOrUnavailable =
          err?.status === 404 ||
          err?.status === 503 ||
          err?.message?.includes('not found') ||
          err?.message?.includes('high demand') ||
          err?.message?.includes('UNAVAILABLE') ||
          err?.message?.includes('RESOURCE_EXHAUSTED');

        if (modelName === DEFAULT_MODEL && isTemporaryOrUnavailable) {
          return await ai.models.generateContent({
            model: FALLBACK_MODEL,
            contents: prompt,
            config: {
              systemInstruction: PARSER_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              maxOutputTokens: config?.maxOutputTokens || MAX_OUTPUT_TOKENS,
              temperature: 0.1,
            },
          });
        }
        throw err;
      }
    })();

    // Enforce bounded timeout
    const response = await this.withTimeout(generatePromise, timeoutMs);

    const rawJsonText = response?.text;
    if (!rawJsonText || !rawJsonText.trim()) {
      throw new Error('Model returned an empty response.');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJsonText);
    } catch {
      throw new Error('Model output was not valid JSON.');
    }

    // Strict runtime validation using Zod
    return validateAIParsedRecipe(parsedJson);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`AI provider request timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutHandle);
    });
  }
}
