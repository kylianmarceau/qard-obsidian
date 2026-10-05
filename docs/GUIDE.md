# Qard for Obsidian

**Your learning, in focus.** Qard is the study layer for an Obsidian vault: a full workspace for browsing decks, choosing what to study, and reviewing Markdown flashcards. Your notes remain ordinary Markdown. No account, backend, analytics, or required network service.

Qard uses a compact deck list, a single breadcrumb trail, restrained blue accents, and a focused study screen. The interface shows only the controls needed for the current task. It runs as a native Obsidian `ItemView` using React components with Preact’s compatibility renderer, not an iframe.

**No prefilled decks.** A fresh install shows “No cards yet” unless your vault already contains Qard callouts. Installing or enabling Qard never creates sample notes or decks. The `example-vault/` folder contains development fixtures only and is not included in the plugin release assets.

## Install in a test vault

Requires Obsidian 1.7.2 or newer. Develop and test in a separate vault first.

```sh
cd qard-obsidian
npm ci
npm run check
npm run test-vault
```

1. In Obsidian, choose **Open another vault → Open folder as vault** and select `.test-vault`.
2. Allow community plugins in this test vault, then enable **Qard** under **Settings → Community plugins** if necessary.
3. Click the Qard ribbon icon or run **Qard: Open study workspace** from the command palette.
4. A new test vault starts empty. Choose **Create a card** to add your first card.

The test-vault script installs the current build without adding notes. Existing notes and review data are preserved, including any examples created by older versions of the development script. Toggle Qard off/on after updating its build. The script never discovers or writes to your personal vault.

For optional sample decks, run `npm run test-vault -- --examples` and open the separate `.example-test-vault` folder. Only that explicit option copies the development fixtures; rerunning it does not overwrite existing notes.

For a prebuilt installation, download `main.js`, `manifest.json`, and `styles.css` from the GitHub release. For a local build, use the same files from `release/qard/`. Copy them into:

```text
YOUR-TEST-VAULT/.obsidian/plugins/qard/
    manifest.json
    main.js
    styles.css
```

Reload Obsidian and enable Qard. Do not copy `node_modules`, the source tree, or the original web app into the vault. You can also install Qard from Obsidian’s Community plugins directory.

## AI flashcards

Choose **Generate with AI** inside a deck or from the New card page. Describe what you want in the prompt box and choose **Start**; you do not need to choose a deck or topic first. Optionally attach notes with **+ Note** or a whole course folder with **+ Folder** (including subfolders), or let the writer find relevant vault notes. The AI chooses how many cards the material needs and suggests a deck and topic, reusing existing ones when appropriate. Starting from a deck or the card editor carries that context forward. Generation uses the existing Writer connection and model in Qard settings.

Review the questions and answers, edit them or preview their Markdown, and adjust the suggested **Save to deck** and **Topic** if needed. Deselect anything you do not want, and choose **Add selected**. Approved cards are saved together as a normal Qard Markdown note in your card folder and immediately appear in the chosen deck. Existing notes are preserved. Once adding begins, the batch's destination stays fixed so later selections and save retries go into the same generated note without duplicating cards. Folder sources are snapshotted at Start, so background retries use the same notes even if a folder later gains new files.

Generation continues while you visit other screens, appears in a **Generating flashcards** row on the Decks home page and in the running-jobs menu, and can be cancelled or retried. The latest review draft, edits, selections and added status are saved in `Flashcard drafts.json` in your card folder. The home row changes to **Review flashcards** when the batch is ready and stays until all cards have been added or the draft is replaced. Click it to reopen generation or review. After a plugin reload, return to **Generate with AI** to resume reviewing. An interrupted AI request requires **Try again**. **Generate another batch** replaces the review draft; cards already added remain in the vault. Usage appears under **Writing flashcards** in the token usage report.

## Keeping cards consistent with your notes

Generated flashcards retain the note versions they were based on. Cards made from practice tests, lesson suggestions and their follow-up answers also link to their source notes. General-knowledge cards without a source are not tracked.

