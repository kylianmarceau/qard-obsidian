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
