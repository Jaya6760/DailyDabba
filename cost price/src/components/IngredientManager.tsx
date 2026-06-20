/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Ingredient } from '../types';
import { getCostPerUnit } from '../data';
import {
  Apple,
  Search,
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  Check,
  X,
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';

interface IngredientManagerProps {
  ingredients: Ingredient[];
  recipesCountMap: Record<string, number>; // ingredientId -> count of usage in active recipes
  onAdd: (ing: Omit<Ingredient, 'id' | 'costPerUnit'>) => void;
  onEdit: (ing: Ingredient) => void;
  onDelete: (id: string) => void;
  onBulkImport: (ingList: Ingredient[]) => void;
}

export default function IngredientManager({
  ingredients,
  recipesCountMap,
  onAdd,
  onEdit,
  onDelete,
  onBulkImport,
}: IngredientManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState<'kg' | 'g' | 'litre' | 'ml'>('kg');
  const [newCost, setNewCost] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingQty, setEditingQty] = useState('');
  const [editingUnit, setEditingUnit] = useState<'kg' | 'g' | 'litre' | 'ml'>('kg');
  const [editingCost, setEditingCost] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newQty || !newCost) return;
    const qtyNum = parseFloat(newQty);
    const costNum = parseFloat(newCost);
    if (isNaN(qtyNum) || qtyNum <= 0 || isNaN(costNum) || costNum < 0) return;

    onAdd({
      name: newName.trim(),
      purchaseQty: qtyNum,
      purchaseUnit: newUnit,
      purchaseCost: costNum,
    });

    setNewName('');
    setNewQty('');
    setNewCost('');
    setIsAdding(false);
  };

  const startEdit = (ing: Ingredient) => {
    setEditingId(ing.id);
    setEditingName(ing.name);
    setEditingQty(ing.purchaseQty.toString());
    setEditingUnit(ing.purchaseUnit);
    setEditingCost(ing.purchaseCost.toString());
  };

  const handleSaveEdit = (id: string) => {
    if (!editingName.trim() || !editingQty || !editingCost) return;
    const qtyNum = parseFloat(editingQty);
    const costNum = parseFloat(editingCost);
    if (isNaN(qtyNum) || qtyNum <= 0 || isNaN(costNum) || costNum < 0) return;

    onEdit({
      id,
      name: editingName.trim(),
      purchaseQty: qtyNum,
      purchaseUnit: editingUnit,
      purchaseCost: costNum,
      costPerUnit: getCostPerUnit(qtyNum, editingUnit, costNum),
    });

    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // Export ingredient list as JSON
  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(ingredients, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'ingredient_database.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import ingredient list from JSON
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          // Basic validation
          const validIngredients = parsed.filter(
            item =>
              typeof item.name === 'string' &&
              typeof item.purchaseQty === 'number' &&
              ['kg', 'g', 'litre', 'ml'].includes(item.purchaseUnit) &&
              typeof item.purchaseCost === 'number'
          );

          if (validIngredients.length > 0) {
            onBulkImport(validIngredients);
            alert(`Successfully imported ${validIngredients.length} ingredients!`);
          } else {
            alert('No valid ingredients found in the JSON file.');
          }
        } else {
          alert('Invalid file format. Expected a JSON array of ingredients.');
        }
      } catch (err) {
        alert('Failed to parse file. Ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
    // Reset file input value so same file can be uploaded again
    e.target.value = '';
  };

  return (
    <div id="ingredient-manager" className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-50 text-teal-600 rounded-xl">
            <Apple className="w-5 h-5 fill-teal-100" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">Master Ingredient Database</h3>
            <p className="text-xs text-slate-400">Manage rates, units, and purchase specifications</p>
          </div>
        </div>

        {/* Export & Import actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-teal-600 hover:bg-slate-50 border border-slate-200/60 rounded-xl transition"
            title="Import from JSON File"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-teal-600 hover:text-white hover:bg-teal-600 border border-teal-200 hover:border-teal-600 rounded-xl transition"
            title="Export as JSON File"
          >
            <Download className="w-3.5 h-3.5" />
            Export Database
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className="hidden"
          />
        </div>
      </div>

      {/* Add New Panel */}
      {!isAdding ? (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full flex items-center justify-center gap-2 mb-4 px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all border border-teal-600 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add raw ingredient
        </button>
      ) : (
        <form onSubmit={handleCreate} className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-4 space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">New Raw Material</h4>
          
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Ingredient Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g., Chopped Paneer"
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 outline-none rounded-lg transition font-semibold text-slate-700"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Purchase Qty</label>
                <input
                  type="number"
                  required
                  step="0.1"
                  min="0.1"
                  value={newQty}
                  onChange={e => setNewQty(e.target.value)}
                  placeholder="e.g., 1"
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 outline-none rounded-lg transition font-semibold text-slate-700"
                />
              </div>

              <div className="col-span-1 space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Purchase Unit</label>
                <select
                  value={newUnit}
                  onChange={e => setNewUnit(e.target.value as any)}
                  className="w-full px-2 py-2 text-xs bg-white border border-slate-200 focus:border-teal-500 outline-none rounded-lg font-semibold text-slate-700"
                >
                  <option value="kg">kg (Kilogram)</option>
                  <option value="g">g (Gram)</option>
                  <option value="litre">litre (Ltr)</option>
                  <option value="ml">ml (Millilitre)</option>
                </select>
              </div>

              <div className="col-span-1 space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Purchase Price (₹)</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 font-mono text-xs">
                    ₹
                  </span>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={newCost}
                    onChange={e => setNewCost(e.target.value)}
                    placeholder="e.g., 59.8"
                    className="w-full pl-6 pr-2 py-1.5 text-sm bg-white border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 outline-none rounded-lg transition font-semibold text-slate-700"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg hover:text-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition"
            >
              Register Ingredient
            </button>
          </div>
        </form>
      )}

      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search master ingredients..."
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50/70 hover:bg-slate-50 border border-slate-100/80 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition-all font-medium text-slate-600"
        />
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto max-h-[480px] divide-y divide-slate-100 pr-1 border border-slate-50 rounded-xl shadow-inner bg-slate-50/20">
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <p className="text-sm font-semibold">No ingredients found</p>
            <p className="text-xs text-slate-400/80">Add your first material or search another name</p>
          </div>
        ) : (
          filtered.map(i => {
            const isEditing = editingId === i.id;
            const usageCount = recipesCountMap[i.id] || 0;
            const baseUnit = i.purchaseUnit === 'litre' || i.purchaseUnit === 'ml' ? 'ml' : 'g';

            return (
              <div key={i.id} className="p-3 hover:bg-white flex items-start justify-between gap-3 transition">
                {isEditing ? (
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="w-full px-2 py-1 text-xs font-bold bg-white border border-slate-200 outline-none rounded focus:border-teal-500 text-slate-700"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={editingQty}
                        onChange={e => setEditingQty(e.target.value)}
                        className="px-2 py-1 text-xs bg-white border border-slate-200 outline-none rounded focus:border-teal-500 text-slate-700"
                        title="Qty"
                      />
                      <select
                        value={editingUnit}
                        onChange={e => setEditingUnit(e.target.value as any)}
                        className="px-1 py-1 text-xs bg-white border border-slate-200 outline-none rounded focus:border-teal-500 text-slate-700"
                      >
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                        <option value="litre">litre</option>
                        <option value="ml">ml</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingCost}
                        onChange={e => setEditingCost(e.target.value)}
                        className="px-2 py-1 text-xs bg-white border border-slate-200 outline-none rounded focus:border-teal-500 text-slate-700"
                        title="Price"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 select-none">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-slate-700 text-sm">{i.name}</h4>
                      {usageCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-teal-50 text-teal-600 font-mono text-[9px] font-bold rounded-md">
                          Used in {usageCount} Dis{usageCount === 1 ? 'h' : 'hes'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">
                      Purchase: {i.purchaseQty} {i.purchaseUnit} for <strong className="text-slate-600">₹{i.purchaseCost}</strong>
                    </p>
                    <p className="text-[11px] text-slate-500/80 font-mono mt-0.5">
                      Rate per {baseUnit}: <span className="font-bold text-teal-600">₹{i.costPerUnit.toFixed(4)}</span>
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(i.id)}
                        className="p-1 px-1.5 bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 rounded-md transition"
                        title="Save Changes"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1 px-1.5 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-md transition"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(i)}
                        className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-md transition"
                        title="Edit Ingredient"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (usageCount > 0) {
                            if (!window.confirm(`This ingredient is used in ${usageCount} recipe(s). Deleting it will cause recipe costs to exclude this ingredient. Do you want to proceed?`)) {
                              return;
                            }
                          }
                          onDelete(i.id);
                        }}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-50 rounded-md transition"
                        title="Delete Ingredient"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
