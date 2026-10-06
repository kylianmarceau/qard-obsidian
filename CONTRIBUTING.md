# Contributing

Use the npm version recorded in `package.json`. Install development dependencies with `npm ci`, then run `npm run check` before submitting a change. This checks formatting, TypeScript, source and stylesheet lint, tests, the production build, and release contents.

## Working on a change

Read [the architecture](docs/ARCHITECTURE.md) to find the owner of the behavior. Keep domain calculations independent of Obsidian where practical; put vault operations in adapters and presentation in components. Share a helper when it represents the same rule, rather than combining similar-looking operations with different persistence or recovery behavior.

Use explicit type imports and braces around control flow. TypeScript rejects unused locals and parameters. `npm run format` applies the repository's formatting; `npm run format:check` verifies it without editing files. Embedded prompt and Markdown templates are intentionally not reformatted by Prettier.

Keep public interfaces and persisted formats stable during refactors. For a behavior change, add a focused regression test that describes the user-visible outcome. For a pure extraction, retain existing tests and add coverage at the extracted boundary when it protects an important contract, such as a saved transcript or cancellation behavior. UI tests use the same Preact renderer as the production build.

## Local verification

`npm run dev` watches the source. To install each build into a development vault, use `npm run dev -- --vault=/absolute/path/to/vault`. A one-time production installation uses `npm run build -- --vault=/absolute/path/to/vault`. These commands copy only `main.js`, `manifest.json`, and `styles.css`; they preserve `data.json`. The destination must already be an Obsidian vault.

Use sample material in a separate development vault for write-flow checks. The optional Hot Reload plugin can reload builds automatically; otherwise disable and re-enable Qard after copying the files. See [the guide](docs/GUIDE.md) for test-vault setup and [community review notes](docs/REVIEW_NOTES.md) for review-specific checks.

Generated bundles, dependencies, release folders, and local previews are ignored. Commit the source, relevant tests, documentation, and lock-file changes together. A successful local check does not publish a release; tagged releases are handled separately by the existing workflow.
