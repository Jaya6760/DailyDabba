/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIRecipeParserProvider, RawAIParsedRecipe } from './types';
import { GeminiRecipeParserProvider } from './geminiProvider';

export interface ParseRecipeRequest {
  recipeText: string;
}

export interface ParseRecipeSuccessResponse {
  success: true;
  provider: string;
  data: RawAIParsedRecipe;
}

export interface ParseRecipeErrorResponse {
  success: false;
  error: {
    code: 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE' | 'AUTH_ERROR' | 'RATE_LIMIT' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'MALFORMED_OUTPUT';
    message: string;
  };
}

export type ParseRecipeResponse = ParseRecipeSuccessResponse | ParseRecipeErrorResponse;

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB max input
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 req/min

// In-memory rate limiting tracker (per IP or client token)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

/**
 * Helper to prune expired entries and prevent unbounded memory growth.
 */
function pruneRateLimitMap(now: number) {
  if (rateLimitMap.size > 500) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }
}

export function resetRateLimitMap() {
  rateLimitMap.clear();
}

export async function handleParseRecipeRequest(
  body: unknown,
  clientIdentifier = 'default-client',
  provider: AIRecipeParserProvider = new GeminiRecipeParserProvider()
): Promise<{ status: number; body: ParseRecipeResponse }> {
  // 1. Rate limiting check
  const now = Date.now();
  pruneRateLimitMap(now);

  const clientLimit = rateLimitMap.get(clientIdentifier);
  if (!clientLimit || now - clientLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(clientIdentifier, { count: 1, windowStart: now });
  } else {
    clientLimit.count += 1;
    if (clientLimit.count > MAX_REQUESTS_PER_WINDOW) {
      return {
        status: 429,
        body: {
          success: false,
          error: {
            code: 'RATE_LIMIT',
            message: 'Too many recipe parsing requests. Please wait a moment and try again.',
          },
        },
      };
    }
  }

  // 2. Input validation
  if (!body || typeof body !== 'object' || !('recipeText' in body)) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body must be a JSON object with a "recipeText" string.',
        },
      },
    };
  }

  const { recipeText } = body as ParseRecipeRequest;

  if (typeof recipeText !== 'string' || !recipeText.trim()) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Recipe text cannot be empty.',
        },
      },
    };
  }

  // Request size limit (cross-platform byte length)
  const byteLength = typeof Buffer !== 'undefined'
    ? Buffer.byteLength(recipeText, 'utf8')
    : new TextEncoder().encode(recipeText).length;

  if (byteLength > MAX_PAYLOAD_BYTES) {
    return {
      status: 413,
      body: {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Recipe text exceeds the 16KB limit. Please provide a shorter recipe description.',
        },
      },
    };
  }

  // 3. Invoke provider
  try {
    const parsed = await provider.parseRecipe(recipeText);
    return {
      status: 200,
      body: {
        success: true,
        provider: provider.providerName,
        data: parsed,
      },
    };
  } catch (err: any) {
    console.error('[AI Recipe Parser Error]:', err?.message || err);
    const errMsg = err?.message || 'Unknown provider error';
    const isZodError = err?.name === 'ZodError' || Array.isArray(err?.issues);

    if (errMsg.includes('API_KEY is not configured')) {
      return {
        status: 503,
        body: {
          success: false,
          error: {
            code: 'AUTH_ERROR',
            message: 'AI recipe parsing service is not configured with an API key on the server.',
          },
        },
      };
    }

    if (errMsg.includes('timed out')) {
      return {
        status: 504,
        body: {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: 'AI recipe parsing timed out. Please try again with a simpler description.',
          },
        },
      };
    }

    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      return {
        status: 429,
        body: {
          success: false,
          error: {
            code: 'RATE_LIMIT',
            message: 'AI service rate limit or quota exceeded. Please try again later.',
          },
        },
      };
    }

    if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE')) {
      return {
        status: 503,
        body: {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: 'AI model is currently experiencing high demand. Please try again in a few moments.',
          },
        },
      };
    }

    if (isZodError || errMsg.includes('valid JSON') || errMsg.includes('Zod') || errMsg.includes('schema')) {
      return {
        status: 502,
        body: {
          success: false,
          error: {
            code: 'MALFORMED_OUTPUT',
            message: 'AI returned an unparseable response. Please verify the recipe format and try again.',
          },
        },
      };
    }

    // Default safe provider error (never exposes stack traces or keys)
    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Unable to parse recipe at this time. Please enter manually or try again.',
        },
      },
    };
  }
}
