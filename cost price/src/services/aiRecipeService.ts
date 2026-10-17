/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Client-side service to communicate with the secure AI parsing endpoint.
 * Never handles or requires LLM API keys on the frontend.
 */

import supabase from '../supabaseClient';
import { RawAIParsedRecipe } from '../server/ai/types';

export interface ParseRecipeResult {
  recipe: RawAIParsedRecipe;
  provider: string;
}

export async function parseRecipeFromNaturalLanguage(recipeText: string): Promise<ParseRecipeResult> {
  const trimmed = recipeText.trim();
  if (!trimmed) {
    throw new Error('Please enter a recipe description before parsing.');
  }

  let localAuthError: string | null = null;

  // 1. Try local server-side endpoint first (/api/parse-recipe)
  try {
    const localRes = await fetch('/api/parse-recipe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipeText: trimmed }),
    });

    if (localRes.ok) {
      const data = await localRes.json();
      if (data.success && data.data) {
        return { recipe: data.data, provider: data.provider || 'AI' };
      }
      throw new Error(data?.error?.message || 'Invalid response from parsing service.');
    } else if (localRes.status === 404) {
      // 404 indicates local endpoint is not present (production static hosting).
      // Fall through to Supabase Edge Function below.
    } else {
      const errorJson = await localRes.json().catch(() => null);
      if (errorJson?.error?.code === 'AUTH_ERROR') {
        // Local server has no API key; record message and check if Supabase Edge Function is configured
        localAuthError = errorJson.error.message;
      } else {
        // Legitimate provider/input failure (e.g. 400, 413, 429, 500, 504)
        // Must throw immediately to prevent duplicate requests to Supabase!
        throw new Error(errorJson?.error?.message || `AI parsing request failed with status ${localRes.status}.`);
      }
    }
  } catch (err: any) {
    if (err.name === 'TypeError' || err.message?.includes('Failed to fetch')) {
      // Network unreachable or not hosted locally; proceed to Supabase fallback
    } else {
      // Real provider error, rate limit, timeout, or input error: rethrow immediately!
      throw err;
    }
  }

  // 2. Fallback to Supabase Edge Function if in production or configured
  try {
    const { data, error } = await supabase.functions.invoke('parse-recipe', {
      body: { recipeText: trimmed },
    });

    if (error) {
      throw new Error(error.message || 'Failed to call Supabase Edge Function.');
    }

    if (data?.success && data?.data) {
      return { recipe: data.data, provider: data.provider || 'Supabase AI Edge' };
    }

    if (data?.error?.message) {
      throw new Error(data.error.message);
    }
  } catch (err: any) {
    if (localAuthError) {
      throw new Error(
        `${localAuthError} If running locally, please restart "npm run dev" to load your updated .env file.`
      );
    }
    throw new Error(
      err?.message || 'Unable to parse recipe. Please ensure GEMINI_API_KEY is configured on the server.'
    );
  }

  throw new Error('No response received from the recipe parsing service.');
}
