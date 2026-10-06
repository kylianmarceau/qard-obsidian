# Architecture

Qard is an Obsidian plugin with a React component tree rendered through Preact compatibility modules. It runs in an `ItemView`; navigation is local state, and Markdown renders through Obsidian. The plugin has no website server or iframe. Styles are scoped to Qard classes and use Obsidian theme variables.

## Module map

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Composition root: construct services, register views and commands, start indexing after layout readiness, and dispose resources. |
| `src/views/` | Obsidian view adapters, workspace screen selection, and service injection. `navigation.ts` defines navigation requests; `services.ts` defines the UI service boundary. |
| `src/components/` | User interaction and presentation. Shared library navigation lives in `library/`; answer rendering and feedback live in `common/`. Learning screens each have their own module. |
| `src/cards/` | Parse and index Markdown cards, perform atomic edits, generate drafts, and track source changes. |
| `src/decks/` | Aggregate cards into decks and topics. |
| `src/review/` | Review metadata, scheduling, study selection, resumable sessions, keyboard rules, and statistics. |
| `src/tests/` | Practice-test contracts, schemas, prompts, annotation matching, job orchestration, and the vault storage adapter. |
| `src/learn/` | Course mastery, graph layout, learning evidence, lesson transcripts, note edits, schemas, job orchestration, and the vault storage adapter. |
| `src/exams/` | Exam-plan selection, coverage, study-day calculations, and calendar dates. |
| `src/agents/` | Provider selection, response validation, usage accounting, cancellation guards, and optional vault tools. |
| `src/audio/` | In-memory recording and voice-answer interaction. |
| `src/jobs/` | Job timing estimates. |
| `src/settings/`, `src/migration/` | Settings UI and the explicit Spaced Repetition import. |
| `src/vault-access.ts` | Shared filtering of ordinary Markdown notes and folders. |

Domain files contain deterministic calculations where possible. Obsidian adapters handle vault access and lifecycle ownership. Components subscribe to service snapshots and call service operations; they do not duplicate persistence rules. Contracts use type-only imports so a component can describe a service without loading its implementation.

Learning and practice-test services retain their stateful orchestration: job controllers, subscriptions, save ordering, recovery, and deletion belong together. Graph placement, scoring evidence, transcript formatting, and note-section insertion are separate pure modules. Their extraction does not change the service APIs or persisted formats.

## Startup and ownership

`QardPlugin.onload()` loads review data, initializes services, registers the workspace and commands, adds settings, and schedules background work for layout readiness. That order matters: indexing and interrupted jobs must see initialized settings and storage. Unloading releases views, closes owned selection modals, disposes services, and cancels registered listeners and timers.

The view supplies services to the component tree. Screen state belongs to `QardApp`; domain job state belongs to the corresponding service. UI subscriptions return cleanup functions. Desktop CLI runners load Node APIs lazily, keeping desktop-only dependencies out of mobile startup.

## Persistence

- Markdown callouts are canonical flashcard content. Stable IDs link them to review history; indexing alone does not add IDs or edit notes.
- `data.json` stores settings, review states and events, card/mastery links, saved sessions, exam plans, timing estimates, and usage totals. `ReviewStore` serializes saves and publishes successful snapshots.
- Practice-test folders hold requests, plans, tests, and attempts. `TestService` coordinates their jobs and writes through `TestStorage`.
- Course mastery lives in Markdown. Learning JSON records retain lesson/check state and resumable course jobs; completed lessons also produce Markdown transcripts. `LearnService` writes through `LearnStorage`.
- Source provenance and update journals let an interrupted card update finish without silently losing its review flag.

Write queues remain specific to their owners. Review metadata, per-file lesson/check writes, test attempts, and source-update journals have different recovery requirements; they are not interchangeable generic persistence tasks.

## Invariants for changes

Keep stable card identities, surrounding note bytes, and existing file formats intact. Reparse inside `Vault.process` before editing a card or note. Reject conflicting edits rather than replacing user changes. Save a review before advancing a study session, and preserve retry state after a failed write.

Validate provider replies before using them. Cancellation guards check before a run and after its reply, so a provider that cannot abort does not apply a cancelled result. Existing prompts, schemas, retry behavior, and source snapshots are part of the feature contract.

Keep calendar arithmetic in the exam domain and scheduling in the review domain. Exam coverage and daily targets do not reschedule FSRS due dates. Cram navigation does not record review events.

See [contribution instructions](../CONTRIBUTING.md) for checks and [the refactor audit](REFACTOR_AUDIT.md) for preservation evidence.

## Markdown design

The proposed `[!qard]- Question` callout is the default. Callout titles cannot naturally contain multiple Markdown blocks. An optional quoted HTML comment `<!-- qard-answer -->` splits rich multiline front content from the back. It is ignored inside code fences, adds no proprietary DSL, and is unnecessary for normal cards. ID comments immediately above callouts are stable UUIDs. Unidentified cards are readable without mutations. IDs are added only to selected cards before study, or when explicitly editing; duplicate IDs block stateful actions instead of merging histories.

Writes reparse the current file inside Vault.process, locate by stable ID or an unambiguous original fingerprint, and refuse conflicting card edits. They preserve all surrounding bytes and line endings. Markdown is the only canonical content; saved plugin data contains settings, states and rating history only.

Flashcard generation uses the same prompt composer styling and folder expansion as New test. Names are optional on requests; the writer suggests a destination using the current deck index when needed. The destination is stored separately from the request and can be edited during draft review. It is persisted and locked before the first save attempt, including failures after a note write, so retries cannot create a second note by changing the deck name. Older drafts with explicit deck/topic names in the request remain readable. Folder selections expand to a deduplicated, filtered Markdown-path snapshot at Start; retries retain that snapshot. Both reply schemas map to the existing flashcard usage category.

## Source consistency and cram sessions

`cards/source-sync-service.ts` records provenance by stable card ID, compares note versions locally, validates Writer suggestions and journals approved updates before editing. `Source links.json` deduplicates baseline note versions across cards; applying journals allow a saved card edit and its pending review flag to finish after an interrupted write. Source links are registered before card creation so a metadata failure cannot leave a successfully generated card silently untracked. Current source snapshots are verified again before an edit; handwritten edits are protected by the existing atomic card writer. When a card lives in its source note, comparison excludes that derived card itself but retains other cards and prose.

Generation snapshots travel with AI drafts, practice tests and lessons, then into generated card creation. A source inferred by a test or flashcard writer is captured after generation only if its vault modification time shows it did not change during that run. Source-update calls include the relevant old and new notes directly and disable vault tools. They appear under Updating flashcards in Usage. Tests and lesson transcripts remain historical records.

`SessionStyle` is separate from `StudyMode`: normal/cram controls the interaction, while all/due/new/difficult controls selection. Cram never calls the card writer to assign identities or the review store to record events. It uses synchronous navigation guards to avoid skipping a question on rapid input, with the same typing, recording, confirmation, active-view and focus protections as normal study.
