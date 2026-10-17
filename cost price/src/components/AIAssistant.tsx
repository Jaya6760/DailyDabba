/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Flame,
  Scale,
  Apple,
  ChefHat,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import {
  Ingredient,
  TeaspoonConversion,
  GasConfig,
  Recipe,
} from '../types';
import {
  ProposedAction,
  ClarificationQuestion,
  AIChatResponse,
  ContextSnapshot,
} from '../server/ai/types';

interface AIAssistantProps {
  ingredients: Ingredient[];
  conversions: TeaspoonConversion[];
  gasConfig: GasConfig;
  recipes: Recipe[];
  onAddIngredient: (ing: Ingredient) => void;
  onEditIngredient: (ing: Ingredient) => void;
  onAddConversion: (conv: TeaspoonConversion) => void;
  onEditConversion: (conv: TeaspoonConversion) => void;
  onUpdateGasConfig: (config: GasConfig) => void;
  onSaveRecipe: (recipe: Recipe, newIngredients?: Ingredient[]) => void;
  onSelectRecipe: (recipeId: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  response?: AIChatResponse;
  status?: 'pending' | 'success' | 'error';
}

const QUICK_PROMPTS = [
  'How much does Jeera Poha cost to make?',
  'Add 1kg Amul Butter at 550 rupees',
  'Update gas cylinder price to 980',
  'What if Moong Dal price rises to 200/kg?',
  'Set teaspoon weight of Haldi to 3g',
  'Which recipes use Groundnut?',
];

export default function AIAssistant({
  ingredients,
  conversions,
  gasConfig,
  recipes,
  onAddIngredient,
  onEditIngredient,
  onAddConversion,
  onEditConversion,
  onUpdateGasConfig,
  onSaveRecipe,
  onSelectRecipe,
}: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello Chef! I am your AI Food Costing Assistant powered by Gemini 3.8 Flash. Ask me anything in natural language—calculate recipe costs, add ingredients, update fuel rates, or test price changes.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [isAiHealthy, setIsAiHealthy] = useState<boolean | null>(null);
  const [actionStatus, setActionStatus] = useState<Record<string, 'pending' | 'applied' | 'rejected'>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check backend AI endpoint health
    fetch('/api/ai/health')
      .then(res => res.json())
      .then(data => {
        setIsAiHealthy(data?.ok && data?.hasGeminiKey);
      })
      .catch(() => {
        setIsAiHealthy(false);
      });
  }, []);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSubmit = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isLoading) return;

    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const contextSnapshot: ContextSnapshot = {
        ingredients,
        conversions,
        gasConfig,
        recipes,
      };

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          contextSnapshot,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Server returned error (${res.status})`);
      }

      const aiData: AIChatResponse = json.data;

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        sender: 'assistant',
        text: aiData.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        response: aiData,
        status: 'success',
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: `Error processing request: ${err.message || 'Could not communicate with AI backend.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmAction = (action: ProposedAction) => {
    setActionStatus(prev => ({ ...prev, [action.id]: 'applied' }));

    switch (action.type) {
      case 'ADD_INGREDIENT':
        onAddIngredient(action.payload);
        break;
      case 'UPDATE_INGREDIENT':
        onEditIngredient(action.payload);
        break;
      case 'SAVE_CONVERSION': {
        const exists = conversions.some(c => c.id === action.payload.id || c.name.toLowerCase() === action.payload.name.toLowerCase());
        if (exists) {
          onEditConversion(action.payload);
        } else {
          onAddConversion(action.payload);
        }
        break;
      }
      case 'UPDATE_GAS_CONFIG':
        onUpdateGasConfig(action.payload);
        break;
      case 'SAVE_RECIPE':
        onSaveRecipe(action.payload);
        if (action.payload.id) {
          onSelectRecipe(action.payload.id);
        }
        break;
      default:
        console.warn('Unknown action type:', action.type);
    }

    setMessages(prev => [
      ...prev,
      {
        id: `sys_${Date.now()}`,
        sender: 'assistant',
        text: `✅ Confirmed & Applied: "${action.title}". Database and local costing ledger have been updated.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const handleRejectAction = (action: ProposedAction) => {
    setActionStatus(prev => ({ ...prev, [action.id]: 'rejected' }));
    setMessages(prev => [
      ...prev,
      {
        id: `sys_${Date.now()}`,
        sender: 'assistant',
        text: `❌ Cancelled proposed change: "${action.title}". No modifications were made.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const handleClarificationChoice = (question: ClarificationQuestion, choiceValue: string | number) => {
    // Send choice back to conversation
    const replyText = `For "${question.question}", I choose: ${choiceValue}`;
    handleSubmit(replyText);
  };

  return (
    <>
      {/* Top Banner Quick Input Bar */}
      <div className="bg-gradient-to-r from-teal-900 via-slate-900 to-teal-950 text-white p-4 rounded-3xl shadow-lg border border-teal-500/20 mb-6 relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-teal-500 to-emerald-400 text-slate-950 rounded-2xl shadow-md">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-teal-300">
                  Daily Dabba AI Assistant
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-teal-400/20 text-teal-300 border border-teal-400/30">
                  Gemini 3.8 Flash
                </span>
                {isAiHealthy === false && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Offline Fallback Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 font-medium">
                Ask in plain English: calculate costs, add ingredients, change fuel rates, or test what-if scenarios.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleSubmit();
                    setIsOpen(true);
                  }
                }}
                placeholder="e.g. 'How much does Jeera Poha cost?', 'Add 1kg Amul Butter @ 550'..."
                className="w-full bg-slate-800/90 text-sm text-white placeholder-slate-400 pl-4 pr-10 py-2.5 rounded-2xl border border-teal-500/30 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 outline-none transition"
              />
              <button
                onClick={() => {
                  handleSubmit();
                  setIsOpen(true);
                }}
                disabled={isLoading || !inputMessage.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-teal-400 hover:text-white disabled:text-slate-600 cursor-pointer transition"
                title="Send to AI"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>

            <button
              onClick={() => setIsOpen(!isOpen)}
              className="px-3.5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold uppercase tracking-wider rounded-2xl transition shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isOpen ? 'Close Chat' : 'Open Assistant'}</span>
            </button>
          </div>
        </div>

        {/* Quick prompt suggestions */}
        <div className="relative z-10 flex items-center gap-2 mt-3 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] text-teal-400/80 font-mono uppercase font-bold shrink-0">Try:</span>
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => {
                handleSubmit(prompt);
                setIsOpen(true);
              }}
              className="px-2.5 py-1 bg-slate-800/80 hover:bg-teal-900/60 text-slate-300 hover:text-teal-200 border border-slate-700 hover:border-teal-500/40 rounded-xl transition cursor-pointer shrink-0 text-[11px]"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Expanded AI Assistant Drawer / Modal */}
      {isOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col antialiased">
          {/* Header */}
          <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-gradient-to-tr from-teal-500 to-emerald-400 text-slate-950 rounded-xl">
                <ChefHat className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                  Daily Dabba AI Assistant
                  <span className="text-[10px] bg-teal-950 text-teal-400 border border-teal-500/30 px-1.5 py-0.2 rounded font-mono font-bold">
                    Gemini 3.8
                  </span>
                </h3>
                <p className="text-[10px] text-slate-400">
                  Exact mathematical costing • Safe confirmation workflow
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setMessages([
                    {
                      id: 'welcome',
                      sender: 'assistant',
                      text: 'Conversation history cleared. Ready for your next food costing query!',
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                title="Reset conversation"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                title="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Conversation stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/60">
            {messages.map(msg => {
              const isUser = msg.sender === 'user';
              const resp = msg.response;
              const action = resp?.proposedAction;
              const costBreakdown = resp?.costBreakdown;
              const clarifications = resp?.clarifications;
              const actionState = action ? actionStatus[action.id] || 'pending' : 'pending';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
                >
                  <div
                    className={`max-w-[90%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                      isUser
                        ? 'bg-teal-600 text-white rounded-br-none shadow-sm'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-none shadow-xs'
                    }`}
                  >
                    <div className="whitespace-pre-wrap font-medium">{msg.text}</div>
                    <span
                      className={`block text-[9px] mt-1.5 ${
                        isUser ? 'text-teal-200' : 'text-slate-400'
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>

                  {/* Render Cost Breakdown Card if available */}
                  {costBreakdown && (
                    <div className="w-full max-w-[95%] bg-white rounded-2xl border border-teal-200/80 p-4 shadow-sm space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <ChefHat className="w-4 h-4 text-teal-600" />
                          <h4 className="font-bold text-slate-900 text-sm">
                            {costBreakdown.recipe.name} Cost Breakdown
                          </h4>
                        </div>
                        <button
                          onClick={() => {
                            onSelectRecipe(costBreakdown.recipe.id);
                            setIsOpen(false);
                          }}
                          className="text-[11px] text-teal-600 hover:text-teal-800 font-bold underline flex items-center gap-1 cursor-pointer"
                        >
                          View in Recipe Auditor <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 bg-teal-50/60 rounded-xl border border-teal-100 text-center">
                          <span className="text-[10px] text-teal-700 uppercase font-mono font-bold">Total Batch</span>
                          <p className="text-sm font-extrabold text-teal-900 mt-0.5">₹{costBreakdown.totalBatchCost.toFixed(2)}</p>
                          <span className="text-[9px] text-slate-500 font-mono">{costBreakdown.yieldAmount} {costBreakdown.yieldType === 'weight' ? 'g' : 'pcs'}</span>
                        </div>
                        <div className="p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100 text-center">
                          <span className="text-[10px] text-emerald-700 uppercase font-mono font-bold">Serving CP</span>
                          <p className="text-sm font-extrabold text-emerald-900 mt-0.5">
                            ₹{(costBreakdown.recipe.yieldAmount > 0 ? (costBreakdown.totalBatchCost / costBreakdown.recipe.yieldAmount) * (costBreakdown.recipe.defaultServingAmount || (costBreakdown.yieldType === 'weight' ? 100 : 1)) : 0).toFixed(2)}
                          </p>
                          <span className="text-[9px] text-slate-500 font-mono">per {costBreakdown.recipe.defaultServingAmount || (costBreakdown.yieldType === 'weight' ? 100 : 1)} {costBreakdown.yieldType === 'weight' ? 'g' : 'pcs'}</span>
                        </div>
                        <div className="p-2.5 bg-rose-50/60 rounded-xl border border-rose-100 text-center">
                          <span className="text-[10px] text-rose-700 uppercase font-mono font-bold">Cooking Gas</span>
                          <p className="text-sm font-extrabold text-rose-900 mt-0.5">₹{costBreakdown.gasCost.toFixed(2)}</p>
                          <span className="text-[9px] text-slate-500 font-mono">{costBreakdown.recipe.cookingTimeMins} mins</span>
                        </div>
                      </div>

                      {/* Ingredients list */}
                      <div className="text-[11px] max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
                        {costBreakdown.rows.map((row, rIdx) => (
                          <div key={rIdx} className="p-2 flex items-center justify-between bg-slate-50/40">
                            <div>
                              <span className="font-semibold text-slate-800">{row.recipeIngredient.name}</span>
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {row.recipeIngredient.quantity} {row.recipeIngredient.unit}
                                {row.isTsp && ` (${row.effectiveQty}g ${row.isTspDefaultUsed ? '• default 4g used' : ''})`}
                              </span>
                            </div>
                            <div className="text-right font-mono font-bold text-slate-700">
                              ₹{row.cost.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Render Clarification Question Card if missing info */}
                  {clarifications && clarifications.length > 0 && (
                    <div className="w-full max-w-[95%] bg-amber-50/90 rounded-2xl border border-amber-200 p-4 shadow-sm space-y-3">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
                        <HelpCircle className="w-4 h-4 text-amber-600" />
                        <span>Missing Information / Clarification Needed</span>
                      </div>

                      {clarifications.map((q, qIdx) => (
                        <div key={qIdx} className="space-y-2 bg-white/80 p-3 rounded-xl border border-amber-200/60">
                          <p className="text-xs text-slate-800 font-semibold">{q.question}</p>

                          {q.defaultValue && (
                            <p className="text-[10px] text-amber-900 font-mono bg-amber-100/60 px-2 py-1 rounded">
                              System Default: <span className="font-bold">{q.defaultValue}</span> {q.defaultDescription && `(${q.defaultDescription})`}
                            </p>
                          )}

                          {q.options && q.options.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {q.options.map((opt, oIdx) => (
                                <button
                                  key={oIdx}
                                  onClick={() => handleClarificationChoice(q, opt.value)}
                                  className={`px-3 py-1.5 text-xs rounded-xl font-bold transition cursor-pointer flex items-center gap-1 ${
                                    opt.isDefault
                                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                                  }`}
                                >
                                  {opt.isDefault && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  <span>{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Render Proposed Action Confirmation Card */}
                  {action && (
                    <div className="w-full max-w-[95%] bg-white rounded-2xl border-2 border-teal-500/40 p-4 shadow-md space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-teal-100 text-teal-800 font-mono font-bold px-2 py-0.5 rounded-full uppercase">
                            Proposed Change
                          </span>
                          <h4 className="font-bold text-slate-900 text-sm">{action.title}</h4>
                        </div>
                        {actionState === 'applied' && (
                          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Applied
                          </span>
                        )}
                        {actionState === 'rejected' && (
                          <span className="text-xs font-bold text-rose-500 flex items-center gap-1">
                            <XCircle className="w-4 h-4" /> Cancelled
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 font-medium">{action.summary}</p>

                      {/* Diff Details */}
                      {action.diff && action.diff.length > 0 && (
                        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 space-y-1.5">
                          {action.diff.map((d, dIdx) => (
                            <div key={dIdx} className="text-[11px] grid grid-cols-12 gap-2 items-center">
                              <span className="col-span-4 font-mono font-bold text-slate-500">{d.label}:</span>
                              <div className="col-span-8 flex items-center gap-1.5 font-mono">
                                {d.before !== undefined && (
                                  <>
                                    <span className="text-rose-600 line-through">{String(d.before)}</span>
                                    <ArrowRight className="w-3 h-3 text-slate-400" />
                                  </>
                                )}
                                <span className="font-bold text-emerald-700">{String(d.after)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Impact Summary */}
                      {action.impactSummary && (
                        <div className="text-[11px] text-slate-500 flex items-start gap-1.5 bg-slate-50/70 p-2 rounded-lg">
                          <Info className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                          <span>{action.impactSummary}</span>
                        </div>
                      )}

                      {/* Action buttons */}
                      {actionState === 'pending' && (
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                          <button
                            onClick={() => handleConfirmAction(action)}
                            className="flex-1 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Confirm & Save to Ledger
                          </button>
                          <button
                            onClick={() => handleRejectAction(action)}
                            className="py-2 px-3 text-slate-500 hover:text-slate-800 hover:bg-slate-100 font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-white p-3 rounded-2xl border border-slate-200/80 w-fit">
                <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                <span>Gemini 3.8 Flash calculating with backend costing engine...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer input */}
          <div className="p-3 bg-white border-t border-slate-200">
            <div className="relative">
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleSubmit();
                  }
                }}
                placeholder="Ask food costing question or request change..."
                className="w-full bg-slate-50 hover:bg-white text-xs text-slate-800 placeholder-slate-400 pl-3.5 pr-10 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition font-medium"
              />
              <button
                onClick={() => handleSubmit()}
                disabled={isLoading || !inputMessage.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-teal-600 hover:bg-teal-700 text-white disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition cursor-pointer"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-2 font-mono">
              Database mutations require your explicit confirmation before applying.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
