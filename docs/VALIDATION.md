# Validation — 28 September 2026

## Automated

`npm run check`: passed strict TypeScript checking, all **59 tests across 9 files**, and the production build.

Coverage includes Markdown formats, multi-file decks, topic overrides and cursor context, rich fronts, images/math preservation, missing/stable/duplicate IDs, malformed notes, minimal range writes and CRLF preservation, concurrent edits, atomic append refusal, All/Due/New/Difficult selection, shuffle preservation, scheduler independence, persistence failures, keyboard guards, summary Escape, React/Markdown lifecycle cleanup, debounced vault events and stale reads, and microphone stream disposal (mocked hardware).

The parent website TypeScript check and Git whitespace check passed. Its existing lint command reports three errors in the unchanged `app/workspace.tsx`: ref assignment during render, state updates in the initial loading effect, and a plain home-page anchor. The website’s lint configuration excludes this independent Obsidian package from Next-specific rules.

## Real Obsidian checks

Tested in **Obsidian 1.13.7 on macOS**, using only the isolated `.test-vault` for development:

- Plugin enable/disable, ribbon opening, dedicated ItemView and reload restoration.
- Three decks / thirteen cards, with eight Computer Networks cards merged across two notes.
- Collapsed topics, compact question rows, and full single-card preview.
- Vault image embeds on both sides and rendered block/inline LaTeX.
- Manual session containing all thirteen selected cards.
- Space reveal, number-key rating, progress updates, session summary.
- A previously reviewed, future-due card remains selectable in All mode.
- Focus fills the workspace; Escape restores chrome, including on the summary.
- Source navigation opens the correct Markdown card; returning via the ribbon reactivates Qard shortcuts.
- Selection command opens the transient editor with the captured selection.
- Light and dark theme appearance.

The selection command was opened and cancelled during the application smoke check; safe saving/editing is covered by automated writer tests. Actual microphone hardware, mobile devices, arbitrary community themes, pop-out windows and cross-device review-data synchronization have not been validated.

The example test vault intentionally retains the smoke test’s review metadata and assigned ID for its handwritten card. The distributable and `example-vault/` fixtures contain no test review history.

## v0.2 minimal interface

Removed the secondary sidebar, duplicate mobile navigation, marketing headings, deck covers, decorative footer, and repeated study labels. The library is a compact deck list; the session builder collapses decks/topics and uses two short selects; the editor and preview use one action row.

The v0.2 production build, typecheck and 59 automated tests pass, including selecting all cards through the redesigned builder. An isolated browser preview verified narrow/desktop layout, all 13 example cards selected, session start, and Space reveal. The browser preview uses mock vault/Markdown services; rich media integration remains covered by the earlier real-Obsidian checks above. Native Obsidian automation was unresponsive during the v0.2 visual pass, so the updated test-vault files require a plugin reload to appear.

## v0.2.1 study flip

Added a 240 ms CSS 3D flip in both directions. Both Markdown faces stay mounted to avoid reloading embeds during each reveal. Inactive faces are inert and aria-hidden; reduced-motion preferences remove the transition. Long content scrolls inside a bounded face. No animation timers or listeners are needed.

Production build, TypeScript and all 60 tests pass. The new regression test covers rapid reveal/hide, inactive-face accessibility and immediate rating after reveal.

## Prompt-first AI flashcards — 2 October 2026

For `4fb21c7`, `npm run check` passed strict TypeScript, lint with zero warnings, **272 tests across 35 files**, the production build and release-content verification. New checks cover description-only generation with inferred deck/topic names, editable review destinations, folder attachments, stale source handling, invalid AI destinations, draft restoration, legacy requests and destination locking across failed saves and reloads.

A local desktop browser preview compared the real new-test and flashcard composers and confirmed matching placement, sizing and spacing. It then generated cards from a description alone, changed the proposed destination, saved through the real card writer and opened the resulting deck. This preview uses the actual Qard components with an in-memory vault, mocked Markdown rendering and a mocked AI provider; native Obsidian and live AI generation have not been checked for this change.

## Remove cloze and image occlusion — 2 October 2026

Reverted the feature changes from `9e40287` while preserving the prompt-first generation changes from `4fb21c7`. The Cloze composer toggle was removed with the card formats. The original question/answer editor, Markdown parser, writer, preview and study renderer were restored. `npm run check` passed strict TypeScript, lint with zero warnings, **236 tests across 33 files**, the production build and release-content verification. The retained generation tests cover description-only requests, note/folder sources, inferred and editable destinations, saved drafts and save retries. The published 0.3.4 tag and its historical release notes remain unchanged.

## Study statistics and FSRS — 2 October 2026

For release 0.3.5, `npm run check` passed strict TypeScript, lint with zero warnings, **260 tests across 36 files**, the production build and release-content verification. New coverage includes heatmap date boundaries and leap years, streaks, period comparisons, rating histograms, collection forecasts, atomic statistics saves, FSRS learning/graduation/lapses, actual elapsed review times, retention targets, scheduler migration in both directions, incomplete/imported history, scheduling off, persistence failures, numeric state restoration, full review-log retention, and interval previews.

