import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clozeFront, FORMAT_BACK, occlusionFront } from '../src/cards/card-format';
import { parseCards } from '../src/cards/parser';
import {
  ensureSiblingGroupsInSource,
  replaceCardInSource,
  serializeCard,
  deleteCardInSource,
} from '../src/cards/source-patch';
import { siblingGroup, siblingIds } from '../src/cards/siblings';
import { ReviewStore } from '../src/review/review-store';
import { DAY, isBuried, scheduler } from '../src/review/scheduler';
import { selectCards } from '../src/review/session';
import { failureDays, needsRepair } from '../src/review/card-repair';
import { readSessions } from '../src/review/saved-session';
import { examProgress } from '../src/exams/exam-plan';

const now = new Date(2026, 9, 10, 12).getTime();
const tomorrow = new Date(2026, 9, 11).getTime();
const make = (id: string, group?: string) =>
  parseCards(serializeCard(id, `Question ${id}`, 'Answer', '\n', group), 'deck.md').cards[0]!;
const cards = [make('a', 'pair'), make('b', 'pair'), make('c')];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

it('groups legacy cloze and image variants precisely, without grouping ordinary notes or unrelated cards', () => {
  const text = '{{c1::TCP}} is {{c2::reliable}}.';
  const a = parseCards(serializeCard('a', clozeFront(text, 1), FORMAT_BACK), 'note.md').cards[0]!;
  const b = parseCards(serializeCard('b', clozeFront(text, 2), FORMAT_BACK), 'note.md').cards[0]!;
  const unrelated = parseCards(
    serializeCard('c', clozeFront('Use {{c1::UDP}}.', 1), FORMAT_BACK),
    'note.md',
  ).cards[0]!;
  const moved = { ...b, sourceFile: 'another.md' };
  expect(siblingIds(a, [a, b, unrelated, moved, make('basic')])).toEqual(['b']);
  expect(siblingGroup(make('basic'))).toBeUndefined();
  const image = {
    image: 'diagram.svg',
    masks: [
      { id: 'one', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { id: 'two', x: 0.5, y: 0.1, width: 0.2, height: 0.2 },
    ],
  };
  const masks = ['one', 'two'].map(
    (target) =>
      parseCards(
        serializeCard(target, occlusionFront('Identify.', { ...image, target }), FORMAT_BACK),
        'note.md',
      ).cards[0]!,
  );
  expect(siblingIds(masks[0]!, masks)).toEqual(['two']);
  expect(siblingIds(a, [a, { ...b, duplicateId: true }])).toEqual([]);
});

it('persists legacy groups before editing, preserves CRLF/prose/IDs and keeps groups after renaming the note', () => {
  const front = '{{c1::TCP}} is {{c2::reliable}}.';
  const source =
    'Prose.\r\n\r\n' +
    [1, 2]
      .map((target) => serializeCard(`c${target}`, clozeFront(front, target), FORMAT_BACK, '\r\n'))
      .join('\r\n') +
    '\r\nTail.\r\n';
  const [original] = parseCards(source, 'old.md').cards;
  const edited = replaceCardInSource(
    source,
    original!,
    clozeFront('{{c1::TCP}} provides delivery.', 1),
    'Extra explanation',
    'c1',
  );
  const parsed = parseCards(edited, 'new.md').cards;
  expect(parsed.map((c) => c.id)).toEqual(['c1', 'c2']);
  expect(parsed[0]!.siblingGroup).toBe(parsed[1]!.siblingGroup);
  expect(siblingIds(parsed[0]!, parsed)).toEqual(['c2']);
  expect(edited.startsWith('Prose.\r\n\r\n')).toBe(true);
  expect(edited.endsWith('\r\nTail.\r\n')).toBe(true);
  expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
  expect(ensureSiblingGroupsInSource(edited, 'new.md')).toBe(edited);
  expect(
    parseCards(deleteCardInSource(edited, parsed[0]!), 'new.md').cards.map((c) => c.id),
  ).toEqual(['c2']);
});

it.each(['fsrs', 'simple'] as const)(
  'defers siblings atomically with a %s rating, advances past them and undo restores the queue and exact state',
  async (algorithm) => {
    const persist = vi.fn(async () => {}),
      store = new ReviewStore(persist);
    await store.saveSettings({ ...store.getSnapshot().settings, scheduler: algorithm });
    await store.review('b', 4, now - DAY);
    const beforeSibling = store.getSnapshot().states.b;
    const session = await store.startSession(cards, 'normal', undefined, 'due');
    const before = store.getSnapshot();
    persist.mockRejectedValueOnce(new Error('disk full'));
    await expect(store.review('a', 4, now, { id: session.id, position: 0 }, ['b'])).rejects.toThrow(
      'disk full',
    );
    expect(store.getSnapshot()).toBe(before);
    const token = await store.review('a', 4, now, { id: session.id, position: 0 }, ['b']);
    const data = store.getSnapshot();
    expect(data.states.b).toEqual({ ...beforeSibling, buriedUntil: tomorrow });
    expect(data.sessions[0]).toMatchObject({
      position: 2,
      deferredIds: ['b'],
      results: [{ cardId: 'a', rating: 4 }],
    });
    expect(data.history).toHaveLength(before.history.length + 1);
    expect(isBuried(data.states.b, tomorrow - 1)).toBe(true);
    expect(isBuried(data.states.b, tomorrow)).toBe(false);
    await expect(store.review('b', 3, now)).rejects.toThrow('deferred');
    await store.undoReview(token);
    expect(store.getSnapshot().states).toEqual(before.states);
    expect(store.getSnapshot().sessions).toEqual(before.sessions);
  },
);

it('keeps deferrals across restart, excludes ordinary study, allows cram and restores availability at local midnight', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, now, undefined, ['b']);
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const states = restored.getSnapshot().states;
  for (const mode of ['all', 'due', 'new', 'difficult'] as const) {
    expect(
      selectCards(cards, states, {
        selection: { decks: ['deck'], topics: [], cards: [] },
        mode,
        order: 'note',
        now,
      }).some((c) => c.id === 'b'),
    ).toBe(false);
  }
  expect(
    selectCards(cards, states, {
      selection: { decks: ['deck'], topics: [], cards: [] },
      mode: 'due',
      order: 'note',
      now,
      includeBuried: true,
    }).map((c) => c.id),
  ).toContain('b');
  const cram = await restored.startSession([cards[1]!], 'cram');
  await restored.advanceCram({ id: cram.id, position: 0 }, 'b');
  expect(restored.getSnapshot().history).toEqual(store.getSnapshot().history);
  await expect(restored.startSession([cards[1]!])).rejects.toThrow('deferred');
  vi.setSystemTime(tomorrow);
  expect(scheduler.isDue(states.b, tomorrow)).toBe(true);
  await expect(restored.startSession([cards[1]!])).resolves.toMatchObject({ cardIds: ['b'] });
});

