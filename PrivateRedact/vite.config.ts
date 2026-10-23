import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { contentSecurityPolicy } from './build-plugins/csp.ts';
import { pdfjsAssets } from './build-plugins/pdfjsAssets.ts';

const root = import.meta.dirname;

// https://vite.dev/config/
export default defineConfig(() => {
  // Static hosts that serve the app from a sub-path (e.g. GitHub Pages at
  // /PrivateRedact/) set VITE_BASE_PATH at build time. Must end with '/'.
  const base = process.env.VITE_BASE_PATH ?? '/';
  const analyze = process.env.ANALYZE === '1';

  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    pdfjsAssets(root),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'PrivateRedact',
        short_name: 'PrivateRedact',
        description: 'Redact PDFs privately. Everything runs in your browser.',
        theme_color: '#06060f',
        background_color: '#06060f',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Precache the whole app (incl. the PDF.js worker, WASM decoders,
        // CMaps and fonts) so it keeps working with the network switched off.
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest,wasm,bcmap,pfb,ttf,icc}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ];
  if (analyze) {
    plugins.push(
      visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true, open: false }),
    );
  }

  return {
    base,
    plugins,
    resolve: {
      alias: { '@': path.resolve(root, 'src') },
    },
    worker: { format: 'es' as const },
    build: {
      target: 'es2022',
      sourcemap: 'hidden' as const,
      // PDF.js' own worker is ~1.2 MB minified. It is only loaded on the
      // /redact route, so raise the warning threshold accordingly.
      chunkSizeWarningLimit: 1400,
    },
  };
});
