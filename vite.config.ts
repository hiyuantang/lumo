// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'lumo-plugin-assets',
    configureServer(server) {
      server.middlewares.use('/plugins', async (request, response) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (!/^\/(calendar|skills|git|docker|nginx|monitor)\/(manifest\.json|[a-f0-9]{64}\.(js|css))$/.test(pathname)) { response.statusCode = 404; response.end(); return; }
        try {
          const bytes = await readFile(path.join(server.config.root, 'public/plugins', pathname));
          response.setHeader('Content-Type', pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(bytes);
        } catch { response.statusCode = 404; response.end(); }
      });
    },
  }],
  esbuild: { minifySyntax: false },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