it('does not defer when scheduling or sibling separation is off, and turning it off clears existing deferrals', async () => {
  for (const preference of ['scheduling', 'burySiblings'] as const) {
    const store = new ReviewStore(async () => {});
    await store.review('a', 4, now, undefined, ['b']);
    expect(isBuried(store.getSnapshot().states.b)).toBe(true);
    await store.saveSettings({ ...store.getSnapshot().settings, [preference]: false });
    expect(store.getSnapshot().states.b?.buriedUntil).toBeUndefined();
    await store.review('a', 3, now + 1000, undefined, ['b']);
    expect(store.getSnapshot().states.b?.buriedUntil).toBeUndefined();
  }
});

it('does not undo over a concurrent sibling change and filters deferred learning in another saved session', async () => {
  const store = new ReviewStore(async () => {});
  const learning = await store.startSession([cards[1]!], 'normal', undefined, 'due');
  await store.review('b', 1, now, { id: learning.id, position: 0 });
  const token = await store.review('a', 4, now, undefined, ['b']);
  const resumed = await store.resumeSession(learning.id, cards);
  expect(resumed.session.learning).toEqual([]);
  await store.setPaused('b', true);
  expect(store.canUndoReview(token)).toBe(false);
  await expect(store.undoReview(token)).rejects.toThrow('changed');
});

