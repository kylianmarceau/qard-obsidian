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
      curly: ['error', 'all'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // Lazy desktop requires use typeof import() without loading Node APIs on mobile.
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'obsidianmd/ui/sentence-case': [
        'warn',
        { brands: ['Qard', 'Spaced Repetition', 'FSRS', 'Anki', 'Markdown', 'CSV', 'TSV'] },
      ],
    },
  },
  {
    files: ['src/migration/anki-content.ts'],
    // These nodes belong to an inert DOMParser document; Obsidian's window helpers are unavailable.
    rules: { 'obsidianmd/prefer-create-el': 'off' },
  },
]);
