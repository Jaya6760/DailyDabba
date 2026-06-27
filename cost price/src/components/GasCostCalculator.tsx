/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GasConfig } from '../types';
import { calculateGasCosts } from '../utils';
import { Flame, Info, DollarSign, Scale, Hourglass } from 'lucide-react';

interface GasCostCalculatorProps {
  config: GasConfig;
  onChange: (newConfig: GasConfig) => void;
}

export default function GasCostCalculator({ config, onChange }: GasCostCalculatorProps) {
  const [cylinderPrice, setCylinderPrice] = useState(config.cylinderPrice.toString());
  const [cylinderWeight, setCylinderWeight] = useState(config.cylinderWeightKg.toString());
  const [consumptionRate, setConsumptionRate] = useState(config.consumptionRateKgHour.toString());

  useEffect(() => {
    setCylinderPrice(config.cylinderPrice.toString());
  }, [config.cylinderPrice]);

  useEffect(() => {
    setCylinderWeight(config.cylinderWeightKg.toString());
  }, [config.cylinderWeightKg]);

  useEffect(() => {
    setConsumptionRate(config.consumptionRateKgHour.toString());
  }, [config.consumptionRateKgHour]);

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCylinderPrice(value);
    const val = parseFloat(value);
    onChange({ ...config, cylinderPrice: isNaN(val) ? 0 : val });
  };

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCylinderWeight(value);
    const val = parseFloat(value);
    onChange({ ...config, cylinderWeightKg: isNaN(val) ? 0 : val });
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setConsumptionRate(value);
    const val = parseFloat(value);
    onChange({ ...config, consumptionRateKgHour: isNaN(val) ? 0 : val });
  };

  const calcs = calculateGasCosts(config);

  return (
    <div id="gas-cost-calculator" className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
          <Flame className="w-5 h-5 fill-rose-100" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800 text-lg">Gas Cost Module</h3>
          <p className="text-xs text-slate-400">Calculate active cooking fuel cost</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Cylinder Price */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Cylinder Price (₹)
          </label>
          <div className="relative rounded-xl overflow-hidden shadow-sm">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-medium">
              ₹
            </span>
            <input
              type="number"
              value={config.cylinderPrice}
              onChange={handlePriceChange}
              step="1"
              min="0"
              className="w-full pl-8 pr-4 py-2.5 text-sm font-semibold bg-slate-50 border border-slate-100 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition-all"
              placeholder="e.g., 950"
            />
          </div>
        </div>

        {/* Cylinder Weight */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Cylinder Weight (kg)
          </label>
          <div className="relative rounded-xl overflow-hidden shadow-sm">
            <input
              type="number"
              value={config.cylinderWeightKg}
              onChange={handleWeightChange}
              step="0.1"
              min="0.1"
              className="w-full px-4 py-2.5 text-sm font-semibold bg-slate-50 border border-slate-100 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition-all"
              placeholder="e.g., 14.2"
            />
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 text-xs">
              kg
            </span>
          </div>
        </div>

        {/* Consumption Rate */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Consumption (kg/hr)
          </label>
          <div className="relative rounded-xl overflow-hidden shadow-sm">
            <input
              type="number"
              value={config.consumptionRateKgHour}
              onChange={handleRateChange}
              step="0.01"
              min="0"
              className="w-full px-4 py-2.5 text-sm font-semibold bg-slate-50 border border-slate-100 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none rounded-xl transition-all"
              placeholder="e.g., 0.25"
            />
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 text-xs">
              kg/hr
            </span>
          </div>
        </div>
      </div>

      {/* Calculated outputs section */}
      <div className="bg-slate-50/70 border border-slate-50 rounded-xl p-4 space-y-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Formula & Calculations</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-3 border border-slate-100 flex items-center gap-3">
            <span className="p-1 px-2.5 bg-sky-50 text-sky-600 rounded-md font-mono text-sm">₹/kg</span>
            <div>
              <p className="text-xs font-medium text-slate-400">Gas Cost per kg</p>
              <p className="font-mono text-base font-bold text-slate-700">
                ₹{calcs.costPerKg.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg p-3 border border-slate-100 flex items-center gap-3">
            <span className="p-1 px-2.5 bg-amber-50 text-amber-600 rounded-md font-mono text-sm">₹/hr</span>
            <div>
              <p className="text-xs font-medium text-slate-400">Gas Cost per Hour</p>
              <p className="font-mono text-base font-bold text-slate-700">
                ₹{calcs.costPerHour.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg p-3 border border-slate-100 flex items-center gap-3">
            <span className="p-1 px-1.5 bg-rose-50 text-rose-600 rounded-md font-mono text-sm">₹/min</span>
            <div>
              <p className="text-xs font-medium text-slate-400">Gas Cost per Minute</p>
              <p className="font-mono text-base font-bold text-teal-600">
                ₹{calcs.costPerMinute.toFixed(4)}
              </p>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-400/80 leading-relaxed border-t border-slate-100 pt-3 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p>
              Gas Cost/kg = ₹{config.cylinderPrice} / {config.cylinderWeightKg} kg = <strong>₹{calcs.costPerKg.toFixed(2)}</strong>.
            </p>
            <p>
              Gas Cost/Hour = ₹{calcs.costPerKg.toFixed(2)} × {config.consumptionRateKgHour} kg = <strong>₹{calcs.costPerHour.toFixed(2)}</strong>.
            </p>
            <p>
              Gas Cost/Minute = ₹{calcs.costPerHour.toFixed(2)} / 60 = <strong className="text-teal-600">₹{calcs.costPerMinute.toFixed(4)}</strong> which will be used in culinary costing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
