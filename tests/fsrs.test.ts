import { expect, it, vi } from 'vitest';
import { createEmptyCard, fsrs, State } from 'ts-fsrs';
import { intervalLabel, memoryStatistics, reviewWithFsrs, validFsrs } from '../src/review/fsrs-scheduler';
import { ReviewStore } from '../src/review/review-store';
import { DAY, scheduler, type Rating, type ReviewEvent, type ReviewState } from '../src/review/scheduler';
import { parseCards } from '../src/cards/parser';
import { readSettings } from '../src/settings/settings';
const start = new Date('2026-01-01T12:00:00Z').getTime();
const model = fsrs({ request_retention: .9, enable_fuzz: false, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] });
const store = () => new ReviewStore(async () => {});
const switchTo = (s: ReviewStore, value: 'fsrs' | 'simple') => s.saveSettings({ ...s.getSnapshot().settings, scheduler: value });

it('uses the maintained FSRS engine for each initial rating, learning, graduation and a later lapse', async () => {
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    const s = store(); await s.review('card', rating, start);
    const actual = s.getSnapshot().states.card!, expected = model.next(createEmptyCard(start), start, rating).card;
    expect(actual.due).toBe(expected.due.getTime());
    expect(actual.fsrs?.stability).toBe(expected.stability);
    expect(actual.fsrs?.difficulty).toBe(expected.difficulty);
    expect(validFsrs(actual.fsrs)).toBe(true);
  }
  const s = store(); await s.review('card', 3, start);
  expect(s.getSnapshot().states.card!.due).toBe(start + 10 * 60_000);
  expect(s.getSnapshot().states.card!.fsrs?.state).toBe(State.Learning);
  await s.review('card', 3, start + 10 * 60_000);
  expect(s.getSnapshot().states.card!.fsrs?.state).toBe(State.Review);
  await s.review('card', 1, s.getSnapshot().states.card!.due!);
  expect(s.getSnapshot().states.card!.fsrs?.state).toBe(State.Relearning);
  expect(s.getSnapshot().states.card!.fsrs?.lapses).toBe(1);
  expect(s.getSnapshot().history[0]).toMatchObject({ scheduler: 'fsrs', desiredRetention: .9 });
});
it('uses actual elapsed time and gives shorter intervals for higher retention', () => {
  const old = reviewWithFsrs('card', undefined, 4, start, .9);
  const later = reviewWithFsrs('card', old, 3, start + 20 * DAY, .9);
  const early = reviewWithFsrs('card', old, 3, start + DAY, .9);
  expect(later.fsrs!.stability).toBeGreaterThan(early.fsrs!.stability);
  expect(reviewWithFsrs('card', old, 3, start + 20 * DAY, .95).interval).toBeLessThan(later.interval);
});
it('keeps existing vaults on simple intervals and starts new vaults on FSRS', async () => {
  expect(store().getSnapshot().settings.scheduler).toBe('fsrs');
  const s = store(); s.load({ settings: { scheduling: true }, states: {} });
  expect(s.getSnapshot().settings.scheduler).toBe('simple');
  await s.review('card', 3, start);
  expect(s.getSnapshot().states.card!.due).toBe(start + DAY);
});
it('replays complete saved ratings on opt-in and preserves due dates in both directions', async () => {
  const s = store(); await switchTo(s, 'simple');
  await s.review('card', 4, start); await s.review('card', 3, start + 5 * DAY);
  const original = { ...s.getSnapshot().states.card! };
  await switchTo(s, 'fsrs');
  const migrated = s.getSnapshot().states.card!;
  expect(migrated).toMatchObject(original);
  expect(migrated.fsrs?.source).toBe('reviews');
  const expected = model.next(model.next(createEmptyCard(start), start, 4).card, start + 5 * DAY, 3).card;
  expect(migrated.fsrs?.stability).toBe(expected.stability);
  await s.review('card', 3, original.due!);
  expect(s.getSnapshot().states.card!.fsrs?.reps).toBe(3);
  const due = s.getSnapshot().states.card!.due;
  await switchTo(s, 'simple');
  expect(s.getSnapshot().states.card!.due).toBe(due);
  expect(s.getSnapshot().states.card!.fsrs).toBeUndefined();
  const simple = s.getSnapshot().states.card!;
  await s.review('card', 2, due!);
  expect(s.getSnapshot().states.card).toEqual(scheduler.reviewCard('card', simple, 2, due!));
});
it('labels incomplete or imported schedules as estimates without inventing activity', async () => {
  const state: ReviewState = { cardId: 'old', due: start + DAY, lastReviewed: start - DAY, reviewCount: 100, interval: 2, ease: 2.5, lapses: 10, lastRating: 3 };
  const s = store(); s.load({ states: { old: state }, history: [], settings: { scheduler: 'simple' } });
  await switchTo(s, 'fsrs');
  expect(s.getSnapshot().states.old).toMatchObject(state);
  expect(s.getSnapshot().states.old!.fsrs).toMatchObject({ source: 'schedule', stability: 2, reps: 100 });
  expect(s.getSnapshot().history).toHaveLength(0);
  expect(s.getSnapshot().statistics.daily).toEqual({});
  await s.importStates([{ ...state, cardId: 'imported' }]);
  expect(s.getSnapshot().states.imported!.fsrs?.source).toBe('schedule');
  await s.review('old', 3, start);
  expect(s.getSnapshot().states.old!.fsrs?.reps).toBe(101);
  expect(s.getSnapshot().states.old!.fsrs?.source).toBe('schedule');
});
it('updates memory with scheduling off and keeps all scheduling metadata unchanged', async () => {
  const s = store(); await s.review('card', 4, start);
  const before = s.getSnapshot().states.card!;
  await s.saveSettings({ ...s.getSnapshot().settings, scheduling: false });
  await s.review('card', 1, start + DAY);
  const after = s.getSnapshot().states.card!;
  expect(after.due).toBe(before.due); expect(after.interval).toBe(before.interval); expect(after.ease).toBe(before.ease);
  expect(after.fsrs!.last_review).toBe(start + DAY);
  expect(after.fsrs!.stability).toBeLessThan(before.fsrs!.stability);
  expect(after.reviewCount).toBe(2); expect(s.getSnapshot().history[1]?.scheduled).toBe(false);
});
it('persists numeric memory state and full review logs across restarts', async () => {
  const s = store(); await s.review('card', 4, start); await s.review('card', 3, start + DAY);
  const restored = store(); restored.load(JSON.parse(JSON.stringify(s.getSnapshot())));
  expect(restored.getSnapshot()).toEqual(s.getSnapshot());
  await restored.review('card', 3, start + 5 * DAY); await s.review('card', 3, start + 5 * DAY);
  expect(restored.getSnapshot().states.card).toEqual(s.getSnapshot().states.card);
  const history: ReviewEvent[] = Array.from({ length: 10001 }, (_, i) => ({ cardId: 'other', at: start + i * 1000, rating: 3, scheduled: true }));
  const many = store(); many.load({ history }); await many.review('last', 3, start + DAY);
  expect(many.getSnapshot().history).toHaveLength(10002);
  expect(many.getSnapshot().history[0]!.at).toBe(start);
});
it('keeps migration and review saves atomic on write failure', async () => {
  const persist = vi.fn(async () => {}), s = new ReviewStore(persist);
  await switchTo(s, 'simple'); await s.review('card', 4, start);
  const before = s.getSnapshot(); persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(switchTo(s, 'fsrs')).rejects.toThrow('disk full'); expect(s.getSnapshot()).toBe(before);
  await switchTo(s, 'fsrs'); const memory = s.getSnapshot();
  persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(s.review('card', 1, start + DAY)).rejects.toThrow('disk full'); expect(s.getSnapshot()).toBe(memory);
});
it('validates retention and corrupted memory, recovering from the saved history', async () => {
  for (const value of [NaN, Infinity, .5, 1, '90']) expect(readSettings({ desiredRetention: value }).desiredRetention).toBe(.9);
  expect(readSettings({ desiredRetention: .95 }).desiredRetention).toBe(.95);
  const s = store(); await s.review('card', 4, start);
  const raw = JSON.parse(JSON.stringify(s.getSnapshot())); raw.states.card.fsrs.stability = -10;
  expect(validFsrs(raw.states.card.fsrs)).toBe(false);
  const restored = store(); restored.load(raw);
  expect(restored.getSnapshot().states.card).toEqual(s.getSnapshot().states.card);
  const due = s.getSnapshot().states.card!.due;
  await s.saveSettings({ ...s.getSnapshot().settings, desiredRetention: .95 });
  expect(s.getSnapshot().states.card!.due).toBe(due);
});
it('reports model difficulty, stability and decaying recall only for current unambiguous cards', async () => {
  const s = store(); await s.review('easy', 4, start); await s.review('hard', 2, start);
  const cards = ['easy', 'hard', 'new', 'deleted'].map(id => parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Q\n> A\n`, `${id}.md`).cards[0]!);
  const initial = memoryStatistics(cards.slice(0, 3), s.getSnapshot().states, start, .9);
  expect(initial.count).toBe(2); expect(initial.recall).toBe(100); expect(initial.medianDifficulty).toBeGreaterThan(0);
  expect(initial.medianStability).toBeGreaterThan(0); expect(initial.bins.reduce((n, b) => n + b)).toBe(2);
  const later = memoryStatistics(cards, s.getSnapshot().states, start + 30 * DAY, .9);
  expect(later.recall).toBeLessThan(initial.recall!); expect(later.belowTarget).toBe(2);
  expect(memoryStatistics(cards.map(c => ({ ...c, duplicateId: true })), s.getSnapshot().states, start, .9).count).toBe(0);
  expect(memoryStatistics([cards[0]!, cards[0]!], s.getSnapshot().states, start, .9).count).toBe(1);
  expect(memoryStatistics(cards, s.getSnapshot().states, start - DAY, .9).count).toBe(0);
});
it('handles clock changes without negative elapsed times or invalid memory', () => {
  const previous = reviewWithFsrs('card', undefined, 4, start, .9);
  const next = reviewWithFsrs('card', previous, 3, start - DAY, .9);
  expect(validFsrs(next.fsrs)).toBe(true); expect(next.lastReviewed).toBe(start - DAY);
  expect(intervalLabel(1 / 1440)).toBe('1 min'); expect(intervalLabel(1)).toBe('1 day');
});