When a linked note changes, an affected-card row appears on Decks. Open the row or run **Qard: Review source updates** to compare the changed passages with the current card and its explanation. Note changes are detected locally; **Suggest an update** uses your configured Writer connection only when you request it. Review and edit the proposed question and answer, then choose **Apply update** or **Keep card as is**. Unrelated changes can be acknowledged without editing the card. Suggestions become unavailable if the card or its notes change while you are reviewing them.

Wording edits keep the card's ID, review history and schedule. When the correct answer changes, leave **The correct answer changed** checked: Qard preserves the history, makes the card due now and flags it for a fresh normal review. That flag clears after an actual rating; cram sessions do not clear it. Memory statistics omit flagged cards until they are reviewed. This does not reset the FSRS model or erase previous reviews.

Linked sources follow note and folder renames while Qard is enabled. Deleted sources are shown as missing and cannot be used for AI suggestions until restored. Existing cards retain their identities when their card notes move. A partially saved update can be finished after a reload without adding a duplicate card.

For older generated cards and handwritten cards, open a card's preview and choose **Link a source note**. Tracking starts from that note's current version; Qard cannot reconstruct the source of an older card automatically. You can link more than one source note. Source versions, links and pending suggestions are stored locally in `Qard/Source links.json`; back up that file with your notes. Keep this metadata file at its original path. Generation drafts, new practice tests and new lessons also retain their source versions so a change before adding their suggested cards is still detected. Historical tests and lesson transcripts remain records of their original attempts; updates edit the derived flashcards, including their answers and explanations.

## Development

