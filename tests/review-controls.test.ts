import { expect, it, vi } from 'vitest';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import { selectCards } from '../src/review/session';
import { scheduler } from '../src/review/scheduler';
import { cardStatistics } from '../src/review/statistics';
import { memoryStatistics } from '../src/review/fsrs-scheduler';
const cards = ['a', 'b', 'c'].map(
  (id) =>
    parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer`, 'deck.md').cards[0]!,
);
const now = new Date('2026-10-07T12:00:00').getTime();

it.each(['fsrs', 'simple'] as const)(
  'undo restores exact %s memory, history and lifetime statistics with scheduling on and off',
  async (algorithm) => {
    const store = new ReviewStore(async () => {});
    await store.saveSettings({ ...store.getSnapshot().settings, scheduler: algorithm });
    // Old lifetime totals may exceed the retained log. Undo must decrement, not rebuild them.
    store.load({
      ...store.getSnapshot(),
      statistics: {
        daily: { '2026-10-07': [5, 2, 9, 1] },
        cards: { a: [5, 2, 9, 1] },
        partialHistory: true,
      },
    });
    await store.review('a', 4, now);
    for (const scheduling of [true, false]) {
      await store.saveSettings({ ...store.getSnapshot().settings, scheduling });
      const before = store.getSnapshot();
      const token = await store.review('a', 1, now + 1000);
      await store.recordTiming('background', 100);
      await store.undoReview(token);
      expect(store.getSnapshot().states).toEqual(before.states);
      expect(store.getSnapshot().history).toEqual(before.history);
      expect(store.getSnapshot().statistics).toEqual(before.statistics);
      expect(store.getSnapshot().timings.background).toEqual(scheduling ? [100] : [100, 100]);
      expect(store.canUndoReview(token)).toBe(false);
    }
  },
);

it('undo on completion recreates the saved queue and removes a first rating without touching other sessions', async () => {
  const store = new ReviewStore(async () => {});
  const session = await store.startSession([cards[0]!]);
  const other = await store.startSession(cards, 'cram');
  const before = store.getSnapshot();
  const token = await store.review('a', 4, now, { id: session.id, position: 0 });
  expect(store.getSnapshot().sessions).toEqual([other]);
  await store.undoReview(token);
  expect(store.getSnapshot().states.a).toBeUndefined();
  expect(store.getSnapshot().statistics).toEqual(before.statistics);
  expect(store.getSnapshot().sessions).toContainEqual(session);
  expect(store.getSnapshot().sessions).toContainEqual(other);
  const restarted = new ReviewStore(async () => {});
  restarted.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect((await restarted.resumeSession(session.id, cards)).session.position).toBe(0);
  expect(restarted.canUndoReview(token)).toBe(false);
});

it('failed undo keeps the rating and queue intact and can be retried; failed later ratings retain the checkpoint', async () => {
  const write = vi.fn(async () => {}),
    store = new ReviewStore(write);
  const session = await store.startSession(cards);
  const token = await store.review('a', 3, now, { id: session.id, position: 0 });
  const rated = store.getSnapshot();
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.undoReview(token)).rejects.toThrow('disk full');
  expect(store.getSnapshot()).toBe(rated);
  expect(store.canUndoReview(token)).toBe(true);
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.review('b', 3, now, { id: session.id, position: 1 })).rejects.toThrow(
    'disk full',
  );
  await store.undoReview(token);
  expect(store.getSnapshot().sessions[0]!.position).toBe(0);
  expect(store.getSnapshot().history).toEqual([]);
});

it('rejects stale undo after a later rating, queue advancement, content change or scheduler change', async () => {
  const store = new ReviewStore(async () => {});
  const first = await store.review('a', 1, now);
  const second = await store.review('b', 3, now);
  await expect(store.undoReview(first)).rejects.toThrow(/later card/);
  await store.requireContentCheck('b');
  await expect(store.undoReview(second)).rejects.toThrow(/changed/);
  const session = await store.startSession(cards);
  const next = await store.review('a', 3, now, { id: session.id, position: 0 });
  await store.skipCard({ id: session.id, position: 1 }, 'b');
  await expect(store.undoReview(next)).rejects.toThrow(/changed/);
  const last = await store.review('c', 4, now);
  await store.saveSettings({ ...store.getSnapshot().settings, scheduler: 'simple' });
  await expect(store.undoReview(last)).rejects.toThrow(/changed/);
});

it('skip persists across restart, changes no memory or review totals, and rejects duplicate navigation', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, now);
  const session = await store.startSession(cards),
    before = store.getSnapshot();
  await store.skipCard({ id: session.id, position: 0 }, 'a');
  expect(store.getSnapshot().states).toBe(before.states);
  expect(store.getSnapshot().history).toBe(before.history);
  expect(store.getSnapshot().statistics).toBe(before.statistics);
  await expect(store.skipCard({ id: session.id, position: 0 }, 'a')).rejects.toThrow(/changed/);
  const restarted = new ReviewStore(async () => {});
  restarted.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const resumed = await restarted.resumeSession(session.id, cards);
  expect(resumed.session).toMatchObject({ position: 1, skippedIds: ['a'], results: [] });
  await restarted.review('b', 4, now, { id: session.id, position: 1 });
  await restarted.skipCard({ id: session.id, position: 2 }, 'c');
  expect(restarted.getSnapshot().sessions).toEqual([]);
  expect(restarted.getSnapshot().history).toHaveLength(2);
});

it('failed pause/skip never commits a flag or advances; successful pause and cursor advance are one write', async () => {
  const write = vi.fn(async () => {}),
    store = new ReviewStore(write);
  const session = await store.startSession(cards),
    before = store.getSnapshot();
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.skipCard({ id: session.id, position: 0 }, 'a', true)).rejects.toThrow(
    'disk full',
  );
  expect(store.getSnapshot()).toBe(before);
  await store.skipCard({ id: session.id, position: 0 }, 'a', true);
  expect(store.getSnapshot().states.a).toMatchObject({ paused: true, reviewCount: 0 });
  expect(store.getSnapshot().sessions[0]).toMatchObject({
    position: 1,
    skippedIds: ['a'],
    results: [],
  });
  expect(store.getSnapshot().history).toEqual([]);
  expect(write).toHaveBeenCalledTimes(3);
});

it('pause survives reload and excludes every study mode, forecasts and memory workload while preserving the schedule', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 1, now - 86400000);
  const memory = store.getSnapshot().states.a!;
  await store.setPaused('a', true);
  await store.setPaused('b', true); // Never-reviewed cards can be paused too.
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const { states, statistics } = restored.getSnapshot();
  expect(states.a).toEqual({ ...memory, paused: true });
  expect(scheduler.isDue(states.a, now)).toBe(false);
  for (const mode of ['all', 'due', 'new', 'difficult'] as const) {
    const selection = { decks: [], topics: [], cards: cards.map((c) => c.id) };
    expect(
      selectCards(cards, states, { selection, mode, order: 'note', now }).some((c) =>
        ['a', 'b'].includes(c.id),
      ),
    ).toBe(false);
  }
  expect(cardStatistics(cards, states, statistics, now, true)).toMatchObject({
    total: 3,
    reviewed: 1,
    due: 0,
    forecast: [0, 0, 0, 0, 0, 0, 0],
  });
  expect(memoryStatistics(cards, states, now, 0.9).count).toBe(0);
  await expect(restored.review('a', 3, now)).rejects.toThrow(/paused/);
  await expect(restored.startSession([cards[0]!], 'cram')).rejects.toThrow(/paused/);
  await restored.setPaused('a', false);
  expect(restored.getSnapshot().states.a).toEqual(memory);
  expect(scheduler.isDue(restored.getSnapshot().states.a, now)).toBe(true);
});

it('resume filters newly paused remaining cards without removing completed reviews or skipped progress', async () => {
  const store = new ReviewStore(async () => {}),
    session = await store.startSession(cards);
  await store.review('a', 3, now, { id: session.id, position: 0 });
  await store.setPaused('a', true);
  await store.setPaused('b', true);
  const resumed = await store.resumeSession(session.id, cards);
  expect(resumed.cards.map((c) => c.id)).toEqual(['a', 'c']);
  expect(resumed.session).toMatchObject({ position: 1, results: [{ cardId: 'a', rating: 3 }] });
  expect(resumed.skipped).toBe(1);
});
