import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    // Engine tests run in Node (no DOM needed). Component tests opt into
    // happy-dom with a `// @vitest-environment happy-dom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/features/redact/engine/**',
        'src/features/redact/state/**',
        'src/features/redact/lib/**',
      ],
      exclude: ['**/*.test.ts', '**/__tests__/**'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
