import { TFile, normalizePath, type App } from 'obsidian';
import type { VaultIndexer } from '../cards/indexer';
import type { ReviewStore } from '../review/review-store';
import {
  DEFAULT_SR_SETTINGS,
  convertSrNote,
  readSrSettings,
  scanSrNote,
  type SrNote,
  type SrSettings,
} from './sr-parser';
import { studyNotes } from '../vault-access';

export const SR_PLUGIN_ID = 'obsidian-spaced-repetition';
export interface ScannedNote extends SrNote {
  scheduled: number;
  copyOf?: string;
}
export interface ImportResult {
  notes: number;
  cards: number;
  schedules: number;
  skipped: { path: string; line: number; reason: string }[];
  failures: { path: string; message: string }[];
}

/** Uses the SR plugin's own settings when present, so custom separators and deck tags are honoured. */
export async function loadSrSettings(app: App): Promise<SrSettings> {
  const path = normalizePath(`${app.vault.configDir}/plugins/${SR_PLUGIN_ID}/data.json`);
  try {
    return (await app.vault.adapter.exists(path))
      ? readSrSettings(JSON.parse(await app.vault.adapter.read(path)))
      : DEFAULT_SR_SETTINGS;
  } catch {
    return DEFAULT_SR_SETTINGS;
  }
}

export async function scanVault(app: App, settings: SrSettings): Promise<ScannedNote[]> {
  const notes: ScannedNote[] = [],
    seen = new Map<string, string>();
  const files = studyNotes(app).sort((a, b) => a.path.localeCompare(b.path));
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!,
      source = await app.vault.cachedRead(file);
    if (settings.foldersToDecks || settings.tags.some((tag) => source.includes(tag))) {
      const note = scanSrNote(source, file.path, settings);
      if (note && (note.cards.length || note.skipped.length)) {
        const key = note.cards.map((c) => c.front + '\0' + c.back).join('\n');
        const scanned: ScannedNote = {
          ...note,
          scheduled: note.cards.filter((c) => c.schedules.some(Boolean)).length,
          copyOf: note.cards.length ? seen.get(key) : undefined,
        };
        if (note.cards.length && !seen.has(key)) {
          seen.set(key, file.path);
        }
        notes.push(scanned);
      }
    }
    if (i % 50 === 49) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  return notes;
}

/** Converts each note in place. A note that changed since it was read is left alone. */
export async function importNotes(
  app: App,
  index: VaultIndexer,
  reviews: ReviewStore,
  paths: string[],
  settings: SrSettings,
  keepSchedule: boolean,
): Promise<ImportResult> {
  const result: ImportResult = { notes: 0, cards: 0, schedules: 0, skipped: [], failures: [] };
  for (const path of paths) {
    try {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        throw new Error('The note no longer exists.');
      }
      const source = await app.vault.read(file);
      const note = scanSrNote(source, path, settings);
      if (!note?.cards.length) {
        continue;
      }
      const conversion = convertSrNote(source, note, () => crypto.randomUUID());
      result.skipped.push(...conversion.skipped.map((s) => ({ path, ...s })));
      if (!conversion.converted) {
        continue;
      }
      // Schedules first: if the note write then fails, the unused states are keyed by IDs no card has.
      if (keepSchedule) {
        await reviews.importStates(conversion.states);
      }
      await app.vault.process(file, (current) => {
        if (current !== source) {
          throw new Error('The note changed while importing. Run the import again.');
        }
        return conversion.source;
      });
      await index.refresh(file);
      result.notes++;
      result.cards += conversion.converted;
      if (keepSchedule) {
        result.schedules += conversion.states.length;
      }
    } catch (e) {
      result.failures.push({ path, message: (e as Error).message });
    }
  }
  return result;
}
