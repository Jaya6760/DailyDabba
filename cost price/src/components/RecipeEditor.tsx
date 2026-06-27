/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Recipe, Ingredient, RecipeIngredient } from '../types';
import { getCostPerUnit } from '../data';
import {
  X,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle,
} from 'lucide-react';

interface RecipeEditorProps {
  recipe: Recipe | null; // Null means we are creating a new recipe
  ingredientsList: Ingredient[];
  onSave: (recipe: Recipe, newIngredientsToRegister: Ingredient[]) => void;
  onCancel: () => void;
}

interface EditorRow {
  localId: string;
  ingredientId: string; // "new" if user is typing a custom ingredient
  name: string;
  quantity: string;
  unit: 'g' | 'kg' | 'ml' | 'litre' | 'tsp';
  // If it's a new ingredient being added on the fly:
  isNew: boolean;
  purchaseQty: string;
  purchaseUnit: 'kg' | 'g' | 'litre' | 'ml';
  purchaseCost: string;
}

export default function RecipeEditor({
  recipe,
  ingredientsList,
  onSave,
  onCancel,
}: RecipeEditorProps) {
  const [recipeName, setRecipeName] = useState('');
  const [yieldType, setYieldType] = useState<'weight' | 'piece'>('weight');
  const [yieldAmount, setYieldAmount] = useState('1000');
  const [cookingTimeMins, setCookingTimeMins] = useState('10');
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Initialize from existing recipe if editing
  useEffect(() => {
    if (recipe) {
      setRecipeName(recipe.name);
      setYieldType(recipe.yieldType);
      setYieldAmount(recipe.yieldAmount.toString());
      setCookingTimeMins(recipe.cookingTimeMins.toString());

      // Map ingredients
      const mappedRows: EditorRow[] = recipe.ingredients.map((ri, idx) => {
        const matchesDB = ingredientsList.find(i => i.id === ri.ingredientId);
        return {
          localId: `row_${idx}_${Date.now()}`,
          ingredientId: ri.ingredientId,
          name: ri.name,
          quantity: ri.quantity.toString(),
          unit: ri.unit,
          isNew: !matchesDB,
          purchaseQty: '1',
          purchaseUnit: 'kg',
          purchaseCost: '0',
        };
      });
      setRows(mappedRows);
    } else {
      // Create empty template
      setRecipeName('');
      setYieldType('weight');
      setYieldAmount('1000');
      setCookingTimeMins('10');
      setRows([
        {
          localId: `row_0_${Date.now()}`,
          ingredientId: ingredientsList[0]?.id || '',
          name: ingredientsList[0]?.name || '',
          quantity: '100',
          unit: 'g',
          isNew: false,
          purchaseQty: '1',
          purchaseUnit: 'kg',
          purchaseCost: '0',
        },
      ]);
    }
  }, [recipe, ingredientsList]);

  // Handle addition of row
  const addRow = () => {
    const defaultIng = ingredientsList[0];
    const newRow: EditorRow = {
      localId: `row_${Date.now()}_${Math.random()}`,
      ingredientId: defaultIng?.id || '',
      name: defaultIng?.name || '',
      quantity: '50',
      unit: 'g',
      isNew: false,
      purchaseQty: '1',
      purchaseUnit: 'kg',
      purchaseCost: '0',
    };
    setRows([...rows, newRow]);
  };

  // Handle deletions of rows
  const removeRow = (localId: string) => {
    setRows(rows.filter(r => r.localId !== localId));
  };

  // Change individual rows
  const updateRow = (localId: string, updates: Partial<EditorRow>) => {
    setRows(
      rows.map(r => {
        if (r.localId === localId) {
          const merged = { ...r, ...updates };
          
          // If changing ingredientSelection to a registered item:
          if (updates.ingredientId && updates.ingredientId !== 'new') {
            const found = ingredientsList.find(i => i.id === updates.ingredientId);
            if (found) {
              merged.name = found.name;
              merged.isNew = false;
              // Suggest matching base unit as default
              if (found.purchaseUnit === 'litre' || found.purchaseUnit === 'ml') {
                merged.unit = 'ml';
              } else {
                merged.unit = 'g';
              }
            }
          } else if (updates.ingredientId === 'new') {
            merged.isNew = true;
            merged.name = ''; // Need to type custom name
            merged.unit = 'g';
          }
          return merged;
        }
        return r;
      })
    );
  };

  // Validation & Saving
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!recipeName.trim()) {
      setErrorText('Dishes must have a recipe name.');
      return;
    }

    if (rows.length === 0) {
      setErrorText('Please specify at least one ingredient.');
      return;
    }

    const yieldAmountValue = parseFloat(yieldAmount);
    const cookingTimeValue = parseInt(cookingTimeMins, 10);
    if (isNaN(yieldAmountValue) || yieldAmountValue <= 0) {
      setErrorText('Please enter a valid recipe yield amount.');
      return;
    }
    if (isNaN(cookingTimeValue) || cookingTimeValue < 0) {
      setErrorText('Please enter a valid cooking time in minutes.');
      return;
    }

    // Verify all row quantities
    for (let r of rows) {
      const quantityValue = parseFloat(r.quantity);
      if (isNaN(quantityValue) || quantityValue <= 0) {
        setErrorText(`Ingredient "${r.name || 'unnamed'}" has invalid use quantity.`);
        return;
      }
      if (r.isNew) {
        const purchaseQtyValue = parseFloat(r.purchaseQty);
        const purchaseCostValue = parseFloat(r.purchaseCost);
        if (!r.name.trim()) {
          setErrorText('Please enter a name for the new custom ingredient.');
          return;
        }
        if (isNaN(purchaseQtyValue) || purchaseQtyValue <= 0 || isNaN(purchaseCostValue) || purchaseCostValue < 0) {
          setErrorText(`Please enter correct purchase specs for new ingredient "${r.name}".`);
          return;
        }
        
        // Check duplication with registered database items
        const isDuplicateDB = ingredientsList.some(
          dbItem => dbItem.name.toLowerCase().trim() === r.name.toLowerCase().trim()
        );
        if (isDuplicateDB) {
          setErrorText(`An ingredient named "${r.name}" already exists in the master database. Please select it from the dropdown instead.`);
          return;
        }
      }
    }

    const newIngredientsToCreate: Ingredient[] = [];
    const savedIngredientsMapped: RecipeIngredient[] = rows.map((r, index) => {
      let finalId = r.ingredientId;
      let finalName = r.name;
      const quantityValue = parseFloat(r.quantity);

      if (r.isNew) {
        // Create matching temporary ID
        const tempId = `temp_api_${index}_${Date.now()}`;
        const purchaseQtyValue = parseFloat(r.purchaseQty);
        const purchaseCostValue = parseFloat(r.purchaseCost);
        const costPerUnit = getCostPerUnit(purchaseQtyValue, r.purchaseUnit, purchaseCostValue);
        
        const newIngObj: Ingredient = {
          id: tempId,
          name: r.name.trim(),
          purchaseQty: purchaseQtyValue,
          purchaseUnit: r.purchaseUnit,
          purchaseCost: purchaseCostValue,
          costPerUnit,
        };
        newIngredientsToCreate.push(newIngObj);
        finalId = tempId;
      }

      return {
        id: `ri_${index}_${Date.now()}`,
        ingredientId: finalId,
        name: finalName,
        quantity: quantityValue,
        unit: r.unit,
      };
    });

    const outputRecipe: Recipe = {
      id: recipe ? recipe.id : `rec_${Date.now()}`,
      name: recipeName.trim(),
      yieldType,
      yieldAmount: yieldAmountValue,
      cookingTimeMins: cookingTimeValue,
      ingredients: savedIngredientsMapped,
      createdAt: recipe ? recipe.createdAt : new Date().toISOString(),
    };

    onSave(outputRecipe, newIngredientsToCreate);
  };

  return (
    <div id="recipe-editor" className="bg-slate-50 border border-slate-200/60 rounded-3xl p-6 shadow-sm overflow-hidden space-y-6">
      
      {/* Form Header */}
      <div className="flex justify-between items-center pb-4 border-b border-slate-200/50">
        <div>
          <h3 className="text-xl font-extrabold text-slate-800">
            {recipe ? `Edit Recipe: ${recipe.name}` : 'Create Culinary Recipe'}
          </h3>
          <p className="text-xs text-slate-400">Specify material fractions and dynamic parameters for accurate costing</p>
        </div>
        <button
          onClick={onCancel}
          className="p-1 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100/80 rounded-xl transition font-medium"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Core Recipe Details Header */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-xs">
          
          {/* Dish Name */}
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">
              Recipe Name
            </label>
            <input
              type="text"
              required
              value={recipeName}
              onChange={e => setRecipeName(e.target.value)}
              placeholder="e.g., Paneer Paratha, Mixed Vegetable"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50/70 border border-slate-100/80 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition font-bold text-slate-700"
            />
          </div>

          {/* Cooking Time */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">
              Cooking Time (mins)
            </label>
            <div className="relative">
              <input
                type="number"
                required
                min="0"
                value={cookingTimeMins}
                onChange={e => setCookingTimeMins(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50/70 border border-slate-100/80 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition font-semibold text-slate-700"
              />
              <span className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 text-xs font-mono">
                mins
              </span>
            </div>
          </div>

          {/* Yield Type selection */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">
              Yield Specification
            </label>
            <div className="flex gap-1.5 p-1 bg-slate-100/60 rounded-xl border border-slate-100">
              <button
                type="button"
                onClick={() => setYieldType('weight')}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all ${
                  yieldType === 'weight'
                    ? 'bg-white text-teal-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Weight
              </button>
              <button
                type="button"
                onClick={() => setYieldType('piece')}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all ${
                  yieldType === 'piece'
                    ? 'bg-white text-teal-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Pieces
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Yield inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-100/30 p-4 rounded-xl">
          {yieldType === 'weight' ? (
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">
                Final Cooked Yield (grams):
              </label>
              <div className="relative">
                <input
                  type="number"
                  required
                  min="1"
                  value={yieldAmount}
                  onChange={e => setYieldAmount(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition font-mono font-bold text-slate-700"
                  placeholder="e.g., 1350"
                />
                <span className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 text-xs">
                  g
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 select-none">
                Example: Cooked rice from recipe raw ingredients yields <strong>1350g</strong>
              </p>
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">
                Total Cooked Pieces Produced:
              </label>
              <div className="relative">
                <input
                  type="number"
                  required
                  min="1"
                  value={yieldAmount}
                  onChange={e => setYieldAmount(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition font-mono font-bold text-slate-700"
                  placeholder="e.g., 12"
                />
                <span className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 text-xs">
                  parathas / rotis
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 select-none">
                Example: Dough portion and fry yield produces exactly <strong>12</strong> items
              </p>
            </div>
          )}
        </div>

        {/* Ingredients Array Sections */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <span>Recipe Raw Ingredients List</span>
              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 font-mono text-[10px] font-bold rounded-md">
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
            </span>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 bg-white hover:bg-slate-100 text-teal-600 hover:text-teal-700 font-bold text-xs px-3 py-1.5 rounded-xl border border-dashed border-slate-200/80 cursor-pointer shadow-2xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Ingredient Row
            </button>
          </div>

          <div className="space-y-4">
            {rows.map((row, idx) => {
              return (
                <div
                  key={row.localId}
                  className={`bg-white rounded-2xl p-4 border transition-all ${
                    row.isNew
                      ? 'border-amber-200 ring-2 ring-amber-500/5 shadow-xs'
                      : 'border-slate-100 shadow-2xs hover:shadow-xs'
                  }`}
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    {/* Database selector */}
                    <div className="md:col-span-5 space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                        Select Matched Raw Material
                      </label>
                      <select
                        value={row.ingredientId}
                        onChange={e => updateRow(row.localId, { ingredientId: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-slate-50/70 border border-slate-100/85 focus:bg-white focus:border-teal-500 outline-none rounded-lg font-semibold text-slate-700"
                      >
                        {ingredientsList.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.name} (₹{item.purchaseCost}/{item.purchaseQty}{item.purchaseUnit})
                          </option>
                        ))}
                        <option value="new" className="text-amber-600 font-bold">
                          ➕ [Not Found - Register New Ingredient on-the-fly]
                        </option>
                      </select>
                    </div>

                    {/* Quantity field */}
                    <div className="md:col-span-3 space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                        Amount Used
                      </label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.01"
                          required
                          min="0.01"
                          value={row.quantity}
                          onChange={e => updateRow(row.localId, { quantity: e.target.value })}
                          className="w-full px-3 py-1.5 text-xs bg-slate-50/70 border border-slate-100/85 focus:bg-white outline-none rounded-lg font-semibold text-slate-700 font-mono"
                          placeholder="qty"
                        />
                        <select
                          value={row.unit}
                          onChange={e => updateRow(row.localId, { unit: e.target.value as any })}
                          className="px-1.5 py-1 text-xs bg-slate-50/70 border border-slate-100/85 focus:bg-white outline-none rounded-lg font-semibold text-slate-600"
                        >
                          <option value="g">g</option>
                          <option value="kg">kg</option>
                          <option value="ml">ml</option>
                          <option value="litre">litre</option>
                          <option value="tsp">tsp</option>
                        </select>
                      </div>
                    </div>

                    {/* Name text input if NEW */}
                    {row.isNew && (
                      <div className="md:col-span-3 space-y-1">
                        <label className="text-[10px] uppercase font-bold text-amber-500 block">
                          Unregistered Ingredient Name!
                        </label>
                        <input
                          type="text"
                          required
                          value={row.name}
                          onChange={e => updateRow(row.localId, { name: e.target.value })}
                          placeholder="e.g., Paneer Cubes"
                          className="w-full px-3 py-1.5 text-xs bg-amber-50/20 border border-amber-200 outline-none rounded-lg font-semibold text-amber-900"
                        />
                      </div>
                    )}

                    {/* Delete button (only if not single row) */}
                    <div className="md:col-span-1 flex justify-end self-center mt-3 md:mt-0 pt-1 md:pt-4">
                      <button
                        type="button"
                        onClick={() => removeRow(row.localId)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Remove row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* INLINE CARD: Missing ingredient registration panel (Matches Requirement 3 requirement) */}
                  {row.isNew && (
                    <div className="mt-3 p-3 bg-amber-50/40 border border-amber-200/60 rounded-xl space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-amber-800">
                            Ingredient not found. Please enter purchase quantity and cost.
                          </p>
                          <p className="text-[10px] text-slate-500">
                            We'll register this in your master database automatically after saving this recipe.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-slate-500 block">Purchase Quantity</label>
                          <input
                            type="number"
                            required
                            step="0.1"
                            min="0.1"
                            value={row.purchaseQty}
                            onChange={e => updateRow(row.localId, { purchaseQty: e.target.value })}
                            className="w-full px-2 py-1 text-[11px] bg-white border border-amber-200 outline-none rounded font-semibold text-slate-700"
                            placeholder="e.g. 1"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-slate-500 block">Purchase Unit</label>
                          <select
                            value={row.purchaseUnit}
                            onChange={e => updateRow(row.localId, { purchaseUnit: e.target.value as any })}
                            className="w-full px-1.5 py-1 text-[11px] bg-white border border-amber-200 outline-none rounded font-semibold text-slate-700"
                          >
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="litre">litre</option>
                            <option value="ml">ml</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-slate-500 block">Purchase Cost (₹)</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0"
                            value={row.purchaseCost}
                            onChange={e => updateRow(row.localId, { purchaseCost: e.target.value })}
                            className="w-full px-2 py-1 text-[11px] bg-white border border-amber-200 outline-none rounded font-semibold text-slate-700"
                            placeholder="e.g. 59.8"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Error panel */}
        {errorText && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-700 text-xs font-semibold">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p>{errorText}</p>
          </div>
        )}

        {/* Save/Cancel Submission block */}
        <div className="pt-4 border-t border-slate-200/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs hover:shadow-sm cursor-pointer transition"
          >
            <Save className="w-4 h-4" />
            Save Recipe
          </button>
        </div>
      </form>
    </div>
  );
}
