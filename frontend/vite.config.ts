import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The backend runs on :4000 by default.
      // Anything starting with /api gets proxied so the React app
      // can call '/api/...' directly without CORS gymnastics in dev.
      '/api': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
    },
  },
});
