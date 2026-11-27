/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Zod schemas for unrestricted culinary natural-language intent parsing.
 */

import { z } from 'zod';

export const YieldTypeEnum = z.enum(['weight', 'piece', 'serving', 'unknown']);

export const FractionalQuantitySchema = z.preprocess((val) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim();
    if (!clean) return null;
    // Check fractional format "1/2", "1/4", "1/5", "1/3", "2 1/2"
    if (clean.includes('/')) {
      const parts = clean.split(/\s+/);
      if (parts.length === 2) {
        const whole = parseFloat(parts[0]);
        const fracParts = parts[1].split('/');
        if (fracParts.length === 2) {
          const num = parseFloat(fracParts[0]);
          const den = parseFloat(fracParts[1]);
          if (!isNaN(whole) && !isNaN(num) && !isNaN(den) && den !== 0) {
            return whole + num / den;
          }
        }
      } else if (parts.length === 1) {
        const fracParts = clean.split('/');
        if (fracParts.length === 2) {
          const num = parseFloat(fracParts[0]);
          const den = parseFloat(fracParts[1]);
          if (!isNaN(num) && !isNaN(den) && den !== 0) {
            return num / den;
          }
        }
      }
    }
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}, z.number().positive().finite().nullable().default(null));

/**
 * Schema specifically for recipe yieldAmount:
 * If the LLM emits 0 (or "0") as a placeholder when the user did not specify a recipe yield,
 * normalize it to null so the validation engine can generate a MISSING_YIELD clarification.
 * Negative yields (-5) or explicitly invalid values are NOT normalized to null and will be rejected.
 */
export const RecipeYieldAmountSchema = z.preprocess((val) => {
  if (val === 0) return null;
  if (typeof val === 'string' && val.trim() === '0') return null;
  return val;
}, FractionalQuantitySchema);

export const IntentParsedIngredientSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name cannot be empty'),
  quantity: FractionalQuantitySchema.optional(),
  rawQuantity: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  originalText: z.string().trim().optional(),
  notes: z.string().trim().nullable().optional(),
  isAmbiguous: z.boolean().optional(),
  ambiguityReason: z.string().trim().nullable().optional(),
});

export class AISchemaValidationError extends Error {
  public readonly issues: any[];
  public readonly receivedType: string;

  constructor(message: string, issues: any[] = [], receivedType = 'unknown') {
    super(message);
    this.name = 'AISchemaValidationError';
    this.issues = issues;
    this.receivedType = receivedType;
  }
}

export const IntentParsedRecipeSchema = z.preprocess((val: unknown) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    const resolvedName =
      (typeof obj.recipeName === 'string' && obj.recipeName.trim()) ||
      (typeof obj.name === 'string' && obj.name.trim()) ||
      (typeof obj.title === 'string' && obj.title.trim()) ||
      (typeof obj.dishName === 'string' && obj.dishName.trim()) ||
      (typeof obj.recipe_name === 'string' && obj.recipe_name.trim()) ||
      obj.recipeName;

    return {
      ...obj,
      recipeName: resolvedName,
    };
  }
  return val;
}, z.object({
  recipeName: z.string().trim().min(1, 'Recipe name cannot be empty'),
  description: z.string().trim().nullable().optional(),
  cookingTimeMins: z.number().min(0).finite().nullable().optional(),
  yieldAmount: RecipeYieldAmountSchema.optional(),
  rawYieldAmount: z.string().trim().optional(),
  yieldType: YieldTypeEnum.optional().default('unknown'),
  ingredients: z.array(IntentParsedIngredientSchema).default([]),
  unresolvedNotes: z.array(z.string().trim()).default([]),
}));

export const IntentIngredientMutationSchema = z.object({
  name: z.string().trim().min(1),
  purchaseQty: z.number().positive().finite().optional(),
  purchaseUnit: z.enum(['kg', 'g', 'litre', 'ml']).optional(),
  purchaseCost: z.number().min(0).finite().optional(),
  costPerUnit: z.number().min(0).finite().optional(),
  notes: z.string().trim().optional(),
});

export const IntentConversionMutationSchema = z.object({
  name: z.string().trim().min(1),
  weightGrams: z.number().positive().finite(),
});

export const IntentGasMutationSchema = z.object({
  cylinderPrice: z.number().positive().finite().optional(),
  cylinderWeightKg: z.number().positive().finite().optional(),
  consumptionRateKgHour: z.number().positive().finite().optional(),
});

export const IntentClarificationAnswerSchema = z.object({
  targetEntity: z.string().trim().describe('Target ingredient name, recipe field, or conversion name'),
  field: z.string().trim().describe('Field being resolved, e.g. "purchasePrice", "purchaseCost", "tspWeightGrams", "weightGrams", "quantity", "yieldAmount", "ingredientName"'),
  value: z.union([z.string(), z.number()]).optional(),
  unit: z.string().trim().optional(),
  purchaseQty: z.number().positive().finite().optional(),
  purchaseUnit: z.enum(['kg', 'g', 'litre', 'ml']).optional(),
});

export const UniversalKitchenIntentSchema = z.object({
  detectedIntent: z.enum([
    'RECIPE_CREATION',
    'INGREDIENT_MUTATION',
    'GAS_MUTATION',
    'CONVERSION_MUTATION',
    'CLARIFICATION_ANSWER',
    'COMPOUND',
    'UNKNOWN',
  ]).default('UNKNOWN'),
  recipes: z.array(IntentParsedRecipeSchema).default([]),
  ingredientCreations: z.array(IntentIngredientMutationSchema).default([]),
  ingredientUpdates: z.array(IntentIngredientMutationSchema).default([]),
  conversionUpdates: z.array(IntentConversionMutationSchema).default([]),
  gasConfigUpdate: IntentGasMutationSchema.nullable().optional(),
  clarificationAnswers: z.array(IntentClarificationAnswerSchema).default([]),
  userFacingExplanation: z.string().trim().optional(),
  unresolvedNotes: z.array(z.string().trim()).default([]),
});

export type IntentParsedIngredient = z.infer<typeof IntentParsedIngredientSchema>;
export type IntentParsedRecipe = z.infer<typeof IntentParsedRecipeSchema>;
export type IntentIngredientMutation = z.infer<typeof IntentIngredientMutationSchema>;
export type IntentConversionMutation = z.infer<typeof IntentConversionMutationSchema>;
export type IntentGasMutation = z.infer<typeof IntentGasMutationSchema>;
export type IntentClarificationAnswer = z.infer<typeof IntentClarificationAnswerSchema>;
export type UniversalKitchenIntent = z.infer<typeof UniversalKitchenIntentSchema>;

export function validateUniversalKitchenIntent(data: unknown): UniversalKitchenIntent {
  if (Array.isArray(data)) {
    throw new AISchemaValidationError(
      'AI returned a root array instead of the required UniversalKitchenIntent object with detectedIntent and category collections.',
      [
        {
          code: z.ZodIssueCode.invalid_type,
          expected: 'object',
          path: [],
          message: 'Root-level intent must be a JSON object, but received an array.',
        },
      ],
      'array'
    );
  }

  const result = UniversalKitchenIntentSchema.safeParse(data);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');

    throw new AISchemaValidationError(
      `AI output failed schema validation: ${errorDetails}`,
      result.error.issues,
      typeof data
    );
  }

  return result.data;
}
