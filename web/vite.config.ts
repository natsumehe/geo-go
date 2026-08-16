import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    port: 3000,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(import.meta.dirname, '..'),
      ]
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
      '/tiles': 'http://localhost:8080',
      '/list': 'http://localhost:8080',
      '/route': 'http://localhost:8080',
      '/history': 'http://localhost:8080',
    //   '/valhalla': {
    //     target: 'http://localhost:8002',
    //     changeOrigin: true,
    //     rewrite: (p) => p.replace(/^\/valhalla/, ''),
    //   },
    },
  },
});