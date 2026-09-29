# Qard for Obsidian

**Your learning, in focus.** Qard is the study layer for an Obsidian vault: a full workspace for browsing decks, choosing what to study, and reviewing Markdown flashcards. Your notes remain ordinary Markdown. No account, backend, analytics, or required network service.

Qard uses a compact deck list, a single breadcrumb trail, restrained blue accents, and a focused study screen. The interface shows only the controls needed for the current task. It runs as a native Obsidian `ItemView` containing React, not an iframe.

## Install in a test vault

Requires Obsidian 1.5.0 or newer. Develop and test in a separate vault first.

```sh
cd qard-obsidian
npm ci
npm run check
npm run test-vault
```

1. In Obsidian, choose **Open another vault → Open folder as vault** and select `.test-vault`.
2. Allow community plugins in this test vault, then enable **Qard** under **Settings → Community plugins** if necessary.
3. Click the Qard ribbon icon or run **Qard: Open Qard** from the command palette.
4. The example library contains **13 cards in 3 decks**. Computer Networks has **8 cards across two files**.

The test-vault script copies the example notes on the first run and installs the current build. Later runs update only plugin files; they preserve note edits and review data. Toggle Qard off/on after updating its build. The script never discovers or writes to your personal vault.

For a prebuilt installation, download `main.js`, `manifest.json`, and `styles.css` from the GitHub release. For a local build, use the same files from `release/qard/`. Copy them into:

```text
YOUR-TEST-VAULT/.obsidian/plugins/qard/
    manifest.json
    main.js
    styles.css
```

Reload Obsidian and enable Qard. Do not copy `node_modules`, the source tree, or the original web app into the vault. Qard is not yet listed in the Community Plugin directory.

## Development

- `npm run dev` — rebuild the plugin on source changes.
- `npm run typecheck` — strict TypeScript checking.
- `npm test` — parser, indexing, writing, selection, scheduling, and UI lifecycle tests.
- `npm run build` — create `main.js` and the installable `release/qard/` folder.
- `npm run check` — typecheck, tests, and production build.
- `npm run test-vault` — install the current build in the isolated example vault.

See [architecture and reuse notes](docs/ARCHITECTURE.md).

## Markdown cards

A simple card uses an Obsidian callout. The callout title is the question; its quoted body is the answer:

```markdown
---
qard-deck: Computer Networks
---

# Transport Layer

<!-- qard-id: example-tcp -->
> [!qard]- What does TCP provide?
> TCP provides **reliable, ordered delivery** of data.
>
> - Retransmission
> - Ordered delivery
```

The `-` makes the callout collapsed in ordinary notes. Qard also accepts `[!qard]` and `[!qard]+`. Prefix every answer line, including blank lines, with `>`. Keep cards outside code fences. In Qard, decks are compact rows, topics start collapsed, and expanding a topic shows question rows rather than expanded answers.

### Decks and topics

- `qard-deck` names a **logical deck**. Every note with the exact same deck name contributes to the same deck, regardless of its folder. Names are case-sensitive.
- Without `qard-deck`, a note’s filename (without `.md`) becomes its deck name.
- The closest preceding heading, at any level, becomes the topic. Nested headings replace the topic rather than building a hierarchy. ATX (`# Heading`) and setext headings work; headings inside fenced code are ignored.
- Before the first heading, the topic is `General`.
- Optional `qard-topic: Transport Layer` overrides headings for the entire file.
- Search matches deck, topic, question, YAML tags and inline tags. It does not search answer prose.

For example, `networking-1.md` and `networking-2.md` can both declare `qard-deck: Computer Networks`; they appear as one deck. Topics with the same name in that deck merge too. Within a deck, note paths are sorted and cards keep their source order.

### Both sides support rich Markdown

Images, formatting, lists, code, wikilinks and math are rendered with Obsidian’s Markdown renderer and the source note path. The primary format stays simple. For a multiline front, add one unobtrusive separator:

````markdown
> [!qard]- What does this function return?
>
> ```js
> [1, 2, 3].map(n => n * 2)
> ```
> <!-- qard-answer -->
> `[2, 4, 6]`
````

Qard’s editor writes this marker only when the front has multiple lines. The answer marker is hidden in normal reading view; ordinary Obsidian callouts still treat all quoted content as their body. The marker is reserved outside fenced code in Qard cards.

### Images and LaTeX

```markdown
> [!qard]- Identify this diagram: ![[network.svg]]
> ![[Attachments/network.svg|400]]
>
> This shows **packet routing**.

> [!qard]- What does $E = mc^2$ mean?
> Energy and mass are related:
>
> $$
> E = mc^2
> $$
```

Local Markdown images such as `![Diagram](../Attachments/network.svg)` also use Obsidian’s renderer. Source-relative links keep their source path. When creating a card from a selection into another deck, Qard creates a sibling note to preserve relative attachments. Cards created from the library go into the configured folder; vault-relative wikilinks are easiest there.

