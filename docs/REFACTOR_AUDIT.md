# Internal refactor audit — 6 October 2026

Scope: the plugin codebase on `codex/ui-polish`, starting from `b72f3fa`. The requirement was to improve organization and readability while preserving the existing interface and functionality. This audit covers source structure and local verification; it is not a new community-store approval or a live-provider integration test.

## Findings and changes

| Area reviewed | Result |
| --- | --- |
| All 99 original source modules, test/support files, build scripts, and configuration | Applied one formatting convention, explicit control-flow braces, type-only imports, and unused-code checks. Added pinned development-only Prettier tooling. |
| Plugin lifecycle | Named service initialization, workspace registration, command registration, and background startup phases. Preserved their order and cleanup ownership. |
| Shared UI | Moved library navigation out of the test browser. Consolidated answer rendering, feedback states, and plural labels into focused shared modules. |
| Learning UI | Replaced the combined screen module with one module per screen. Separated course progress, graph presentation styles, navigation, and subscription hooks. |
| Course graph | Moved deterministic placement, topic aggregation, routing, and graph constants out of the SVG component. |
| Learning service | Extracted contracts, evidence calculations, note-section insertion, and lesson-note formatting. Kept job orchestration, recovery, and persistence in the service. |
| Practice-test service | Extracted storage/job contracts. Kept test generation, marking, attempt saves, recovery, and deletion in the service. |
| Provider execution | Shared the identical pre/post cancellation guard between tests and learning. Preserved lazy desktop API loading and existing provider selection. |
| Cards, reviews, exams, audio, migration, settings, storage, and provider adapters | Reviewed ownership and dependencies; retained their existing boundaries and behavior. Normalized formatting and imports without introducing replacement abstractions. |
| Styles and release tooling | Preserved declarations and packaging. Removed the now-unneeded compact CSS declaration exception; official Obsidian lint rules remain active. |
| Contributor documentation | Documented module ownership, startup, persistence invariants, and the required checks. |

The resulting source contains 119 modules and no runtime import cycles. Extracted modules have direct imports; there are no compatibility barrels or duplicate implementations left behind.

## Preservation evidence

The formatting-only commit `72eaa7c` produced a production JavaScript bundle byte-for-byte identical to the starting build. Structural changes necessarily alter the bundle, so the later comparison checked contracts rather than bundle hashes:

- All compiled root JSX expressions match the original expressions, including static text and whitespace.
- CSS compiled to the same minified declarations and selectors.
- Prompt templates match the original templates.
- The complete multiset of runtime literal values across source modules is unchanged, including text, constants, regular expressions, and template fragments.
- Golden lesson-note fixtures were captured from the original service at `b72f3fa`. They check course and standalone transcripts, marked answers, multiple choice, unknown answers, unfinished steps, follow-up questions, links, and Mermaid text.
- Cancellation tests check task/reply identity, already-cancelled calls, late replies, and preservation of provider errors.
- The original regression suite remains in place. See [validation results](VALIDATION.md#internal-refactor--6-october-2026) for the completed checks.

These comparisons support preservation without claiming that static checks prove every possible interaction. Existing persistence schemas, filenames, commands, settings defaults, scheduling calculations, and production dependency versions are unchanged. No feature changes or data migrations were introduced.

## Deliberate boundaries

Stateful services remain cohesive rather than being divided into arbitrary handler classes. Their separate write queues remain separate because their save/recovery semantics differ. Provider-specific execution loops also remain separate. This avoids making a cosmetic refactor depend on changes to cancellation timing, retry behavior, or storage ordering.

Large prompts and generated Markdown retain their existing template contents. Further changes to these strings should be reviewed as behavior changes, with output-level tests. The formatter intentionally leaves embedded template languages alone.
