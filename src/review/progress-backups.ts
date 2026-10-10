import type { PluginData } from './review-store';
import { readSessions, stableId } from './saved-session';
import { readExams } from '../exams/exam-plan';
import { validFsrs } from './fsrs-scheduler';

export type ReviewProgress = Pick<
  PluginData,
  'version' | 'states' | 'history' | 'statistics' | 'links' | 'sessions' | 'exams'
>;
export interface ProgressBackup {
  version: 1;
  createdAt: number;
  progress: ReviewProgress;
  checksum: string;
}
export interface BackupStorage {
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}
export function progressSnapshot(data: PluginData): ReviewProgress {
  const { version, states, history, statistics, links, sessions, exams } = data;
  return JSON.parse(
    JSON.stringify({ version, states, history, statistics, links, sessions, exams }),
  ) as ReviewProgress;
}
export function validateProgress(value: unknown): ReviewProgress {
  const data = value as ReviewProgress | undefined;
  const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
  const counter = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  const date = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(new Date(value).getTime());
  const counts = (value: unknown) =>
    Array.isArray(value) && value.length === 4 && value.every(counter);
  if (
    !data ||
    data.version !== 1 ||
    !record(data.states) ||
    !record(data.links) ||
    !record(data.statistics) ||
    !record(data.statistics.daily) ||
    !record(data.statistics.cards) ||
    typeof data.statistics.partialHistory !== 'boolean' ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.exams)
  ) {
    throw new Error('This file is not a supported Qard study-progress backup.');
  }
  if (
    Object.entries(data.states).some(
      ([id, state]) =>
        !stableId(id) ||
        !state ||
        state.cardId !== id ||
        !counter(state.reviewCount) ||
        !counter(state.lapses) ||
        (state.due !== undefined && !date(state.due)) ||
        (state.lastReviewed !== undefined && !date(state.lastReviewed)) ||
        (state.buriedUntil !== undefined && !date(state.buriedUntil)) ||
        (state.fsrs !== undefined && !validFsrs(state.fsrs)) ||
        !Number.isFinite(state.interval) ||
        state.interval < 0 ||
        !Number.isFinite(state.ease) ||
        state.ease <= 0,
    ) ||
    data.history.some(
      (event) =>
        !event ||
        !stableId(event.cardId) ||
        ![1, 2, 3, 4].includes(event.rating) ||
        !date(event.at) ||
        typeof event.scheduled !== 'boolean' ||
        (event.introduced !== undefined && typeof event.introduced !== 'boolean'),
    ) ||
    Object.entries(data.statistics.daily).some(
      ([day, value]) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !counts(value),
    ) ||
    Object.entries(data.statistics.cards).some(([id, value]) => !stableId(id) || !counts(value)) ||
    readSessions(data.sessions).length !== data.sessions.length ||
    readExams(data.exams).length !== data.exams.length ||
    Object.entries(data.links).some(
      ([id, link]) =>
        !stableId(id) ||
        !link ||
        !counter(link.lapses) ||
        typeof link.mastery !== 'string' ||
        typeof link.objective !== 'string',
    )
  ) {
    throw new Error('This backup contains invalid study progress. Nothing was restored.');
  }
  return data;
}
async function digest(createdAt: number, progress: ReviewProgress) {
  const bytes = new TextEncoder().encode(JSON.stringify({ createdAt, progress }));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const filename = /^study-\d+-[A-Za-z0-9_-]+\.json$/;
const INTERVAL = 30 * 60 * 1000;
const KEEP = 30;

/** Immutable local files, serialized writes, checksum validation and bounded rotation. */
export class ProgressBackups {
  private last = -Infinity;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: BackupStorage) {}
  capture(data: PluginData, force = false, now = Date.now()): Promise<void> {
    const snapshot = progressSnapshot(data);
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        if (!force && now >= this.last && now - this.last < INTERVAL) {
          return;
        }
        validateProgress(snapshot);
        const backup: ProgressBackup = {
          version: 1,
          createdAt: now,
          progress: snapshot,
          checksum: await digest(now, snapshot),
        };
        const name = `study-${now}-${crypto.randomUUID()}.json`;
        await this.storage.write(name, JSON.stringify(backup));
        await this.read(name); // Verify the completed file before rotating older copies.
        this.last = now;
        const files = (await this.storage.list())
          .filter((name) => filename.test(name))
          .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
        for (const old of files.slice(KEEP)) {
          await this.storage.remove(old);
        }
      });
    this.queue = operation;
    return operation;
  }
  async read(name: string): Promise<ProgressBackup> {
    if (!filename.test(name)) {
      throw new Error('Choose a backup from the list.');
    }
    const backup = JSON.parse(await this.storage.read(name)) as ProgressBackup;
    if (
      backup.version !== 1 ||
      typeof backup.createdAt !== 'number' ||
      !Number.isFinite(new Date(backup.createdAt).getTime())
    ) {
      throw new Error('Invalid backup metadata.');
    }
    validateProgress(backup.progress);
    if (backup.checksum !== (await digest(backup.createdAt, backup.progress))) {
      throw new Error('The backup is incomplete or has changed. Nothing was restored.');
    }
    return backup;
  }
  async list() {
    await this.queue.catch(() => {});
    const result: { name: string; backup?: ProgressBackup; error?: string }[] = [];
    for (const name of (await this.storage.list()).filter((name) => filename.test(name))) {
      try {
        result.push({ name, backup: await this.read(name) });
      } catch {
        result.push({ name, error: 'Incomplete or damaged backup' });
      }
    }
    return result.sort((a, b) => (b.backup?.createdAt ?? 0) - (a.backup?.createdAt ?? 0));
  }
}
