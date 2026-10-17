import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function aiBackendPlugin(): Plugin {
  return {
    name: 'daily-dabba-ai-backend',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/ai')) {
          try {
            const { handleAiRequest } = await import('./src/server/ai/middleware');
            await handleAiRequest(req, res, next);
          } catch (err) {
            console.error('Error handling AI request:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: String(err) }));
          }
        } else {
          next();
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/ai')) {
          try {
            const { handleAiRequest } = await import('./src/server/ai/middleware');
            await handleAiRequest(req, res, next);
          } catch (err) {
            console.error('Error handling AI request:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: String(err) }));
          }
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aiBackendPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
