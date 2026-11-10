/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Cross-Tab Synchronization Service
 * Coordinates catalog mutations and proposal revalidation across browser tabs
 * using BroadcastChannel with graceful localStorage fallback.
 */

export interface CatalogMutationEvent {
  type: 'CATALOG_MUTATED' | 'PROPOSAL_APPLIED';
  timestamp: number;
  sourceTabId: string;
  details?: Record<string, any>;
}

const CHANNEL_NAME = 'dailydabba_catalog_sync';
const STORAGE_KEY = 'dailydabba_catalog_mutation_ping';

// Generate a unique session tab ID for this window/tab
export const CURRENT_TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

let channelInstance: BroadcastChannel | null = null;

const getGlobalScope = () => {
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis as any;
  return null;
};

function getBroadcastChannel(): BroadcastChannel | null {
  const root = getGlobalScope();
  if (!root || typeof (root as any).BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channelInstance) {
    try {
      channelInstance = new (root as any).BroadcastChannel(CHANNEL_NAME);
    } catch (e) {
      console.warn('BroadcastChannel unavailable, using storage fallback:', e);
      channelInstance = null;
    }
  }
  return channelInstance;
}

/**
 * Broadcasts a catalog mutation event to all other open tabs
 */
export function broadcastCatalogMutation(details?: Record<string, any>): void {
  const root = getGlobalScope();
  if (!root) return;

  const event: CatalogMutationEvent = {
    type: 'CATALOG_MUTATED',
    timestamp: Date.now(),
    sourceTabId: CURRENT_TAB_ID,
    details,
  };

  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage(event);
    } catch (err) {
      console.warn('Failed to post to BroadcastChannel:', err);
    }
  }

  // Also write to localStorage to support storage event fallback
  try {
    if (root.localStorage) {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
    }
  } catch {
    // LocalStorage might be disabled in private browsing or quotas exceeded
  }
}

/**
 * Subscribes to catalog mutation events broadcast from OTHER tabs.
 * Returns an unsubscribe callback.
 */
export function subscribeToCatalogMutations(
  callback: (event: CatalogMutationEvent) => void
): () => void {
  const root = getGlobalScope();
  if (!root) {
    return () => {};
  }

  const channel = getBroadcastChannel();

  // Handler for BroadcastChannel messages
  const handleMessage = (e: any) => {
    const data = e.data as CatalogMutationEvent;
    if (data && data.sourceTabId !== CURRENT_TAB_ID) {
      callback(data);
    }
  };

  // Handler for localStorage storage events (fallback across tabs)
  const handleStorage = (e: any) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const data = JSON.parse(e.newValue) as CatalogMutationEvent;
        if (data && data.sourceTabId !== CURRENT_TAB_ID) {
          callback(data);
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  };

  if (channel) {
    channel.addEventListener('message', handleMessage);
  }
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('storage', handleStorage);
  }

  return () => {
    if (channel) {
      channel.removeEventListener('message', handleMessage);
    }
    if (typeof root.removeEventListener === 'function') {
      root.removeEventListener('storage', handleStorage);
    }
  };
}

