/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe, RecipeIngredient } from '../../types';
import {
  ContextSnapshot,
  ProposedAction,
  ClarificationQuestion,
  AIChatResponse,
} from './types';
import {
  calculateGasCosts,
  getEffectiveQuantity,
  calculateRecipeCosts,
  calculateDefaultServingCost,
  getDefaultServingAmount,
  getDefaultServingUnit,
  getCostPerUnit,
  calculateIngredientChangeImpact,
  calculateGasChangeImpact,
} from './costingEngine';

// Gemini API Tool declarations
export const geminiToolDeclarations = [
  {
    type: 'function',
    name: 'search_records',
    description: 'Search across master ingredients, recipes, teaspoon conversions, and gas configuration.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword (e.g. ingredient name, recipe name, or measurement).',
        },
        category: {
          type: 'string',
          enum: ['all', 'ingredients', 'recipes', 'conversions', 'gas'],
          description: 'Category to search. Defaults to "all".',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'calculate_recipe_cost',
    description: 'Calculates the batch cost, per-serving cost, cost per 100g/piece, and ingredient breakdown for a recipe using exact backend mathematical formulas. Can also simulate hypothetical ingredient price changes.',
    parameters: {
      type: 'object',
      properties: {
        recipeName: {
          type: 'string',
          description: 'Name of the recipe to calculate cost for.',
        },
        portionAmount: {
          type: 'number',
          description: 'Optional custom serving amount (e.g., 150 grams or 2 pieces).',
        },
        ingredientPriceOverrides: {
          type: 'array',
          description: 'Optional simulated price changes for "what-if" calculations without modifying saved data.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Ingredient name' },
              simulatedPrice: { type: 'number', description: 'Simulated purchase cost in ₹' },
              purchaseQty: { type: 'number', description: 'Simulated purchase quantity (defaults to existing)' },
              purchaseUnit: { type: 'string', enum: ['kg', 'g', 'litre', 'ml'], description: 'Purchase unit' },
            },
            required: ['name', 'simulatedPrice'],
          },
        },
      },
      required: ['recipeName'],
    },
  },
  {
    type: 'function',
    name: 'propose_add_ingredient',
    description: 'Validates and prepares a new ingredient to be added to the master inventory. Requires user confirmation before saving.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the ingredient (e.g., "Amul Butter")' },
        purchaseQty: { type: 'number', description: 'Quantity purchased (e.g., 1 or 500)' },
        purchaseUnit: {
          type: 'string',
          enum: ['kg', 'g', 'litre', 'ml'],
          description: 'Unit of purchase: kg, g, litre, or ml',
        },
        purchaseCost: { type: 'number', description: 'Total purchase cost in ₹ (e.g., 550)' },
      },
      required: ['name', 'purchaseQty', 'purchaseUnit', 'purchaseCost'],
    },
  },
  {
    type: 'function',
    name: 'propose_update_ingredient',
    description: 'Validates and prepares an update to an existing ingredient price or packaging. Calculates exact cost impact on all affected recipes. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the existing ingredient to update' },
        purchaseCost: { type: 'number', description: 'New purchase cost in ₹' },
        purchaseQty: { type: 'number', description: 'Optional new purchase quantity' },
        purchaseUnit: {
          type: 'string',
          enum: ['kg', 'g', 'litre', 'ml'],
          description: 'Optional new purchase unit',
        },
      },
      required: ['name', 'purchaseCost'],
    },
  },
  {
    type: 'function',
    name: 'propose_conversion',
    description: 'Adds or updates a teaspoon (tsp) weight conversion in grams for an ingredient. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of ingredient to map (e.g., "Haldi" or "Sugar")' },
        weightGrams: { type: 'number', description: 'Weight in grams for 1 teaspoon (e.g., 3.5)' },
      },
      required: ['name', 'weightGrams'],
    },
  },
  {
    type: 'function',
    name: 'propose_gas_config',
    description: 'Updates cooking gas (LPG) parameters. Calculates new cost per minute/hour and impact across all recipes. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        cylinderPrice: { type: 'number', description: 'LPG cylinder price in ₹ (e.g. 980)' },
        cylinderWeightKg: { type: 'number', description: 'Cylinder net weight in kg (e.g. 14.2)' },
        consumptionRateKgHour: { type: 'number', description: 'Burner consumption rate in kg/hour (e.g. 0.25)' },
      },
    },
  },
  {
    type: 'function',
    name: 'propose_save_recipe',
    description: 'Validates and prepares a recipe to be saved (created or updated). Checks all ingredients in master inventory, checks teaspoon conversions, asks clarification for missing prices, and calculates exact costs. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Dish / Recipe name' },
        yieldType: { type: 'string', enum: ['weight', 'piece'], description: '"weight" (in grams) or "piece" (item count)' },
        yieldAmount: { type: 'number', description: 'Total cooked batch yield amount (e.g. 1200 grams or 10 pieces)' },
        cookingTimeMins: { type: 'number', description: 'Cooking time in minutes for gas calculation' },
        defaultServingAmount: { type: 'number', description: 'Default portion size per serving (e.g. 100g or 1 piece)' },
        ingredients: {
          type: 'array',
          description: 'List of ingredients in this recipe with quantities and units.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name of ingredient' },
              quantity: { type: 'number', description: 'Quantity used in recipe' },
              unit: { type: 'string', enum: ['g', 'kg', 'ml', 'litre', 'tsp'], description: 'Measurement unit' },
            },
            required: ['name', 'quantity', 'unit'],
          },
        },
      },
      required: ['name', 'yieldType', 'yieldAmount', 'cookingTimeMins', 'ingredients'],
    },
  },
  {
    type: 'function',
    name: 'request_clarification',
    description: 'Asks the user for missing or ambiguous information before proceeding (e.g. unknown ingredient prices, missing yields, or choosing between defaults vs custom values).',
    parameters: {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: 'Friendly explanation of what information is missing' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              field: { type: 'string' },
              defaultValue: { type: 'string', description: 'System default value if available' },
              defaultDescription: { type: 'string', description: 'Why this default exists' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                    isDefault: { type: 'boolean' },
                  },
                  required: ['label', 'value'],
                },
              },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['explanation', 'questions'],
    },
  },
];