In Obsidian 1.13.7 on macOS, the existing isolated test vault was updated and the statistics command, page and new scheduler controls were verified. An isolated browser preview with sample ratings verified the FSRS memory charts and the four rating interval previews. Test-vault settings and review data were preserved. Personal parameter optimization is not implemented. Mobile hardware and large-vault performance have not been validated for this release.

## Release 0.3.8 review fixes

`npm run check` passed strict TypeScript, source lint with zero warnings, the official Obsidian CSS rules with zero warnings against Electron 30, **280 tests across 37 files**, the production build and release-content verification. Regression checks cover hidden-note filtering during indexing and file events, hidden course sources, complete answer selection without clipboard access, course-map panel state and FSRS rating layout classes. Production dependency auditing reported zero vulnerabilities; development-tool advisory limitations are recorded in `docs/REVIEW_NOTES.md`.

An isolated browser preview using sample data verified answer selection and focus, map toolbar placement with the details panel open and closed, annotation borders and marker colors, and FSRS interval button layout. These checks did not use a personal vault or contact an AI provider. The community scanner's capability recommendations are distinct from the local lint checks: vault enumeration remains intentionally used for discovery. A new community scan is not verified by these local checks.

## Release 0.3.9 clean installation

The 0.3.8 workflow stopped during `npm ci` because a lock file generated with npm 11 omitted Vite's optional esbuild peer dependencies expected by npm 10. No 0.3.8 GitHub release or install assets were published. The lock file was regenerated with npm 10.9.4; a clean installation with that version succeeded. Version 0.3.9 contains the same review fixes and the completed lock file. The npm version is recorded in `package.json` for future lock-file maintenance.

After the clean installation, `npm run check` passed TypeScript, source and CSS lint with zero warnings, all 280 tests across 37 files, the build and release verification for 0.3.9.

## Internal refactor — 6 October 2026

Starting from `b72f3fa` on `codex/ui-polish`, `npm run check` passed formatting, strict TypeScript with unused-code checks, source lint with zero warnings, the official Obsidian stylesheet checks with zero warnings, **338 tests across 48 files**, the production build, and release-content verification. All 332 original tests remain; six new tests cover saved lesson transcripts and cancellation guards. A clean offline dependency installation with the recorded npm 10.9.4 version succeeded. The lock file retains all previous package entries and versions, adding only development-only Prettier.

The formatting-only commit `72eaa7c` built byte-identical JavaScript. After the structural extraction, comparisons against the starting source confirmed unchanged compiled JSX expressions, compiled CSS, prompt templates, and runtime literal values. The runtime import graph has no cycles. [The audit](REFACTOR_AUDIT.md) records the module changes and retained boundaries.

The three production files were backed up and installed locally in Life Vault, then Qard was disabled/re-enabled in **Obsidian 1.14.4 on macOS**. The deck library reopened with the same 427/421/1 card counts. The existing CSC3044S plan retained its October 19 exam, 421-card coverage total, and 30-card daily target; its October calendar and agenda rendered as before. Before/after calendar screenshots differed only within the pointer highlight. The installed assets match the build, and the hash of `data.json` is unchanged after reload. No sample data was added, no study reviews were performed, and no AI provider was contacted during this native check.

Saved lesson Markdown is checked against fixtures captured from the original service. The full regression suite covers the existing study, writing, test, learning, exam, persistence, and lifecycle behavior; the native check above is a focused reload/preservation check, not a repeat of every integration flow.


## Agent status layout — 6 October 2026

On `codex/agent-status-polish`, `npm run check` passed formatting, strict TypeScript, source and stylesheet lint with zero warnings, **341 tests across 49 files**, the production build and release-content verification. New interaction tests cover Escape with focus restoration, outside-click dismissal, and separate task navigation/cancellation. Existing waiting-screen, ready-state, recovery and learning tests continue to pass.

An isolated browser preview using the production `RunningJobs` and `WhileYouWait` components verified course mapping, test creation and lesson loading at 1280, 420 and 320 px. Long course/model labels wrapped without page overflow; multiple task rows kept timing and Cancel separate; the tutor hint stayed inside the waiting panel. No live AI provider was contacted.

The three plugin assets were backed up and installed in the registered `/Users/kyliandabancourt/Documents/Qard/qard/obsidian-plugin/.test-vault`. Installed hashes match the build. All existing test-vault files outside the install assets retain their hashes, including notes, settings and `data.json`. Life Vault's plugin files and review data retain their hashes. The active Life Vault session was not reloaded; native running-agent screens and mobile hardware have not been checked for this change.


## Release 0.5.2

Release 0.5.2 contains the agent-status layout changes described above. Before the release version bump, the agent-status build was also installed and Qard disabled/re-enabled in Life Vault in Obsidian 1.14.4 on macOS. The deck library reopened with the existing 774/499/433/957 card counts. Installed assets match the build, Qard remains enabled, and the hash of `data.json` is unchanged after reload. No live AI requests were made during installation.

