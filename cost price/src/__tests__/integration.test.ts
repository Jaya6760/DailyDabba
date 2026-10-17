/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { initialIngredients, initialConversions, initialGasConfig, initialRecipes } from '../data';
import { processAIChat } from '../server/ai/service';

test('Integration: processAIChat correctly handles natural language costing inquiry via Gemini 3.8 Flash', async () => {
  const contextSnapshot = {
    ingredients: initialIngredients,
    conversions: initialConversions,
    gasConfig: initialGasConfig,
    recipes: initialRecipes,
  };

  const response = await processAIChat({
    message: 'What is the cost of Jeera Poha per batch and per serving?',
    contextSnapshot,
  });

  console.log('AI Reply:', response.reply);
  assert.ok(response.reply.length > 0);
  assert.ok(response.costBreakdown);
  assert.equal(response.costBreakdown.recipe.name, 'Jeera Poha');
  assert.ok(response.costBreakdown.totalBatchCost > 0);
});
