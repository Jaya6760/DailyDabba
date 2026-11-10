/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Unified AI Kitchen Conversational Assistant Modal
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  X,
  Send,
  RotateCcw,
  Bot,
  User,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Layers,
  Apple,
  Scale,
  Flame,
} from 'lucide-react';
import { Ingredient, TeaspoonConversion, GasConfig, Recipe } from '../types';
import { KitchenConversationManager, ConversationTurnResult } from '../services/conversationManager';
import { generateProposedChangeSet, generateDatabaseSnapshotHash } from '../services/proposalGenerator';
import { ProposedChangeSet } from '../server/ai/proposalTypes';
import { persistProposedChangeSet } from '../services/catalogPersistenceService';
import { subscribeToCatalogMutations } from '../services/crossTabSync';
import AIProposalReview from './AIProposalReview';

interface AIKitchenAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  ingredientsList: Ingredient[];
  conversionsList: TeaspoonConversion[];
  gasConfig: GasConfig;
  recipesList: Recipe[];
  onApplySuccess: (data: {
    updatedIngredients: Ingredient[];
    updatedConversions: TeaspoonConversion[];
    updatedGasConfig: GasConfig;
    updatedRecipes: Recipe[];
  }) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  proposal?: ProposedChangeSet;
  clarifications?: string[];
  isStaleProposal?: boolean;
  conflictError?: string;
  conflictDetails?: any[];
}

const QUICK_EXAMPLES = [
  {
    label: 'Paneer Paratha (Recipe)',
    prompt:
      'For 2 paneer parathas:\n102g panner\nChat masala - 1/2 teaspoon\nKalonji - 1/5 teaspoon\nDhaniya powder - 1 teaspoon\nKali mirch - 1/4 teaspoon\nChilli flakes - 1 teaspoon\nOregano - 1/4 teaspoon\nJeera powder - 1 teaspoon\nSalt - 1/3 teaspoon\nKala namak - 1/3 teaspoon\nAjwain - 1/5 teaspoon\nKastori methi - 1/2 teaspoon\nMaggi masala - 1 pouch\nPyaaz - 1/2\nDhaniya patti - 1 teaspoon',
  },
  {
    label: 'Dal (Recipe)',
    prompt: '144g dal\n1/2 teaspoon Haldi\n1 teaspoon Salt\nCooking time 10 mins',
  },
  {
    label: 'New Ingredients',
    prompt: 'Add poha 500 g for ₹40 and jeera 100 g for ₹60.',
  },
  {
    label: 'Price Update',
    prompt: 'Change the purchase price of paneer to ₹105 for 200 g.',
  },
  {
    label: 'Gas Settings',
    prompt: 'Gas cylinder costs ₹1000, cylinder weight is 14.2 kg, consumption rate is 0.25 kg per hour.',
  },
  {
    label: 'TSP Weight',
    prompt: 'One teaspoon of jeera weighs 2 grams.',
  },
];

