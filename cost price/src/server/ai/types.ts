/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawAIParsedIngredient, RawAIParsedRecipe } from './schema';
export type { RawAIParsedIngredient, RawAIParsedRecipe };

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface AIParseErrorResponse {
  error: {
    code: 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE' | 'AUTH_ERROR' | 'RATE_LIMIT' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'MALFORMED_OUTPUT';
    message: string;
    details?: string;
  };
}

export interface AIRecipeParserProvider {
  readonly providerName: string;
  parseRecipe(rawText: string, config?: Partial<AIProviderConfig>): Promise<RawAIParsedRecipe>;
}
