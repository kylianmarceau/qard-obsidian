import { expect, it } from 'vitest';
import { FSRSAlgorithm, forgetting_curve, generatorParameters } from 'ts-fsrs';
import {
  clip,
  countReviews,
  DEFAULT_PARAMETERS,
  evaluate,
  nextMemory,
  NotEnoughReviews,
  OptimizationCancelled,
  optimizeParameters,
  recall,
  trainingItems,
  validParameters,
  type TrainingItem,
} from '../src/review/fsrs-optimizer';
import { recomputeMemory, reviewWithFsrs } from '../src/review/fsrs-scheduler';
import { mergeProgress } from '../src/review/merge-progress';
import { ReviewStore } from '../src/review/review-store';
import { DAY, type Rating, type ReviewEvent, type ReviewState } from '../src/review/scheduler';
import { readSettings } from '../src/settings/settings';

/** Deterministic pseudo-random numbers (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A learner whose memory follows `truth`, reviewed at intervals an FSRS scheduler would choose. */
function simulate(truth: readonly number[], cards: number, reviews: number, seed = 7) {
  const random = seeded(seed),
    items: TrainingItem[] = [];
  for (let c = 0; c < cards; c++) {
    const first = random() < 0.2 ? 1 : random() < 0.3 ? 2 : random() < 0.8 ? 3 : 4;
    const item: TrainingItem = { ratings: [first], days: [0] };
    let memory = nextMemory(truth, undefined, 0, first);
    for (let i = 1; i < reviews; i++) {
      const days = Math.max(1, Math.round(memory.stability * (0.5 + random())));
      const remembered = random() < recall(truth, days, memory.stability);
      const rating = remembered ? (random() < 0.15 ? 2 : random() < 0.85 ? 3 : 4) : 1;
      item.ratings.push(rating);
      item.days.push(days);
      memory = nextMemory(truth, memory, days, rating);
    }
    items.push(item);
  }
  return items;
}
const instant = { pause: async () => {}, random: seeded(1) };

it('matches the scheduler engine for every rating, same-day steps and the forgetting curve', () => {
  const odd = clip([
    0.5, 1.1, 4, 12, 6, 0.6, 2.5, 0.01, 1.6, 0.2, 0.9, 1.7, 0.08, 0.3, 1.9, 0.5, 2.2, 0.6, 0.12,
    0.1, 0.25,
  ]);
  for (const w of [[...DEFAULT_PARAMETERS], odd]) {
    const engine = new FSRSAlgorithm(generatorParameters({ w, enable_short_term: true }));
    expect(recall(w, 7, 3.2)).toBeCloseTo(forgetting_curve(w, 7, 3.2), 6);
    for (const first of [1, 2, 3, 4]) {
      let mine = nextMemory(w, undefined, 0, first),
        theirs = engine.next_state(null, 0, first);
      expect(mine.stability).toBeCloseTo(theirs.stability, 6);
      expect(mine.difficulty).toBeCloseTo(theirs.difficulty, 6);
      for (const [days, rating] of [
        [0, 3],
        [0, 1],
        [2, 3],
        [9, 2],
        [30, 1],
        [0, 4],
        [12, 4],
      ] as const) {
        mine = nextMemory(w, mine, days, rating);
        theirs = engine.next_state(theirs, days, rating);
        expect(mine.stability / theirs.stability).toBeCloseTo(1, 5);
        expect(mine.difficulty).toBeCloseTo(theirs.difficulty, 5);
      }
    }
  }
});

it('turns saved ratings into per-card sequences with whole elapsed days', () => {
  const at = new Date(2026, 0, 1, 9).getTime();
  const event = (cardId: string, offset: number, rating: Rating): ReviewEvent => ({
    cardId,
    at: at + offset,
    rating,
    scheduled: true,
  });
  const items = trainingItems([
    event('b', 0, 4),
    event('a', 3 * DAY + 700_000, 3),
    event('a', 0, 1),
    event('a', 600_000, 3),
  ]);
  expect(items).toEqual(
    expect.arrayContaining([
      { ratings: [1, 3, 3], days: [0, 0, 3] },
      { ratings: [4], days: [0] },
    ]),
  );
  expect(countReviews(items)).toEqual({ total: 4, spaced: 1 });
});

it('finds parameters that predict a learner with different memory better than the defaults', async () => {
  // Weaker first memories and slower growth than the published defaults assume.
  const truth = clip(
    DEFAULT_PARAMETERS.map((w, i) => (i < 4 ? w * 0.3 : i === 8 ? 1.2 : i === 11 ? 0.8 : w)),
  );
  const items = simulate(truth, 300, 8);
  const progress: number[] = [];
  const result = await optimizeParameters(items, {
    ...instant,
    onProgress: (done) => progress.push(done),
  });
  expect(result.improved).toBe(true);
  expect(result.after.logLoss).toBeLessThan(result.before.logLoss - 0.01);
  expect(result.after.calibration).toBeLessThan(result.before.calibration);
  // Close to what the true parameters achieve on the same reviews.
  expect(result.after.logLoss).toBeLessThan(evaluate(items, truth).logLoss + 0.005);
  expect(result.parameters).toEqual(clip(result.parameters));
  expect(result.parameters[0]!).toBeLessThanOrEqual(result.parameters[3]!);
  expect(progress[progress.length - 1]).toBe(1);
  // Unseen cards from the same learner are predicted better too, so this is not memorised noise.
  const unseen = simulate(truth, 200, 8, 99);
  expect(evaluate(unseen, result.parameters).logLoss).toBeLessThan(
    evaluate(unseen, DEFAULT_PARAMETERS).logLoss,
  );
}, 60_000);

