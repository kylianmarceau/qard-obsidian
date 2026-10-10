import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { introductionsToday, newAllowance, paceCards } from '../src/review/pacing';
import { ReviewStore } from '../src/review/review-store';
import { readSettings } from '../src/settings/settings';
import type { ReviewEvent } from '../src/review/scheduler';

const now = new Date(2026, 9, 10, 12).getTime();
const cards = ['a', 'b', 'c', 'd'].map(
  (id) => parseCards(serializeCard(id, id, 'Answer'), 'deck.md').cards[0]!,
);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());
const event = (cardId: string, at: number, introduced?: boolean): ReviewEvent => ({
  cardId,
  at,
  rating: 3,
  scheduled: true,
  ...(introduced === undefined ? {} : { introduced }),
});

it('counts distinct local introductions across repeats, imported history and local midnight', () => {
  const midnight = new Date(2026, 9, 10).getTime();
  const history = [
    event('old', midnight - 1),
    event('old', now),
    event('a', midnight),
    event('a', now),
    event('import', now, false),
    event('partial-log', now, false),
    event('tomorrow', new Date(2026, 9, 11).getTime()),
  ];
  expect(introductionsToday(history, now)).toBe(1);
  expect(introductionsToday(history.slice().reverse(), now)).toBe(1);
});

it('keeps defaults unlimited and validates optional preferences', () => {
  const settings = readSettings({
    newCardsPerDay: -1,
    reviewBatchSize: '12',
    typedAnswers: 'true',
  });
  expect(settings).toMatchObject({ newCardsPerDay: 0, reviewBatchSize: 0, typedAnswers: false });
  const store = new ReviewStore(async () => {});
  expect(paceCards(cards, store.getSnapshot()).batch).toEqual(cards);
  expect(newAllowance(store.getSnapshot())).toBe(Infinity);
});

it('does not consume today’s allowance when importing existing review history', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({ ...store.getSnapshot().settings, newCardsPerDay: 1 });
  await store.importStates(
    [
      {
        cardId: 'imported',
        interval: 3,
        ease: 2.5,
        reviewCount: 1,
        lapses: 0,
        due: now + 86400000,
        lastReviewed: now,
      },
    ],
    [event('imported', now)],
  );
  expect(store.getSnapshot().history[0]!.introduced).toBe(false);
  expect(newAllowance(store.getSnapshot())).toBe(1);
});

it('prioritizes reviews, caps new cards without postponing due dates, and continues a bounded batch', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({
    ...store.getSnapshot().settings,
    scheduler: 'simple',
    newCardsPerDay: 2,
    reviewBatchSize: 2,
  });
  await store.review('d', 4, now - 86400000);
  const before = store.getSnapshot().states.d;
  const session = await store.startSession(cards);
  expect(session.cardIds).toEqual(['d', 'a']);
  expect(session.remainingIds).toEqual(['b']);
  expect(paceCards(cards, store.getSnapshot()).heldNew).toBe(1);
  expect(store.getSnapshot().states.d).toBe(before);
  await store.review('d', 4, now, { id: session.id, position: 0 });
  await store.review('a', 4, now, { id: session.id, position: 1 });
  expect(newAllowance(store.getSnapshot())).toBe(1);
  const next = await store.startSession(
    cards.filter((card) => session.remainingIds?.includes(card.id)),
  );
  expect(next.cardIds).toEqual(['b']);
});

it('persists the remaining selection and override when a batch is resumed after restart', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({
    ...store.getSnapshot().settings,
    reviewBatchSize: 1,
    newCardsPerDay: 1,
  });
  const session = await store.startSession(cards, 'normal', undefined, 'new', { extraNew: true });
  const restart = new ReviewStore(async () => {});
  restart.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const resumed = await restart.resumeSession(session.id, cards.slice().reverse());
  expect(resumed.session).toMatchObject({
    cardIds: ['a'],
    remainingIds: ['b', 'c', 'd'],
    extraNew: true,
    mode: 'new',
  });
});

it('enforces the daily allowance at the serialized rating boundary and undo returns the allowance', async () => {
  const persist = vi.fn(async () => {});
  const store = new ReviewStore(persist);
  await store.saveSettings({ ...store.getSnapshot().settings, newCardsPerDay: 1 });
  const one = await store.startSession([cards[0]!]);
  const two = await store.startSession([cards[1]!]);
  persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.review('a', 4, now, { id: one.id, position: 0 })).rejects.toThrow('disk full');
  expect(newAllowance(store.getSnapshot())).toBe(1);
  const undo = await store.review('a', 4, now, { id: one.id, position: 0 });
  await expect(store.review('b', 4, now, { id: two.id, position: 0 })).rejects.toThrow(/allowance/);
  expect(store.getSnapshot().history).toHaveLength(1);
  await store.undoReview(undo);
  expect(newAllowance(store.getSnapshot())).toBe(1);
  await store.review('b', 4, now, { id: two.id, position: 0 });
  expect(newAllowance(store.getSnapshot())).toBe(0);
});

it('allows scheduled learning repeats after the allowance is exhausted, and extra study or cram bypass it', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({
    ...store.getSnapshot().settings,
    newCardsPerDay: 1,
    reviewBatchSize: 1,
  });
  const first = await store.startSession([cards[0]!]);
  await store.review('a', 1, now, { id: first.id, position: 0 });
  const due = store.getSnapshot().states.a!.due!;
  const current = store.getSnapshot().sessions[0]!;
  await store.review('a', 4, due, { id: current.id, position: current.position, learningDue: due });
  expect(introductionsToday(store.getSnapshot().history)).toBe(1);
  await expect(store.startSession([cards[1]!])).rejects.toThrow(/allowance/);
  const extra = await store.startSession([cards[1]!], 'normal', undefined, 'new', {
    extraNew: true,
  });
  await store.review('b', 4, now, { id: extra.id, position: 0 });
  const cram = await store.startSession(cards, 'cram');
  expect(cram.cardIds).toHaveLength(4);
  const exam = await store.startSession(cards, 'normal', 'exam');
  expect(exam.cardIds).toHaveLength(4);
});
