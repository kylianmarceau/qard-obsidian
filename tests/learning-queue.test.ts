import { expect, it, vi } from 'vitest';
import { State } from 'ts-fsrs';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import { completedReviewCount, pendingLearning } from '../src/review/learning-queue';
import { readSessions } from '../src/review/saved-session';

const now = new Date('2026-10-09T12:00:00Z').getTime();
const cards = ['a', 'b', 'c'].map(
  (id) =>
    parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer`, 'deck.md').cards[0]!,
);
const dueSession = (store: ReviewStore, selected = cards) =>
  store.startSession(selected, 'normal', undefined, 'due');

it('requeues Again, forbids early repeats, and finishes on Good while preserving the FSRS learning step', async () => {
  const store = new ReviewStore(async () => {});
  const session = await dueSession(store, [cards[0]!]);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const waiting = store.getSnapshot();
  expect(waiting.sessions[0]).toMatchObject({
    position: 1,
    learning: [{ cardId: 'a', due: now + 60_000 }],
  });
  await expect(
    store.review('a', 3, now + 59_999, {
      id: session.id,
      position: 1,
      learningDue: now + 60_000,
    }),
  ).rejects.toThrow('not due yet');
  expect(store.getSnapshot()).toBe(waiting);
  await store.review('a', 1, now + 60_000, {
    id: session.id,
    position: 1,
    learningDue: now + 60_000,
  });
  expect(store.getSnapshot().sessions[0]).toMatchObject({
    position: 1,
    learning: [{ cardId: 'a', due: now + 120_000 }],
  });
  await store.review('a', 3, now + 120_000, {
    id: session.id,
    position: 1,
    learningDue: now + 120_000,
  });
  expect(store.getSnapshot().sessions).toEqual([]);
  expect(store.getSnapshot().states.a!.fsrs?.state).toBe(State.Learning);
  expect(store.getSnapshot().states.a!.due).toBe(now + 720_000);
  expect(store.getSnapshot().history).toHaveLength(3);
});

it('repeats established cards after a lapse at their relearning time', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, now);
  const reviewAt = store.getSnapshot().states.a!.due!;
  const session = await dueSession(store, [cards[0]!]);
  await store.review('a', 1, reviewAt, { id: session.id, position: 0 });
  expect(store.getSnapshot().states.a!.fsrs?.state).toBe(State.Relearning);
  expect(store.getSnapshot().sessions[0]!.learning).toEqual([
    { cardId: 'a', due: reviewAt + 600_000 },
  ]);
});

it('keeps the first-pass cursor when interleaving repeats and rejects duplicate/stale repeated ratings', async () => {
  const store = new ReviewStore(async () => {});
  const session = await dueSession(store);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const step = { id: session.id, position: 1, learningDue: now + 60_000 };
  const results = await Promise.allSettled([
    store.review('a', 3, now + 60_000, step),
    store.review('a', 3, now + 60_000, step),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(store.getSnapshot().sessions[0]!.position).toBe(1);
  await store.review('b', 4, now + 61_000, { id: session.id, position: 1 });
  expect(store.getSnapshot().sessions[0]!.position).toBe(2);
  expect(store.getSnapshot().history.map((e) => e.cardId)).toEqual(['a', 'a', 'b']);
  await store.review('a', 4, now + 62_000); // Another view reviews this card.
  await expect(
    store.review('a', 3, now + 660_000, {
      id: session.id,
      position: 2,
      learningDue: now + 660_000,
    }),
  ).rejects.toThrow('changed in another view');
});

it('survives restart when the first pass is exhausted and resolves current content for waiting cards', async () => {
  const store = new ReviewStore(async () => {});
  const session = await dueSession(store, [cards[0]!]);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const restarted = new ReviewStore(async () => {});
  restarted.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const resumed = await restarted.resumeSession(session.id, [
    { ...cards[0]!, frontMarkdown: 'Edited' },
  ]);
  expect(resumed.session).toMatchObject({
    position: 1,
    repeatLearning: true,
    learning: [{ cardId: 'a', due: now + 60_000 }],
  });
  expect(resumed.cards[0]!.frontMarkdown).toBe('Edited');
  expect(resumed.session.results).toHaveLength(1);
});

it('removes missing, paused, ambiguous and already graduated learning cards on resume', async () => {
  for (const unavailable of ['missing', 'ambiguous', 'graduated']) {
    const store = new ReviewStore(async () => {});
    const session = await dueSession(store, [cards[0]!]);
    await store.review('a', 1, now, { id: session.id, position: 0 });
    if (unavailable === 'graduated') await store.review('a', 4, now + 60_000);
    const available =
      unavailable === 'missing' ? [] : [{ ...cards[0]!, duplicateId: unavailable === 'ambiguous' }];
    const resumed = await store.resumeSession(session.id, available);
    expect(resumed.session.learning).toEqual([]);
    expect(store.getSnapshot().sessions).toEqual([]);
  }
});

it('pausing a waiting card from another view clears its pending repeat and preserves its review', async () => {
  const store = new ReviewStore(async () => {});
  const session = await dueSession(store, [cards[0]!]);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const before = store.getSnapshot();
  await store.setPaused('a', true);
  expect(store.getSnapshot().sessions).toEqual([]);
  expect(store.getSnapshot().states.a).toEqual({ ...before.states.a, paused: true });
  expect(store.getSnapshot().history).toBe(before.history);
});

it('saves learning queues and ratings atomically and restores both on undo, including a repeated rating', async () => {
  const write = vi.fn(async () => {});
  const store = new ReviewStore(write);
  const session = await dueSession(store, [cards[0]!]);
  const original = store.getSnapshot();
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.review('a', 1, now, { id: session.id, position: 0 })).rejects.toThrow(
    'disk full',
  );
  expect(store.getSnapshot()).toBe(original);
  const first = await store.review('a', 1, now, { id: session.id, position: 0 });
  await store.undoReview(first);
  expect(store.getSnapshot().sessions).toEqual(original.sessions);
  expect(store.getSnapshot().states).toEqual(original.states);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const waiting = store.getSnapshot();
  const repeat = await store.review('a', 3, now + 60_000, {
    id: session.id,
    position: 1,
    learningDue: now + 60_000,
  });
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.undoReview(repeat)).rejects.toThrow('disk full');
  expect(store.canUndoReview(repeat)).toBe(true);
  await store.undoReview(repeat);
  expect(store.getSnapshot().sessions).toEqual(waiting.sessions);
  expect(store.getSnapshot().states).toEqual(waiting.states);
  expect(store.getSnapshot().statistics).toEqual(waiting.statistics);
});

it.each([false, true])(
  'skip/pause of a returning card removes its repeat without advancing the first pass (pause=%s)',
  async (pause) => {
    const store = new ReviewStore(async () => {});
    const session = await dueSession(store);
    await store.review('a', 1, now, { id: session.id, position: 0 });
    const before = store.getSnapshot();
    await store.skipCard({ id: session.id, position: 1, learningDue: now + 60_000 }, 'a', pause);
    expect(store.getSnapshot().sessions[0]).toMatchObject({
      position: 1,
      learning: [],
      skippedIds: ['a'],
    });
    expect(store.getSnapshot().history).toBe(before.history);
    expect(store.getSnapshot().states.a!.due).toBe(now + 60_000);
    expect(store.getSnapshot().states.a!.paused).toBe(pause || undefined);
    await store.review('b', 4, now + 60_000, { id: session.id, position: 1 });
  },
);

it('orders waiting repeats by their real due times and finishing preserves the schedule and history', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, now - 86_400_000);
  const session = await dueSession(store);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  await store.review('b', 1, now + 1000, { id: session.id, position: 1 });
  expect(
    pendingLearning(store.getSnapshot().sessions[0], store.getSnapshot().states).map(
      (e) => e.cardId,
    ),
  ).toEqual(['b', 'a']);
  const before = store.getSnapshot();
  await store.discardSession(session.id);
  expect(store.getSnapshot().states).toBe(before.states);
  expect(store.getSnapshot().history).toBe(before.history);
  expect(store.getSnapshot().sessions).toEqual([]);
});

it.each([2, 3, 4] as const)(
  'finishes rating %s on the first pass or an Again repeat and preserves the FSRS schedule on restart',
  async (rating) => {
    for (const repeated of [false, true]) {
      const store = new ReviewStore(async () => {});
      const session = await dueSession(store);
      if (repeated) {
        await store.review('a', 1, now, { id: session.id, position: 0 });
      }
      const at = repeated ? now + 60_000 : now;
      await store.review('a', rating, at, {
        id: session.id,
        position: repeated ? 1 : 0,
        ...(repeated ? { learningDue: at } : {}),
      });
      const data = store.getSnapshot();
      expect(data.sessions[0]!.learning).toEqual([]);
      expect(completedReviewCount(data.sessions[0]!, data.states)).toBe(1);
      expect(data.states.a!.due).toBeGreaterThan(at);
      if (rating !== 4) {
        expect(data.states.a!.fsrs?.state).toBe(State.Learning);
      }
      const restored = new ReviewStore(async () => {});
      restored.load(JSON.parse(JSON.stringify(data)));
      const resumed = await restored.resumeSession(session.id, cards);
      expect(resumed.session.learning).toEqual([]);
      expect(completedReviewCount(resumed.session, restored.getSnapshot().states)).toBe(1);
      expect(restored.getSnapshot().states).toEqual(data.states);
      expect(restored.getSnapshot().history).toEqual(data.history);
    }
  },
);

it.each([2, 3] as const)(
  'removes legacy rating %s repeats on reload while retaining Again and original unvisited cards',
  async (rating) => {
    const store = new ReviewStore(async () => {});
    const session = await dueSession(store);
    await store.review('a', rating, now, { id: session.id, position: 0 });
    await store.review('b', 1, now, { id: session.id, position: 1 });
    const data = JSON.parse(JSON.stringify(store.getSnapshot()));
    data.sessions[0].learning.push({ cardId: 'a', due: data.states.a.due });
    const restored = new ReviewStore(async () => {});
    restored.load(data);
    expect(restored.getSnapshot().sessions[0]).toMatchObject({
      position: 2,
      learning: [{ cardId: 'b', due: now + 60_000 }],
    });
    expect(restored.getSnapshot().history).toEqual(data.history);
    expect(restored.getSnapshot().states).toEqual(data.states);
    const resumed = await restored.resumeSession(session.id, cards);
    expect(resumed.session.learning).toEqual([{ cardId: 'b', due: now + 60_000 }]);
    expect(completedReviewCount(resumed.session, restored.getSnapshot().states)).toBe(1);
    data.sessions[0].position = 3;
    data.sessions[0].learning = [{ cardId: 'a', due: data.states.a.due }];
    restored.load(data);
    expect(restored.getSnapshot().sessions).toEqual([]);
  },
);

it.each(['all', 'due', 'new', 'difficult'] as const)(
  'keeps missed cards in normal %s sessions until learning is finished',
  async (mode) => {
    const store = new ReviewStore(async () => {});
    const session = await store.startSession([cards[0]!], 'normal', undefined, mode);
    await store.review('a', 1, now, { id: session.id, position: 0 });
    expect(store.getSnapshot().sessions[0]).toMatchObject({
      repeatLearning: true,
      position: 1,
      learning: [{ cardId: 'a', due: now + 60_000 }],
    });
  },
);

it('keeps cram, exam, simple-scheduler and scheduling-off sessions single-pass', async () => {
  for (const options of [
    { style: 'cram' as const },
    { examId: 'exam' },
    { scheduler: 'simple' as const },
    { scheduling: false },
  ]) {
    const store = new ReviewStore(async () => {});
    await store.saveSettings({ ...store.getSnapshot().settings, ...options });
    const session = await store.startSession([cards[0]!], options.style, options.examId, 'due');
    expect(session.repeatLearning).toBeUndefined();
  }
});

it('upgrades a saved single-pass deck session on resume without losing its order or reviews', async () => {
  const store = new ReviewStore(async () => {});
  const session = await store.startSession(cards);
  const data = JSON.parse(JSON.stringify(store.getSnapshot()));
  delete data.sessions[0].repeatLearning;
  delete data.sessions[0].learning;
  store.load(data);
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const before = store.getSnapshot();
  const resumed = await store.resumeSession(session.id, cards);
  expect(resumed.session).toMatchObject({
    cardIds: ['a', 'b', 'c'],
    position: 1,
    results: [{ cardId: 'a', rating: 1 }],
    repeatLearning: true,
    learning: [{ cardId: 'a', due: now + 60_000 }],
  });
  expect(store.getSnapshot().history).toBe(before.history);
  expect(store.getSnapshot().states).toBe(before.states);
});

it.each([{ scheduling: false }, { scheduler: 'simple' as const }])(
  'drops waiting repeats when FSRS scheduling is disabled: %j',
  async (change) => {
    const store = new ReviewStore(async () => {});
    const session = await dueSession(store, [cards[0]!]);
    await store.review('a', 1, now, { id: session.id, position: 0 });
    await store.saveSettings({ ...store.getSnapshot().settings, ...change });
    expect(store.getSnapshot().sessions).toEqual([]);
  },
);

it('sanitizes learning metadata and only accepts exhausted sessions with a valid pending repeat', async () => {
  const store = new ReviewStore(async () => {});
  const initial = await dueSession(store, [cards[0]!]);
  const session = { ...initial, position: 1, learning: [{ cardId: 'a', due: now }] };
  expect(readSessions([session])).toHaveLength(1);
  for (const learning of [
    [null],
    [{ cardId: 'other', due: now }],
    [{ cardId: 'a', due: null }],
    [{ cardId: 'a', due: Infinity }],
  ]) {
    expect(readSessions([{ ...session, learning }])).toEqual([]);
  }
  expect(readSessions([{ ...session, repeatLearning: 'yes' }])).toEqual([]);
  expect(readSessions([{ ...session, style: 'cram' }])).toEqual([]);
  expect(readSessions([{ ...session, examId: 'exam' }])).toEqual([]);
  expect(readSessions([{ ...session, skippedIds: ['a'] }])).toEqual([]);
  expect(readSessions([{ ...session, skippedIds: {} }])[0]!.learning).toEqual(session.learning);
});