// Implementation of tool executions
export class ToolExecutor {
  constructor(private context: ContextSnapshot) {}

  public updateContext(newContext: ContextSnapshot) {
    this.context = newContext;
  }

  public executeTool(
    name: string,
    args: any
  ): {
    result: any;
    sideEffects?: Partial<AIChatResponse>;
  } {
    switch (name) {
      case 'search_records':
        return this.searchRecords(args.query, args.category || 'all');
      case 'calculate_recipe_cost':
        return this.calculateRecipeCost(args.recipeName, args.portionAmount, args.ingredientPriceOverrides);
      case 'propose_add_ingredient':
        return this.proposeAddIngredient(args.name, args.purchaseQty, args.purchaseUnit, args.purchaseCost);
      case 'propose_update_ingredient':
        return this.proposeUpdateIngredient(args.name, args.purchaseCost, args.purchaseQty, args.purchaseUnit);
      case 'propose_conversion':
        return this.proposeConversion(args.name, args.weightGrams);
      case 'propose_gas_config':
        return this.proposeGasConfig(args.cylinderPrice, args.cylinderWeightKg, args.consumptionRateKgHour);
      case 'propose_save_recipe':
        return this.proposeSaveRecipe(args);
      case 'request_clarification':
        return this.requestClarification(args.explanation, args.questions);
      default:
        return {
          result: { error: `Unknown tool "${name}"` },
        };
    }
  }

