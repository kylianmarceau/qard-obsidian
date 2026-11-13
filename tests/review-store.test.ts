import { it, expect, vi } from 'vitest';
import { type PluginData, ReviewStore } from '../src/review/review-store';
it('persists only review metadata and settings, never card text', async () => {
  const write = vi.fn(async (_data: PluginData) => {});
  const store = new ReviewStore(write);
  await store.review('stable', 3, 1000);
  expect(write).toHaveBeenCalledTimes(1);
  const saved = write.mock.calls[0]![0];
  expect(JSON.stringify(saved)).not.toMatch(/frontMarkdown|backMarkdown|sourceText/);
  expect(store.getSnapshot().states.stable?.reviewCount).toBe(1);
});
it('does not commit a rating if persistence fails', async () => {
  const store = new ReviewStore(async () => {
    throw new Error('disk full');
  });
  await expect(store.review('stable', 3)).rejects.toThrow('disk full');
  expect(store.getSnapshot().states.stable).toBeUndefined();
});
it('serialises concurrent reviews and preserves all state', async () => {
  const store = new ReviewStore(async () => {});
  await Promise.all([store.review('one', 1), store.review('two', 4), store.review('one', 3)]);
  expect(store.getSnapshot().states.one?.reviewCount).toBe(2);
  expect(store.getSnapshot().history).toHaveLength(3);
});
it('loads saved review state across a restart', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('stable', 4, 2000);
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect(restored.getSnapshot().states.stable).toEqual(store.getSnapshot().states.stable);
});
it('records ratings with scheduling disabled without changing due dates', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('stable', 4, 2000);
  const due = store.getSnapshot().states.stable?.due;
  await store.saveSettings({ ...store.getSnapshot().settings, scheduling: false });
  await store.review('stable', 1, 3000);
  expect(store.getSnapshot().states.stable?.due).toBe(due);
  expect(store.getSnapshot().history[1]?.scheduled).toBe(false);
});
it('rejects temporary IDs for persistent history', async () => {
  const store = new ReviewStore(async () => {});
  await expect(store.review('volatile:note:1', 3)).rejects.toThrow(/stable/);
});

it.each([
  { scheduler: 'fsrs' as const, scheduling: true, burySiblings: true },
  { scheduler: 'simple' as const, scheduling: true, burySiblings: false },
  { scheduler: 'fsrs' as const, scheduling: false, burySiblings: true },
])(
  'saves and reloads appearance without altering study data under $scheduler/$scheduling',
  async (options) => {
    const store = new ReviewStore(async () => {});
    await store.review('stable', 3, 2000);
    const data = JSON.parse(JSON.stringify(store.getSnapshot())) as PluginData;
    Object.assign(data.settings, options);
    data.settings.deckOptions = { A: { desiredRetention: 0.85, newCardsPerDay: 3 } };
    data.states.stable!.buriedUntil = 900000;
    data.sessions = [
      {
        id: 'saved',
        title: 'Saved deck',
        results: [],
        cardIds: ['stable'],
        position: 0,
        style: 'normal',
        createdAt: 2000,
        updatedAt: 2000,
        repeatLearning: true,
        learning: [{ cardId: 'stable', due: 3000 }],
      },
    ];
    const restored = new ReviewStore(async () => {});
    restored.load(data);
    const before = structuredClone(restored.getSnapshot());
    await restored.saveSettings({
      ...before.settings,
      deckOptions: { A: { ...before.settings.deckOptions.A, icon: 'terminal', color: '#123456' } },
    });
    const after = restored.getSnapshot();
    for (const key of [
      'states',
      'history',
      'statistics',
      'links',
      'exams',
      'study',
      'usage',
      'timings',
      'removed',
    ] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    const sessions =
      options.scheduling && options.scheduler === 'fsrs'
        ? before.sessions
        : before.sessions.map(
            ({ repeatLearning: _repeat, learning: _learning, ...session }) => session,
          );
    expect(after.sessions).toEqual(sessions);
    expect(after.settings.deckOptions.A).toEqual({
      desiredRetention: 0.85,
      newCardsPerDay: 3,
      icon: 'terminal',
      color: '#123456',
    });
    const restarted = new ReviewStore(async () => {});
    restarted.load(JSON.parse(JSON.stringify(after)));
    expect(restarted.getSnapshot().settings.deckOptions).toEqual(after.settings.deckOptions);
    await restarted.saveSettings({
      ...restarted.getSnapshot().settings,
      deckOptions: { A: { desiredRetention: 0.85, newCardsPerDay: 3 } },
    });
    expect(restarted.getSnapshot().states).toEqual(before.states);
    expect(restarted.getSnapshot().sessions).toEqual(sessions);
  },
);

it.each([
  { scheduler: 'simple' as const, scheduling: true },
  { scheduler: 'fsrs' as const, scheduling: false },
  { scheduler: 'fsrs' as const, scheduling: true },
])(
  'normalizes synced learning repeats on any save under $scheduler/$scheduling',
  async (options) => {
    const store = new ReviewStore(async () => {});
    await store.review('stable', 1, Date.now());
    const data = structuredClone(store.getSnapshot());
    Object.assign(data.settings, options);
    data.sessions = [0, 1].map((position) => ({
      id: position ? 'finished' : 'pending',
      title: 'Synced deck',
      results: [],
      cardIds: ['stable'],
      position,
      style: 'normal',
      createdAt: 2000,
      updatedAt: 2000,
      repeatLearning: true,
      learning: [{ cardId: 'stable', due: data.states.stable!.due! }],
    }));
    const restored = new ReviewStore(async () => {});
    restored.load(data);
    const before = structuredClone(restored.getSnapshot());
    expect(before.sessions).toHaveLength(2);
    expect(before.sessions[1]!.learning).toHaveLength(1);
    await restored.saveSettings({
      ...before.settings,
      deckOptions: { A: { color: '#123456' } },
    });
    const after = restored.getSnapshot();
    expect(after.states).toEqual(before.states);
    expect(after.history).toEqual(before.history);
    if (options.scheduler === 'fsrs' && options.scheduling) {
      expect(after.sessions).toEqual(before.sessions);
    } else {
      const { repeatLearning: _repeat, learning: _learning, ...pending } = before.sessions[0]!;
      expect(after.sessions).toEqual([pending]);
    }
  },
);
