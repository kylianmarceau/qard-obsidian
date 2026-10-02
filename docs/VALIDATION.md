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

## Cloze and image occlusion — 2 October 2026

On `feat/visual-and-cloze-cards`, `npm run check` passed strict TypeScript, lint with zero warnings, **264 tests across 35 files**, the production build and release-content verification. Regression checks cover hidden/revealed cloze content and hints, LaTeX braces and code indentation, format round-trips and CRLF, optional explanations, stable identities and concurrent mask edits, format conversion, invalid mask bounds and local attachment validation, pointer drawing in both directions, keyboard mask controls, missing attachments, the reveal/rating flow, and AI cloze generation, draft restoration and acceptance.

A local desktop browser preview verified selecting an image, drawing a mask over a diagram label, saving through the real card writer into an in-memory vault, viewing both faces, and studying and revealing the image card. The cloze study front also showed hints and blanks without answer text. The preview uses mock vault and Markdown services; native Obsidian rendering and mobile devices have not been checked for the new formats. All blanks/masks on a card share one review identity and reveal together. AI mask suggestions and Spaced Repetition cloze import are outside this change.
