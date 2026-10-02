# Debugging Qard

Qard keeps the last 3,000 diagnostic events in memory at all times. Turning on debug logging also writes them to a file, and saves each agent run's prompt and reply. None of this appears in Qard's interface or leaves your computer.

## Turn on logging

Run **Qard: Toggle debug logging** from the command palette. It stays on across reloads until you toggle it off. While it's on:

- events print to the developer console (Cmd+Option+I on macOS, Ctrl+Shift+I elsewhere) as `[Qard:area] event`;
- they're appended as JSON lines to `.obsidian/plugins/qard/debug.log`, which rotates to `debug.log.old` at 5 MB;
- each agent run's full prompt, schema and reply (or error) is saved to `.obsidian/plugins/qard/debug/runs/`. The last 100 are kept.

**Qard: Write debug report** saves the recent events, the jobs and any runs still going to `.obsidian/plugins/qard/debug/report-<time>.json`.

## The `qard` console object

Type these in the developer console:

| Call | Shows |
|---|---|
| `qard.help()` | This list. |
| `qard.jobs()` | Qard's jobs (probe, map, steps, figure, mark…) with their key, age and error. |
| `qard.runs()` | What's in flight right now: jobs, agent runs and processes, with their age. |
| `qard.log(filter?, n?)` | Recent events. `filter` is text (`'openrouter'`) or a RegExp (`/failed/`). |
| `qard.errors()` | Recent failures, timeouts, rejected replies and cancels. |
| `qard.lesson(path?)` | A lesson's saved state; without a path, the last lesson opened. |
| `qard.cancel(key)` | Cancels a job by the key `qard.jobs()` shows. |
| `qard.report()` | Writes the debug report and returns its path. |

Wrap results in `console.table(...)` to read them as a table.

## What's logged

| Area | Events |
|---|---|
| `job` | Every lesson, check, test and figure job: start, done, failed or cancelled, with its duration. Also when a job is already running and isn't started again. |
| `agent` | Every agent run: purpose, role, connection, model, prompt size, duration, tokens, how it ended. Also replies that fail validation (with the reply), and requests that time out. |
| `openrouter`, `anthropic` | Each request in the tool loop: turn, HTTP status, finish or stop reason, tools called, the model that served it, tokens. |
| `codex` | Codex's events as they arrive: reasoning, commands it runs, messages, errors. |
| `process` | Each Claude Code, Codex, Python or shell process: command, arguments, pid, exit code, stderr, and whether it was killed for a timeout or a cancel. |
| `lesson` | Opening a lesson (its stage, which steps exist, its jobs) and the notes context prepared for the tutor. |
| `figure` | Illustrator attempts that failed, with the error. |

## Finding a hang

1. Turn on logging and reproduce the problem.
2. Run `console.table(qard.runs())`. Whatever has been running far longer than usual is the stuck part, and its `data` says what it is.
3. Run `console.table(qard.log(/agent|openrouter|codex|process/))` to see the last requests: did a request go out with no response, did a process never exit, or was a reply rejected and retried?
4. Open the newest file in `debug/runs/` to read the exact prompt and reply.
