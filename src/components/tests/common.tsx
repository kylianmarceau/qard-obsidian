import { useEffect, useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { Question, TestFolder } from '../../tests/test-types';
import type { Job, JobKind } from '../../tests/test-service';

export type TestNav = {
  library: () => void; tests: () => void; newTest: (prompt?: string) => void; plan: (folder: string) => void; take: (folder: string) => void;
  results: (folder: string) => void; review: (folder: string, question?: string) => void; cards: (folder: string) => void;
};

/** Loads a test folder and re-renders when the service changes it. */
export function useTestFolder(services: QardServices, folder: string): { entry?: TestFolder; error?: string; job: (kind: JobKind, id?: string) => Job | undefined } {
  const snapshot = useSyncExternalStore(services.tests.subscribe, services.tests.getSnapshot);
  const [error, setError] = useState<string>();
  useEffect(() => { let live = true; services.tests.load(folder).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [services, folder]);
  void snapshot;
  return { entry: services.tests.get(folder), error, job: (kind, id) => services.tests.job(folder, kind, id) };
}

/** Where a card for this question belongs: its source note's deck and heading, else a deck named after the test. */
export function cardTarget(services: QardServices, q: Question, testTitle: string, sectionTitle: string) {
  const cards = q.source ? services.index.getSnapshot().cards.filter(c => c.sourceFile === q.source!.path) : [];
  const topic = cards.find(c => q.source?.heading && c.topic === q.source.heading)?.topic ?? cards[0]?.topic ?? sectionTitle;
  return cards.length ? { deck: cards[0]!.deck, topic, sourceFile: q.source!.path } : { deck: testTitle, topic: sectionTitle, sourceFile: undefined };
}

export function Waiting({ text }: { text: string }) {
  return <p className="qard-waiting" role="status"><span className="qard-dot" aria-hidden="true"/>{text}</p>;
}
export function JobError({ job, retry, dismiss }: { job?: Job; retry?: () => void; dismiss?: () => void }) {
  if (!job?.error) return null;
  return <div className="qard-error" role="alert"><span>{job.error}</span>{retry && <button className="qard-text-button" onClick={retry}>Try again</button>}{dismiss && <button className="qard-text-button" onClick={dismiss}>Dismiss</button>}</div>;
}
export function Check({ on }: { on: boolean }) { return <span className={'qard-check' + (on ? ' is-on' : '')} aria-hidden="true">{on ? '✓' : ''}</span>; }
export const scoreTone = (score: number, marks: number) => score >= marks ? 'is-full' : score <= 0 ? 'is-zero' : 'is-partial';
