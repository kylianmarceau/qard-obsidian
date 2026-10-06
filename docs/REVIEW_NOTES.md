# Community review notes

## Vault enumeration

Qard intentionally uses Obsidian’s `getMarkdownFiles()` to discover existing flashcards, populate note and folder source pickers, discover course mastery notes, and scan for Spaced Repetition cards when an import is requested. These features work across ordinary vault notes, so a vault-enumeration capability recommendation may remain in the community scanner. Changing the enumeration API would not remove the underlying capability.

Discovery is centralized in `src/vault-access.ts`. It excludes hidden Markdown files and hidden folders, and never lists attachments or other file types. Course source expansion also filters out hidden Markdown. Card indexing reads ordinary notes locally through `cachedRead()` to find Qard callouts. It does not upload their contents. The course folder picker derives folders from the same Markdown paths rather than enumerating all loaded files.

AI connections are optional. API note tools expose only ordinary Markdown notes outside the configured tests folder; requests and matching paths or excerpts can be sent to the provider chosen by the user when AI features run. Those exclusions apply to Qard’s API tools. Desktop Claude Code and Codex use their own read tools inside the vault and retain their existing vault access; they do not use Qard’s API path filter. Tasks whose prompts already contain the necessary context disable note tools where supported. Manual study does not use an AI connection.

## Clipboard

Qard does not read or write the system clipboard. **Select answer** opens a read-only text field containing the answer’s Markdown and selects it. The user copies with the operating system’s normal action. Release verification rejects clipboard API references in the bundle.

## CSS

`npm run lint:css` uses `stylelint-config-obsidianmd` and fails on warnings. It targets Electron 30 to match the reported Obsidian 1.6.5 review baseline, which is more conservative than Qard’s minimum Obsidian 1.7.2 version. All official Obsidian-specific rules remain active. The general descending-specificity rule is disabled because it cannot distinguish independent component states and intentional overrides. Declaration formatting follows Prettier; all other configured stylesheet checks remain active. No clipboard, compatibility, !important or :has warning is suppressed.

## Dependencies

Production dependency auditing reports no known vulnerabilities for this release. Obsidian is external to the bundle. Stylelint and the Obsidian API types are development tools, not shipped plugin code. Their dependency chains currently have audit advisories without a compatible upstream fix; downgrading Obsidian’s types or disabling review checks would not improve the shipped plugin. These development advisories remain disclosed rather than being marked as resolved.
