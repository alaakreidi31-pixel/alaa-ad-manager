import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Development only: reachable from this computer only (same rule as the API)
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Requests to /api/... are forwarded to the NestJS API.
    // The browser sees one origin, so no CORS setup is needed.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
