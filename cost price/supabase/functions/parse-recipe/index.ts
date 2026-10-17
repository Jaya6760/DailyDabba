// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Supabase Edge Function: parse-recipe
 *
 * Invoked via: supabase.functions.invoke('parse-recipe', { body: { recipeText } })
 * Secrets required in Supabase Vault: GEMINI_API_KEY
 */

// Ambient declarations for Deno runtime when inspected by Node IDE
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

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB max input

const PARSER_SYSTEM_INSTRUCTION = `You are a professional culinary recipe parser for a commercial cloud kitchen costing engine.
Your single responsibility is to interpret natural-language recipe descriptions and extract structured recipe parameters.

CRITICAL RULES:
1. Do NOT calculate recipe costs, prices, or ingredient expenses.
2. Do NOT invent prices or purchase pack sizes.
3. Do NOT assume unverified conversions:
   - Counted items like "one onion" must set quantity=1, unit="piece", isAmbiguous=true.
   - For volume measurements like tablespoons or cups, preserve unit as "tbsp" or "cup".
   - For teaspoon measurements, set unit="tsp" and do NOT assume a gram weight.
4. Extract cooking time in minutes if mentioned. If absent, set cookingTimeMins=null.
5. Extract final yield and whether it is weight (grams) or pieces. If absent, set yieldAmount=null, yieldType="unknown".
6. Return only the requested structured JSON.`;

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
    const recipeText = body?.recipeText;

    if (!recipeText || typeof recipeText !== 'string' || !recipeText.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'Recipe text cannot be empty.' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new TextEncoder().encode(recipeText).length > MAX_PAYLOAD_BYTES) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Recipe text exceeds the 16KB limit.' },
        }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Gemini API via fetch with x-goog-api-key header (prevents key exposure in URL query strings)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const payload = {
      system_instruction: { parts: [{ text: PARSER_SYSTEM_INSTRUCTION }] },
      contents: [{ parts: [{ text: `Extract structured recipe parameters from:\n\n${recipeText.trim()}` }] }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1,
        max_output_tokens: 2048,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!apiRes.ok) {
      const status = apiRes.status === 429 ? 429 : 502;
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: apiRes.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR',
            message: apiRes.status === 429 ? 'AI rate limit exceeded. Please try again later.' : 'AI provider returned an error.',
          },
        }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resJson = await apiRes.json();
    const rawContent = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error('Empty model output');
    }

    // Clean any markdown wrapper if present
    let cleanContent = rawContent.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    const parsedData = JSON.parse(cleanContent);
    if (!parsedData || typeof parsedData !== 'object' || !parsedData.recipeName || !Array.isArray(parsedData.ingredients)) {
      throw new Error('Model output missing required recipe structure');
    }

    if (typeof parsedData.yieldType === 'string') {
      const norm = parsedData.yieldType.trim().toLowerCase();
      if (norm === 'piece' || norm === 'pieces' || norm === 'pcs' || norm === 'count') {
        parsedData.yieldType = 'piece';
      } else if (norm === 'weight' || norm === 'g' || norm === 'gram' || norm === 'grams' || norm === 'kg') {
        parsedData.yieldType = 'weight';
      } else if (norm === 'serving' || norm === 'servings' || norm === 'portion' || norm === 'portions') {
        parsedData.yieldType = 'serving';
      } else {
        parsedData.yieldType = 'unknown';
      }
    }

    return new Response(
      JSON.stringify({ success: true, provider: 'Google Gemini (Supabase Edge)', data: parsedData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: isTimeout ? 'TIMEOUT' : 'PROVIDER_ERROR',
          message: isTimeout ? 'AI request timed out. Please try again.' : 'Internal parsing error.',
        },
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
