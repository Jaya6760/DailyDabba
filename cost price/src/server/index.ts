/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'http';
import { handleAiRequest } from './ai/middleware';
import { getGeminiApiKey } from './ai/service';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const server = http.createServer((req, res) => {
  // Add CORS headers for local development if standalone server is running on a different port
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  handleAiRequest(req, res);
});

server.listen(PORT, () => {
  const hasKey = !!getGeminiApiKey();
  console.log(`Daily Dabba AI Backend Server running at http://localhost:${PORT}`);
  console.log(`Gemini API Key configured: ${hasKey ? 'YES' : 'NO (Check .env)'}`);
  console.log(`Health check: http://localhost:${PORT}/api/ai/health`);
});
