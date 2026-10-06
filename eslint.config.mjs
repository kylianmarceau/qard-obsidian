import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'main.js',
      'release/**',
      '.preview/**',
      '.test-vault/**',
      '.example-test-vault/**',
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', { brands: ['Qard', 'Spaced Repetition', 'FSRS'] }],
    },
  },
]);
