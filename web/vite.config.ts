import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './', 
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
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
    },
  },
});
