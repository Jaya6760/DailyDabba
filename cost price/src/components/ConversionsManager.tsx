/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { TeaspoonConversion } from '../types';
import { Scale, Search, Plus, Edit2, Trash2, Check, X, RefreshCw } from 'lucide-react';
import { initialConversions } from '../data';

interface ConversionsManagerProps {
  conversions: TeaspoonConversion[];
  onAdd: (c: Omit<TeaspoonConversion, 'id'>) => void;
  onEdit: (c: TeaspoonConversion) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}

export default function ConversionsManager({
  conversions,
  onAdd,
  onEdit,
  onDelete,
  onReset,
}: ConversionsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingWeight, setEditingWeight] = useState('');

  const filtered = conversions.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newWeight) return;
    const g = parseFloat(newWeight);
    if (isNaN(g) || g <= 0) return;
    
    onAdd({
      name: newName.trim(),
      weightGrams: g,
    });
    
    setNewName('');
    setNewWeight('');
    setIsAdding(false);
  };

  const startEdit = (c: TeaspoonConversion) => {
    setEditingId(c.id);
    setEditingName(c.name);
    setEditingWeight(c.weightGrams.toString());
  };

  const handleSaveEdit = (id: string) => {
    if (!editingName.trim() || !editingWeight) return;
    const g = parseFloat(editingWeight);
    if (isNaN(g) || g <= 0) return;

    onEdit({
      id,
      name: editingName.trim(),
      weightGrams: g,
    });

    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div id="conversions-manager" className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">Teaspoon (tsp) conversions</h3>
            <p className="text-xs text-slate-400 font-mono">1 Teaspoon Weight (g) conversion database</p>
          </div>
        </div>

        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-teal-600 hover:bg-slate-50 border border-slate-200/60 rounded-xl transition-all self-start sm:self-auto font-medium"
          title="Reset to default conversions"
        >
          <RefreshCw className="w-3 h-3" />
          Reset Standard
        </button>
      </div>

      {/* Add New Header */}
      {!isAdding ? (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full flex items-center justify-center gap-2 mb-4 px-4 py-3 bg-teal-50 hover:bg-teal-100/80 text-teal-700 hover:text-teal-800 font-semibold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all border border-dashed border-teal-200"
        >
          <Plus className="w-4 h-4" />
          Add tsp conversion weight
        </button>
      ) : (
        <form onSubmit={handleCreate} className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-4 space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">New Conversion</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 block">Ingredient / Item Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g., Powder Salt"
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 outline-none rounded-lg transition-all font-semibold text-slate-700"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 block">1 tsp Weight (grams)</label>
              <div className="relative">
                <input
                  type="number"
                  required
                  step="0.1"
                  min="0.1"
                  value={newWeight}
                  onChange={e => setNewWeight(e.target.value)}
                  placeholder="e.g., 5"
                  className="w-full px-3 py-1.5 pr-14 text-sm bg-white border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 outline-none rounded-lg transition-all font-semibold text-slate-700"
                />
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 text-xs">
                  g
                </span>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
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
              Save Conversion
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
          placeholder="Search teaspoon weights..."
          className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50/70 hover:bg-slate-50 border border-slate-100/80 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition-all font-medium text-slate-600"
        />
      </div>

      {/* List Container */}
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 pr-1 rounded-xl border border-slate-50">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p className="text-sm">No conversions found</p>
            <p className="text-xs text-slate-400/80">Try searching another term or add a new definition</p>
          </div>
        ) : (
          filtered.map(c => {
            const isEditing = editingId === c.id;

            return (
              <div key={c.id} className="flex items-center justify-between py-2.5 px-3 hover:bg-slate-100/40 rounded-lg transition-all">
                {isEditing ? (
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 mr-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="px-2 py-1 text-xs font-semibold bg-white border border-slate-200 outline-none rounded focus:border-teal-500"
                    />
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={editingWeight}
                        onChange={e => setEditingWeight(e.target.value)}
                        className="w-full px-2 py-1 pr-6 text-xs font-semibold bg-white border border-slate-200 outline-none rounded focus:border-teal-500"
                      />
                      <span className="absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-400 font-mono">
                        g
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700">{c.name}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      1 Teaspoon = <strong>{c.weightGrams}g</strong>
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(c.id)}
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
                        onClick={() => startEdit(c)}
                        className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-md transition"
                        title="Edit Conversion"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-50 rounded-md transition"
                        title="Delete Conversion"
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
