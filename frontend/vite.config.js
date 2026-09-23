import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// In development the API runs on :4000 and is proxied, so cookies stay same-origin
// (SameSite=Strict) exactly as in production behind CloudFront.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Service worker: the app itself loads with no network on a tablet (entries are in IndexedDB).
    // API responses are never cached; only the app shell and fonts.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'QMAS · Incoming Inspection',
        short_name: 'QMAS',
        description: 'Incoming material inspection and defect notification',
        theme_color: '#1d4ed8',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        start_url: '/tablet',
        icons: [{ src: '/favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,avif,svg,ico}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.QMAS_API_URL ?? 'http://localhost:4000', changeOrigin: false } },
  },
  test: { environment: 'node' },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@reduxjs/toolkit', 'react-redux'] },
      },
    },
  },
});
