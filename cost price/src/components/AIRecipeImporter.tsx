/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * AI-assisted natural language recipe importer and interactive review modal.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  X,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  RotateCcw,
  Scale,
  Flame,
  Clock,
  Plus,
} from 'lucide-react';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import { parseRecipeFromNaturalLanguage } from '../services/aiRecipeService';
import { ingestAIRecipe, IngestedRecipeReview, MatchedIngredientDetail } from '../services/aiRecipeMatcher';
import { getCostPerUnit } from '../data';

interface AIRecipeImporterProps {
  isOpen: boolean;
  onClose: () => void;
  ingredientsList: Ingredient[];
  conversionsList: TeaspoonConversion[];
  gasConfig: GasConfig;
  onConfirmRecipe: (recipe: Recipe, newIngredientsToRegister: Ingredient[], newConversionsToSave?: TeaspoonConversion[]) => void;
}

const SAMPLE_PROMPT =
  'Prepare vegetable poha using 200 g poha, one medium onion, 30 g peanuts, half a teaspoon of turmeric, 1 teaspoon salt, 2 tablespoons oil, and 10 minutes of cooking time. The final cooked yield is 500 g.';

export default function AIRecipeImporter({
  isOpen,
  onClose,
  ingredientsList,
  conversionsList,
  gasConfig,
  onConfirmRecipe,
}: AIRecipeImporterProps) {
  const [inputText, setInputText] = useState(SAMPLE_PROMPT);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Review stage state
  const [reviewData, setReviewData] = useState<IngestedRecipeReview | null>(null);

  // User resolution state
  // Unmatched resolutions: map index -> { selectedIngredientId?: string; isNewCustom?: boolean; newName?: string; purchaseQty?: string; purchaseUnit?: 'kg'|'g'|'litre'|'ml'; purchaseCost?: string }
  const [unmatchedResolutions, setUnmatchedResolutions] = useState<
    Record<
      number,
      {
        selectedId?: string;
        isNew?: boolean;
        newName?: string;
        purchaseQty?: string;
        purchaseUnit?: 'kg' | 'g' | 'litre' | 'ml';
        purchaseCost?: string;
      }
    >
  >({});

  // Teaspoon conversion resolutions: map ingredientName -> { weightGrams: number; saveAsDefault: boolean }
  const [tspResolutions, setTspResolutions] = useState<Record<string, { weightGrams: number; saveAsDefault: boolean }>>({});

  // Unit and quantity overrides: map index -> { quantity?: number; unit?: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' }
  const [rowOverrides, setRowOverrides] = useState<Record<number, { quantity?: number; unit?: 'g' | 'kg' | 'ml' | 'litre' | 'tsp' }>>({});

  if (!isOpen) return null;

  const handleParse = async () => {
    if (!inputText.trim()) {
      setErrorMessage('Please enter a recipe description.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { recipe: parsedAI } = await parseRecipeFromNaturalLanguage(inputText);
      const ingested = ingestAIRecipe(parsedAI, ingredientsList, conversionsList, gasConfig);
      setReviewData(ingested);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to parse recipe. Please try again or enter manually.');
    } finally {
      setIsLoading(false);
    }
  };

  // Resolve an unmatched row by picking an existing ingredient from dropdown
  const handleSelectExistingIngredient = (index: number, ingredientId: string) => {
    setUnmatchedResolutions(prev => ({
      ...prev,
      [index]: { selectedId: ingredientId, isNew: false },
    }));
  };

  // Resolve an unmatched row by registering a custom material
  const handleSetCustomIngredient = (index: number, updates: Partial<{ newName: string; purchaseQty: string; purchaseUnit: 'kg' | 'g' | 'litre' | 'ml'; purchaseCost: string }>) => {
    setUnmatchedResolutions(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        isNew: true,
        ...updates,
      },
    }));
  };

  // Resolve a missing teaspoon conversion (custom or suggested default)
  const handleResolveTsp = (idx: number, ingredientName: string, weightGrams: number, saveAsDefault: boolean) => {
    setTspResolutions(prev => ({
      ...prev,
      [ingredientName.toLowerCase().trim()]: { weightGrams, saveAsDefault },
    }));
    if (!saveAsDefault) {
      // If only applying to this recipe without global default, convert row unit to grams directly
      const currentQty = reviewData?.draftRecipe.ingredients[idx]?.quantity || 1;
      setRowOverrides(prev => ({
        ...prev,
        [idx]: { quantity: currentQty * weightGrams, unit: 'g' },
      }));
    }
  };

  // Final confirmation
  const handleConfirmAndSave = () => {
    if (!reviewData) return;

    const newIngredientsToCreate: Ingredient[] = [];
    const newConversionsToSave: TeaspoonConversion[] = [];

    // Save persistent teaspoon conversions if user opted in
    Object.entries(tspResolutions).forEach(([name, res]) => {
      const typedRes = res as { weightGrams: number; saveAsDefault: boolean };
      if (typedRes.saveAsDefault && typedRes.weightGrams > 0) {
        newConversionsToSave.push({
          id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          weightGrams: typedRes.weightGrams,
        });
      }
    });

    // Map ingredients with resolutions
    const finalizedIngredients = reviewData.draftRecipe.ingredients.map((ri, index) => {
      const resolution = unmatchedResolutions[index];
      const override = rowOverrides[index];

      let ingredientId = ri.ingredientId;
      let name = ri.name;
      let quantity = override?.quantity !== undefined ? override.quantity : ri.quantity;
      let unit = override?.unit !== undefined ? override.unit : ri.unit;

      if (resolution?.isNew && resolution.newName) {
        const pQty = parseFloat(resolution.purchaseQty || '1');
        const pCost = parseFloat(resolution.purchaseCost || '0');
        const pUnit = resolution.purchaseUnit || 'kg';
        const costPerUnit = getCostPerUnit(pQty, pUnit, pCost);
        const tempId = `temp_ai_${index}_${Date.now()}`;

        newIngredientsToCreate.push({
          id: tempId,
          name: resolution.newName.trim(),
          purchaseQty: pQty,
          purchaseUnit: pUnit,
          purchaseCost: pCost,
          costPerUnit,
        });

        ingredientId = tempId;
        name = resolution.newName.trim();
      } else if (resolution?.selectedId) {
        ingredientId = resolution.selectedId;
        const found = ingredientsList.find(i => i.id === resolution.selectedId);
        if (found) name = found.name;
      }

      return {
        ...ri,
        ingredientId,
        name,
        quantity,
        unit,
      };
    });

    const finalizedRecipe: Recipe = {
      ...reviewData.draftRecipe,
      ingredients: finalizedIngredients,
    };

    onConfirmRecipe(finalizedRecipe, newIngredientsToCreate, newConversionsToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-teal-600 to-sky-500 text-white rounded-2xl shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 leading-none">AI Recipe Import</h3>
              <p className="text-xs text-slate-400 mt-1">Convert spoken or written kitchen recipes into structured costed sheets</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {!reviewData ? (
            /* Stage 1: Input Natural Language Text */
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                  Describe the recipe in natural language
                </label>
                <textarea
                  rows={5}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="e.g. Prepare vegetable poha using 200 g poha, 1 onion, 1 tsp salt, 2 tbsp oil..."
                  className="w-full p-4 text-sm bg-slate-50/70 border border-slate-200 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none rounded-2xl transition font-medium text-slate-700 leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>The AI extracts ingredients, cooking times, and yield without altering costs.</span>
                <button
                  type="button"
                  onClick={() => setInputText(SAMPLE_PROMPT)}
                  className="text-teal-600 font-semibold hover:underline cursor-pointer"
                >
                  Load Sample Recipe
                </button>
              </div>

              {errorMessage && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-700 text-xs font-semibold">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
                  <p>{errorMessage}</p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleParse}
                  className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      Parsing Recipe with AI...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Parse with AI
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Stage 2: Interactive Review Screen */
            <div className="space-y-6">
              {/* Recipe Summary Bar */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Recipe Name</span>
                  <input
                    type="text"
                    value={reviewData.draftRecipe.name}
                    onChange={e =>
                      setReviewData({
                        ...reviewData,
                        draftRecipe: { ...reviewData.draftRecipe, name: e.target.value },
                      })
                    }
                    className="w-full text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-teal-500 mt-0.5"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Cook Time (mins)</span>
                  <input
                    type="number"
                    min="0"
                    value={reviewData.draftRecipe.cookingTimeMins}
                    onChange={e =>
                      setReviewData({
                        ...reviewData,
                        draftRecipe: { ...reviewData.draftRecipe, cookingTimeMins: parseInt(e.target.value, 10) || 0 },
                      })
                    }
                    className="w-full text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-teal-500 mt-0.5"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Cooked Yield ({reviewData.draftRecipe.yieldType === 'weight' ? 'g' : 'pcs'})
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={reviewData.draftRecipe.yieldAmount}
                    onChange={e =>
                      setReviewData({
                        ...reviewData,
                        draftRecipe: { ...reviewData.draftRecipe, yieldAmount: parseFloat(e.target.value) || 1 },
                      })
                    }
                    className="w-full text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-teal-500 mt-0.5"
                  />
                </div>
              </div>

              {/* Status Banner */}
              <div
                className={`p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs font-semibold ${
                  reviewData.breakdown.isComplete
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  {reviewData.breakdown.isComplete ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  )}
                  <span>
                    {reviewData.breakdown.isComplete
                      ? 'All ingredients and conversions are verified. Ready to calculate final cost.'
                      : `Draft Recipe: ${reviewData.breakdown.unresolvedIssues.length} item(s) require your resolution.`}
                  </span>
                </div>
                <span className="font-mono font-bold text-sm">
                  {reviewData.breakdown.isComplete
                    ? `₹${reviewData.breakdown.totalBatchCost.toFixed(2)}`
                    : `~₹${reviewData.breakdown.totalBatchCost.toFixed(2)} (Draft)`}
                </span>
              </div>

              {/* Parsed Ingredients Review List */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                  Extracted Ingredients ({reviewData.matchedDetails.length})
                </h4>

                <div className="space-y-3">
                  {reviewData.matchedDetails.map((detail, idx) => {
                    const rowRes = unmatchedResolutions[idx];
                    const isRowMatched = detail.isMatched || !!rowRes?.selectedId || !!rowRes?.isNew;
                    const cleanName = detail.extractedIngredient.name.toLowerCase().trim();
                    const isTspMissing = detail.missingConversion && !tspResolutions[cleanName];

                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-2xl border space-y-3 transition ${
                          !isRowMatched || isTspMissing || detail.isUnsupportedUnit
                            ? 'bg-amber-50/40 border-amber-200'
                            : 'bg-white border-slate-100 shadow-2xs'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-800">
                              {detail.extractedIngredient.name}
                            </span>
                            <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-semibold">
                              {detail.extractedIngredient.quantity ?? '?'} {detail.rawUnit}
                            </span>
                            {detail.extractedIngredient.originalText && (
                              <span className="text-[10px] text-slate-400 italic">
                                &quot;{detail.extractedIngredient.originalText}&quot;
                              </span>
                            )}
                          </div>

                          {/* Match status badge */}
                          <div>
                            {isRowMatched ? (
                              <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                                Matched: {rowRes?.newName || detail.matchedIngredient?.name}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">
                                Unmatched
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Interactive prompt if ingredient is NOT matched */}
                        {!detail.isMatched && !rowRes?.selectedId && !rowRes?.isNew && (
                          <div className="bg-white p-3 rounded-xl border border-amber-200/80 space-y-2 text-xs">
                            <p className="font-bold text-amber-900">
                              We could not find &quot;{detail.extractedIngredient.name}&quot; in your database.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <select
                                onChange={e => {
                                  if (e.target.value === 'new') {
                                    handleSetCustomIngredient(idx, { newName: detail.extractedIngredient.name });
                                  } else if (e.target.value) {
                                    handleSelectExistingIngredient(idx, e.target.value);
                                  }
                                }}
                                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none font-semibold text-slate-700 flex-1"
                              >
                                <option value="">Select existing ingredient from database...</option>
                                {ingredientsList.map(ing => (
                                  <option key={ing.id} value={ing.id}>
                                    {ing.name} (₹{ing.purchaseCost}/{ing.purchaseQty}{ing.purchaseUnit})
                                  </option>
                                ))}
                                <option value="new">➕ Register as new ingredient...</option>
                              </select>
                            </div>
                          </div>
                        )}

                        {/* If user chose to register custom ingredient */}
                        {rowRes?.isNew && (
                          <div className="bg-white p-3 rounded-xl border border-amber-200 space-y-2 text-xs">
                            <span className="font-bold text-slate-700 block">Register Purchase Specs:</span>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-500 font-bold block">Purchase Qty</label>
                                <input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  value={rowRes.purchaseQty || '1'}
                                  onChange={e => handleSetCustomIngredient(idx, { purchaseQty: e.target.value })}
                                  className="w-full p-1 text-xs border rounded font-mono"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-bold block">Purchase Unit</label>
                                <select
                                  value={rowRes.purchaseUnit || 'kg'}
                                  onChange={e => handleSetCustomIngredient(idx, { purchaseUnit: e.target.value as any })}
                                  className="w-full p-1 text-xs border rounded"
                                >
                                  <option value="kg">kg</option>
                                  <option value="g">g</option>
                                  <option value="litre">litre</option>
                                  <option value="ml">ml</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-bold block">Cost (₹)</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={rowRes.purchaseCost || '50'}
                                  onChange={e => handleSetCustomIngredient(idx, { purchaseCost: e.target.value })}
                                  className="w-full p-1 text-xs border rounded font-mono font-bold"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Interactive prompt if missing teaspoon conversion */}
                        {isTspMissing && (
                          <div className="bg-white p-3 rounded-xl border border-amber-200/80 space-y-2 text-xs">
                            <div className="flex items-center gap-1.5 font-bold text-amber-900">
                              <Scale className="w-4 h-4 text-amber-600" />
                              <span>We don&apos;t have a verified weight for 1 teaspoon of {detail.extractedIngredient.name}. What would you like to do?</span>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleResolveTsp(idx, detail.extractedIngredient.name, 4, false)}
                                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition"
                              >
                                Use suggested default (4g) for this recipe
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveTsp(idx, detail.extractedIngredient.name, 4, true)}
                                className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded-lg transition border border-teal-200"
                              >
                                Use 4g &amp; Save as default
                              </button>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  placeholder="custom g"
                                  className="w-20 px-2 py-0.5 text-xs border rounded"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      const val = parseFloat((e.target as HTMLInputElement).value);
                                      if (val > 0) handleResolveTsp(idx, detail.extractedIngredient.name, val, true);
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Interactive prompt if unsupported unit (e.g. piece, tbsp, cup) */}
                        {detail.isUnsupportedUnit && (
                          <div className="bg-white p-3 rounded-xl border border-amber-200/80 space-y-2 text-xs">
                            <p className="font-bold text-amber-900">
                              Unit &quot;{detail.rawUnit}&quot; cannot be automatically converted to weight. Please enter the quantity in grams or ml:
                            </p>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                placeholder="e.g. 100"
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  if (val > 0) setRowOverrides(prev => ({ ...prev, [idx]: { quantity: val, unit: 'g' } }));
                                }}
                                className="w-28 px-2 py-1 text-xs border rounded font-mono font-bold"
                              />
                              <span className="text-slate-500 font-mono">grams</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setReviewData(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Back to Text
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAndSave}
                    className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Confirm &amp; Import Recipe
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
