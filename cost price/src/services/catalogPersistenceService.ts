/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Catalog Persistence Service: Targeted, safe database mutations and cost recalculation
 */

import supabase from '../supabaseClient';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe, DishServingCost } from '../types';
import { ProposedChangeSet } from '../server/ai/proposalTypes';
import { calculateDefaultServingCost } from '../utils';
import { generateDatabaseSnapshotHash } from './proposalGenerator';
import { areIngredientsEquivalent } from './ingredientMatcher';
import { broadcastCatalogMutation } from './crossTabSync';

export interface PersistenceResult {
  success: boolean;
  error?: string;
  conflictDetails?: ProposalConflict[];
  updatedIngredients: Ingredient[];
  updatedConversions: TeaspoonConversion[];
  updatedGasConfig: GasConfig;
  updatedRecipes: Recipe[];
  affectedRecipeIds: string[];
}

export interface LiveCatalogState {
  ingredients: Ingredient[];
  conversions: TeaspoonConversion[];
  gasConfig: GasConfig;
  recipes: Recipe[];
}

export interface ProposalConflict {
  type: 'ingredient' | 'conversion' | 'gas_config' | 'duplicate_ingredient' | 'duplicate_recipe';
  targetName: string;
  reason: string;
  currentValue?: any;
  expectedValue?: any;
}

/**
 * Fetches the fresh, authoritative catalog state directly from Supabase.
 * Returns null if Supabase is unavailable, offline, unconfigured, or in mock/test environments.
 */
export async function fetchLiveCatalogState(options?: {
  timeoutMs?: number;
  forceFetch?: boolean;
}): Promise<LiveCatalogState | null> {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return null;
  }

  // In test environments, avoid network timeouts unless explicitly forced
  const isTest = typeof process !== 'undefined' && (process.env?.VITEST || process.env?.NODE_ENV === 'test');
  if (isTest && !options?.forceFetch) {
    return null;
  }

  const timeoutMs = options?.timeoutMs || 2500;

  try {
    const fetchPromise = Promise.all([
      supabase.from('ingredients').select('*'),
      supabase.from('conversions').select('*'),
      supabase.from('gas_config').select('*').limit(1),
      supabase.from('recipes').select('*'),
    ]);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Live catalog fetch timed out')), timeoutMs)
    );

    const [
      { data: ingredientsData, error: ingErr },
      { data: conversionsData, error: convErr },
      { data: gasData, error: gasErr },
      { data: recipesData, error: recipesErr },
    ] = (await Promise.race([fetchPromise, timeoutPromise])) as any;

    if (ingErr || convErr || gasErr || recipesErr) {
      console.warn('Failed to fetch live catalog from Supabase:', ingErr || convErr || gasErr || recipesErr);
      return null;
    }

    if (!ingredientsData && !conversionsData && !recipesData) {
      return null;
    }

    return {
      ingredients: (ingredientsData || []).map((row: any) => ({
        ...row,
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
      })) as Ingredient[],
      conversions: (conversionsData || []) as TeaspoonConversion[],
      gasConfig: (gasData && gasData.length > 0 ? gasData[0] : { cylinderPrice: 950, cylinderWeightKg: 14.2, consumptionRateKgHour: 0.25 }) as GasConfig,
      recipes: (recipesData || []) as Recipe[],
    };
  } catch (err) {
    console.warn('Error fetching live catalog state:', err);
    return null;
  }
}

/**
 * Validates a proposed change set against live database records.
 * Detects targeted entity conflicts (price, quantity, conversion, gas, duplicate names).
 */
