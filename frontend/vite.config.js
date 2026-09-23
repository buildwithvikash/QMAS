import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :4000 and is proxied, so cookies stay same-origin
// (SameSite=Strict) exactly as in production behind CloudFront.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.QMAS_API_URL ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@reduxjs/toolkit', 'react-redux'] },
      },
    },
  },
});
