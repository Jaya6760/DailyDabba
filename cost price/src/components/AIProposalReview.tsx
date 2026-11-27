/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * AI Proposal Review Card: Explicit diff review before database confirmation
 */

import React from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Flame,
  Scale,
  Apple,
  Layers,
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { ProposedChangeSet } from '../server/ai/proposalTypes';

interface AIProposalReviewProps {
  proposal: ProposedChangeSet;
  isApplying: boolean;
  isStale?: boolean;
  conflictError?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onRefreshProposal?: () => void;
}

export default function AIProposalReview({
  proposal,
  isApplying,
  isStale = false,
  conflictError,
  onConfirm,
  onCancel,
  onRefreshProposal,
}: AIProposalReviewProps) {
  const { operations, warnings, missingInfo, hasBlockingIssues, summary } = proposal;

  const isBlocked = hasBlockingIssues || isStale || !!conflictError;

  const hasAnyChanges =
    operations.newIngredients.length > 0 ||
    operations.updatedIngredients.length > 0 ||
    operations.newConversions.length > 0 ||
    operations.updatedConversions.length > 0 ||
    !!operations.gasConfigUpdate ||
    operations.recipesToCreate.length > 0;

  return (
    <div className={`bg-white border-2 rounded-2xl shadow-md overflow-hidden my-4 transition-all ${
      conflictError || isStale ? 'border-rose-300 ring-2 ring-rose-200' : 'border-slate-200'
    }`}>
      {/* Header Banner */}
      <div className={`px-5 py-3 flex items-center justify-between ${
        conflictError || isStale ? 'bg-rose-950 text-rose-100' : 'bg-slate-900 text-white'
      }`}>
        <div className="flex items-center gap-2">
          {conflictError || isStale ? (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-teal-400" />
          )}
          <h4 className="font-extrabold text-sm tracking-wide">
            {conflictError || isStale ? 'PROPOSAL OUTDATED — CONCURRENT DB CHANGE' : 'PROPOSED DATABASE CHANGES'}
          </h4>
        </div>
        <span className={`text-[11px] font-mono uppercase font-semibold px-2 py-0.5 rounded ${
          conflictError || isStale ? 'bg-rose-800 text-rose-200' : 'text-slate-400 bg-slate-800'
        }`}>
          {conflictError || isStale ? 'Stale / Blocked' : 'Review Required'}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Concurrency Conflict Alert Banner */}
        {(conflictError || isStale) && (
          <div className="bg-rose-50 border-2 border-rose-300 rounded-xl p-3.5 text-xs text-rose-900 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-800">Database Conflict Detected:</p>
                <p className="text-rose-700 leading-relaxed font-mono text-[11px]">
                  {conflictError || 'The database was modified in another tab or session after this proposal was prepared.'}
                </p>
                <p className="text-[11px] text-rose-600 font-medium">
                  To protect against lost updates, this proposal cannot be confirmed. Please click below to generate a fresh proposal using the latest database records.
                </p>
              </div>
            </div>
            {onRefreshProposal && (
              <div className="pt-2 border-t border-rose-200 flex justify-end">
                <button
                  type="button"
                  onClick={onRefreshProposal}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generate Fresh Proposal</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Summary text */}
        <div className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <span className="text-slate-400 font-mono uppercase text-[10px] block mb-0.5">Summary of Proposed Changes:</span>
          {summary}
        </div>

        {/* Blocking or Unresolved Warnings */}
        {hasBlockingIssues && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-rose-700 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>Pending Information Required (Cannot Confirm Yet)</span>
            </div>
            <ul className="text-xs text-rose-600 space-y-1 list-disc pl-5">
              {missingInfo.map((q, idx) => (
                <li key={idx}>{q}</li>
              ))}
              {warnings.map((w, idx) => (
                <li key={`w-${idx}`}>{w}</li>
              ))}
            </ul>
            <p className="text-[11px] text-rose-500 italic mt-1">
              Please answer the question(s) in the chat below. The proposal will update automatically.
            </p>
          </div>
        )}

        {/* Non-blocking warnings */}
        {!hasBlockingIssues && warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <span>Notices & Non-blocking Warnings</span>
            </div>
            <ul className="text-xs text-amber-700 space-y-0.5 list-disc pl-5">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 1. New Ingredients */}
        {operations.newIngredients.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Apple className="w-3.5 h-3.5 text-teal-600" />
              New Ingredients to Create ({operations.newIngredients.length})
            </h5>
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {operations.newIngredients.map((item, idx) => (
                <div key={idx} className="p-3 bg-teal-50/40 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800">{item.name}</span>
                    <span className="text-slate-500 ml-2">
                      Purchase: {item.purchaseQty} {item.purchaseUnit} for ₹{item.purchaseCost}
                    </span>
                  </div>
                  <div className="font-mono text-teal-700 font-bold bg-teal-100/60 px-2 py-0.5 rounded text-[11px]">
                    ₹{(item.costPerUnit * 1000).toFixed(2)} / {item.purchaseUnit === 'litre' || item.purchaseUnit === 'ml' ? 'L' : 'kg'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Updated Ingredient Prices */}
        {operations.updatedIngredients.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Apple className="w-3.5 h-3.5 text-sky-600" />
              Ingredient Price Updates ({operations.updatedIngredients.length})
            </h5>
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {operations.updatedIngredients.map((item, idx) => (
                <div key={idx} className="p-3 bg-sky-50/40 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800">{item.name}</span>
                    <div className="flex items-center gap-2 mt-0.5 text-slate-500">
                      <span>Old: {item.previous.purchaseQty} {item.previous.purchaseUnit} = ₹{item.previous.purchaseCost}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-slate-800">
                        New: {item.proposed.purchaseQty} {item.proposed.purchaseUnit} = ₹{item.proposed.purchaseCost}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sky-800 font-bold bg-sky-100/70 px-2 py-0.5 rounded text-[11px]">
                      ₹{(item.proposed.costPerUnit * 1000).toFixed(2)} / {item.proposed.purchaseUnit === 'litre' || item.proposed.purchaseUnit === 'ml' ? 'L' : 'kg'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Teaspoon Conversions */}
        {(operations.newConversions.length > 0 || operations.updatedConversions.length > 0) && (
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-amber-600" />
              Teaspoon Conversions ({operations.newConversions.length + operations.updatedConversions.length})
            </h5>
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {operations.newConversions.map((conv, idx) => (
                <div key={`new-conv-${idx}`} className="p-2.5 bg-amber-50/40 text-xs flex justify-between items-center">
                  <span className="font-bold text-slate-800">{conv.name}</span>
                  <span className="font-mono font-semibold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded text-[11px]">
                    1 tsp = {conv.weightGrams} g (New)
                  </span>
                </div>
              ))}
              {operations.updatedConversions.map((conv, idx) => (
                <div key={`upd-conv-${idx}`} className="p-2.5 bg-amber-50/40 text-xs flex justify-between items-center">
                  <span className="font-bold text-slate-800">{conv.name}</span>
                  <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
                    <span>1 tsp = {conv.previousWeightGrams} g</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span className="font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                      {conv.proposedWeightGrams} g
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Gas Configuration */}
        {operations.gasConfigUpdate && (
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-rose-600" />
              Gas Configuration Update
            </h5>
            <div className="p-3 bg-rose-50/40 border border-slate-200 rounded-xl text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Cylinder Price:</span>
                <span className="font-mono font-bold text-slate-800">
                  ₹{operations.gasConfigUpdate.previous.cylinderPrice} → ₹{operations.gasConfigUpdate.proposed.cylinderPrice}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Weight:</span>
                <span className="font-mono font-bold text-slate-800">
                  {operations.gasConfigUpdate.previous.cylinderWeightKg} kg → {operations.gasConfigUpdate.proposed.cylinderWeightKg} kg
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Consumption Rate:</span>
                <span className="font-mono font-bold text-slate-800">
                  {operations.gasConfigUpdate.previous.consumptionRateKgHour} kg/hr → {operations.gasConfigUpdate.proposed.consumptionRateKgHour} kg/hr
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 5. Recipes to Create */}
        {operations.recipesToCreate.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              Recipes to Create ({operations.recipesToCreate.length})
            </h5>
            <div className="space-y-3">
              {operations.recipesToCreate.map((rc, idx) => (
                <div key={idx} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/60 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h6 className="font-extrabold text-sm text-slate-900">{rc.recipe.name}</h6>
                      <p className="text-[11px] text-slate-500">
                        Yield: {rc.recipe.yieldAmount} {rc.recipe.yieldType === 'piece' ? 'pieces' : 'g'} • Cook time: {rc.recipe.cookingTimeMins} mins
                      </p>
                    </div>
                    {rc.calculatedCost.isComplete ? (
                      <div className="text-right">
                        <span className="text-xs text-slate-400 font-mono block">Cost / Serving</span>
                        <span className="text-sm font-extrabold font-mono text-teal-700 bg-teal-100/80 px-2 py-0.5 rounded">
                          ₹{rc.calculatedCost.servingCost.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded block">
                          Cost Incomplete
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Ingredient items pill list */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ingredients ({rc.recipe.ingredients.length}):</span>
                    <div className="grid grid-cols-2 gap-1 text-[11px] font-medium text-slate-700">
                      {rc.recipe.ingredients.map((ing, iIdx) => (
                        <div key={iIdx} className="bg-white border border-slate-100 px-2 py-1 rounded flex justify-between">
                          <span className="truncate pr-1">{ing.name}</span>
                          <span className="font-mono text-slate-500 shrink-0">{ing.quantity} {ing.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cost breakdown */}
                  {rc.calculatedCost.isComplete && (
                    <div className="bg-teal-50 border border-teal-100 rounded-lg p-2 text-xs flex justify-between items-center font-mono">
                      <span className="text-teal-800">Total Batch Cost: ₹{rc.calculatedCost.totalBatchCost.toFixed(2)}</span>
                      {rc.calculatedCost.costPerPiece && (
                        <span className="text-teal-700">₹{rc.calculatedCost.costPerPiece.toFixed(2)} / piece</span>
                      )}
                      {rc.calculatedCost.costPer100g && (
                        <span className="text-teal-700">₹{rc.calculatedCost.costPer100g.toFixed(2)} / 100g</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasAnyChanges && (
          <div className="text-center py-4 text-slate-400 text-xs">
            No database modifications detected in this request.
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-200 flex justify-end items-center gap-3">
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold uppercase rounded-xl transition cursor-pointer"
          >
            Cancel Proposal
          </button>

          <button
            onClick={onConfirm}
            disabled={isApplying || isBlocked || !hasAnyChanges}
            className={`px-5 py-2 text-white text-xs font-extrabold uppercase rounded-xl transition flex items-center gap-2 cursor-pointer shadow-sm ${
              isBlocked || !hasAnyChanges
                ? 'bg-slate-300 cursor-not-allowed opacity-60'
                : 'bg-teal-600 hover:bg-teal-700 active:scale-98'
            }`}
          >
            {isApplying ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Applying Changes...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Confirm & Apply Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
