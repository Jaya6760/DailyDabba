/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Recipe, Ingredient, TeaspoonConversion, GasConfig } from '../types';
import { calculateRecipeCosts, calculateGasCosts } from '../utils';
import {
  Sparkles,
  Flame,
  ChefHat,
  Copy,
  Edit,
  Trash2,
  HelpCircle,
  Clock,
  Printer,
  TrendingUp,
  RotateCcw,
  PlusCircle,
  AlertTriangle,
} from 'lucide-react';

interface RecipeDetailProps {
  recipe: Recipe;
  ingredients: Ingredient[];
  conversions: TeaspoonConversion[];
  gasConfig: GasConfig;
  onEdit: (recipeId: string) => void;
  onDuplicate: (recipeId: string) => void;
  onDelete: (recipeId: string) => void;
}

export default function RecipeDetail({
  recipe,
  ingredients,
  conversions,
  gasConfig,
  onEdit,
  onDuplicate,
  onDelete,
}: RecipeDetailProps) {
  const [customServingWeight, setCustomServingWeight] = useState<string>('100');
  const [customServingPieces, setCustomServingPieces] = useState<string>('1');
  const [showDebug, setShowDebug] = useState<boolean>(true);

  const breakdown = calculateRecipeCosts(recipe, ingredients, conversions, gasConfig);

  // Custom costing calculation
  const customWeightValue = parseFloat(customServingWeight);
  const customPieceValue = parseFloat(customServingPieces);

  const calculatedCustomWeightCost = breakdown.yieldAmount > 0 && !Number.isNaN(customWeightValue)
    ? (breakdown.totalBatchCost / breakdown.yieldAmount) * customWeightValue
    : 0;

  const calculatedCustomPieceCost = breakdown.yieldAmount > 0 && !Number.isNaN(customPieceValue)
    ? (breakdown.totalBatchCost / breakdown.yieldAmount) * customPieceValue
    : 0;

  return (
    <div id="recipe-detail" className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-5 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1 px-2.5 bg-teal-50 text-teal-600 rounded-lg text-xs font-bold uppercase tracking-wider font-mono">
              Recipe Card
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1 font-medium">
              <Clock className="w-3 h-3" />
              {recipe.cookingTimeMins} mins cook
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{recipe.name}</h2>
          <p className="text-xs text-slate-400">
            Serving: <strong className="text-slate-600 font-mono">{recipe.yieldAmount} {recipe.yieldType === 'weight' ? 'g' : 'Pieces'}</strong>
          </p>
        </div>

        {/* Card actions */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          <button
            onClick={() => onDuplicate(recipe.id)}
            className="p-2 text-slate-500 hover:text-teal-600 hover:bg-slate-50 rounded-xl border border-slate-100 transition shadow-sm"
            title="Duplicate Recipe"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(recipe.id)}
            className="p-2 text-slate-500 hover:text-teal-600 hover:bg-slate-50 rounded-xl border border-slate-100 transition shadow-sm"
            title="Edit Recipe"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Are you sure you want to delete "${recipe.name}"?`)) {
                onDelete(recipe.id);
              }
            }}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl border border-transparent transition"
            title="Delete Recipe"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Costing Summary Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total Batch Cost Card */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-md relative overflow-hidden">
          <ChefHat className="absolute right-0 bottom-0 w-24 h-24 text-white/5 -mb-4 -mr-4 pointer-events-none" />
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Batch Cost Price</p>
            {!breakdown.isComplete && (
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md">
                Incomplete (Draft)
              </span>
            )}
          </div>
          <p className="text-4xl font-extrabold font-mono tracking-tight mt-1.5 text-teal-300 flex items-baseline gap-2 flex-wrap">
            <span>₹{breakdown.totalBatchCost.toFixed(2)}</span>
            {!breakdown.isComplete && (
              <span className="text-xs font-semibold text-amber-300/90 font-sans">
                (Unresolved: {breakdown.unresolvedIssues.length} issue{breakdown.unresolvedIssues.length !== 1 ? 's' : ''})
              </span>
            )}
          </p>
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-white/10 text-xs text-slate-300 font-medium font-mono">
            <span>Ingredients: ₹{breakdown.ingredientsCost.toFixed(2)}</span>
            <span>Gas: ₹{breakdown.gasCost.toFixed(2)}</span>
          </div>
        </div>

        {/* Dynamic Cost Mode Card */}
        <div className="bg-slate-50/80 border border-slate-100 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">
              Costing Mode Selector
            </p>

            {recipe.yieldType === 'weight' ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-500">Custom Serving Quantity:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={customServingWeight}
                      onChange={e => setCustomServingWeight(e.target.value)}
                      className="w-16 px-1.5 py-0.5 text-xs text-right bg-white border border-slate-200 rounded font-semibold text-slate-700"
                    />
                    <span className="text-xs font-mono text-slate-400">g</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="10"
                  max={Math.max(recipe.yieldAmount * 2, 500)}
                  step="10"
                  value={customServingWeight}
                  onChange={e => setCustomServingWeight(parseInt(e.target.value))}
                  className="w-full accent-teal-600 h-1 bg-slate-200 rounded-lg cursor-pointer"
                />

                <div className="pt-2 border-t border-slate-100 flex justify-between items-end">
                  <span className="text-xs text-slate-400 font-semibold uppercase font-mono">Cost per {customServingWeight}g :</span>
                  <span className="text-xl font-bold font-mono text-slate-700 text-teal-600">
                    ₹{calculatedCustomWeightCost.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-500">Serving size (Pieces):</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      value={customServingPieces}
                      onChange={e => setCustomServingPieces(e.target.value)}
                      className="w-16 px-1.5 py-0.5 text-xs text-right bg-white border border-slate-200 rounded font-semibold text-slate-700 font-mono"
                    />
                    <span className="text-xs font-medium text-slate-400">pc</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-between items-end">
                  <span className="text-xs text-slate-400 font-semibold uppercase font-mono">
                    Cost per {customServingPieces} Piece{customServingPieces > 1 ? 's' : ''} :
                  </span>
                  <span className="text-xl font-bold font-mono text-teal-600">
                    ₹{calculatedCustomPieceCost.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="text-[10px] text-slate-400 font-mono mt-3 leading-tight">
            Formula: {recipe.yieldType === 'weight'
              ? `(₹${breakdown.totalBatchCost.toFixed(2)} / ${breakdown.yieldAmount}g cooked) × ${customServingWeight}g`
              : `(₹${breakdown.totalBatchCost.toFixed(2)} / ${breakdown.yieldAmount} pieces) × ${customServingPieces}`}
          </div>
        </div>
      </div>

      {/* Unresolved Issues Alert Banner */}
      {!breakdown.isComplete && breakdown.unresolvedIssues.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Action Required: This recipe has {breakdown.unresolvedIssues.length} unresolved costing item{breakdown.unresolvedIssues.length !== 1 ? 's' : ''}</span>
          </div>
          <ul className="space-y-1 text-xs text-amber-800">
            {breakdown.unresolvedIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-500 font-bold">•</span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700/80 italic pt-1">
            Note: Costs shown above are partial estimates. A final verified recipe cost requires all ingredients, conversions, and prices to be resolved.
          </p>
        </div>
      )}

      {/* Debug Mode Breakdown Section */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
            <span className="font-bold text-slate-600 text-xs uppercase tracking-wider">
              Audit Sheet (Cost Breakdown)
            </span>
          </div>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-teal-600 hover:text-teal-700 font-semibold transition bg-teal-50 hover:bg-teal-100/60 px-2.5 py-1 rounded-lg"
          >
            {showDebug ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        {showDebug && (
          <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden text-sm relative">
            <div className="p-4 bg-slate-100/50 border-b border-slate-200/50 flex justify-between items-center">
              <span className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                Component / Material
              </span>
              <span className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-widest text-right">
                Cost Contribution (₹)
              </span>
            </div>

            {/* List */}
            <div className="divide-y divide-slate-100 font-medium">
              {breakdown.rows.map((row, idx) => {
                const ri = row.recipeIngredient;
                return (
                  <div key={ri.id || idx} className="p-3 px-4 flex justify-between items-start gap-4">
                    <div className="space-y-0.5 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-700 text-xs font-semibold">{row.recipeIngredient.name}</span>
                        <span className="text-[10px] font-mono bg-slate-200/55 text-slate-500 rounded px-1.5 py-0.2">
                          {ri.quantity} {ri.unit}
                        </span>
                        
                        {/* Display tsp converted weight details if it was a teaspoon */}
                        {row.isTsp && (
                          <span
                            className={`text-[9px] font-mono rounded px-1.5 py-0.5 border ${
                              row.conversionGrams > 0
                                ? 'bg-teal-50 text-teal-600 border-teal-200'
                                : 'bg-amber-50 text-amber-600 border-amber-200 font-bold'
                            }`}
                            title={row.conversionGrams > 0 ? 'Verified teaspoon conversion' : 'Missing verified teaspoon conversion'}
                          >
                            {row.conversionGrams > 0
                              ? `= ${row.effectiveQty}g (${row.conversionGrams}g/tsp)`
                              : '⚠ Missing tsp weight'}
                          </span>
                        )}
                      </div>
                      
                      {row.isUnresolved ? (
                        <p className="text-[10px] text-amber-700 flex items-center gap-1 font-medium mt-0.5">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-500" />
                          <span>{row.unresolvedReason || 'Unresolved calculation'}</span>
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-400 font-mono">
                          Computed: {row.effectiveQty}{row.baseUnit} × ₹{row.matchedIngredient?.costPerUnit.toFixed(4)}/{row.baseUnit}
                        </p>
                      )}
                    </div>
                    
                    <div className="text-right font-mono font-bold text-xs self-center">
                      {row.isUnresolved ? (
                        <span className="text-amber-600 text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          Pending
                        </span>
                      ) : (
                        <span className="text-slate-700">₹{row.cost.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Gas cost row */}
              <div className="p-3 px-4 flex justify-between items-start gap-4 bg-rose-50/30">
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-rose-500 fill-rose-100 flex-shrink-0" />
                    <span className="text-slate-700 text-xs font-bold">Cooking Gas Cost</span>
                    <span className="text-[10px] font-mono bg-rose-100/50 text-rose-600 rounded px-1.5 py-0.2">
                      {recipe.cookingTimeMins} mins
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Computed: {recipe.cookingTimeMins} mins × ₹{(calculateGasCosts(gasConfig).costPerMinute).toFixed(4)}/min
                  </p>
                </div>
                
                <div className="text-right font-mono font-bold text-rose-600 text-xs self-center">
                  ₹{breakdown.gasCost.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Calculations Totals section */}
            <div className="p-4 bg-slate-100/70 border-t border-slate-200/50 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between text-slate-500 font-semibold">
                <span>INGREDIENTS SUB-TOTAL:</span>
                <span className="font-bold text-slate-600">₹{breakdown.ingredientsCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500 font-semibold mb-1">
                <span>GAS COST SUB-TOTAL:</span>
                <span className="font-bold text-slate-600">₹{breakdown.gasCost.toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-300 pt-2 flex justify-between font-extrabold text-slate-800 text-sm">
                <span>TOTAL BATCH COST PRICE{breakdown.isComplete ? '' : ' (ESTIMATED)'}:</span>
                <span className={breakdown.isComplete ? 'text-teal-600' : 'text-amber-600'}>
                  ₹{breakdown.totalBatchCost.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