## Cloze and image occlusion — 7 October 2026

On `codex/cloze-image-occlusion`, `npm run check` passes formatting, strict TypeScript, source and stylesheet lint with zero warnings, **383 tests across 52 files**, the production build and release-content verification. New coverage includes numbered cloze groups/hints, math and inline code in answers, literal-code exclusions, malformed metadata, atomic batch saving and retry identities, stable editing, attachment resolution/import, proportional mask drawing and keyboard editing, fractional size input validity, reveal/rating behaviour, and removal of the persistent Source/Open source buttons. Existing study, cram, saved-session, planner, learning, generation and lifecycle tests continue to pass.

An isolated local browser preview using production editor, preview and study components with mock Obsidian storage/rendering verified text selection -> Hide selection -> save, image selection -> draw two masks -> save, hidden/revealed image regions, rating -> next mask, and alignment at desktop and 380 px widths in light/dark themes. The visual pass caught a native form-validation error on arbitrary fractional mask sizes; numeric fields now accept those values and a regression test covers it. The preview's Markdown service is a text stand-in; native Obsidian Markdown integration and mobile hardware were not exercised for this change. No live AI provider was contacted.

The three plugin assets were backed up and installed in the registered `/Users/kyliandabancourt/Documents/Qard/qard/obsidian-plugin/.test-vault`. Installed assets match the verified build. All 16 existing vault files outside the plugin install assets retain their hashes, including notes, attachments, settings and `data.json`. The active personal-vault study session was not reloaded or changed.

## Release 0.5.3 — 7 October 2026

`npm run check` passes formatting, strict TypeScript, source and stylesheet lint with zero warnings, **404 tests across 54 files**, the production build and release-content verification. Version metadata matches in the package, lock file, manifest and compatibility table. The release includes cloze/image occlusion, review undo/skip/pause, and the borderless session recall-difficulty curve.

Chart regression checks cover rating frequencies and percentages, odd/even medians, split distributions, a single card, empty ratings, undo/rerating and skipped reviews. A local browser preview verified desktop light and narrow dark layouts. The border removal was also verified on an existing completion screen in Obsidian 1.14.4, retaining its session results. The production stylesheet contains no outer chart border. Mobile hardware was not exercised.

## Release 0.5.4 — 9 October 2026

On `main`, `npm run check` passes formatting, strict TypeScript, source and stylesheet lint with zero warnings, **425 tests across 56 files**, the production build and release-content verification. Version metadata matches in the package, lock file, manifest and compatibility table.

The release adds persistent FSRS learning queues for normal Due cards sessions. Regression coverage includes timed learning/relearning returns, interleaving without interrupting the current question, waiting and restart/resume after the initial pass, undo, skip/pause, finishing early, failed saves, stale or premature ratings, malformed saved queues and settings changes. Other study modes and older saved sessions retain single-pass behavior.

Before the version bump, the feature build was installed in the registered `/Users/kyliandabancourt/Documents/Qard/qard/obsidian-plugin/.test-vault`. The three installed assets matched the build, and all 19 other vault files retained their hashes, including notes, settings and review data. Native Obsidian interaction and mobile hardware were not exercised for this change; the study-flow checks use the production UI with mocked Obsidian services.

## Review editing, sibling separation and card repair — 10 October 2026

On `feature/review-card-repair-and-siblings`, `npm run check` passes formatting, strict TypeScript, source and stylesheet lint with zero warnings, **446 tests across 58 files**, the production build and release-content verification. Release metadata remains at 0.5.4; these changes are on the feature branch.

New coverage exercises in-session editing and cancellation, identity/history/queue preservation, retry after an edited note's content-check save fails, flag persistence and failed writes, precise legacy cloze/image grouping, group migration and preservation across edits/renames, grouped batch retries, atomic deferral and undo with both schedulers, concurrent sibling changes, restart and local-midnight availability, cram and scheduling-off behavior, learning-step edits, exam coverage, failure counting across distinct study days, advisory repair actions and the library repair filter.

An isolated browser preview using production components and sample in-memory storage verified the repair prompt, opening/cancelling the existing editor and the Needs fixing library filter. At desktop and 380 px widths, the prompt and controls fit within the viewport and remained accessible through the existing scroll area. Native Obsidian interaction and mobile hardware were not exercised, and no live AI provider was contacted.

### Today deck selection — 10 October 2026

- Today lists eligible due cards by deck, with accurate per-deck counts and a Study action that creates a queue for only that deck, oldest due first. Checks finish by returning to Today for deck selection.
- Four new UI/integration tests cover deck identity, saved queue isolation, paused/deferred/new/future/duplicate exclusions, live note and review updates, and checks kept separate from cards. The existing check test also verifies returning to Today.
- Full `npm run check` passed: 450 tests across 59 files, formatting, TypeScript, lint, styles, production build and release validation.
- An isolated browser preview verified the actual Today component at desktop and 380px widths, no horizontal overflow, and the chosen deck opening in study. Installed assets match the build; all 23 other test-vault files are preserved.
