/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from './types';
import {
  initialIngredients,
  initialConversions,
  initialGasConfig,
  initialRecipes,
  getCostPerUnit,
} from './data';
import { calculateRecipeCosts } from './utils';

// Import subcomponents
import GasCostCalculator from './components/GasCostCalculator';
import ConversionsManager from './components/ConversionsManager';
import IngredientManager from './components/IngredientManager';
import RecipeDetail from './components/RecipeDetail';
import RecipeEditor from './components/RecipeEditor';

// Lucide Icons
import {
  ChefHat,
  Search,
  Plus,
  Flame,
  Scale,
  Apple,
  TrendingUp,
  Info,
  Calendar,
  Layers,
  UtensilsCrossed,
  Sparkles,
} from 'lucide-react';

export default function App() {
  // State initialization loading from Supabase or preseeded values
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [conversions, setConversions] = useState<TeaspoonConversion[]>(initialConversions);
  const [gasConfig, setGasConfig] = useState<GasConfig>(initialGasConfig);
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);

  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // UI state
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(() => {
    const first = initialRecipes.length > 0 ? initialRecipes[0].id : null;
    return first;
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null); // null means new recipe
  const [recipeServingQuantities, setRecipeServingQuantities] = useState<Record<string, string>>({});

  // Right column active sub-tab (for layout partitioning)
  const [activeTab, setActiveTab] = useState<'ingredients' | 'gas' | 'conversions'>('ingredients');
  // Filters for recipes search list
  const [recipeSearch, setRecipeSearch] = useState('');

  const getRecipeServingQuantity = (recipe: Recipe) => {
    return recipeServingQuantities[recipe.id] ?? recipe.yieldAmount.toString();
  };

  const calculateServingCost = (recipe: Recipe, totalBatchCost: number, servingString: string) => {
    const servingValue = parseFloat(servingString);
    if (isNaN(servingValue) || servingValue <= 0 || recipe.yieldAmount <= 0) {
      return 0;
    }
    if (recipe.yieldType === 'weight') {
      return (totalBatchCost / recipe.yieldAmount) * servingValue;
    }
    return (totalBatchCost / recipe.yieldAmount) * servingValue;
  };

  useEffect(() => {
    const loadFromDatabase = async () => {
      try {
        const [{ data: ingredientsData, error: ingErr }, { data: conversionsData, error: convErr }, { data: gasData, error: gasErr }, { data: recipesData, error: recipesErr }] = await Promise.all([
          supabase.from('ingredients').select('*'),
          supabase.from('conversions').select('*'),
          supabase.from('gas_config').select('*').limit(1),
          supabase.from('recipes').select('*'),
        ]);

        if (ingErr || convErr || gasErr || recipesErr) {
          throw ingErr || convErr || gasErr || recipesErr;
        }

        const loadedIngredients = ingredientsData && ingredientsData.length > 0 ? ingredientsData as Ingredient[] : initialIngredients;
        const loadedConversions = conversionsData && conversionsData.length > 0 ? conversionsData as TeaspoonConversion[] : initialConversions;
        const loadedGasConfig = gasData && gasData.length > 0 ? gasData[0] as GasConfig & { id: string } : initialGasConfig;
        const loadedRecipes = recipesData && recipesData.length > 0 ? recipesData as Recipe[] : initialRecipes;

        setIngredients(loadedIngredients);
        setConversions(loadedConversions);
        setGasConfig(loadedGasConfig);
        setRecipes(loadedRecipes);
        setSelectedRecipeId(prevId => prevId || loadedRecipes[0]?.id || null);
        setIsDbLoaded(true);

        // Seed any missing data in the database so tables are initialized.
        if (!ingredientsData || ingredientsData.length === 0) {
          await supabase.from('ingredients').upsert(initialIngredients);
        }
        if (!conversionsData || conversionsData.length === 0) {
          await supabase.from('conversions').upsert(initialConversions);
        }
        if (!gasData || gasData.length === 0) {
          await supabase.from('gas_config').upsert([{ id: 'singleton', ...initialGasConfig }]);
        }
        if (!recipesData || recipesData.length === 0) {
          await supabase.from('recipes').upsert(initialRecipes);
        }
      } catch (error) {
        console.error('Failed to load app data from Supabase', error);
        setDbError('Unable to load app data from the database. Using local defaults.');
        setIsDbLoaded(true);
      }
    };

    loadFromDatabase();
  }, []);

  useEffect(() => {
    if (!isDbLoaded) return;
    void (async () => {
      const { error } = await supabase.from('ingredients').upsert(ingredients);
      if (error) console.error('Ingredients sync failed', error);
    })();
  }, [ingredients, isDbLoaded]);

  useEffect(() => {
    if (!isDbLoaded) return;
    void (async () => {
      const { error } = await supabase.from('conversions').upsert(conversions);
      if (error) console.error('Conversions sync failed', error);
    })();
  }, [conversions, isDbLoaded]);

  useEffect(() => {
    if (!isDbLoaded) return;
    void (async () => {
      const { error } = await supabase.from('gas_config').upsert([{ id: 'singleton', ...gasConfig }]);
      if (error) console.error('Gas config sync failed', error);
    })();
  }, [gasConfig, isDbLoaded]);

  useEffect(() => {
    if (!isDbLoaded) return;
    void (async () => {
      const { error } = await supabase.from('recipes').upsert(recipes);
      if (error) console.error('Recipes sync failed', error);
    })();
  }, [recipes, isDbLoaded]);

  // Derive counts of ingredient usage across all recipes
  const recipesCountMap = React.useMemo(() => {
    const counts: Record<string, number> = {};
    recipes.forEach(r => {
      r.ingredients.forEach(ri => {
        counts[ri.ingredientId] = (counts[ri.ingredientId] || 0) + 1;
      });
    });
    return counts;
  }, [recipes]);

  // Master Ingredient Operations
  const handleAddIngredient = (newIngProps: Omit<Ingredient, 'id' | 'costPerUnit'>) => {
    const costPerUnit = getCostPerUnit(
      newIngProps.purchaseQty,
      newIngProps.purchaseUnit,
      newIngProps.purchaseCost
    );
    const newIng: Ingredient = {
      ...newIngProps,
      id: `ing_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      costPerUnit,
    };
    setIngredients([newIng, ...ingredients]);
  };

  const handleEditIngredient = (updatedIng: Ingredient) => {
    setIngredients(ingredients.map(i => (i.id === updatedIng.id ? updatedIng : i)));
  };

  const handleDeleteIngredient = (id: string) => {
    setIngredients(ingredients.filter(i => i.id !== id));
  };

  const handleBulkImportIngredients = (importedList: Ingredient[]) => {
    // Merge Strategy: Identify duplicates by name matching (case-insensitive) and override
    const updated = [...ingredients];
    importedList.forEach(importedItem => {
      const matchIdx = updated.findIndex(
        i => i.name.trim().toLowerCase() === importedItem.name.trim().toLowerCase()
      );
      const costPerUnit = getCostPerUnit(
        importedItem.purchaseQty,
        importedItem.purchaseUnit,
        importedItem.purchaseCost
      );
      const safeIng: Ingredient = {
        ...importedItem,
        id: importedItem.id && !importedItem.id.startsWith('temp_') ? importedItem.id : `ing_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        costPerUnit,
      };

      if (matchIdx !== -1) {
        updated[matchIdx] = safeIng;
      } else {
        updated.push(safeIng);
      }
    });

    setIngredients(updated);
  };

  // Teaspoon Mappings
  const handleAddConversion = (newConvProps: Omit<TeaspoonConversion, 'id'>) => {
    const newConv: TeaspoonConversion = {
      ...newConvProps,
      id: `conv_${Date.now()}`,
    };
    setConversions([newConv, ...conversions]);
  };

  const handleEditConversion = (updatedConv: TeaspoonConversion) => {
    setConversions(conversions.map(c => (c.id === updatedConv.id ? updatedConv : c)));
  };

  const handleDeleteConversion = (id: string) => {
    setConversions(conversions.filter(c => c.id !== id));
  };

  const handleResetConversions = () => {
    if (window.confirm('Are you sure you want to restore conversions to standard defaults? This will overwrite manual changes.')) {
      setConversions(initialConversions);
    }
  };

  // Recipes actions
  const handleSaveRecipe = (recipeToSave: Recipe, newIngredientsToRegister: Ingredient[]) => {
    // 1. If we have on-the-fly ingredients created under Requirement 3, save them in the main database first!
    let updatedIngredients = [...ingredients];
    const tempToRealIdMap: Record<string, string> = {};

    newIngredientsToRegister.forEach(tempIng => {
      const realId = `ing_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      tempToRealIdMap[tempIng.id] = realId;

      const registeredItem: Ingredient = {
        ...tempIng,
        id: realId,
      };
      updatedIngredients.push(registeredItem);
    });

    // Save registered items
    if (newIngredientsToRegister.length > 0) {
      setIngredients(updatedIngredients);
    }

    // 2. Adjust recipe ingredient mappings replacing temp IDs
    const resolvedIngredients = recipeToSave.ingredients.map(ri => {
      if (tempToRealIdMap[ri.ingredientId]) {
        return {
          ...ri,
          ingredientId: tempToRealIdMap[ri.ingredientId],
        };
      }
      return ri;
    });

    const finalizedRecipe: Recipe = {
      ...recipeToSave,
      ingredients: resolvedIngredients,
    };

    // 3. Save / update recipe array
    const exists = recipes.some(r => r.id === finalizedRecipe.id);
    if (exists) {
      setRecipes(recipes.map(r => (r.id === finalizedRecipe.id ? finalizedRecipe : r)));
    } else {
      setRecipes([finalizedRecipe, ...recipes]);
    }

    // Set as active selected card
    setSelectedRecipeId(finalizedRecipe.id);
    setIsEditing(false);
    setEditingRecipeId(null);
  };

  const handleDuplicateRecipe = (recipeId: string) => {
    const source = recipes.find(r => r.id === recipeId);
    if (!source) return;

    const dupRecipe: Recipe = {
      ...source,
      id: `rec_dup_${Date.now()}`,
      name: `${source.name} (Copy)`,
      createdAt: new Date().toISOString(),
    };

    setRecipes([dupRecipe, ...recipes]);
    setSelectedRecipeId(dupRecipe.id);
    setIsEditing(false);
  };

  const handleDeleteRecipe = (recipeId: string) => {
    const updated = recipes.filter(r => r.id !== recipeId);
    setRecipes(updated);
    if (selectedRecipeId === recipeId) {
      setSelectedRecipeId(updated.length > 0 ? updated[0].id : null);
    }
    setIsEditing(false);
  };

  // Active editors trigger
  const triggerCreateRecipe = () => {
    setEditingRecipeId(null);
    setIsEditing(true);
  };

  const triggerEditRecipe = (recipeId: string) => {
    setEditingRecipeId(recipeId);
    setIsEditing(true);
  };

  // Recipe selections
  const activeRecipe = recipes.find(r => r.id === selectedRecipeId) || null;
  const filteredRecipesList = recipes.filter(r =>
    r.name.toLowerCase().includes(recipeSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-800 font-sans flex flex-col antialiased">
      
      {/* Visual Navigation Banner */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100/90 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-linear-to-tr from-teal-600 to-sky-500 text-white rounded-2xl shadow-sm">
              <ChefHat className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5 leading-none">
                Food Costing Calculator
                <span className="text-[10px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                  CP Engine
                </span>
              </h1>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest font-mono">
                Responsive Food Yield Cost Price Auditor
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono font-semibold">
              Live Cooking Clock: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace Stage */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column stage: Dishes & Active costing audits (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {isEditing ? (
            <RecipeEditor
              recipe={recipes.find(r => r.id === editingRecipeId) || null}
              ingredientsList={ingredients}
              onSave={handleSaveRecipe}
              onCancel={() => {
                setIsEditing(false);
                setEditingRecipeId(null);
              }}
            />
          ) : (
            <>
              {/* Recipe Selector Panel */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                      <Layers className="w-4 h-4 text-teal-500" />
                      Dishes & Menu Recipes
                    </h3>
                    <p className="text-xs text-slate-400">Select dished recipes below to audit calculated Batch Costs</p>
                  </div>

                  <button
                    onClick={triggerCreateRecipe}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:shadow-xs shadow-2xs transition whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    New Recipe
                  </button>
                </div>

                {/* Recipe lists filters */}
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={recipeSearch}
                    onChange={e => setRecipeSearch(e.target.value)}
                    placeholder="Search saved recipes by name..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50/70 hover:bg-slate-50 border border-slate-100/80 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition font-medium text-slate-600"
                  />
                </div>

                {/* Recipe selection grid/chips */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                  {filteredRecipesList.length === 0 ? (
                    <div className="col-span-full text-center py-6 text-slate-400">
                      <p className="text-xs font-semibold">No recipes matches found</p>
                      <button
                        onClick={() => setRecipeSearch('')}
                        className="text-xs text-teal-600 underline font-medium mt-1 cursor-pointer"
                      >
                        Clear search filter
                      </button>
                    </div>
                  ) : (
                    filteredRecipesList.map(r => {
                      const isActive = selectedRecipeId === r.id;
                      const cCosts = calculateRecipeCosts(r, ingredients, conversions, gasConfig);
                      const servingQuantity = getRecipeServingQuantity(r);
                      const displayedLabel = r.yieldType === 'weight' ? 'g' : 'pieces';
                      const servingCost = calculateServingCost(r, cCosts.totalBatchCost, servingQuantity);

                      return (
                        <div
                          key={r.id}
                          onClick={() => setSelectedRecipeId(r.id)}
                          className={`p-4 rounded-2xl border cursor-pointer select-none transition-all flex flex-col justify-between ${
                            isActive
                              ? 'bg-teal-50/40 border-teal-500/40 ring-1 ring-teal-500/10 shadow-xs'
                              : 'bg-white hover:bg-slate-100/30 border-slate-100 shadow-2xs'
                          }`}
                        >
                          <div>
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-bold text-slate-700 text-sm line-clamp-1">
                                {r.name}
                              </span>
                              <span className="font-mono text-xs font-extrabold text-teal-600 whitespace-nowrap">
                                ₹{servingCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="mt-3">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                                  Serving Quantity
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="0.1"
                                  value={servingQuantity}
                                  onChange={e => setRecipeServingQuantities({
                                    ...recipeServingQuantities,
                                    [r.id]: e.target.value,
                                  })}
                                  className="w-20 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500"
                                />
                                <span className="text-[10px] text-slate-400">
                                  {displayedLabel}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-2">
                                Serving: {servingQuantity} {displayedLabel}
                              </p>
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-slate-100/60 text-[9px] font-mono text-slate-400">
                            <span>{r.ingredients.length} items</span>
                            <span className="bg-slate-100/80 text-slate-500 font-bold px-1.5 py-0.2 rounded">
                              {r.cookingTimeMins} min cooked
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Costing breakdown stage sheet */}
              {activeRecipe ? (
                <RecipeDetail
                  recipe={activeRecipe}
                  ingredients={ingredients}
                  conversions={conversions}
                  gasConfig={gasConfig}
                  onEdit={triggerEditRecipe}
                  onDuplicate={handleDuplicateRecipe}
                  onDelete={handleDeleteRecipe}
                />
              ) : (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                  <UtensilsCrossed className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold">No Dish Recipe Selected</p>
                  <p className="text-xs text-slate-400/80 mt-1 max-w-sm mx-auto">
                    Please register or select an existing recipe from the list above to audit ingredient ratios and fuel rates.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column stage: Ingredients database, Conversions & Gas module (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Tabs header controller */}
          <div className="bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between gap-1">
            <button
              onClick={() => setActiveTab('ingredients')}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2 px-1 text-center rounded-xl transition duration-150 cursor-pointer ${
                activeTab === 'ingredients'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Apple className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Materials</span>
            </button>

            <button
              onClick={() => setActiveTab('gas')}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2 px-1 text-center rounded-xl transition duration-150 cursor-pointer ${
                activeTab === 'gas'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Flame className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Gas</span>
            </button>

            <button
              onClick={() => setActiveTab('conversions')}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2 px-1 text-center rounded-xl transition duration-150 cursor-pointer ${
                activeTab === 'conversions'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">tsp weights</span>
            </button>
          </div>

          {/* Active Tab Panel renderer */}
          <div className="h-full">
            {activeTab === 'ingredients' && (
              <IngredientManager
                ingredients={ingredients}
                recipesCountMap={recipesCountMap}
                onAdd={handleAddIngredient}
                onEdit={handleEditIngredient}
                onDelete={handleDeleteIngredient}
                onBulkImport={handleBulkImportIngredients}
              />
            )}

            {activeTab === 'gas' && (
              <GasCostCalculator
                config={gasConfig}
                onChange={setGasConfig}
              />
            )}

            {activeTab === 'conversions' && (
              <ConversionsManager
                conversions={conversions}
                onAdd={handleAddConversion}
                onEdit={handleEditConversion}
                onDelete={handleDeleteConversion}
                onReset={handleResetConversions}
              />
            )}
          </div>
        </div>
      </main>

      {/* Page Footer */}
      <footer className="mt-auto bg-slate-900 text-white border-t border-slate-800 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs select-none">
          <div className="space-y-1">
            <p className="font-semibold text-slate-300">Food Costing Calculator CP Engine</p>
            <p className="text-slate-500 font-mono">Precision accounting metrics for professional smart kitchens</p>
          </div>
          <div className="flex items-center gap-2 text-slate-500 font-medium">
            <span>Responsive Native Web Application</span>
            <span>•</span>
            <span>Local Persistent Ledger (No Login Required)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
