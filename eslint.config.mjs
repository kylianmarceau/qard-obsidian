<<<<<<< HEAD
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate Obsidian package has its own typecheck and test pipeline.
    "obsidian-plugin/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
=======
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
>>>>>>> origin/staging