it('never returns parameters worse than the defaults for a learner the defaults already fit', async () => {
  const items = simulate(DEFAULT_PARAMETERS, 150, 6);
  const result = await optimizeParameters(items, instant);
  expect(result.after.logLoss).toBeLessThanOrEqual(result.before.logLoss + 0.002);
}, 60_000);

it('asks for more reviews instead of fitting noise, and stops when cancelled', async () => {
  await expect(optimizeParameters(simulate(DEFAULT_PARAMETERS, 30, 5), instant)).rejects.toThrow(
    'at least 400 ratings. You have 150; 250 more',
  );
  const sameDay: TrainingItem[] = Array.from({ length: 100 }, () => ({
    ratings: [1, 3, 3, 3, 3],
    days: [0, 0, 0, 0, 0],
  }));
  await expect(optimizeParameters(sameDay, instant)).rejects.toBeInstanceOf(NotEnoughReviews);
  const controller = new AbortController();
  controller.abort();
  await expect(
    optimizeParameters(simulate(DEFAULT_PARAMETERS, 150, 6), {
      ...instant,
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(OptimizationCancelled);
});

it('accepts only complete, finite parameter sets and keeps them in range', () => {
  expect(validParameters([...DEFAULT_PARAMETERS])).toBe(true);
  expect(validParameters(DEFAULT_PARAMETERS.slice(0, 19))).toBe(false);
  expect(validParameters([...DEFAULT_PARAMETERS.slice(0, 20), NaN])).toBe(false);
  expect(readSettings({}).fsrsParameters).toBeUndefined();
  expect(readSettings({ fsrsParameters: [1, 2, 3] }).fsrsParameters).toBeUndefined();
  const wild = readSettings({ fsrsParameters: DEFAULT_PARAMETERS.map(() => 1000) }).fsrsParameters!;
  expect(wild[0]).toBe(100);
  expect(wild[20]).toBe(0.8);
});

const strong = clip(DEFAULT_PARAMETERS.map((w, i) => (i < 4 ? w * 4 : i === 8 ? 2.6 : w)));
const start = new Date(2026, 0, 1, 12).getTime();
async function reviewed() {
  const store = new ReviewStore(async () => {});
  await store.review('a', 3, start);
  await store.review('a', 3, start + 600_000);
  await store.review('a', 3, start + 4 * DAY);
  return store;
}

it('applies personal parameters to new reviews and refreshes memory without moving due dates', async () => {
  const store = await reviewed();
  const before = store.getSnapshot().states.a!;
  await store.saveSettings({ ...store.getSnapshot().settings, fsrsParameters: strong });
  const after = store.getSnapshot().states.a!;
  expect(after.due).toBe(before.due);
  expect(after.interval).toBe(before.interval);
  expect(after.reviewCount).toBe(3);
  expect(after.fsrs!.stability).toBeGreaterThan(before.fsrs!.stability);
  expect(after.fsrs!.source).toBe('reviews');
  // The next rating is scheduled by the personal parameters.
  const next = start + 20 * DAY;
  const undo = await store.review('a', 3, next);
  expect(store.getSnapshot().states.a!.due).toBe(
    reviewWithFsrs('a', after, 3, next, 0.9, strong).due,
  );
  expect(store.getSnapshot().states.a!.due).not.toBe(reviewWithFsrs('a', after, 3, next, 0.9).due);
  // Undo still works after a review made under personal parameters.
  await store.undoReview(undo);
  expect(store.getSnapshot().states.a).toEqual(after);
  // Resetting returns memory to what the defaults believe.
  const { fsrsParameters: _dropped, ...defaults } = store.getSnapshot().settings;
  await store.saveSettings(defaults);
  expect(store.getSnapshot().states.a!.fsrs!.stability).toBeCloseTo(before.fsrs!.stability, 6);
  expect(store.getSnapshot().settings.fsrsParameters).toBeUndefined();
});

it('leaves estimates from imported schedules alone when parameters change', () => {
  const imported: ReviewState = {
    cardId: 'i',
    interval: 12,
    ease: 2.5,
    reviewCount: 5,
    lapses: 0,
    due: start + 12 * DAY,
    lastReviewed: start,
  };
  const estimated = reviewWithFsrs('i', imported, 3, start + 12 * DAY, 0.9);
  expect(estimated.fsrs!.source).toBe('schedule');
  const states = recomputeMemory({ i: estimated }, [], 0.9, strong);
  expect(states.i).toBe(estimated);
});

it('rebuilds a card rated on two devices with the saved personal parameters', async () => {
  const laptop = await reviewed();
  await laptop.saveSettings({ ...laptop.getSnapshot().settings, fsrsParameters: strong });
  const base = laptop.getSnapshot();
  const phone = new ReviewStore(async () => {});
  await phone.load(JSON.parse(JSON.stringify(base)));
  await laptop.review('a', 3, start + 20 * DAY);
  await phone.review('a', 4, start + 21 * DAY);
  const merged = ReviewStore.parse(mergeProgress(base, laptop.getSnapshot(), phone.getSnapshot()));
  let expected: ReviewState | undefined;
  for (const [at, rating] of [
    [start, 3],
    [start + 600_000, 3],
    [start + 4 * DAY, 3],
    [start + 20 * DAY, 3],
    [start + 21 * DAY, 4],
  ] as const) {
    expected = reviewWithFsrs('a', expected, rating, at, 0.9, strong);
  }
  expect(merged.settings.fsrsParameters).toEqual(strong);
  expect(merged.states.a!.fsrs!.stability).toBeCloseTo(expected!.fsrs!.stability, 6);
  expect(merged.states.a!.due).toBe(expected!.due);
});