export default function AIKitchenAssistantModal({
  isOpen,
  onClose,
  ingredientsList,
  conversionsList,
  gasConfig,
  recipesList,
  onApplySuccess,
}: AIKitchenAssistantModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello Chef! You can enter recipes, new ingredients, price updates, teaspoon weights, or gas settings in ordinary natural language. I will parse your input, check against your database, ask follow-up questions for anything missing, and prepare a proposed change set for your review before saving.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);

  // Active conversation manager instance
  const convManagerRef = useRef<KitchenConversationManager>(new KitchenConversationManager());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Phase 3: Cross-tab synchronization and focus revalidation
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = subscribeToCatalogMutations(() => {
      setMessages(prev =>
        prev.map(m =>
          m.proposal && !m.isStaleProposal
            ? {
                ...m,
                isStaleProposal: true,
                conflictError: 'The database was modified in another tab while this proposal was open.',
              }
            : m
        )
      );
    });

    const handleFocus = () => {
      const liveHash = generateDatabaseSnapshotHash(
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );
      setMessages(prev =>
        prev.map(m =>
          m.proposal && !m.isStaleProposal && m.proposal.databaseSnapshotHash !== liveHash
            ? {
                ...m,
                isStaleProposal: true,
                conflictError: 'The database state was updated concurrently. Please review or regenerate this proposal.',
              }
            : m
        )
      );
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, [isOpen, ingredientsList, conversionsList, gasConfig, recipesList]);

  if (!isOpen) return null;

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputVal).trim();
    if (!text || isLoading || isApplying) return;

    setErrorMessage(null);
    setSuccessNotification(null);

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputVal('');
    setIsLoading(true);

    try {
      // 1. Process turn via conversation manager
      const turnResult = await convManagerRef.current.processUserTurn(
        text,
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );

      // 2. Generate structured proposed change set
      const proposal = generateProposedChangeSet(
        turnResult,
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );

      // 3. Add assistant message
      const clarificationsList = turnResult.pendingClarifications?.map(c => c.question);
      const assistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: turnResult.assistantReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        proposal: proposal.operations.newIngredients.length > 0 ||
          proposal.operations.updatedIngredients.length > 0 ||
          proposal.operations.newConversions.length > 0 ||
          proposal.operations.updatedConversions.length > 0 ||
          !!proposal.operations.gasConfigUpdate ||
          proposal.operations.recipesToCreate.length > 0
            ? proposal
            : undefined,
        clarifications: clarificationsList && clarificationsList.length > 0 ? clarificationsList : undefined,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Conversation turn error:', err);
      setErrorMessage(err?.message || 'Failed to process kitchen message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmProposal = async (proposal: ProposedChangeSet) => {
    setIsApplying(true);
    setErrorMessage(null);

    try {
      const currentSnapshotHash = generateDatabaseSnapshotHash(
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );
      const result = await persistProposedChangeSet(
        proposal,
        currentSnapshotHash,
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );

      if (!result.success) {
        // Mark the proposal as stale and attach the detailed conflict error
        setMessages(prev =>
          prev.map(m =>
            m.proposal?.id === proposal.id
              ? {
                  ...m,
                  isStaleProposal: true,
                  conflictError: result.error,
                  conflictDetails: result.conflictDetails,
                }
              : m
          )
        );

        // Add assistant explanation message with clear details
        const conflictMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          sender: 'assistant',
          text: `⚠️ **Proposal Stale / Concurrency Conflict Detected**:\n\n${result.error}\n\nTo protect your database against lost updates, this outdated proposal has been blocked from saving. Click **"Generate Fresh Proposal"** on the card above to re-evaluate with current database values.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, conflictMsg]);
        setErrorMessage(result.error || 'Database state conflict detected.');
        return;
      }

      setSuccessNotification(`Successfully applied: ${proposal.summary}`);

      // Notify parent to update React state cleanly
      onApplySuccess({
        updatedIngredients: result.updatedIngredients,
        updatedConversions: result.updatedConversions,
        updatedGasConfig: result.updatedGasConfig,
        updatedRecipes: result.updatedRecipes,
      });

      // Clear pending draft from manager
      convManagerRef.current.clear();

      // Add assistant confirmation message
      const confirmMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: `All changes have been safely saved to your database!\n- ${proposal.summary}\nAffected recipe cost prices have been recalculated automatically using your kitchen costing engine.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, confirmMsg]);
    } catch (err: any) {
      console.error('Confirm error:', err);
      setErrorMessage(err?.message || 'Failed to apply changes to database.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancelProposal = (proposalId: string) => {
    convManagerRef.current.clear();
    setMessages(prev => [
      ...prev,
      {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: 'The proposal has been cancelled. No database changes were made. How else can I help?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const handleRegenerateProposal = async (staleProposal: ProposedChangeSet) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const turnResult = await convManagerRef.current.processUserTurn(
        staleProposal.summary,
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );
      const freshProposal = generateProposedChangeSet(
        turnResult,
        ingredientsList,
        conversionsList,
        gasConfig,
        recipesList
      );

      const assistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: `Here is a fresh proposal generated against your latest database state:\n- ${freshProposal.summary}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        proposal: freshProposal,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Failed to regenerate proposal:', err);
      setErrorMessage(err?.message || 'Failed to generate fresh proposal.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetConversation = () => {
    convManagerRef.current.clear();
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: 'Conversation reset. Enter a new recipe, ingredient updates, conversions, or gas settings whenever you are ready.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setErrorMessage(null);
    setSuccessNotification(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-teal-500 to-sky-500 rounded-xl">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-extrabold text-base tracking-tight flex items-center gap-2">
                Daily Dabba AI Kitchen Assistant
                <span className="text-[10px] bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-mono uppercase">
                  Natural Language
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Recipes, Ingredients, Prices, Gas Rates & TSP Weights in One Unified Conversational Interface
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetConversation}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Reset conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Close assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Example Chips */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Quick Examples:</span>
          {QUICK_EXAMPLES.map((ex, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(ex.prompt)}
              disabled={isLoading || isApplying}
              className="text-xs bg-white hover:bg-teal-50 hover:text-teal-700 hover:border-teal-300 border border-slate-200 text-slate-600 px-2.5 py-1 rounded-lg transition font-medium shrink-0 cursor-pointer disabled:opacity-50"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/* Notification alerts */}
        {errorMessage && (
          <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-700 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-800 font-bold">
              Dismiss
            </button>
          </div>
        )}

        {successNotification && (
          <div className="bg-teal-50 border-b border-teal-200 px-6 py-2.5 text-xs text-teal-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span className="font-semibold">{successNotification}</span>
            </div>
            <button onClick={() => setSuccessNotification(null)} className="text-teal-600 hover:text-teal-900 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* Chat message history scrollable stage */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-slate-900 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`max-w-[85%] space-y-2 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Bubble */}
                <div
                  className={`p-4 rounded-2xl text-xs sm:text-sm whitespace-pre-wrap leading-relaxed shadow-xs ${
                    msg.sender === 'user'
                      ? 'bg-teal-600 text-white rounded-br-none'
                      : 'bg-slate-100 text-slate-800 border border-slate-200/80 rounded-bl-none'
                  }`}
                >
                  {msg.text}
                </div>

                {/* Follow-up question highlights */}
                {msg.clarifications && msg.clarifications.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span>Please clarify in chat:</span>
                    </div>
                    <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
                      {msg.clarifications.map((c, cIdx) => (
                        <li key={cIdx}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Proposal review card if present */}
                {msg.proposal && (
                  <AIProposalReview
                    proposal={msg.proposal}
                    isApplying={isApplying}
                    isStale={msg.isStaleProposal}
                    conflictError={msg.conflictError}
                    onConfirm={() => handleConfirmProposal(msg.proposal!)}
                    onCancel={() => handleCancelProposal(msg.proposal!.id)}
                    onRefreshProposal={() => handleRegenerateProposal(msg.proposal!)}
                  />
                )}

                <span className="text-[10px] text-slate-400 block px-1">{msg.timestamp}</span>
              </div>

              {msg.sender === 'user' && (
                <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 justify-start items-center text-slate-400 text-xs py-2">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-teal-400 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 bg-slate-100 px-4 py-2.5 rounded-2xl rounded-bl-none border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-teal-500 animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-teal-500 animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 rounded-full bg-teal-500 animate-bounce [animation-delay:0.4s]" />
                <span className="text-slate-600 font-medium ml-1">Analyzing kitchen request...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Text Input Footer */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Type any recipe, ingredient prices, teaspoon conversions, or gas settings..."
              rows={2}
              disabled={isLoading || isApplying}
              className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none font-medium transition"
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || isLoading || isApplying}
              className="p-3.5 bg-teal-600 hover:bg-teal-700 active:scale-95 disabled:opacity-40 disabled:hover:bg-teal-600 text-white rounded-2xl transition cursor-pointer shrink-0 shadow-sm"
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <div className="mt-1.5 flex justify-between items-center text-[10px] text-slate-400 font-mono">
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span>Deterministic Cost Engine Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}
