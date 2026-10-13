import { expect, it } from 'vitest';
import { createEmptyCard, fsrs, get_fuzz_range, type Grade } from 'ts-fsrs';
import { reviewIntervals, reviewWithFsrs, intervalLabel } from '../src/review/fsrs-scheduler';
import { ReviewStore } from '../src/review/review-store';
import { DAY, type Rating } from '../src/review/scheduler';

const start = new Date('2026-03-02T09:00:00Z').getTime();
const unfuzzed = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});
const ids = Array.from({ length: 120 }, (_, i) => `card-${i}`);

it('spreads a batch rated together over nearby days within the FSRS fuzz range', () => {
  const plain = unfuzzed.next(createEmptyCard(start), start, 4 as Grade).card.scheduled_days;
  const { min_ivl, max_ivl } = get_fuzz_range(plain, 0, 36500);
  const days = ids.map((id) => Math.round(reviewWithFsrs(id, undefined, 4, start, 0.9).interval));
  for (const d of days) {
    expect(d).toBeGreaterThanOrEqual(min_ivl);
    expect(d).toBeLessThanOrEqual(max_ivl);
  }
  // Without fuzz all 120 would land on one day.
  expect(new Set(days).size).toBeGreaterThanOrEqual(3);
  expect(
    Math.max(...[...new Set(days)].map((d) => days.filter((x) => x === d).length)),
  ).toBeLessThan(90);
});

it('keeps spreading on later reviews instead of re-converging', () => {
  let states = ids.map((id) => reviewWithFsrs(id, undefined, 4, start, 0.9));
  states = states.map((s, i) => reviewWithFsrs(ids[i]!, s, 3, s.due!, 0.9));
  const dueDays = states.map((s) => Math.floor(s.due! / DAY));
  expect(new Set(dueDays).size).toBeGreaterThanOrEqual(5);
});

it('saves the interval that was previewed before rating', () => {
  for (const id of ids.slice(0, 40)) {
    const previous = reviewWithFsrs(id, undefined, 4, start, 0.9);
    const shown = previous.due! + 3 * DAY;
    const preview = reviewIntervals(id, previous, shown, 0.9);
    // Rating a few seconds after the answer was revealed.
    const saved = ([1, 2, 3, 4] as Rating[]).map((r) =>
      intervalLabel(reviewWithFsrs(id, previous, r, shown + 4_000, 0.9).interval),
    );
    expect(saved).toEqual(preview);
  }
});

it('gives the same schedule when the same ratings are replayed', async () => {
  const run = async () => {
    const store = new ReviewStore(async () => {});
    await store.review('card', 4, start);
    await store.review('card', 3, start + 9 * DAY);
    return store.getSnapshot().states.card;
  };
  expect(await run()).toEqual(await run());
});

it('does not fuzz learning steps or short intervals', () => {
  expect(reviewWithFsrs('card', undefined, 3, start, 0.9).due).toBe(start + 10 * 60_000);
  expect(reviewWithFsrs('card', undefined, 1, start, 0.9).due).toBe(start + 60_000);
});
