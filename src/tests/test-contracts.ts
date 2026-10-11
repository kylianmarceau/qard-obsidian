import type { PracticeTest, Attempt } from './test-types';

/** File access for test folders; the Obsidian adapter lives in vault-storage.ts. */
export interface TestStorage {
  folders(root: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): boolean;
  trash(folder: string): Promise<void>;
}

export type JobKind = 'plan' | 'generate' | 'mark' | 'wrapup' | 'retry' | 'ask' | 'dispute';

/** startedAt lets the UI show elapsed time and how long is left. */
export interface Job {
  kind: JobKind;
  id: string;
  startedAt?: number;
  error?: string;
}

export interface TestSummary {
  folder: string;
  title: string;
  created: number;
  status: 'planning' | 'plan' | 'writing' | 'ready' | 'in-progress' | 'marked' | 'failed';
  score?: number;
  marks?: number;
}

export interface ServiceSnapshot {
  revision: number;
  jobs: Record<string, Job>;
}

/** The link to course mastery files: objectives for writing, evidence after marking. */
export interface TestLearning {
  objectives(paths: string[]): Promise<{ mastery: string; lines: string } | undefined>;
  record(test: PracticeTest, attempt: Attempt): Promise<void>;
}
