/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Structured Kitchen Change Set Proposals and Diff Specifications
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../../types';

export interface ProposedIngredientCreate {
  tempId: string;
  name: string;
  purchaseQty: number;
  purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
  purchaseCost: number;
  costPerUnit: number;
  aliases?: string[];
}

export interface ProposedIngredientUpdate {
  id: string;
  name: string;
  previous: {
    purchaseQty: number;
    purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
    purchaseCost: number;
    costPerUnit: number;
  };
  proposed: {
    purchaseQty: number;
    purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
    purchaseCost: number;
    costPerUnit: number;
  };
  aliases?: string[];
}

export interface ProposedConversionCreate {
  name: string;
  weightGrams: number;
}

export interface ProposedConversionUpdate {
  id: string;
  name: string;
  previousWeightGrams: number;
  proposedWeightGrams: number;
}

export interface ProposedGasUpdate {
  previous: GasConfig;
  proposed: GasConfig;
}

export interface ProposedRecipeCost {
  totalBatchCost: number;
  servingCost: number;
  servingAmount: number;
  servingUnit: string;
  costPer100g?: number;
  costPerPiece?: number;
  isComplete: boolean;
  incompleteReasons: string[];
}

export interface ProposedRecipeCreate {
  recipe: Recipe;
  calculatedCost: ProposedRecipeCost;
  newIngredientsToRegister: ProposedIngredientCreate[];
  newConversionsToRegister: ProposedConversionCreate[];
}

export interface ProposedRecipeUpdate {
  id: string;
  previous: Recipe;
  proposed: Recipe;
  calculatedCost: ProposedRecipeCost;
}

export type ProposalStatus = 'draft' | 'ready_for_review' | 'confirmed' | 'cancelled' | 'applied';

export interface ProposedChangeSet {
  id: string;
  createdAt: string;
  summary: string;
  operations: {
    newIngredients: ProposedIngredientCreate[];
    updatedIngredients: ProposedIngredientUpdate[];
    newConversions: ProposedConversionCreate[];
    updatedConversions: ProposedConversionUpdate[];
    gasConfigUpdate?: ProposedGasUpdate;
    recipesToCreate: ProposedRecipeCreate[];
    recipesToUpdate: ProposedRecipeUpdate[];
  };
  warnings: string[];
  missingInfo: string[];
  hasBlockingIssues: boolean;
  status: ProposalStatus;
  databaseSnapshotHash: string;
}