  private searchRecords(query: string, category: string) {
    const q = (query || '').toLowerCase().trim();
    const results: {
      ingredients?: Ingredient[];
      recipes?: Recipe[];
      conversions?: TeaspoonConversion[];
      gasConfig?: GasConfig;
    } = {};

    if (category === 'all' || category === 'ingredients') {
      results.ingredients = this.context.ingredients.filter(i =>
        i.name.toLowerCase().includes(q)
      );
    }
    if (category === 'all' || category === 'recipes') {
      results.recipes = this.context.recipes.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.ingredients.some(ri => ri.name.toLowerCase().includes(q))
      );
    }
    if (category === 'all' || category === 'conversions') {
      results.conversions = this.context.conversions.filter(c =>
        c.name.toLowerCase().includes(q)
      );
    }
    if (category === 'all' || category === 'gas') {
      results.gasConfig = this.context.gasConfig;
    }

    const totalFound =
      (results.ingredients?.length || 0) +
      (results.recipes?.length || 0) +
      (results.conversions?.length || 0);

    return {
      result: {
        query,
        category,
        totalFound,
        results,
      },
      sideEffects: {
        searchResults: results,
      },
    };
  }

  private calculateRecipeCost(
    recipeName: string,
    portionAmount?: number,
    overrides?: Array<{ name: string; simulatedPrice: number; purchaseQty?: number; purchaseUnit?: string }>
  ) {
    const q = (recipeName || '').toLowerCase().trim();
    const recipe = this.context.recipes.find(r => r.name.toLowerCase().trim() === q) ||
      this.context.recipes.find(r => r.name.toLowerCase().includes(q));

    if (!recipe) {
      return {
        result: {
          error: `Recipe "${recipeName}" was not found in saved recipes.`,
          availableRecipes: this.context.recipes.map(r => r.name),
        },
      };
    }

    // Apply simulated price overrides if requested
    let ingredientsToUse = [...this.context.ingredients];
    if (overrides && overrides.length > 0) {
      for (const ov of overrides) {
        const ovName = ov.name.toLowerCase().trim();
        ingredientsToUse = ingredientsToUse.map(ing => {
          if (ing.name.toLowerCase().trim() === ovName) {
            const purchaseQty = ov.purchaseQty ?? ing.purchaseQty;
            const purchaseUnit = (ov.purchaseUnit as any) ?? ing.purchaseUnit;
            const costPerUnit = getCostPerUnit(purchaseQty, purchaseUnit, ov.simulatedPrice);
            return {
              ...ing,
              purchaseCost: ov.simulatedPrice,
              purchaseQty,
              purchaseUnit,
              costPerUnit,
            };
          }
          return ing;
        });
      }
    }

    const breakdown = calculateRecipeCosts(
      recipe,
      ingredientsToUse,
      this.context.conversions,
      this.context.gasConfig
    );

    const defaultServingAmt = portionAmount && portionAmount > 0
      ? portionAmount
      : getDefaultServingAmount(recipe);
    const defaultServingUnitLabel = getDefaultServingUnit(recipe);

    const servingCost = recipe.yieldAmount > 0
      ? (breakdown.totalBatchCost / recipe.yieldAmount) * defaultServingAmt
      : 0;

    const summary = {
      recipeName: recipe.name,
      yieldType: recipe.yieldType,
      yieldAmount: recipe.yieldAmount,
      cookingTimeMins: recipe.cookingTimeMins,
      servingPortion: `${defaultServingAmt} ${defaultServingUnitLabel}`,
      servingCostPrice: Number(servingCost.toFixed(2)),
      totalBatchCost: Number(breakdown.totalBatchCost.toFixed(2)),
      ingredientsCost: Number(breakdown.ingredientsCost.toFixed(2)),
      gasCost: Number(breakdown.gasCost.toFixed(2)),
      costPer100g: Number(breakdown.costPer100g.toFixed(2)),
      costPerPiece: Number(breakdown.costPerPiece.toFixed(2)),
      itemizedIngredients: breakdown.rows.map(r => ({
        name: r.recipeIngredient.name,
        recipeQty: `${r.recipeIngredient.quantity} ${r.recipeIngredient.unit}`,
        effectiveQty: `${r.effectiveQty} ${r.baseUnit}`,
        ratePerBaseUnit: `₹${r.ratePerBaseUnit.toFixed(4)}/${r.baseUnit}`,
        cost: Number(r.cost.toFixed(2)),
        isTsp: r.isTsp,
        isTspDefaultUsed: r.isTspDefaultUsed,
        conversionGrams: r.conversionGrams,
      })),
    };

    return {
      result: summary,
      sideEffects: {
        costBreakdown: breakdown,
      },
    };
  }

  private proposeAddIngredient(
    name: string,
    purchaseQty: number,
    purchaseUnit: 'kg' | 'g' | 'litre' | 'ml',
    purchaseCost: number
  ) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      return { result: { error: 'Ingredient name is required.' } };
    }
    if (purchaseQty <= 0 || purchaseCost <= 0) {
      return { result: { error: 'Quantity and cost must be positive numbers.' } };
    }

    const existing = this.context.ingredients.find(
      i => i.name.toLowerCase().trim() === trimmed.toLowerCase()
    );

    if (existing) {
      return {
        result: {
          duplicateDetected: true,
          message: `Ingredient "${existing.name}" already exists with price ₹${existing.purchaseCost} for ${existing.purchaseQty} ${existing.purchaseUnit}. Would you like to update its price instead?`,
          existingIngredient: existing,
        },
        sideEffects: {
          clarifications: [
            {
              id: `dup_${existing.id}`,
              question: `"${existing.name}" is already in inventory at ₹${existing.purchaseCost} per ${existing.purchaseQty} ${existing.purchaseUnit}. Do you want to update its price to ₹${purchaseCost}?`,
              options: [
                { label: `Update price to ₹${purchaseCost}`, value: 'update_price' },
                { label: 'Keep current price and cancel', value: 'cancel' },
              ],
            },
          ],
        },
      };
    }

    const costPerUnit = getCostPerUnit(purchaseQty, purchaseUnit, purchaseCost);
    const newIngredient: Ingredient = {
      id: `ing_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: trimmed,
      purchaseQty,
      purchaseUnit,
      purchaseCost,
      costPerUnit,
    };

    const action: ProposedAction = {
      id: `act_${Date.now()}`,
      type: 'ADD_INGREDIENT',
      title: `Add Ingredient: ${trimmed}`,
      summary: `Register "${trimmed}" at ₹${purchaseCost} for ${purchaseQty} ${purchaseUnit} (₹${(costPerUnit * (purchaseUnit === 'kg' || purchaseUnit === 'litre' ? 1000 : 1)).toFixed(2)}/${purchaseUnit}).`,
      requiresConfirmation: true,
      status: 'pending',
      payload: newIngredient,
      diff: [
        { field: 'name', label: 'Name', after: trimmed },
        { field: 'purchaseQty', label: 'Package Size', after: `${purchaseQty} ${purchaseUnit}` },
        { field: 'purchaseCost', label: 'Purchase Cost', after: `₹${purchaseCost}` },
        { field: 'costPerUnit', label: 'Base Rate', after: `₹${costPerUnit.toFixed(4)} per ${purchaseUnit === 'litre' || purchaseUnit === 'ml' ? 'ml' : 'g'}` },
      ],
    };

    return {
      result: {
        success: true,
        proposedAction: action,
        costPerBaseUnit: costPerUnit,
      },
      sideEffects: {
        proposedAction: action,
      },
    };
  }

  private proposeUpdateIngredient(
    name: string,
    purchaseCost: number,
    purchaseQty?: number,
    purchaseUnit?: 'kg' | 'g' | 'litre' | 'ml'
  ) {
    const trimmed = (name || '').trim();
    const existing = this.context.ingredients.find(
      i => i.name.toLowerCase().trim() === trimmed.toLowerCase()
    );

    if (!existing) {
      return {
        result: {
          error: `Ingredient "${trimmed}" was not found in inventory.`,
          message: `Would you like to register "${trimmed}" as a new ingredient?`,
        },
        sideEffects: {
          clarifications: [
            {
              id: 'not_found_add_new',
              question: `"${trimmed}" is not currently in master inventory. Add it as a new ingredient for ₹${purchaseCost}?`,
              options: [
                { label: `Add "${trimmed}" as new ingredient`, value: 'add_new' },
                { label: 'Cancel', value: 'cancel' },
              ],
            },
          ],
        },
      };
    }

    const newQty = purchaseQty ?? existing.purchaseQty;
    const newUnit = purchaseUnit ?? existing.purchaseUnit;
    const newCostPerUnit = getCostPerUnit(newQty, newUnit, purchaseCost);

    const affectedRecipes = calculateIngredientChangeImpact(
      existing.id,
      newCostPerUnit,
      this.context
    );

    const updatedIngredient: Ingredient = {
      ...existing,
      purchaseCost,
      purchaseQty: newQty,
      purchaseUnit: newUnit,
      costPerUnit: newCostPerUnit,
    };

    const action: ProposedAction = {
      id: `act_${Date.now()}`,
      type: 'UPDATE_INGREDIENT',
      title: `Update Price: ${existing.name}`,
      summary: `Update "${existing.name}" price from ₹${existing.purchaseCost} to ₹${purchaseCost} for ${newQty} ${newUnit}.`,
      requiresConfirmation: true,
      status: 'pending',
      payload: updatedIngredient,
      diff: [
        { field: 'purchaseCost', label: 'Purchase Cost', before: `₹${existing.purchaseCost}`, after: `₹${purchaseCost}` },
        { field: 'costPerUnit', label: 'Base Rate', before: `₹${existing.costPerUnit.toFixed(4)}/base`, after: `₹${newCostPerUnit.toFixed(4)}/base` },
      ],
      impactSummary: affectedRecipes.length > 0
        ? `${affectedRecipes.length} recipe(s) (${affectedRecipes.map(r => r.recipeName).join(', ')}) will automatically recalculate.`
        : 'No existing recipes currently use this ingredient.',
      affectedRecipes,
    };

    return {
      result: {
        success: true,
        proposedAction: action,
        affectedRecipesCount: affectedRecipes.length,
        affectedRecipes,
      },
      sideEffects: {
        proposedAction: action,
      },
    };
  }

  private proposeConversion(name: string, weightGrams: number) {
    const trimmed = (name || '').trim();
    if (weightGrams <= 0) {
      return { result: { error: 'Teaspoon weight must be greater than 0 grams.' } };
    }

    const existing = this.context.conversions.find(
      c => c.name.toLowerCase().trim() === trimmed.toLowerCase()
    );

    const conversionItem: TeaspoonConversion = {
      id: existing ? existing.id : `conv_${Date.now()}`,
      name: trimmed,
      weightGrams,
    };

    const action: ProposedAction = {
      id: `act_${Date.now()}`,
      type: 'SAVE_CONVERSION',
      title: `${existing ? 'Update' : 'Add'} tsp Weight: ${trimmed}`,
      summary: `Set 1 teaspoon (tsp) of "${trimmed}" to ${weightGrams}g (default fallback is 4g).`,
      requiresConfirmation: true,
      status: 'pending',
      payload: conversionItem,
      diff: [
        {
          field: 'weightGrams',
          label: '1 tsp Gram Weight',
          before: existing ? `${existing.weightGrams}g` : '4g (System Default)',
          after: `${weightGrams}g`,
        },
      ],
    };

    return {
      result: {
        success: true,
        proposedAction: action,
      },
      sideEffects: {
        proposedAction: action,
      },
    };
  }

  private proposeGasConfig(
    cylinderPrice?: number,
    cylinderWeightKg?: number,
    consumptionRateKgHour?: number
  ) {
    const current = this.context.gasConfig;
    const newPrice = cylinderPrice ?? current.cylinderPrice;
    const newWeight = cylinderWeightKg ?? current.cylinderWeightKg;
    const newRate = consumptionRateKgHour ?? current.consumptionRateKgHour;

    if (newPrice <= 0 || newWeight <= 0 || newRate <= 0) {
      return { result: { error: 'Gas config values must be positive.' } };
    }

    const newConfig: GasConfig = {
      cylinderPrice: newPrice,
      cylinderWeightKg: newWeight,
      consumptionRateKgHour: newRate,
    };

    const oldGas = calculateGasCosts(current);
    const newGas = calculateGasCosts(newConfig);
    const affectedRecipes = calculateGasChangeImpact(newConfig, this.context);

    const action: ProposedAction = {
      id: `act_${Date.now()}`,
      type: 'UPDATE_GAS_CONFIG',
      title: 'Update Gas Configuration',
      summary: `Update cylinder price to ₹${newPrice} (${newWeight}kg @ ${newRate}kg/h). Cooking gas rate changes from ₹${oldGas.costPerMinute.toFixed(4)}/min to ₹${newGas.costPerMinute.toFixed(4)}/min.`,
      requiresConfirmation: true,
      status: 'pending',
      payload: newConfig,
      diff: [
        { field: 'cylinderPrice', label: 'Cylinder Price', before: `₹${current.cylinderPrice}`, after: `₹${newPrice}` },
        { field: 'costPerMinute', label: 'Fuel Cost / Minute', before: `₹${oldGas.costPerMinute.toFixed(4)}/min`, after: `₹${newGas.costPerMinute.toFixed(4)}/min` },
      ],
      impactSummary: `All ${affectedRecipes.length} recipes will automatically adjust their fuel costs.`,
      affectedRecipes,
    };

    return {
      result: {
        success: true,
        proposedAction: action,
        oldCostPerMinute: oldGas.costPerMinute,
        newCostPerMinute: newGas.costPerMinute,
        affectedRecipes,
      },
      sideEffects: {
        proposedAction: action,
      },
    };
  }

  private proposeSaveRecipe(args: {
    name: string;
    yieldType: 'weight' | 'piece';
    yieldAmount: number;
    cookingTimeMins: number;
    defaultServingAmount?: number;
    ingredients: Array<{ name: string; quantity: number; unit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' }>;
  }) {
    const { name, yieldType, yieldAmount, cookingTimeMins, defaultServingAmount, ingredients } = args;
    const trimmedName = (name || '').trim();

    if (!trimmedName) {
      return { result: { error: 'Recipe name is required.' } };
    }

    // Validate ingredients against inventory
    const missingIngredients: string[] = [];
    const missingConversions: string[] = [];
    const resolvedRecipeIngredients: RecipeIngredient[] = [];
    const clarifications: ClarificationQuestion[] = [];

    for (const item of ingredients) {
      const cleanItemName = item.name.trim();
      const matched = this.context.ingredients.find(
        i => i.name.toLowerCase().trim() === cleanItemName.toLowerCase()
      );

      if (!matched) {
        missingIngredients.push(cleanItemName);
      } else {
        resolvedRecipeIngredients.push({
          id: `ri_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          ingredientId: matched.id,
          name: matched.name,
          quantity: item.quantity,
          unit: item.unit,
        });

        // Check teaspoon conversion
        if (item.unit === 'tsp') {
          const convMatch = this.context.conversions.find(
            c => c.name.toLowerCase().trim() === cleanItemName.toLowerCase()
          );
          if (!convMatch) {
            missingConversions.push(cleanItemName);
          }
        }
      }
    }

    // If ingredients are not found in master inventory, we CANNOT invent prices!
    if (missingIngredients.length > 0) {
      clarifications.push({
        id: 'missing_ingredient_prices',
        question: `The following ingredients are not in your inventory: ${missingIngredients.join(', ')}. Please provide purchase price and packaging (e.g. "Milk ₹30 for 500ml") so exact costs can be calculated.`,
        field: 'newIngredients',
      });

      return {
        result: {
          success: false,
          missingIngredients,
          message: `Cannot save recipe "${trimmedName}" because prices for [${missingIngredients.join(', ')}] are unknown. Please provide their prices first.`,
        },
        sideEffects: {
          clarifications,
        },
      };
    }

    // Check if teaspoon conversions use default
    if (missingConversions.length > 0) {
      clarifications.push({
        id: 'tsp_conversions_default',
        question: `No custom teaspoon conversion found for ${missingConversions.join(', ')}. System standard fallback is 4 grams per teaspoon.`,
        defaultValue: '4',
        defaultDescription: 'Standard kitchen dry spice fallback (4g / tsp)',
        options: [
          { label: 'Use standard default (4g/tsp)', value: 'use_default_4g', isDefault: true },
          { label: 'Enter custom weight in grams', value: 'custom_weight' },
        ],
      });
    }

    // Check for existing recipe with same name
    const existingRecipe = this.context.recipes.find(
      r => r.name.toLowerCase().trim() === trimmedName.toLowerCase()
    );

    const recipeToSave: Recipe = {
      id: existingRecipe ? existingRecipe.id : `rec_${Date.now()}`,
      name: trimmedName,
      yieldType,
      yieldAmount,
      cookingTimeMins: cookingTimeMins > 0 ? cookingTimeMins : 10,
      defaultServingAmount: defaultServingAmount && defaultServingAmount > 0
        ? defaultServingAmount
        : (yieldType === 'weight' ? 100 : 1),
      createdAt: existingRecipe ? existingRecipe.createdAt : new Date().toISOString(),
      ingredients: resolvedRecipeIngredients,
    };

    // Calculate exact costs using existing formula
    const breakdown = calculateRecipeCosts(
      recipeToSave,
      this.context.ingredients,
      this.context.conversions,
      this.context.gasConfig
    );

    const servingCost = calculateDefaultServingCost(
      recipeToSave,
      this.context.ingredients,
      this.context.conversions,
      this.context.gasConfig
    );

    const action: ProposedAction = {
      id: `act_${Date.now()}`,
      type: 'SAVE_RECIPE',
      title: `${existingRecipe ? 'Update' : 'Create'} Recipe: ${trimmedName}`,
      summary: `Save "${trimmedName}" with ${resolvedRecipeIngredients.length} ingredients. Batch Cost: ₹${breakdown.totalBatchCost.toFixed(2)} | Cost per serving (${servingCost.defaultServingAmount} ${servingCost.defaultServingUnit}): ₹${servingCost.costPrice.toFixed(2)}.`,
      requiresConfirmation: true,
      status: 'pending',
      payload: recipeToSave,
      diff: [
        { field: 'name', label: 'Dish Name', after: trimmedName },
        { field: 'yield', label: 'Yield', after: `${yieldAmount} ${yieldType === 'weight' ? 'g' : 'pieces'}` },
        { field: 'cookingTime', label: 'Cook Time', after: `${recipeToSave.cookingTimeMins} mins` },
        { field: 'totalBatchCost', label: 'Total Batch Cost', after: `₹${breakdown.totalBatchCost.toFixed(2)}` },
        { field: 'costPrice', label: 'Serving Cost Price', after: `₹${servingCost.costPrice.toFixed(2)}` },
      ],
    };

    return {
      result: {
        success: true,
        proposedAction: action,
        totalBatchCost: breakdown.totalBatchCost,
        servingCostPrice: servingCost.costPrice,
        costBreakdown: breakdown,
      },
      sideEffects: {
        proposedAction: action,
        costBreakdown: breakdown,
        clarifications: clarifications.length > 0 ? clarifications : undefined,
      },
    };
  }

  private requestClarification(explanation: string, questions: ClarificationQuestion[]) {
    return {
      result: {
        clarificationNeeded: true,
        explanation,
        questions,
      },
      sideEffects: {
        clarifications: questions,
      },
    };
  }
}
