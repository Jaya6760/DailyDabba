/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'http';
import { processAIChat, getGeminiApiKey } from './service';
import { AIChatRequest } from './types';

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload in request body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Connect/Vite compatible middleware for AI backend endpoints.
 */
export async function handleAiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next?: () => void
) {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Health check endpoint
  if (url === '/api/ai/health' || url === '/api/ai/health/') {
    const hasKey = !!getGeminiApiKey();
    return sendJson(res, 200, {
      ok: true,
      hasGeminiKey: hasKey,
      model: 'gemini-3.8-flash',
    });
  }

  // Chat endpoint
  if (url === '/api/ai/chat' || url === '/api/ai/chat/') {
    if (method !== 'POST') {
      return sendJson(res, 405, { success: false, error: 'Method Not Allowed. Use POST.' });
    }

    try {
      const body = await parseJsonBody(req);
      const chatRequest = body as AIChatRequest;

      if (!chatRequest || !chatRequest.message || typeof chatRequest.message !== 'string') {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing or invalid "message" in request payload.',
        });
      }

      if (!chatRequest.contextSnapshot) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing "contextSnapshot" in request payload.',
        });
      }

      const response = await processAIChat(chatRequest);
      return sendJson(res, 200, {
        success: true,
        data: response,
      });
    } catch (err: any) {
      console.error('AI chat endpoint error:', err);
      return sendJson(res, 500, {
        success: false,
        error: err.message || 'Internal server error processing AI chat.',
      });
    }
  }

  if (next) {
    next();
  } else {
    sendJson(res, 404, { success: false, error: 'Not found' });
  }
}