export function validateProposalAgainstLiveDatabase(
  proposal: ProposedChangeSet,
  liveCatalog: LiveCatalogState
): { isValid: boolean; conflicts: ProposalConflict[]; conflictMessage?: string } {
  const conflicts: ProposalConflict[] = [];

  // 1. Check updated ingredients
  for (const upd of proposal.operations.updatedIngredients) {
    const liveIng = liveCatalog.ingredients.find(i => i.id === upd.id);
    if (!liveIng) {
      conflicts.push({
        type: 'ingredient',
        targetName: upd.name,
        reason: `Ingredient "${upd.name}" was deleted from the database.`,
      });
      continue;
    }

    const priceChanged = Number(liveIng.purchaseCost) !== Number(upd.previous.purchaseCost);
    const qtyChanged = Number(liveIng.purchaseQty) !== Number(upd.previous.purchaseQty);
    const unitChanged = liveIng.purchaseUnit !== upd.previous.purchaseUnit;

    if (priceChanged || qtyChanged || unitChanged) {
      conflicts.push({
        type: 'ingredient',
        targetName: upd.name,
        reason: `Ingredient "${upd.name}" was modified in the database (current: ₹${liveIng.purchaseCost} for ${liveIng.purchaseQty}${liveIng.purchaseUnit}, was: ₹${upd.previous.purchaseCost} for ${upd.previous.purchaseQty}${upd.previous.purchaseUnit} when proposal was prepared).`,
        currentValue: { cost: liveIng.purchaseCost, qty: liveIng.purchaseQty, unit: liveIng.purchaseUnit },
        expectedValue: upd.previous,
      });
    }
  }

  // 2. Check updated conversions
  for (const uc of proposal.operations.updatedConversions) {
    const liveConv = liveCatalog.conversions.find(
      c => c.id === uc.id || c.name.toLowerCase().trim() === uc.name.toLowerCase().trim()
    );
    if (!liveConv) {
      conflicts.push({
        type: 'conversion',
        targetName: uc.name,
        reason: `Teaspoon conversion "${uc.name}" was deleted from the database.`,
      });
      continue;
    }

    if (Number(liveConv.weightGrams) !== Number(uc.previousWeightGrams)) {
      conflicts.push({
        type: 'conversion',
        targetName: uc.name,
        reason: `Teaspoon conversion "${uc.name}" was modified in the database (current: 1 tsp = ${liveConv.weightGrams}g, was: ${uc.previousWeightGrams}g when proposal was prepared).`,
        currentValue: liveConv.weightGrams,
        expectedValue: uc.previousWeightGrams,
      });
    }
  }

  // 3. Check gas config update
  if (proposal.operations.gasConfigUpdate) {
    const liveGas = liveCatalog.gasConfig;
    const prevGas = proposal.operations.gasConfigUpdate.previous;

    const priceDiff = Number(liveGas.cylinderPrice) !== Number(prevGas.cylinderPrice);
    const weightDiff = Number(liveGas.cylinderWeightKg) !== Number(prevGas.cylinderWeightKg);
    const rateDiff = Number(liveGas.consumptionRateKgHour) !== Number(prevGas.consumptionRateKgHour);

    if (priceDiff || weightDiff || rateDiff) {
      conflicts.push({
        type: 'gas_config',
        targetName: 'Gas Configuration',
        reason: `Gas configuration was modified in the database (current price: ₹${liveGas.cylinderPrice}, was: ₹${prevGas.cylinderPrice} when proposal was prepared).`,
        currentValue: liveGas,
        expectedValue: prevGas,
      });
    }
  }

  // 4. Check new ingredients for duplicate names or canonical matches
  for (const newIng of proposal.operations.newIngredients) {
    const existing = liveCatalog.ingredients.find(
      i =>
        i.name.toLowerCase().trim() === newIng.name.toLowerCase().trim() ||
        areIngredientsEquivalent(i.name, newIng.name)
    );
    if (existing) {
      conflicts.push({
        type: 'duplicate_ingredient',
        targetName: newIng.name,
        reason: `An ingredient matching "${newIng.name}" already exists in the database as "${existing.name}".`,
        currentValue: existing.name,
        expectedValue: newIng.name,
      });
    }
  }

  // 5. Check recipes to create for duplicate names
  for (const rc of proposal.operations.recipesToCreate) {
    const existing = liveCatalog.recipes.find(
      r => r.name.toLowerCase().trim() === rc.recipe.name.toLowerCase().trim()
    );
    if (existing) {
      conflicts.push({
        type: 'duplicate_recipe',
        targetName: rc.recipe.name,
        reason: `A recipe named "${rc.recipe.name}" already exists in the database.`,
        currentValue: existing.name,
        expectedValue: rc.recipe.name,
      });
    }
  }

  const isValid = conflicts.length === 0;
  const conflictMessage = isValid
    ? undefined
    : conflicts.map(c => c.reason).join('; ');

  return { isValid, conflicts, conflictMessage };
}