- `npm run dev` — rebuild the plugin on source changes.
- `QARD_VAULT=~/path/to/vault npm run dev` (or `npm run dev -- --vault=~/path/to/vault`) — also copy `main.js`, `manifest.json` and `styles.css` into that vault's `.obsidian/plugins/qard/` after every rebuild, including edits to `styles.css`. It never touches `data.json` (settings and review history), refuses folders that aren't vaults, and adds the `.hotreload` marker so the [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads Qard automatically. `npm run build -- --vault=…` installs a production build once.
- `npm run lint` — official Obsidian source checks, with zero warnings.
- `npm run lint:css` — official Obsidian CSS checks against the review’s Electron 30 baseline, with zero warnings.
- `npm run typecheck` — strict TypeScript checking.
- `npm test` — parser, indexing, writing, selection, scheduling, and UI lifecycle tests.
- `npm run build` — create `main.js` and the installable `release/qard/` folder.
- `npm run check` — typecheck, source and CSS lint, tests, production build, and release-content checks.
- `npm run test-vault` — install the current build in an isolated vault without adding notes.
- `npm run test-vault -- --examples` — install in a separate vault with optional example notes.

See [architecture and reuse notes](ARCHITECTURE.md).

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

**Session** offers **Normal session** and **Cram mode**. A normal session reveals the answer, then asks for Again/Hard/Good/Easy. In Cram mode, press Space to reveal the answer and Space again to move to the next question; use the Reveal answer and Next card buttons on touch devices. Cram sessions run through the selected cards once, offer **Cram again** at the end, and never assign card IDs, record ratings, alter schedules or count as reviews in Statistics. The All/Due/New/Difficult filters and ordering are available in both styles. Tests, lessons and checks keep their existing behaviour.

Order can be deck/note order or shuffle. The session shows progress and finishes after every selected card has been reviewed once. Again does not silently add repeats; the summary offers an explicit **Review difficult cards** action. Sessions do not automatically resume after closing/reloading, but completed ratings remain saved.

| Key | Action |
| --- | --- |
| Space | Normal: reveal/hide answer. Cram: reveal/next card |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy, after reveal |
| F | Toggle focus mode |
| Escape | Exit focus; otherwise show/cancel the leave-session confirmation |

Shortcuts are inactive in text fields, editable content, other workspace tabs, modal inputs, media controls, and while recording. Held keys and modified shortcuts do not rate cards. Focus mode fills the app window without requiring Electron’s Fullscreen API, hides Qard navigation, and restores the original workspace when exited or the view/plugin closes. Native OS window decorations may remain visible.

Delete a whole deck with the trash icon on its row or beside the deck title. Delete a topic with the trash icon beside its Study button. Confirming removes all matching flashcard callouts across the vault, including cards hidden by search, while preserving headings, prose, attachments and other cards. This cannot be undone from Qard.

Under **Learn**, trash icons remove courses, lessons and pending course mappings. Opened courses, lessons and checks also have a trash icon in the top bar. Deleting a course moves its mastery file and associated generated lessons/checks to Obsidian's configured trash; source notes, flashcards and practice tests remain. Deleting a running mapping stops it and removes its saved proposal so it cannot restart on reload.

Every preview and study card has **Open source**; previews also offer edit and delete. To move a card between decks/topics, edit the note’s Markdown structure and keep its ID comment.

## Commands

- Qard: Open study workspace
- Qard: Review source updates
- Qard: Study selected deck(s)
- Qard: Study this deck
- Qard: Study this topic
- Qard: Study this note
- Qard: Create card from selection
- Qard: Import from Spaced Repetition
- Qard: New practice test
- Qard: Open practice tests
- Qard: Open today
- Qard: Open courses
- Qard: Teach me this note

The “this…” commands work in a Markdown note containing indexed cards. Topic selection follows the nearest Markdown heading at the cursor, respecting the file-level override. Create-from-selection opens a small transient editor to enter a question, choose a deck/topic, and save the selection as the answer. The main application is always a workspace tab.

## Importing from Spaced Repetition

Run **Qard: Import from Spaced Repetition** or use **Settings → Qard → Import**. Qard reads the Spaced Repetition plugin's settings (deck tags, ignored tags, separators, end marker, folder decks and cloze options) when they are installed. Otherwise it uses that plugin's defaults.

1. Qard scans the notes that Spaced Repetition treats as flashcard notes and lists them with card, schedule and skipped counts. Nothing is written yet.
2. Choose which notes to convert. A note with exactly the same cards as an earlier note (for example an archived copy) is marked and starts unselected.
3. **Convert notes** rewrites each selected note in place. Cards are converted as follows:
   - `Question::Answer` and multiline `?` cards become `[!qard]` callouts with IDs.
   - Reversed `:::` and `??` cards become two cards, one for each direction.
   - Headings, prose and any other text in the note stay as they are, and headings become Qard topics.
   - A nested deck tag such as `#flashcards/cs315/hmm` becomes `qard-deck: "cs315/hmm"`, unless the note already sets `qard-deck`.
   - `<!--SR:...-->` due dates, intervals and ease become Qard review states. You can turn **Keep review schedule** off to import every card as new.

Cloze cards are not converted, because Qard has no cloze cards. Cards with an empty side or an unclosed code fence are not converted either. All of these are listed and left unchanged in the note. A note that changes while the import runs is not written. Running the import again skips cards that are already Qard callouts.

The Spaced Repetition plugin no longer sees converted cards, and its note tags are left in place. Commit or back up your vault before converting. You can disable Spaced Repetition afterwards so both plugins do not read the same notes.

## Practice tests

Practice tests are a second mode next to flashcards. An AI agent writes an exam-style test from your notes, you answer in text, and the agent marks each answer against a mark scheme. Open **Tests** in the Qard library, or run **Qard: New practice test**. When a specific test is open, click the trash icon in the top bar to move its plan, questions and saved answers to Obsidian’s configured trash and return to the test list. Any running jobs for that test are stopped.

Use **+ Folder** in the new-test composer to attach a whole course. Search for its vault folder and select it once; Qard includes every Markdown note in that folder and its subfolders, shows a note count, and removes duplicates if you also attach notes or overlapping folders. Remove the folder chip to detach it. Folder contents are refreshed when you press **Start**, then saved with the request. PDFs and other non-Markdown files are not attached.

1. **Describe the test.** Type what it should cover. Optionally tick **Flashcards** and choose decks, or add specific notes. With no sources, the agent finds the relevant notes itself.
2. **Check the plan** (optional, on by default). The agent drafts a short plan: a goal, the sources it will use and why, and sections with their question mix and marks. You can remove sources or ask for changes, then choose **Generate test**. Untick **Plan first** to skip straight to the test.
3. **Take the test.** Answer short, long, calculation (LaTeX shows a preview) and multiple-choice questions. Optionally mark how sure you were, choose **I don't know** rather than guessing, and flag questions. By default each section is marked in the background when you submit it, while you carry on. Choose **Mark answers: At the end** in settings for exam conditions.
4. **Review.** The results screen shows your score and the three most important things to fix. **Review answers** shows your answer marked up like a script:
   - underlines for correct, incorrect, vague and insightful parts, and a + marker where a point was missing, each linked to a marker's note;
   - the mark scheme, showing which points you earned;
   - **Try again**, to attempt the missed points before you look at the model answer;
   - **Model answer**, which can be compared side by side with yours;
   - **Ask**, for a follow-up question;
   - **Dispute**, to have the answer re-marked, or to set the mark yourself;
   - **Make card**, to create a flashcard in the deck the question came from.
5. **Close the gaps.** After marking, the agent suggests cards for the clear gaps and updates a study profile (`_profile.md` in the tests folder). Later tests use the profile to target your weak spots. You can read and edit it.

### Choosing an agent

See [AI connections and roles](#ai-connections-and-roles).

Agents never write files. They return JSON, which Qard checks against the expected format (retrying once if it doesn't match) before saving. Marks are recalculated from the awarded rubric points, so an agent cannot give more than a question is worth. Your notes are sent to the provider you choose. No other network requests are made.

When a test's notes belong to a course with a [mastery file](#learn-mastery-checks-and-lessons), the writer tags each question with the objective it tests, and the marks are recorded in the mastery file.

Each test is a folder under `Qard/Tests/` containing `request.json`, `plan.json`, `test.json` and `attempt.json`. Tests written by any agent outside Qard appear under Tests if they follow [the file format](PRACTICE_TESTS.md).

## Learn: mastery, checks and lessons

Learn is a third mode next to flashcards and tests. It keeps a record of what you know for each course, teaches what you don't, and checks later whether it stuck. Open **Learn** in the Qard library, or run **Qard: Open today**.

### The mastery file

**Map a course** asks the writer to read a course folder and list its objectives: the specific things you need to be able to explain or do, and which objectives each one builds on. It uses your study profile to mark ones you've already struggled with, and adds topics from the course outline that no note covers yet as **not covered yet**. Nothing is saved until you accept the list. Qard then writes `<Course> Mastery.md` in that folder: a normal note with a table, one row per objective (state, due date, needs, notes, evidence). You can edit it freely: change a state or date, add or remove rows, change what an objective needs, or add your own columns. Qard only rewrites the table's rows.

### The course map

Each course page opens on a **topic map**: one node per topic (the **Group** column), with arrows showing which topics build on which. Thicker arrows mean more links. Each topic shows how many of its objectives you've learned (taught or better) as a bar, how many are ready to learn, and a ⚠ count for misconceptions and slipping objectives. Topics the outline lists but no note covers yet are faded. Everything shown is worked out from the objectives each time, so nothing extra is stored and checks, lessons and evidence work per objective as before.

**Click a topic** to open its objectives, each shown by its short **Label** (the full title is in the side panel). Topics it builds on appear as links along the top and topics it unlocks along the bottom; click one to go there, or **Topics** (or Escape) to go back. Objectives are coloured by state, and those that are **ready to learn** (untaught, with everything they build on already taught) are outlined. Lessons suggested on Today favour them.

- **Move around:** drag to pan, scroll to move, pinch or ⌘/Ctrl + scroll to zoom. The toolbar has zoom, **Fit** and **Full screen**. Keys: arrow keys move along the arrows and across a row, Enter opens a topic, `/` searches, `+`, `-` and `0` zoom, and Escape goes back.
- **Find and filter:** type in **Find** to highlight matching topics or objectives (Enter jumps to the first match, opening its topic), or click states in the legend above the map to show only those.
- **Select an objective** to see everything it builds on and everything that builds on it, with a side panel listing them (including objectives in other topics), its notes and all its evidence, with **Teach** and **Check**.
- **Route here** lists every prerequisite you haven't been taught yet, in the order to learn it, across topics. Steps are numbered on the map, topics show how many steps they hold, and **Teach step 1** starts the first lesson.

**List** shows the same objectives as rows. A mastery file without groups shows the objectives directly; **Update objectives** can add groups and labels to it. A loop in the Needs column is ignored by dropping the link that closes it.

### As the course grows

The mastery file records when the course was last mapped (`qard-mapped`). When notes in the course folder are added or edited after that, the course page says so. **Update objectives** asks the writer to read only those notes and propose new objectives, more notes or prerequisites for existing ones (a "not covered yet" objective becomes new once its notes arrive), and objectives that may be outdated. Existing objectives are never renamed or rewritten, so your progress stays attached to them, and nothing is removed unless you tick it. New objectives start as new, so an update doesn't fill Today.

Every mode reads the mastery file before writing anything, and adds evidence after:

| State | Meaning | What happens next |
|---|---|---|
| New | No evidence yet | Teach it when you're ready |
| Gap | Couldn't answer | A lesson is suggested |
| Misconception | Wrong while sure | A lesson is suggested |
| Taught | A lesson covered it | A check in 3 days |
| Shaky | Right but guessing, or partly right | A check in 2–3 days |
| Right once | One correct check or test | A harder check in a week |
| Mastered | Right again, at least 2 days later | Cards keep it fresh |
| Slipping | Mastered, but its cards are lapsing | A check today |

The rules: answering correctly straight after a lesson doesn't count, so a lesson moves an objective to **taught** at most. Mastery needs two correct answers at least two days apart, the second at a harder goal (explain, then apply). A wrong answer you were sure of is a misconception; **I don't know** is a gap. Passing a flashcard never promotes an objective, but two lapses on a card made for a mastered objective mark it as slipping.

### Today

The home page shows one **Today** row with what is due: checks first, then cards, and any objectives that need a lesson. **Start** works through them in that order.

A **check** is one to three new questions on one objective, marked straight away with the same underlines and notes as a test. The writer writes each check ahead of time, as soon as the previous result is recorded, so a check opens instantly. If the objective's notes change before you start it, it is written again. The question format follows its goal: multiple choice to tell ideas apart, short answers to recall, long answers to explain, calculations or code to apply. Every check is kept in `Qard/Checks/` as evidence, and later checks avoid repeating it.

### Lessons

Choose **Teach** on an objective, or run **Qard: Teach me this note**.

1. **Probe.** A few quick questions on what the lesson depends on, skipping anything the mastery file already shows you know.
2. **Plan.** The tutor marks the probe and proposes where to start, with a short plan and a map of the steps from what you know to the goal. Ask for changes, or choose **Start lesson**.
3. **Teach.** The writer prepares each step, starting with the first, while you work. Each step says why it is needed, explains the idea from what you already accept, and ends with a check. When you can work it out yourself, the check comes before the explanation. The tutor marks your answer live and, if you made a mistake the writer expected, shows an explanation aimed at it. You can try again once, and ask questions at any point.
4. **Close.** The lesson is recorded in the mastery file and saved as a note in `Qard/Lessons/`. The writer suggests cards (linked to the objective) and, when a note was missing something the lesson had to explain, a paragraph to add to it. Nothing is added to your notes unless you accept it. The first check is written for three days later.

## Background work and while you wait

Writing tests, marking, mapping courses and preparing lessons run in the background. Leaving the screen, closing the Qard tab or moving around Obsidian doesn't stop them. When one finishes, Obsidian shows a notice. Course mappings and updates are saved under `Qard/Proposals/` until you review them, and a lesson reopened after a reload picks up where it stopped. The header shows **● N running** while jobs are in progress; it lists each one with its elapsed time and an estimate, and opens it when clicked. Estimates come from how long that kind of job recently took with your chosen connection and model.

Long waits show **While you wait** instead of a spinner, offering one thing at a time:

- a **check** that's due, when there's time for one;
- **cards**: due flashcards, or before a lesson a warm-up on what it builds on (its prerequisites' cards, even if not due yet);
- a **missed point** from a recent test to try again;
- the **notes** the job is based on.

While a practice test is written or marked, nothing from that test's own notes is offered, so warming up doesn't inflate your score or show answers you're about to review. Ratings and answers count as usual. Once you start something the screen stays put, and when the job is done a bar offers **Continue**.

## Study statistics

Choose **Statistics** in the workspace header or run **Qard: Show study statistics**.

- **Review performance:** reviews, self-rated recall and active study days over 7 days, 30 days or saved history. Recall counts Hard, Good and Easy as remembered, and shows the change from the preceding period when both periods have reviews.
- **Study activity:** a yearly calendar heatmap with daily review counts, active days, reviews per active day and the longest streak within that year. Choose a year, click a square, or focus the calendar and use arrow keys to inspect days. The current streak spans years and stays active if you studied today or yesterday. Days follow the device’s local time.
- **Rating-based difficulty:** a histogram and median for currently indexed cards with recorded ratings. Each card’s average rating is mapped from Easy (0%) through Good (33%) and Hard (67%) to Again (100%). This observed score is not FSRS difficulty; cards with only a few ratings have little evidence yet.
- **Memory estimates (FSRS):** predicted recall now, median stability, median model difficulty, and cards below your retention target. Stability is the number of days until predicted recall falls to 90%, independently of the selected target. The difficulty distribution displays FSRS’s 1–10 scale as 0–100%. These are estimates rather than measured test scores.
- **Your collection:** reviewed and new card counts, coverage, and due cards. The seven-day forecast uses current due dates, including overdue cards today, and changes as you review. Scheduling controls due counts and the forecast; ratings are recorded even when scheduling is off.
- **By deck:** collection coverage, recall and due counts, with a shortcut to study that deck.

Daily and per-card rating totals are kept locally without the 10,000-event limit. Existing saved rating events are migrated when the plugin loads. If older reviews were already removed by that limit, they cannot be recovered and the page says the history may be incomplete. Imported schedules affect collection counts but do not create historical reviews. Deleted cards remain in activity totals and are excluded from collection and difficulty charts. Duplicate card IDs are excluded from collection counts until fixed.

## Token usage

Qard records the tokens used by every call it makes to Claude Code, Codex, the Anthropic API or OpenRouter: input, output and cache tokens, the model that ran, and the cost where the provider reports it. **Qard: Show token usage** (also **Usage** on the Learn tab and **View usage** in Settings → Qard → AI roles) shows totals for today, 7 days, 30 days or all time, tokens per day, and breakdowns by feature (writing tests, marking, writing lessons, tutoring, course mapping and so on) and by connection and model.

Cost appears only where the provider reports it: OpenRouter, and Claude Code, which reports an estimate at API prices (a Claude subscription isn't billed per token). Anthropic API and Codex runs show tokens only. Daily totals are kept for 180 days in `data.json` and can be cleared from the usage screen.

## AI connections and roles

In **Settings → Qard → AI connections**, set up the tools and keys Qard may use:

| Connection | Notes |
|---|---|
| **Claude Code** | Runs `claude -p` on this computer with your existing login. It may only read the vault (`Read`, `Grep` and `Glob`). Editing, shell and web tools are denied. Desktop only. |
| **Codex** | Runs `codex exec` with a read-only sandbox. Desktop only. |
| **Anthropic API** | Calls the Claude API directly. The model reads notes only through three read-only tools (list, search, read) and never sees the tests folder. Works on mobile. Opus and Sonnet requests use server-side refusal fallback. |
| **OpenRouter** | Any OpenRouter model that can use tools, through the same three read-only tools. Works on mobile. |

API keys are kept in Obsidian's secure storage (Obsidian 1.11.4+), not in your vault or plugin data.

Then, under **AI roles**, choose a connection and model for each job:

| Role | Does | Default |
|---|---|---|
| **Tutor** | Replies live in lessons, marks checks, answers questions. Should be fast. | Claude Code with Haiku |
| **Writer** | Maps courses, and writes tests, checks and lesson steps. Should be your best model. | Claude Code's default model |
| **Marker** | Marks practice tests in the background. | Claude Code's default model |

Each Claude Code or Codex call starts a new process, which adds a few seconds. For the most responsive tutor, use an API key or OpenRouter with a fast model.

## Review data and settings

Review states, all saved timestamped rating events, settings, the links between cards and mastery objectives, job timings, daily and per-card study totals, and daily token usage live in `.obsidian/plugins/qard/data.json`. It contains no canonical question or answer text. Back up both notes and this file if you want to preserve study history. Review saves finish before a session advances; failed saves are shown and can be retried.

Choose **Settings → Qard → Study preferences → Review scheduler**:

- **FSRS (adaptive memory):** uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), with FSRS-6 defaults and a 90% target retention. New vaults start here. You can set a target from 70% to 97%; a higher target means more frequent reviews. Target changes take effect as cards are reviewed. Personal parameter optimization is not included yet.
- **Simple intervals:** the previous scheduler, kept as the default for existing vaults. Again schedules 10 minutes ahead, Hard starts at half a day, Good at one day, and Easy at four days; later intervals grow based on rating and ease.

Switching schedulers preserves current due dates and review counts. When enabling FSRS, complete saved histories are replayed into its memory model. Cards with missing history or imported schedules start with approximate memory estimates based on their current interval; the statistics page labels these. Switching back to simple intervals retains due dates and removes FSRS memory state. No past review events are invented.

FSRS uses learning steps of 1 and 10 minutes, and a 10-minute relearning step after a lapse. Reveal the answer to preview the next review interval for each rating. **Again** means you forgot; **Hard** means you remembered with effort; **Good** means you remembered; **Easy** means immediate recall. A forgotten answer should be rated Again. Finishing a session does not automatically repeat learning cards; use Due cards once their next review is due.

Disabling scheduling still saves ratings and updates FSRS memory estimates without changing due dates or intervals. **All cards never consults the scheduler.** All timestamped rating events are now retained locally for memory reconstruction and future personalization. Earlier versions truncated history at 10,000 events; removed events cannot be recovered.

Settings include default All/Due mode, order, keyboard hints, automatic focus, optional voice answers, new-card folder and scheduling enable/disable.

## Optional voice answers

Enable voice answers in Qard settings, then choose **Record answer** during study. Microphone access is requested only at that point. Stop and play back the recording before revealing the answer. Recordings stay in memory and are discarded on card change, session exit, or view close. There is no upload, saved audio attachment, transcription or answer grading. Browser/OS microphone support varies; unavailable recording does not block normal study.

## Current scope and limitations

- No FSRS, cloze cards, general import/export, persistent recordings or speech recognition.
- Keyboard defaults are fixed; command shortcuts can use Obsidian’s normal hotkey settings.
- No course/project hierarchy beyond decks and Markdown topics, and no folder-to-deck mapping.
- Malformed YAML, empty cards and unclosed card code fences are reported and skipped. Nested Qard callouts/list-contained Qard blocks are not supported.
- Cross-vault concurrent review-data merging and saved-session resume are not implemented.
- Rich media beyond images/math depends on Obsidian’s renderer and installed processors.
- Desktop Obsidian was used for application checks. Mobile, arbitrary third-party themes and real microphone hardware require further testing; the build does not use Node/Electron runtime APIs and is not desktop-only.

Licensed under MIT; see [LICENSE](../LICENSE).

## Release verification

Version tags trigger GitHub Actions to run all checks, build the three install files, create GitHub artifact attestations, and publish the release. Tags must exactly match the manifest version. Release notes live in `docs/releases/<version>.md`. The build aliases React imports to Preact compatibility modules so the existing components work without bundling React DOM’s unused dynamic script loaders. UI tests run with the same renderer.

Qard enumerates Markdown notes once after the workspace is ready to discover flashcards across files; subsequent indexing updates only affected files. This is expected vault access, not network access.

Discovery skips hidden notes and folders. The course folder picker uses Markdown paths rather than all loaded files. API note tools also exclude the configured tests folder. Qard does not read or write the system clipboard: **Select answer** selects the answer’s Markdown in a read-only field so you can use your device’s Copy action. See [community review notes](REVIEW_NOTES.md) for the remaining vault-enumeration recommendation and development dependency audit limitations.

## Support

Finding Qard helpful? You can buy me a coffee to support its continued development. Thank you for helping make Qard better!

Support @kylianmarceau:

<a href="https://buymeacoffee.com/kylianmarceau" target="_blank" rel="noopener noreferrer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" width="175" height="40"></a>

## AI flashcard topics

AI generation can create several topics within one deck. By default, the writer assigns one topic per source note; describe a different grouping in your request if needed. Review each card’s topic before adding it. **One topic per note** rebuilds the topic names from the source-note links, including for drafts created by older versions. Cards without a source keep their current topic. Entering a shared name in **Topic for all cards** combines the batch under that topic.

Deck and topic assignments are fixed once you attempt to add cards, so a failed save can be retried safely. Already saved cards are not reorganized automatically.
