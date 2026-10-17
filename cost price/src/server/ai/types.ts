/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient, TeaspoonConversion, GasConfig, Recipe, RecipeIngredient } from '../../types';
import { RecipeCostBreakdown } from '../../utils';

export type ProposedActionType =
  | 'ADD_INGREDIENT'
  | 'UPDATE_INGREDIENT'
  | 'SAVE_CONVERSION'
  | 'UPDATE_GAS_CONFIG'
  | 'SAVE_RECIPE'
  | 'DELETE_RECIPE';

export interface ActionDiff {
  field: string;
  label: string;
  before?: any;
  after: any;
}

export interface ProposedAction {
  id: string;
  type: ProposedActionType;
  title: string;
  summary: string;
  requiresConfirmation: boolean;
  status: 'pending' | 'confirmed' | 'cancelled';
  payload: any;
  diff?: ActionDiff[];
  impactSummary?: string;
  affectedRecipes?: {
    recipeName: string;
    oldBatchCost: number;
    newBatchCost: number;
    oldServingCost: number;
    newServingCost: number;
  }[];
}

export interface ClarificationOption {
  label: string;
  value: string | number;
  isDefault?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  field?: string;
  context?: string;
  defaultValue?: string | number;
  defaultDescription?: string;
  options?: ClarificationOption[];
}

export interface ContextSnapshot {
  ingredients: Ingredient[];
  conversions: TeaspoonConversion[];
  gasConfig: GasConfig;
  recipes: Recipe[];
}

export interface ChatHistoryMessage {
  role: 'user' | 'model';
  content: string;
}

export interface AIChatRequest {
  message: string;
  history?: ChatHistoryMessage[];
  contextSnapshot: ContextSnapshot;
}

export interface AIChatResponse {
  reply: string;
  costBreakdown?: RecipeCostBreakdown;
  proposedAction?: ProposedAction;
  clarifications?: ClarificationQuestion[];
  searchResults?: any;
}