Simple remote Markdown images are shown as links instead of automatically loaded images. Other HTML/embed behavior follows Obsidian and its installed Markdown processors; Qard is not a network sandbox. Use vault attachments for fully offline cards. No card text is uploaded by Qard.

### Stable identities and safe editing

You do not need to type IDs. Handwritten callouts are detected immediately. Before persistent review or when editing, Qard inserts a UUID comment directly above an unidentified card. Cards created in Qard receive IDs immediately.

Keep the adjacent `<!-- qard-id: ... -->` comment with its callout when moving a card. The ID survives edits, reorderings and file renames. Copying a card should omit its ID; Qard flags duplicate IDs and blocks ambiguous review/edit operations. Removing the ID makes the card a new identity. Editing unidentified cards before their first review does not preserve an identity, because none has yet been saved.

The editor, delete action and ID assignment use `Vault.process` and replace only the affected source range. Surrounding prose and line endings are preserved. Concurrent content changes or ambiguous matches stop the edit rather than overwrite unknown text. Create-from-selection copies the selection as Markdown; it does not remove the original text. Delete removes the callout and its ID from the note after an inline confirmation. Review metadata is retained so undoing a deletion can restore its history; use Obsidian/File Recovery or your normal backups for note recovery.

## Studying at your pace

Choose **Study**, select any combination of decks/topics/individual cards, choose a mode and order, and start. Expand a deck to choose topics, then expand a topic to choose individual cards.

| Mode | Includes |
| --- | --- |
| **All cards** | Every selected card, regardless of scheduling, due date or review history |
| Due cards | Unreviewed cards and reviewed cards whose due date has arrived |
| New cards | Cards with no recorded reviews |
| Difficult cards | Cards whose last rating was Again or Hard |

Order can be deck/note order or shuffle. The session shows progress and finishes after every selected card has been reviewed once. Again does not silently add repeats; the summary offers an explicit **Review difficult cards** action. Sessions do not automatically resume after closing/reloading, but completed ratings remain saved.

| Key | Action |
| --- | --- |
| Space | Reveal/hide answer |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy, after reveal |
| F | Toggle focus mode |
| Escape | Exit focus; otherwise show/cancel the leave-session confirmation |

Shortcuts are inactive in text fields, editable content, other workspace tabs, modal inputs, media controls, and while recording. Held keys and modified shortcuts do not rate cards. Focus mode fills the app window without requiring Electron’s Fullscreen API, hides Qard navigation, and restores the original workspace when exited or the view/plugin closes. Native OS window decorations may remain visible.

Every preview and study card has **Open source**; previews also offer edit and delete. To move a card between decks/topics, edit the note’s Markdown structure and keep its ID comment.

## Commands

- Qard: Open Qard
- Qard: Study selected deck(s)
- Qard: Study this deck
- Qard: Study this topic
- Qard: Study this note
- Qard: Create card from selection

The “this…” commands work in a Markdown note containing indexed cards. Topic selection follows the nearest Markdown heading at the cursor, respecting the file-level override. Create-from-selection opens a small transient editor to enter a question, choose a deck/topic, and save the selection as the answer. The main application is always a workspace tab.

## Review data and settings

Review states, the most recent 10,000 rating events and settings live in `.obsidian/plugins/qard/data.json`. It contains no canonical question or answer text. Back up both notes and this file if you want to preserve study history. Review saves finish before a session advances; failed saves are shown and can be retried.

The scheduler is deliberately small and isolated behind an interface; it is **not FSRS**. Again schedules 10 minutes ahead, Hard starts at half a day, Good at one day, and Easy at four days; later intervals grow based on rating and ease. Disabling scheduling still saves ratings without changing due dates. **All cards never consults the scheduler.**

Settings include default All/Due mode, order, keyboard hints, automatic focus, optional voice answers, new-card folder and scheduling enable/disable.

## Optional voice answers

Enable voice answers in Qard settings, then choose **Record answer** during study. Microphone access is requested only at that point. Stop and play back the recording before revealing the answer. Recordings stay in memory and are discarded on card change, session exit, or view close. There is no upload, saved audio attachment, transcription or answer grading. Browser/OS microphone support varies; unavailable recording does not block normal study.

## Current scope and limitations

- No FSRS, cloze cards, import/export, advanced statistics, persistent recordings or speech recognition.
- Keyboard defaults are fixed; command shortcuts can use Obsidian’s normal hotkey settings.
- No course/project hierarchy beyond decks and Markdown topics, and no folder-to-deck mapping.
- Malformed YAML, empty cards and unclosed card code fences are reported and skipped. Nested Qard callouts/list-contained Qard blocks are not supported.
- Cross-vault concurrent review-data merging and saved-session resume are not implemented.
- Rich media beyond images/math depends on Obsidian’s renderer and installed processors.
- Desktop Obsidian was used for application checks. Mobile, arbitrary third-party themes and real microphone hardware require further testing; the build does not use Node/Electron runtime APIs and is not desktop-only.

Licensed under MIT; see [LICENSE](LICENSE).
