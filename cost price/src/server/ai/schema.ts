/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const YieldTypeSchema = z.preprocess((val) => {
  if (typeof val !== 'string') return 'unknown';
  const norm = val.trim().toLowerCase();
  if (norm === 'piece' || norm === 'pieces' || norm === 'pcs' || norm === 'count') return 'piece';
  if (norm === 'weight' || norm === 'g' || norm === 'gram' || norm === 'grams' || norm === 'kg') return 'weight';
  if (norm === 'serving' || norm === 'servings' || norm === 'portion' || norm === 'portions') return 'serving';
  if (norm === 'unknown') return 'unknown';
  return 'unknown';
}, z.enum(['weight', 'piece', 'serving', 'unknown']).default('unknown'));

export const RawAIParsedIngredientSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name cannot be empty'),
  quantity: z
    .number()
    .positive('Quantity must be greater than zero')
    .finite('Quantity must be a finite number')
    .nullable()
    .describe('Parsed numerical quantity or null if unstated or ambiguous'),
  unit: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) => val ?? '')
    .default('')
    .describe('Raw unit as extracted from user input (e.g. g, kg, ml, litre, tsp, tbsp, piece, cup)'),
  originalText: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) => val ?? '')
    .default('')
    .describe('Original phrase from the user description for transparency'),
  notes: z.string().trim().nullable().optional().default(null).describe('Optional preparation notes (e.g. chopped, roasted)'),
  isAmbiguous: z.boolean().optional().default(false).describe('True if quantity or unit is ambiguous or count-based without weight'),
  ambiguityReason: z.string().trim().nullable().optional().default(null),
});

export const RawAIParsedRecipeSchema = z.object({
  recipeName: z.string().trim().min(1, 'Recipe name cannot be empty'),
  description: z.string().trim().nullable().optional().default(null),
  cookingTimeMins: z
    .number()
    .min(0, 'Cooking time cannot be negative')
    .finite('Cooking time must be a finite number')
    .nullable()
    .optional()
    .default(null)
    .describe('Cooking time in minutes or null if not specified'),
  yieldAmount: z
    .number()
    .positive('Yield amount must be greater than zero')
    .finite('Yield amount must be a finite number')
    .nullable()
    .optional()
    .default(null)
    .describe('Numerical yield or null if not specified'),
  yieldType: YieldTypeSchema.describe('Type of yield specified'),
  ingredients: z
    .array(RawAIParsedIngredientSchema)
    .min(1, 'Recipe must contain at least one extracted ingredient'),
  cookingSteps: z
    .array(z.string().trim())
    .nullable()
    .optional()
    .transform((val) => val ?? [])
    .default([]),
  unresolvedNotes: z
    .array(z.string().trim())
    .nullable()
    .optional()
    .transform((val) => val ?? [])
    .default([]),
});

export type RawAIParsedIngredient = z.infer<typeof RawAIParsedIngredientSchema>;
export type RawAIParsedRecipe = z.infer<typeof RawAIParsedRecipeSchema>;

/**
 * Validates and cleans untrusted model JSON output.
 * Throws a formatted error if the model produced invalid or malicious values.
 */
export function validateAIParsedRecipe(data: unknown): RawAIParsedRecipe {
  return RawAIParsedRecipeSchema.parse(data);
}