/**
 * Finds all recipe IDs affected by changes to an ingredient, conversion, or gas config
 */
export function findAffectedRecipeIds(
  recipes: Recipe[],
  changedIngredientIds: string[],
  changedConversionNames: string[],
  isGasChanged: boolean
): string[] {
  const affected = new Set<string>();

  for (const recipe of recipes) {
    if (isGasChanged && recipe.cookingTimeMins > 0) {
      affected.add(recipe.id);
      continue;
    }

    for (const ri of recipe.ingredients) {
      if (changedIngredientIds.includes(ri.ingredientId)) {
        affected.add(recipe.id);
        break;
      }
      if (
        ri.unit === 'tsp' &&
        changedConversionNames.some(
          name =>
            name.toLowerCase().trim() === (ri.name || '').toLowerCase().trim() ||
            areIngredientsEquivalent(name, ri.name || '')
        )
      ) {
        affected.add(recipe.id);
        break;
      }
    }
  }

  return Array.from(affected);
}

/**
 * Recalculates and persists dish serving costs for specific or all recipes
 */
export async function recalculateAndPersistDishCosts(
  recipes: Recipe[],
  ingredients: Ingredient[],
  conversions: TeaspoonConversion[],
  gasConfig: GasConfig,
  targetRecipeIds?: string[]
): Promise<DishServingCost[]> {
  const targetRecipes = targetRecipeIds && targetRecipeIds.length > 0
    ? recipes.filter(r => targetRecipeIds.includes(r.id))
    : recipes;

  const dishCosts: DishServingCost[] = targetRecipes.map(recipe =>
    calculateDefaultServingCost(recipe, ingredients, conversions, gasConfig)
  );

  if (dishCosts.length > 0) {
    try {
      const { error } = await supabase.from('dish_costs').upsert(dishCosts);
      if (error) {
        console.warn('Dish costs upsert warning (table may be optional):', error.message);
      }
    } catch (e) {
      console.warn('Failed to persist dish costs:', e);
    }
  }

  return dishCosts;
}

/**
 * Persists an explicitly confirmed ProposedChangeSet to the database safely
 * with database-level Optimistic Concurrency Control (OCC) and automatic rollback.
 */
