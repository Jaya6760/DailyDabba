/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Vite server middleware providing /api/parse-recipe for local development.
 * Keeps GEMINI_API_KEY strictly on the server in process.env.
 */

import { loadEnv, type Plugin } from 'vite';
import { handleParseRecipeRequest } from './src/server/ai/parseHandler';

export function viteApiPlugin(): Plugin {
  return {
    name: 'vite-api-plugin',
    configureServer(server) {
      if (!process.env.GEMINI_API_KEY) {
        const loaded = loadEnv('development', process.cwd(), '');
        if (loaded.GEMINI_API_KEY) {
          process.env.GEMINI_API_KEY = loaded.GEMINI_API_KEY;
        }
      }

      server.middlewares.use('/api/parse-recipe', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: false,
              error: { code: 'INVALID_INPUT', message: 'Method Not Allowed. Use POST.' },
            })
          );
          return;
        }

        let bodyRaw = '';
        let isTooLarge = false;

        req.on('data', chunk => {
          if (isTooLarge) return;
          bodyRaw += chunk;
          if (bodyRaw.length > 32 * 1024) {
            isTooLarge = true;
            req.destroy();
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds maximum limit (16KB).' },
              })
            );
          }
        });

        req.on('end', async () => {
          if (isTooLarge) return;
          try {
            const body = bodyRaw ? JSON.parse(bodyRaw) : {};
            const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'localhost';
            const result = await handleParseRecipeRequest(body, clientIp);
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.body));
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'Malformed JSON payload.' },
              })
            );
          }
        });
      });
    },
  };
}
