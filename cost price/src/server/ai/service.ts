/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  AIChatRequest,
  AIChatResponse,
  ContextSnapshot,
} from './types';
import { geminiToolDeclarations, ToolExecutor } from './tools';

// Helper to retrieve API key securely on backend
export function getGeminiApiKey(): string | null {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }

  // Fallback to checking .env or .env.local in current or parent working directory
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../.env'),
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  }

  return null;
}

const SYSTEM_INSTRUCTION = `You are the Daily Dabba Food Costing AI Assistant, specialized in commercial food costing, recipe yields, raw material rates, and cooking fuel expenditure.

CRITICAL RULES:
1. MATHEMATICAL FORMULAS: NEVER calculate, estimate, or extrapolate costs or arithmetic yourself. ALWAYS invoke the provided tools:
   - "calculate_recipe_cost" for costing existing or modified dishes
   - "propose_save_recipe" for creating or updating recipes
   - "propose_add_ingredient" or "propose_update_ingredient" for ingredient pricing
   - "propose_gas_config" for LPG fuel parameter changes
   - "propose_conversion" for teaspoon weights
   - "search_records" to find existing dishes or materials
2. NO INVENTED VALUES: Never make up ingredient prices, conversions, yields, or cooking times. If an ingredient price is not in master inventory, explicitly state that its price is missing and ask the user to provide purchase price and pack size (e.g., "₹30 for 500ml").
3. DEFAULTS & CLARIFICATIONS:
   - If a recipe uses teaspoons (tsp) and lacks a custom gram conversion, inform the user that the standard fallback is 4 grams per tsp. Ask if they want to accept this default or specify custom grams.
   - If serving portion size is missing, state default 100g (or 1 piece).
   - If cooking time is missing, suggest default 10 minutes or ask for cook duration.
4. CONFIRMATION BEFORE MUTATIONS: Any database change (saving recipe, updating prices, adding materials, gas config) MUST be prepared via the corresponding "propose_*" tool. The frontend displays an interactive confirmation card for the user to review and confirm.
5. CONCISE, PROFESSIONAL TONE: Provide clear, structured responses with rupee values (₹) and units (g, ml, tsp).`;

export async function processAIChat(request: AIChatRequest): Promise<AIChatResponse> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the backend. Please set GEMINI_API_KEY in .env.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const toolExecutor = new ToolExecutor(request.contextSnapshot);

  // Initialize conversation steps for Interactions API
  const steps: any[] = [];

  // Add system instruction as developer input or first context step if supported
  steps.push({
    type: 'user_input',
    content: [
      {
        type: 'text',
        text: `[SYSTEM CONTEXT]\n${SYSTEM_INSTRUCTION}\n\n[USER REQUEST]\n${request.message}`,
      },
    ],
  });

  const sideEffects: Partial<AIChatResponse> = {};
  let finalReply = '';
  const MAX_TURNS = 5;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await ai.interactions.create({
      model: 'gemini-3.8-flash',
      input: steps,
      tools: geminiToolDeclarations as any,
    });

    const responseSteps = response.steps || [];
    steps.push(...responseSteps);

    const functionCalls = responseSteps.filter(s => s.type === 'function_call');

    if (functionCalls.length === 0) {
      // Model produced final text
      finalReply = response.output_text || '';
      break;
    }

    // Execute tool calls
    for (const call of functionCalls) {
      const toolName = call.name!;
      const toolArgs = call.arguments || {};
      const { result, sideEffects: callEffects } = toolExecutor.executeTool(toolName, toolArgs);

      if (callEffects) {
        if (callEffects.costBreakdown) sideEffects.costBreakdown = callEffects.costBreakdown;
        if (callEffects.proposedAction) sideEffects.proposedAction = callEffects.proposedAction;
        if (callEffects.clarifications) sideEffects.clarifications = callEffects.clarifications;
        if (callEffects.searchResults) sideEffects.searchResults = callEffects.searchResults;
      }

      steps.push({
        type: 'function_result',
        name: toolName,
        call_id: call.id,
        result: JSON.stringify(result),
      });
    }
  }

  return {
    reply: finalReply || 'I have processed your request with the backend CP engine.',
    costBreakdown: sideEffects.costBreakdown,
    proposedAction: sideEffects.proposedAction,
    clarifications: sideEffects.clarifications,
    searchResults: sideEffects.searchResults,
  };
}