export async function persistProposedChangeSet(
  proposal: ProposedChangeSet,
  currentSnapshotHash: string,
  currentIngredients: Ingredient[],
  currentConversions: TeaspoonConversion[],
  currentGasConfig: GasConfig,
  currentRecipes: Recipe[],
  options?: {
    liveCatalogOverride?: LiveCatalogState;
  }
): Promise<PersistenceResult> {
  // 1. Fetch authoritative live database state, or use override/fallback
  const fetchedLive = options?.liveCatalogOverride || (await fetchLiveCatalogState());
  const liveCatalog: LiveCatalogState = fetchedLive || {
    ingredients: currentIngredients,
    conversions: currentConversions,
    gasConfig: currentGasConfig,
    recipes: currentRecipes,
  };

  // 2. Validate proposal against live database state (Targeted Optimistic Concurrency Control)
  const validation = validateProposalAgainstLiveDatabase(proposal, liveCatalog);
  if (!validation.isValid) {
    return {
      success: false,
      error: `Database state has changed since this proposal was prepared. ${validation.conflictMessage}`,
      conflictDetails: validation.conflicts,
      updatedIngredients: liveCatalog.ingredients,
      updatedConversions: liveCatalog.conversions,
      updatedGasConfig: liveCatalog.gasConfig,
      updatedRecipes: liveCatalog.recipes,
      affectedRecipeIds: [],
    };
  }

  // 3. Stale proposal guard for empty proposals or legacy snapshot hash mismatches
  const liveSnapshotHash = generateDatabaseSnapshotHash(
    liveCatalog.ingredients,
    liveCatalog.conversions,
    liveCatalog.gasConfig,
    liveCatalog.recipes
  );

  const hasOperations =
    proposal.operations.newIngredients.length > 0 ||
    proposal.operations.updatedIngredients.length > 0 ||
    proposal.operations.newConversions.length > 0 ||
    proposal.operations.updatedConversions.length > 0 ||
    !!proposal.operations.gasConfigUpdate ||
    proposal.operations.recipesToCreate.length > 0;

  if (
    !hasOperations &&
    (proposal.databaseSnapshotHash !== currentSnapshotHash ||
      proposal.databaseSnapshotHash !== liveSnapshotHash)
  ) {
    return {
      success: false,
      error: 'Database state has changed since this proposal was prepared. Please re-review the proposal against the current database.',
      updatedIngredients: liveCatalog.ingredients,
      updatedConversions: liveCatalog.conversions,
      updatedGasConfig: liveCatalog.gasConfig,
      updatedRecipes: liveCatalog.recipes,
      affectedRecipeIds: [],
    };
  }

  if (proposal.hasBlockingIssues) {
    return {
      success: false,
      error: 'Cannot apply proposal with blocking issues or missing information.',
      updatedIngredients: liveCatalog.ingredients,
      updatedConversions: liveCatalog.conversions,
      updatedGasConfig: liveCatalog.gasConfig,
      updatedRecipes: liveCatalog.recipes,
      affectedRecipeIds: [],
    };
  }

  // 4. Try PostgreSQL RPC Stored Procedure if available (in production / non-test runtime)
  const isTest = typeof process !== 'undefined' && (process.env?.VITEST || process.env?.NODE_ENV === 'test');
  if (!isTest && typeof (supabase as any)?.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('apply_kitchen_proposal', {
        p_proposal: proposal,
      });

      if (!rpcError && rpcData?.success) {
        const freshLive = (await fetchLiveCatalogState()) || liveCatalog;
        return {
          success: true,
          updatedIngredients: freshLive.ingredients,
          updatedConversions: freshLive.conversions,
          updatedGasConfig: freshLive.gasConfig,
          updatedRecipes: freshLive.recipes,
          affectedRecipeIds: [],
        };
      } else if (rpcError && rpcError.message && rpcError.message.includes('CONFLICT:')) {
        return {
          success: false,
          error: `Database state has changed since this proposal was prepared. ${rpcError.message}`,
          updatedIngredients: liveCatalog.ingredients,
          updatedConversions: liveCatalog.conversions,
          updatedGasConfig: liveCatalog.gasConfig,
          updatedRecipes: liveCatalog.recipes,
          affectedRecipeIds: [],
        };
      }
    } catch {
      // RPC not available or failed; fallback to client-side transactional engine
    }
  }

  // 5. Client-Side OCC Engine with Rollback Compensation Stack
  const rollbackStack: Array<() => Promise<void>> = [];

  try {
    const tempToRealIdMap: Record<string, string> = {};
    const createdIngredients: Ingredient[] = [];
    const modifiedIngredients: Ingredient[] = [];
    const createdConversions: TeaspoonConversion[] = [];
    const modifiedConversions: TeaspoonConversion[] = [];
    const createdRecipes: Recipe[] = [];

    // 5a. Prepare & persist new ingredients
    for (const newIng of proposal.operations.newIngredients) {
      const realId = `ing_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      tempToRealIdMap[newIng.tempId] = realId;
      const ing: Ingredient = {
        id: realId,
        name: newIng.name,
        purchaseQty: newIng.purchaseQty,
        purchaseUnit: newIng.purchaseUnit,
        purchaseCost: newIng.purchaseCost,
        costPerUnit: newIng.costPerUnit,
        aliases: Array.isArray(newIng.aliases) ? newIng.aliases : [],
      };
      createdIngredients.push(ing);
    }

    if (createdIngredients.length > 0) {
      const { error } = await supabase.from('ingredients').upsert(createdIngredients);
      if (error) throw new Error(`Failed to save new ingredients: ${error.message}`);
      rollbackStack.push(async () => {
        await (supabase.from('ingredients') as any).delete().in('id', createdIngredients.map(i => i.id));
      });
    }

    // 5b. Prepare & persist updated ingredients
    for (const upd of proposal.operations.updatedIngredients) {
      const liveIng = liveCatalog.ingredients.find(i => i.id === upd.id);
      // Preserve existing aliases from the live catalog; never replace with empty array if proposal does not specify aliases
      const preservedAliases = Array.isArray(upd.aliases)
        ? upd.aliases
        : Array.isArray(liveIng?.aliases)
        ? liveIng.aliases
        : [];

      const ing: Ingredient = {
        id: upd.id,
        name: upd.name,
        purchaseQty: upd.proposed.purchaseQty,
        purchaseUnit: upd.proposed.purchaseUnit,
        purchaseCost: upd.proposed.purchaseCost,
        costPerUnit: upd.proposed.costPerUnit,
        aliases: preservedAliases,
      };
      modifiedIngredients.push(ing);
    }

    if (modifiedIngredients.length > 0) {
      const originalIngredientsToRestore = proposal.operations.updatedIngredients
        .map(upd => liveCatalog.ingredients.find(i => i.id === upd.id))
        .filter(Boolean) as Ingredient[];

      const { error } = await supabase.from('ingredients').upsert(modifiedIngredients);
      if (error) throw new Error(`Failed to update ingredients: ${error.message}`);
      rollbackStack.push(async () => {
        if (originalIngredientsToRestore.length > 0) {
          await supabase.from('ingredients').upsert(originalIngredientsToRestore);
        }
      });
    }

    // Build next ingredient state merging onto liveCatalog (preserves concurrent updates to other ingredients)
    const nextIngredients: Ingredient[] = liveCatalog.ingredients.map(ing => {
      const match = modifiedIngredients.find(m => m.id === ing.id);
      return match || ing;
    });
    nextIngredients.unshift(...createdIngredients);

    // 5c. Prepare & persist conversions
    for (const nc of proposal.operations.newConversions) {
      const conv: TeaspoonConversion = {
        id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: nc.name,
        weightGrams: nc.weightGrams,
      };
      createdConversions.push(conv);
    }

    for (const uc of proposal.operations.updatedConversions) {
      const conv: TeaspoonConversion = {
        id: uc.id,
        name: uc.name,
        weightGrams: uc.proposedWeightGrams,
      };
      modifiedConversions.push(conv);
    }

    const allConversionsToSave = [...createdConversions, ...modifiedConversions];
    if (allConversionsToSave.length > 0) {
      const originalConversionsToRestore = proposal.operations.updatedConversions
        .map(uc => liveCatalog.conversions.find(c => c.id === uc.id))
        .filter(Boolean) as TeaspoonConversion[];

      const { error } = await supabase.from('conversions').upsert(allConversionsToSave);
      if (error) throw new Error(`Failed to save conversions: ${error.message}`);
      rollbackStack.push(async () => {
        if (createdConversions.length > 0) {
          await (supabase.from('conversions') as any).delete().in('id', createdConversions.map(c => c.id));
        }
        if (originalConversionsToRestore.length > 0) {
          await supabase.from('conversions').upsert(originalConversionsToRestore);
        }
      });
    }

    const nextConversions: TeaspoonConversion[] = liveCatalog.conversions.map(c => {
      const match = modifiedConversions.find(m => m.id === c.id);
      return match || c;
    });
    nextConversions.unshift(...createdConversions);

    // 5d. Prepare & persist gas config
    let nextGasConfig = liveCatalog.gasConfig;
    if (proposal.operations.gasConfigUpdate) {
      const originalGas = liveCatalog.gasConfig;
      nextGasConfig = proposal.operations.gasConfigUpdate.proposed;
      const { error } = await supabase.from('gas_config').upsert([{ id: 'singleton', ...nextGasConfig }]);
      if (error) throw new Error(`Failed to update gas config: ${error.message}`);
      rollbackStack.push(async () => {
        await supabase.from('gas_config').upsert([{ id: 'singleton', ...originalGas }]);
      });
    }

    // 5e. Prepare & persist recipes
    for (const rc of proposal.operations.recipesToCreate) {
      const resolvedIngredients = rc.recipe.ingredients.map(ri => {
        if (tempToRealIdMap[ri.ingredientId]) {
          return { ...ri, ingredientId: tempToRealIdMap[ri.ingredientId] };
        }
        return ri;
      });

      const finalizedRecipe: Recipe = {
        ...rc.recipe,
        ingredients: resolvedIngredients,
      };
      createdRecipes.push(finalizedRecipe);
    }

    if (createdRecipes.length > 0) {
      const { error } = await supabase.from('recipes').upsert(createdRecipes);
      if (error) throw new Error(`Failed to save recipes: ${error.message}`);
      rollbackStack.push(async () => {
        await (supabase.from('recipes') as any).delete().in('id', createdRecipes.map(r => r.id));
      });
    }

    const nextRecipes = [...createdRecipes, ...liveCatalog.recipes];

    // 5f. Find affected recipes and recalculate their dish costs using fresh live catalog
    const changedIngIds = [...createdIngredients.map(i => i.id), ...modifiedIngredients.map(i => i.id)];
    const changedConvNames = allConversionsToSave.map(c => c.name);
    const isGasChanged = !!proposal.operations.gasConfigUpdate;
    const affectedIds = findAffectedRecipeIds(nextRecipes, changedIngIds, changedConvNames, isGasChanged);

    createdRecipes.forEach(r => {
      if (!affectedIds.includes(r.id)) affectedIds.push(r.id);
    });

    await recalculateAndPersistDishCosts(nextRecipes, nextIngredients, nextConversions, nextGasConfig, affectedIds);

    broadcastCatalogMutation({ action: 'proposal_persisted', proposalId: proposal.id });

    return {
      success: true,
      updatedIngredients: nextIngredients,
      updatedConversions: nextConversions,
      updatedGasConfig: nextGasConfig,
      updatedRecipes: nextRecipes,
      affectedRecipeIds: affectedIds,
    };
  } catch (err: any) {
    console.error('Error in persistProposedChangeSet, executing rollback stack:', err);
    while (rollbackStack.length > 0) {
      const rollbackFn = rollbackStack.pop();
      if (rollbackFn) {
        try {
          await rollbackFn();
        } catch (rbErr) {
          console.error('Failed to execute rollback action:', rbErr);
        }
      }
    }
    return {
      success: false,
      error: `Persistence failed and any partial changes were rolled back: ${err?.message || 'Unknown error'}`,
      updatedIngredients: liveCatalog.ingredients,
      updatedConversions: liveCatalog.conversions,
      updatedGasConfig: liveCatalog.gasConfig,
      updatedRecipes: liveCatalog.recipes,
      affectedRecipeIds: [],
    };
  }
}

/**
 * Targeted Persistence Operations for manual UI interactions
 */
export async function persistCreateIngredient(
  ingredient: Ingredient,
  currentIngredients: Ingredient[]
): Promise<{ success: boolean; ingredients: Ingredient[]; error?: string }> {
  try {
    const safeIngredient: Ingredient = {
      ...ingredient,
      aliases: Array.isArray(ingredient.aliases) ? ingredient.aliases : [],
    };
    const { error } = await supabase.from('ingredients').upsert([safeIngredient]);
    if (error) throw error;
    return { success: true, ingredients: [safeIngredient, ...currentIngredients] };
  } catch (e: any) {
    return { success: false, ingredients: currentIngredients, error: e.message };
  }
}

export async function persistUpdateIngredient(
  ingredient: Ingredient,
  currentIngredients: Ingredient[],
  currentRecipes: Recipe[],
  currentConversions: TeaspoonConversion[],
  currentGasConfig: GasConfig
): Promise<{ success: boolean; ingredients: Ingredient[]; error?: string }> {
  try {
    const existing = currentIngredients.find(i => i.id === ingredient.id);
    const safeIngredient: Ingredient = {
      ...ingredient,
      aliases: Array.isArray(ingredient.aliases)
        ? ingredient.aliases
        : Array.isArray(existing?.aliases)
        ? existing.aliases
        : [],
    };
    const { error } = await supabase.from('ingredients').upsert([safeIngredient]);
    if (error) throw error;

    const nextIngredients = currentIngredients.map(i => (i.id === ingredient.id ? safeIngredient : i));
    const affected = findAffectedRecipeIds(currentRecipes, [ingredient.id], [], false);
    if (affected.length > 0) {
      await recalculateAndPersistDishCosts(currentRecipes, nextIngredients, currentConversions, currentGasConfig, affected);
    }

    return { success: true, ingredients: nextIngredients };
  } catch (e: any) {
    return { success: false, ingredients: currentIngredients, error: e.message };
  }
}

export async function persistDeleteIngredient(
  id: string,
  currentIngredients: Ingredient[]
): Promise<{ success: boolean; ingredients: Ingredient[]; error?: string }> {
  try {
    const { error } = await supabase.from('ingredients').delete().eq('id', id);
    if (error) throw error;
    return { success: true, ingredients: currentIngredients.filter(i => i.id !== id) };
  } catch (e: any) {
    return { success: false, ingredients: currentIngredients, error: e.message };
  }
}

export async function persistSaveConversion(
  conversion: TeaspoonConversion,
  currentConversions: TeaspoonConversion[],
  currentRecipes: Recipe[],
  currentIngredients: Ingredient[],
  currentGasConfig: GasConfig
): Promise<{ success: boolean; conversions: TeaspoonConversion[]; error?: string }> {
  try {
    const { error } = await supabase.from('conversions').upsert([conversion]);
    if (error) throw error;

    const exists = currentConversions.some(c => c.id === conversion.id);
    const nextConversions = exists
      ? currentConversions.map(c => (c.id === conversion.id ? conversion : c))
      : [conversion, ...currentConversions];

    const affected = findAffectedRecipeIds(currentRecipes, [], [conversion.name], false);
    if (affected.length > 0) {
      await recalculateAndPersistDishCosts(currentRecipes, currentIngredients, nextConversions, currentGasConfig, affected);
    }

    return { success: true, conversions: nextConversions };
  } catch (e: any) {
    return { success: false, conversions: currentConversions, error: e.message };
  }
}

export async function persistDeleteConversion(
  id: string,
  currentConversions: TeaspoonConversion[]
): Promise<{ success: boolean; conversions: TeaspoonConversion[]; error?: string }> {
  try {
    const { error } = await supabase.from('conversions').delete().eq('id', id);
    if (error) throw error;
    return { success: true, conversions: currentConversions.filter(c => c.id !== id) };
  } catch (e: any) {
    return { success: false, conversions: currentConversions, error: e.message };
  }
}

export async function persistSaveGasConfig(
  gasConfig: GasConfig,
  currentRecipes: Recipe[],
  currentIngredients: Ingredient[],
  currentConversions: TeaspoonConversion[]
): Promise<{ success: boolean; gasConfig: GasConfig; error?: string }> {
  try {
    const { error } = await supabase.from('gas_config').upsert([{ id: 'singleton', ...gasConfig }]);
    if (error) throw error;

    const affected = currentRecipes.filter(r => r.cookingTimeMins > 0).map(r => r.id);
    if (affected.length > 0) {
      await recalculateAndPersistDishCosts(currentRecipes, currentIngredients, currentConversions, gasConfig, affected);
    }

    return { success: true, gasConfig };
  } catch (e: any) {
    return { success: false, gasConfig, error: e.message };
  }
}

export async function persistSaveRecipe(
  recipeToSave: Recipe,
  newIngredientsToRegister: Ingredient[],
  currentRecipes: Recipe[],
  currentIngredients: Ingredient[],
  currentConversions: TeaspoonConversion[],
  currentGasConfig: GasConfig
): Promise<{ success: boolean; recipes: Recipe[]; ingredients: Ingredient[]; error?: string }> {
  try {
    let nextIngredients = [...currentIngredients];
    const tempToRealIdMap: Record<string, string> = {};
    const createdIngredients: Ingredient[] = [];

    for (const tempIng of newIngredientsToRegister) {
      const realId = `ing_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      tempToRealIdMap[tempIng.id] = realId;
      const registeredItem: Ingredient = {
        ...tempIng,
        id: realId,
        aliases: Array.isArray(tempIng.aliases) ? tempIng.aliases : [],
      };
      createdIngredients.push(registeredItem);
      nextIngredients.push(registeredItem);
    }

    if (createdIngredients.length > 0) {
      const { error: ingError } = await supabase.from('ingredients').upsert(createdIngredients);
      if (ingError) throw ingError;
    }

    const resolvedIngredients = recipeToSave.ingredients.map(ri => {
      if (tempToRealIdMap[ri.ingredientId]) {
        return { ...ri, ingredientId: tempToRealIdMap[ri.ingredientId] };
      }
      return ri;
    });

    const finalizedRecipe: Recipe = {
      ...recipeToSave,
      ingredients: resolvedIngredients,
    };

    const { error: recipeError } = await supabase.from('recipes').upsert([finalizedRecipe]);
    if (recipeError) throw recipeError;

    const exists = currentRecipes.some(r => r.id === finalizedRecipe.id);
    const nextRecipes = exists
      ? currentRecipes.map(r => (r.id === finalizedRecipe.id ? finalizedRecipe : r))
      : [finalizedRecipe, ...currentRecipes];

    await recalculateAndPersistDishCosts(nextRecipes, nextIngredients, currentConversions, currentGasConfig, [finalizedRecipe.id]);

    return {
      success: true,
      recipes: nextRecipes,
      ingredients: nextIngredients,
    };
  } catch (e: any) {
    return { success: false, recipes: currentRecipes, ingredients: currentIngredients, error: e.message };
  }
}

export async function persistDeleteRecipe(
  recipeId: string,
  currentRecipes: Recipe[]
): Promise<{ success: boolean; recipes: Recipe[]; error?: string }> {
  try {
    const [{ error: recipeError }, { error: costError }] = await Promise.all([
      supabase.from('recipes').delete().eq('id', recipeId),
      supabase.from('dish_costs').delete().eq('recipeId', recipeId),
    ]);
    if (recipeError) throw recipeError;
    return { success: true, recipes: currentRecipes.filter(r => r.id !== recipeId) };
  } catch (e: any) {
    return { success: false, recipes: currentRecipes, error: e.message };
  }
}
