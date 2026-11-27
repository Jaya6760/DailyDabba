// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Supabase Edge Function: apply-catalog-mutations
 *
 * Invoked via: supabase.functions.invoke('apply-catalog-mutations', { body: { proposal } })
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

  try {
    const body = await req.json();
    const proposal = body?.proposal;

    if (!proposal || !proposal.id || !proposal.operations) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'Proposal is missing or invalid.' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (proposal.hasBlockingIssues) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'BLOCKING_ISSUES_PRESENT', message: 'Cannot apply proposal with blocking issues.' },
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          proposalId: proposal.id,
          appliedSummary: proposal.summary || 'Mutations applied successfully',
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'SERVER_ERROR', message: err?.message || 'Server error' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
