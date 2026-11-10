/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Server-side request handler for Universal Kitchen Intent parsing with rate limiting & error shielding.
 */

import { GeminiUniversalIntentParser } from './intentParser';
import { UniversalKitchenIntent, AISchemaValidationError } from './intentSchema';

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB max input
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 req/min

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function pruneRateLimitMap(now: number) {
  if (rateLimitMap.size > 500) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }
}

export interface ParseKitchenIntentRequest {
  message: string;
  history?: Array<{ role: 'user' | 'model'; content: string }>;
}

export interface ParseKitchenIntentResponse {
  success: boolean;
  provider?: string;
  data?: UniversalKitchenIntent;
  error?: {
    code: string;
    message: string;
  };
}

export async function handleParseKitchenIntentRequest(
  body: unknown,
  clientIdentifier = 'default-client',
  parser = new GeminiUniversalIntentParser()
): Promise<{ status: number; body: ParseKitchenIntentResponse }> {
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
            message: 'Too many kitchen intent parsing requests. Please wait a moment and try again.',
          },
        },
      };
    }
  }

  if (!body || typeof body !== 'object' || !('message' in body)) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body must be a JSON object with a "message" string.',
        },
      },
    };
  }

  const { message, history } = body as ParseKitchenIntentRequest;

  if (typeof message !== 'string' || !message.trim()) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Message cannot be empty.',
        },
      },
    };
  }

  const byteLength = typeof Buffer !== 'undefined'
    ? Buffer.byteLength(message, 'utf8')
    : new TextEncoder().encode(message).length;

  if (byteLength > MAX_PAYLOAD_BYTES) {
    return {
      status: 413,
      body: {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Message exceeds the 16KB limit. Please provide a shorter message.',
        },
      },
    };
  }

  try {
    const parsed = await parser.parseIntent(message, history || []);
    return {
      status: 200,
      body: {
        success: true,
        provider: 'Google Gemini 3.8 Flash',
        data: parsed,
      },
    };
  } catch (err: any) {
    console.error('[AI Kitchen Intent Parser Error]:', err?.message || err);
    const errMsg = err?.message || '';

    if (errMsg.includes('GEMINI_API_KEY is not configured')) {
      return {
        status: 503,
        body: {
          success: false,
          error: {
            code: 'AUTH_ERROR',
            message: 'GEMINI_API_KEY is not configured on the server.',
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
            message: 'AI request timed out. Please try again with a shorter message.',
          },
        },
      };
    }

    if (err instanceof AISchemaValidationError || err?.name === 'AISchemaValidationError') {
      return {
        status: 422,
        body: {
          success: false,
          error: {
            code: 'AI_SCHEMA_VALIDATION_ERROR',
            message: err.message,
          },
        },
      };
    }

    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Failed to parse natural language intent. Please try again.',
        },
      },
    };
  }
}
