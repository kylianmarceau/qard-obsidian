# From Qard website to Obsidian

The reference website is `app/workspace.tsx` in the original website: one React stateful screen combining project/course navigation, card CRUD, dialogs and study. `lib/model.ts` defines projects → courses → plain-text cards. `app/globals.css` carries the blue layered-card mark, restrained typography, spacious cards, soft course colours and central study layout. `components/ui` contains general Radix/Tailwind primitives, not independent domain components. Navigation is local React state; the page shell, authentication, WebMCP and `/api/workspace` API are web-specific. The API stores a workspace JSON document in Cloudflare D1. The website's study renderer treats Markdown as text.

The plugin retains React, Lucide icons, Qard's visual hierarchy, deck-card layout and central question/reveal flow. It adapts those compositions rather than importing the monolithic component or its global CSS. Styles are scoped to `.qard-app` and paired with Obsidian semantic theme variables. Radix dialogs and the website sidebar assume a browser viewport and global portals, so they are not used as the workspace shell.

The minimum architectural replacements are: ItemView instead of page routing; incremental vault indexing instead of API fetches; MarkdownRenderer instead of text spans; Vault.process for exact card edits; Plugin.loadData/saveData for review metadata only. No website server code enters the plugin bundle. The original website is a separate project and is not included in this repository.

Pure modules: parser, deck aggregation, source patching, scheduler and session selection. Obsidian boundary modules: indexer, card writer, view and plugin lifecycle. The main view hosts React without iframe/webview. A small selection modal is the only modal creation flow; browser, builder, editor and study all occupy the workspace.

## Markdown design

The proposed `[!qard]- Question` callout is the default. Callout titles cannot naturally contain multiple Markdown blocks. An optional quoted HTML comment `<!-- qard-answer -->` splits rich multiline front content from the back. It is ignored inside code fences, adds no proprietary DSL, and is unnecessary for normal cards. ID comments immediately above callouts are stable UUIDs. Unidentified cards are readable without mutations. IDs are added only to selected cards before study, or when explicitly editing; duplicate IDs block stateful actions instead of merging histories.

Writes reparse the current file inside Vault.process, locate by stable ID or an unambiguous original fingerprint, and refuse conflicting card edits. They preserve all surrounding bytes and line endings. Markdown is the only canonical content; saved plugin data contains settings, states and rating history only.

Flashcard generation uses the same prompt composer styling and folder expansion as New test. Names are optional on requests; the writer suggests a destination using the current deck index when needed. The destination is stored separately from the request and can be edited during draft review. It is persisted and locked before the first save attempt, including failures after a note write, so retries cannot create a second note by changing the deck name. Older drafts with explicit deck/topic names in the request remain readable. Folder selections expand to a deduplicated, filtered Markdown-path snapshot at Start; retries retain that snapshot. Both reply schemas map to the existing flashcard usage category.

References checked: official Obsidian API declarations, Vault.process guidance, lifecycle management, and deferred indexing guidance at docs.obsidian.md and github.com/obsidianmd/obsidian-api.
