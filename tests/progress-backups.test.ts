import { expect, it, vi } from 'vitest';
import {
  ProgressBackups,
  progressSnapshot,
  validateProgress,
} from '../src/review/progress-backups';
import { ReviewStore } from '../src/review/review-store';

function storage() {
  const files = new Map<string, string>();
  const adapter = {
    list: async () => [...files.keys()],
    read: async (name: string) => {
      if (!files.has(name)) throw new Error('Missing file');
      return files.get(name)!;
    },
    write: vi.fn(async (name: string, text: string) => {
      files.set(name, text);
    }),
    remove: vi.fn(async (name: string) => {
      files.delete(name);
    }),
  };
  return { files, adapter, backups: new ProgressBackups(adapter) };
}
it('backs up review progress without credentials, preferences, usage or card text', async () => {
  const { backups, files } = storage();
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, 1000);
  await store.saveSettings({ ...store.getSnapshot().settings, cardFolder: 'Secret folder' });
  await backups.capture(store.getSnapshot(), true, 2000);
  const [entry] = await backups.list();
  expect(entry!.backup!.progress.states.a!.reviewCount).toBe(1);
  const text = [...files.values()][0]!;
  expect(text).not.toMatch(/settings|Secret folder|connections|usage|frontMarkdown/);
});
it('throttles automatic snapshots, allows manual copies and keeps the newest 30 verified files', async () => {
  const { backups, files, adapter } = storage();
  const data = new ReviewStore(async () => {}).getSnapshot();
  await Promise.all([backups.capture(data, false, 1), backups.capture(data, false, 2)]);
  expect(files.size).toBe(1);
  await backups.capture(data, false, 1800001);
  expect(files.size).toBe(2);
  for (let i = 0; i < 31; i++) await backups.capture(data, true, 1800010 + i);
  expect(files.size).toBe(30);
  expect(adapter.remove).toHaveBeenCalledTimes(3);
  expect((await backups.list())[0]!.backup!.createdAt).toBe(1800040);
});
it('rejects tampered or interrupted files, never rotates existing copies after a failed write, and recovers', async () => {
  const { backups, files, adapter } = storage();
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, 1000);
  await backups.capture(store.getSnapshot(), true, 2000);
  const name = [...files.keys()][0]!;
  const changed = JSON.parse(files.get(name)!);
  changed.progress.states.a.reviewCount++;
  files.set(name, JSON.stringify(changed));
  await expect(backups.read(name)).rejects.toThrow(/changed/);
  expect((await backups.list())[0]!.error).toMatch(/damaged/);
  adapter.write.mockImplementationOnce(async (name) => {
    files.set(name, '{');
  });
  await expect(backups.capture(store.getSnapshot(), true, 3000)).rejects.toThrow();
  expect(adapter.remove).not.toHaveBeenCalled();
  await backups.capture(store.getSnapshot(), true, 4000);
  expect((await backups.list())[0]!.backup!.createdAt).toBe(4000);
  await expect(backups.read('../data.json')).rejects.toThrow(/list/);
});
it('rejects malformed progress and restores only progress atomically while retaining preferences', async () => {
  const persist = vi.fn(async () => {});
  const store = new ReviewStore(persist);
  await store.review('a', 4, 1000);
  const backup = progressSnapshot(store.getSnapshot());
  await store.review('b', 4, 2000);
  await store.saveSettings({
    ...store.getSnapshot().settings,
    typedAnswers: true,
    newCardsPerDay: 5,
  });
  const before = store.getSnapshot();
  expect(() =>
    validateProgress({ ...backup, states: { a: { ...backup.states.a, reviewCount: -1 } } }),
  ).toThrow(/invalid/);
  persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.restoreProgress(backup, before)).rejects.toThrow('disk full');
  expect(store.getSnapshot()).toBe(before);
  await store.restoreProgress(backup, before);
  expect(store.getSnapshot().history).toHaveLength(1);
  expect(store.getSnapshot().states.b).toBeUndefined();
  expect(store.getSnapshot().settings).toBe(before.settings);
});
it('refuses to overwrite progress committed while the safety backup is being prepared', async () => {
  const store = new ReviewStore(async () => {});
  const backup = progressSnapshot(store.getSnapshot());
  const before = store.getSnapshot();
  await store.review('a', 4, 1000);
  await expect(store.restoreProgress(backup, before)).rejects.toThrow(/Progress changed/);
  expect(store.getSnapshot().history).toHaveLength(1);
});