it('counts failure days, excludes unscheduled/future failures, and mark fixed starts a new advisory window without changing history', async () => {
  const store = new ReviewStore(async () => {});
  for (let day = 6; day >= 2; day--) {
    for (let repeat = 0; repeat < 4; repeat++)
      await store.review('a', 1, now - day * DAY + repeat * 1000);
  }
  const before = store.getSnapshot();
  expect(failureDays(before.history, before.states).get('a')).toBe(5);
  expect(needsRepair(before.states.a, 5)).toBe(true);
  await store.setNeedsFixing('a', true);
  await store.review('a', 3, now - DAY);
  expect(store.getSnapshot().states.a?.needsFixing).toBe(true);
  const repaired = store.getSnapshot();
  await store.markFixed('a', now);
  expect(store.getSnapshot().history).toBe(repaired.history);
  expect(store.getSnapshot().states.a).toEqual({
    ...repaired.states.a,
    needsFixing: undefined,
    repairSince: now,
  });
  expect(
    failureDays(store.getSnapshot().history, store.getSnapshot().states).get('a'),
  ).toBeUndefined();
  await store.review('a', 1, now + DAY);
  expect(
    failureDays(store.getSnapshot().history, store.getSnapshot().states).get('a'),
  ).toBeUndefined();
  expect(
    failureDays(store.getSnapshot().history, store.getSnapshot().states, now + DAY).get('a'),
  ).toBe(1);
  const history = [{ cardId: 'x', rating: 1 as const, at: now, scheduled: false }];
  expect(failureDays(history, {}).size).toBe(0);
});

it('flags and repair dates survive both schedulers, restart and failed saves without changing the queue', async () => {
  const write = vi.fn(async () => {}),
    store = new ReviewStore(write);
  const session = await store.startSession(cards);
  write.mockRejectedValueOnce(new Error('disk full'));
  const before = store.getSnapshot();
  await expect(store.setNeedsFixing('a', true)).rejects.toThrow('disk full');
  expect(store.getSnapshot()).toBe(before);
  await store.setNeedsFixing('a', true);
  expect(store.getSnapshot().sessions[0]).toBe(session);
  await store.markFixed('a', now - DAY);
  await store.setNeedsFixing('a', true);
  await store.saveSettings({ ...store.getSnapshot().settings, scheduler: 'simple' });
  await store.review('a', 3, now);
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect(restored.getSnapshot().states.a).toMatchObject({
    needsFixing: true,
    repairSince: now - DAY,
  });
  restored.load({
    ...restored.getSnapshot(),
    states: {
      a: {
        ...restored.getSnapshot().states.a,
        needsFixing: 'yes',
        buriedUntil: Infinity,
        repairSince: 'today',
      },
    },
  });
  expect(restored.getSnapshot().states.a?.needsFixing).toBeUndefined();
  expect(restored.getSnapshot().states.a?.buriedUntil).toBeUndefined();
  expect(restored.getSnapshot().states.a?.repairSince).toBeUndefined();
  await expect(store.setNeedsFixing('volatile:id', true)).rejects.toThrow('stable');
});

it('refreshes a learning step after an answer edit and prevents reviewing the previous due-time snapshot', async () => {
  const store = new ReviewStore(async () => {});
  const session = await store.startSession([cards[0]!], 'normal', undefined, 'due');
  await store.review('a', 1, now, { id: session.id, position: 0 });
  const oldDue = store.getSnapshot().states.a!.due!;
  await store.requireContentCheck('a', now + 1000);
  expect(store.getSnapshot().sessions[0]?.learning).toEqual([{ cardId: 'a', due: now + 1000 }]);
  await expect(
    store.review('a', 3, oldDue, { id: session.id, position: 1, learningDue: oldDue }),
  ).rejects.toThrow('changed');
  await store.review('a', 3, now + 1000, { id: session.id, position: 1, learningDue: now + 1000 });
  expect(store.getSnapshot().states.a?.needsContentCheck).toBeUndefined();
  expect(
    readSessions([{ ...session, deferredIds: ['a', 'outside', 'a'] }])[0]?.deferredIds,
  ).toEqual(['a']);
});

it('keeps deferred new siblings in exam coverage totals but out of today’s planned queue', async () => {
  const store = new ReviewStore(async () => {});
  await store.review('a', 4, now, undefined, ['b']);
  const progress = examProgress(
    {
      id: 'exam',
      name: 'Exam',
      date: '2026-10-20',
      createdAt: now - DAY,
      dailyLimit: 10,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      selection: { decks: ['deck'], topics: [], cards: [] },
    },
    cards,
    store.getSnapshot().states,
    store.getSnapshot().history,
    now,
  );
  expect(progress.selected).toHaveLength(3);
  expect(progress.uncovered).toBe(2);
  expect(progress.queue.map((c) => c.id)).not.toContain('b');
});
