import type { CardLink } from '../review/review-store';
import type { Objective } from './mastery';

/** Vault access for learning files; the Obsidian adapter is vault-learn-storage.ts. */
export interface LearnStorage {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Atomic read-modify-write of an existing note. */
  process(path: string, fn: (text: string) => string): Promise<void>;
  exists(path: string): boolean;
  /** Files with this extension under a folder, recursively. */
  files(folder: string, extension: string): string[];
  /** Notes whose frontmatter has qard-mastery. */
  masteryFiles(): string[];
  modified(path: string): number | undefined;
  /** Resolves a wikilink target to a vault path. */
  resolve(link: string, from: string): string | undefined;
  /** Moves one selected Qard learning file to Obsidian's configured trash. */
  remove(path: string): Promise<void>;
}

export interface CardLinks {
  get(cardId: string): CardLink | undefined;
  set(cardId: string, link: CardLink): Promise<void>;
}

export type LearnJobKind =
  | 'map-course'
  | 'check-write'
  | 'check-mark'
  | 'probe'
  | 'map'
  | 'revise'
  | 'steps'
  | 'tutor'
  | 'ask'
  | 'close'
  | 'figure';

export interface LearnJob {
  kind: LearnJobKind;
  id: string;
  startedAt?: number;
  error?: string;
}

export interface CourseProposal {
  folder: string;
  course: string;
  objectives: Objective[];
}

export interface CourseUpdate {
  mastery: string;
  course: string;
  notes: string[];
  added: Objective[];
  extended: {
    id: string;
    title: string;
    notes: string[];
    needs: string[];
    group?: string;
    label?: string;
  }[];
  outdated: { id: string; title: string; reason: string }[];
}

export interface LearnSnapshot {
  revision: number;
  jobs: Record<string, LearnJob>;
}

/** A course mapping or update in flight or failed, kept on disk so a reload restarts it and failures stay visible. */
export interface CourseJobRecord {
  kind: 'map' | 'update';
  target: string;
  request: string;
  status: 'running' | 'failed';
  startedAt: number;
  error?: string;
}
