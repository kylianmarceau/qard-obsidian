import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      'lucide-react': fileURLToPath(
        new URL('./node_modules/lucide-react/dist/esm/lucide-react.mjs', import.meta.url),
      ),
      'react-dom/server': 'preact-render-to-string',
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      react: 'preact/compat',
      obsidian: fileURLToPath(new URL('./tests/obsidian-mock.ts', import.meta.url)),
    },
  },
  test: {
    server: { deps: { inline: ['lucide-react'] } },
    environment: 'node',
    setupFiles: ['./tests/dom-helpers.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
