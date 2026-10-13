import { CLAMP_PARAMETERS, clipParameters, default_w, W17_W18_Ceiling } from 'ts-fsrs';
import { DAY, type ReviewEvent } from './scheduler';

/** Fewer ratings than this cannot say much about 21 parameters. */
export const MIN_REVIEWS = 400;
/** Only reviews at least a day after the previous one test long-term memory. */
export const MIN_SPACED_REVIEWS = 50;
export const DEFAULT_PARAMETERS: readonly number[] = default_w;
const S_MIN = 0.001,
  S_MAX = 36500;
const RANGES = CLAMP_PARAMETERS(W17_W18_Ceiling, true);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
/** Qard uses one relearning step, so the standard parameter ranges apply. */
export const clip = (w: readonly number[]) =>
  clipParameters([...w], 1, true).map((value) => Number(value.toFixed(4)));
export function validParameters(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 21 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** One card's ratings in order, with whole days since its previous rating (0 for the first). */
export interface TrainingItem {
  ratings: number[];
  days: number[];
}
export function trainingItems(history: ReviewEvent[]): TrainingItem[] {
  const byCard = new Map<string, ReviewEvent[]>();
  for (const event of history) {
    if ([1, 2, 3, 4].includes(event.rating) && Number.isFinite(event.at)) {
      byCard.set(event.cardId, [...(byCard.get(event.cardId) ?? []), event]);
    }
  }
  return [...byCard.values()].map((events) => {
    events.sort((a, b) => a.at - b.at);
    return {
      ratings: events.map((e) => e.rating),
      // The scheduler counts elapsed time the same way: completed days, never negative.
      days: events.map((e, i) =>
        i ? Math.max(0, Math.floor((e.at - events[i - 1]!.at) / DAY)) : 0,
      ),
    };
  });
}
export const countReviews = (items: TrainingItem[]) => ({
  total: items.reduce((sum, item) => sum + item.ratings.length, 0),
  spaced: items.reduce((sum, item) => sum + item.days.filter((d) => d >= 1).length, 0),
});

/** The FSRS-6 memory model, matching the scheduler's engine without its date handling. */
export const recall = (w: readonly number[], days: number, stability: number) => {
  const decay = -w[20]!;
  return Math.pow(1 + ((Math.pow(0.9, 1 / decay) - 1) * days) / stability, decay);
};
const initialDifficulty = (w: readonly number[], rating: number) =>
  w[4]! - Math.exp((rating - 1) * w[5]!) + 1;
export function nextMemory(
  w: readonly number[],
  memory: { stability: number; difficulty: number } | undefined,
  days: number,
  rating: number,
) {
  if (!memory) {
    return {
      stability: Math.max(w[rating - 1]!, 0.1),
      difficulty: clamp(initialDifficulty(w, rating), 1, 10),
    };
  }
  const { stability: s, difficulty: d } = memory;
  let stability: number;
  if (days === 0) {
    const change = Math.pow(s, -w[19]!) * Math.exp(w[17]! * (rating - 3 + w[18]!));
    stability = clamp(s * (rating >= 2 ? Math.max(change, 1) : change), S_MIN, S_MAX);
  } else {
    const r = recall(w, days, s);
    if (rating === 1) {
      const forgotten = clamp(
        w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!),
        S_MIN,
        S_MAX,
      );
      stability = clamp(s / Math.exp(w[17]! * w[18]!), S_MIN, forgotten);
    } else {
      stability = clamp(
        s *
          (1 +
            Math.exp(w[8]!) *
              (11 - d) *
              Math.pow(s, -w[9]!) *
              (Math.exp((1 - r) * w[10]!) - 1) *
              (rating === 2 ? w[15]! : 1) *
              (rating === 4 ? w[16]! : 1)),
        S_MIN,
        S_MAX,
      );
    }
  }
  const moved = d + (-w[6]! * (rating - 3) * (10 - d)) / 9;
  return {
    stability,
    difficulty: clamp(w[7]! * initialDifficulty(w, 4) + (1 - w[7]!) * moved, 1, 10),
  };
}

const EPSILON = 1e-7;
/** Visits every spaced review with the recall the model predicted just before it. */
function predictions(
  items: TrainingItem[],
  w: readonly number[],
  visit: (predicted: number, remembered: boolean) => void,
) {
  for (const item of items) {
    let memory: ReturnType<typeof nextMemory> | undefined;
    for (let i = 0; i < item.ratings.length; i++) {
      const days = item.days[i]!,
        rating = item.ratings[i]!;
      if (memory && days >= 1) {
        visit(recall(w, days, memory.stability), rating > 1);
      }
      memory = nextMemory(w, memory, days, rating);
    }
  }
}
function logLoss(items: TrainingItem[], w: readonly number[]) {
  let sum = 0,
    count = 0;
  predictions(items, w, (predicted, remembered) => {
    const p = clamp(predicted, EPSILON, 1 - EPSILON);
    sum -= remembered ? Math.log(p) : Math.log(1 - p);
    count++;
  });
  return count ? sum / count : 0;
}
export interface Fit {
  /** Average surprise per review; lower means recall is predicted better. */
  logLoss: number;
  /** Gap between predicted and actual recall across groups of similar predictions, as a fraction. */
  calibration: number;
  reviews: number;
}
export function evaluate(items: TrainingItem[], w: readonly number[]): Fit {
  const bins = Array.from({ length: 20 }, () => ({ predicted: 0, remembered: 0, count: 0 }));
  let reviews = 0;
  predictions(items, w, (predicted, remembered) => {
    const bin = bins[Math.min(19, Math.floor(clamp(predicted, 0, 1) * 20))]!;
    bin.predicted += predicted;
    bin.remembered += remembered ? 1 : 0;
    bin.count++;
    reviews++;
  });
  const squared = bins.reduce(
    (sum, bin) =>
      bin.count
        ? sum + bin.count * Math.pow(bin.predicted / bin.count - bin.remembered / bin.count, 2)
        : sum,
    0,
  );
  return {
    logLoss: logLoss(items, w),
    calibration: reviews ? Math.sqrt(squared / reviews) : 0,
    reviews,
  };
}

/** A starting stability per first rating, fitted to how the next spaced review of those cards went. */
function initialStabilities(items: TrainingItem[], w: number[]) {
  for (let rating = 1; rating <= 4; rating++) {
    const seconds: { days: number; remembered: boolean }[] = [];
    for (const item of items) {
      // Same-day learning steps in between would change stability, so only a direct spaced review counts.
      if (item.ratings[0] === rating && item.ratings.length > 1 && item.days[1]! >= 1) {
        seconds.push({ days: item.days[1]!, remembered: item.ratings[1]! > 1 });
      }
    }
    if (seconds.length < 20) {
      continue;
    }
    const loss = (stability: number) =>
      seconds.reduce((sum, review) => {
        const p = clamp(recall(w, review.days, stability), EPSILON, 1 - EPSILON);
        return sum - (review.remembered ? Math.log(p) : Math.log(1 - p));
      }, 0);
    // Golden-section search over log-stability; the loss has a single minimum in it.
    let low = Math.log(0.01),
      high = Math.log(100);
    const ratio = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 40; i++) {
      const a = high - ratio * (high - low),
        b = low + ratio * (high - low);
      if (loss(Math.exp(a)) < loss(Math.exp(b))) {
        high = b;
      } else {
        low = a;
      }
    }
    w[rating - 1] = Math.exp((low + high) / 2);
  }
  // A better first rating never means a weaker memory.
  for (let i = 1; i < 4; i++) {
    w[i] = Math.max(w[i]!, w[i - 1]!);
  }
}

export interface OptimizeOptions {
  signal?: AbortSignal;
  /** Called with progress from 0 to 1. */
  onProgress?: (done: number) => void;
  /** Deterministic shuffling for tests. */
  random?: () => number;
  /** Hands control back to the interface between slices of work. */
  pause?: () => Promise<void>;
}
export interface OptimizeResult {
  parameters: number[];
  before: Fit;
  after: Fit;
  improved: boolean;
}
export class NotEnoughReviews extends Error {}
export class OptimizationCancelled extends Error {
  constructor() {
    super('Optimisation was cancelled.');
  }
}
const BATCH = 512;

/**
 * Fits FSRS parameters to a review history on this device. Gradients are measured numerically on shuffled
 * batches of cards and followed with Adam; the best parameters seen on the whole history are returned,
 * so the result never predicts that history worse than the defaults.
 */
export async function optimizeParameters(
  items: TrainingItem[],
  options: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const { total, spaced } = countReviews(items);
  if (total < MIN_REVIEWS) {
    throw new NotEnoughReviews(
      `Personalising needs at least ${MIN_REVIEWS} ratings. You have ${total}; ${MIN_REVIEWS - total} more to go.`,
    );
  }
  if (spaced < MIN_SPACED_REVIEWS) {
    throw new NotEnoughReviews(
      `Personalising needs at least ${MIN_SPACED_REVIEWS} reviews made a day or more after the previous one. You have ${spaced}.`,
    );
  }
  const random = options.random ?? Math.random,
    pause = options.pause ?? (() => new Promise<void>((done) => window.setTimeout(done, 0)));
  const defaults = [...DEFAULT_PARAMETERS];
  const before = evaluate(items, defaults);
  const start = [...defaults];
  initialStabilities(items, start);
  let w = clip(start);
  // Small histories are pulled towards the defaults; large ones speak for themselves.
  const pull = 0.1 * Math.min(1, 1000 / spaced);
  const objective = (subset: TrainingItem[], candidate: readonly number[]) =>
    logLoss(subset, candidate) +
    (pull *
      candidate.reduce((sum, value, i) => {
        const [min, max] = RANGES[i]!;
        return sum + Math.pow((value - defaults[i]!) / (max! - min!), 2);
      }, 0)) /
      candidate.length;

  // Whole cards per batch, so each sequence is evaluated from its first rating.
  const batches = (): TrainingItem[][] => {
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const result: TrainingItem[][] = [];
    let batch: TrainingItem[] = [],
      size = 0;
    for (const item of order) {
      batch.push(item);
      size += item.ratings.length;
      if (size >= BATCH) {
        result.push(batch);
        batch = [];
        size = 0;
      }
    }
    if (batch.length) {
      result.push(batch);
    }
    return result;
  };
  const steps = clamp(Math.ceil((5 * total) / BATCH), 200, 1500);
  const m = Array<number>(21).fill(0),
    v = Array<number>(21).fill(0);
  let best = w,
    bestLoss = objective(items, w),
    queue: TrainingItem[][] = [],
    sliceStart = Date.now();
  if (objective(items, defaults) < bestLoss) {
    best = clip(defaults);
    bestLoss = objective(items, best);
  }
  for (let step = 1; step <= steps; step++) {
    if (options.signal?.aborted) {
      throw new OptimizationCancelled();
    }
    if (!queue.length) {
      queue = batches();
    }
    const batch = queue.pop()!;
    // Cosine decay settles the parameters instead of circling the minimum.
    const rate = 0.04 * 0.5 * (1 + Math.cos((Math.PI * (step - 1)) / steps));
    const next = [...w];
    for (let i = 0; i < 21; i++) {
      const [min, max] = RANGES[i]!;
      const h = Math.max(1e-4, 1e-3 * Math.abs(w[i]!));
      const up = [...w],
        down = [...w];
      up[i] = Math.min(max!, w[i]! + h);
      down[i] = Math.max(min!, w[i]! - h);
      const gradient = (objective(batch, up) - objective(batch, down)) / (up[i]! - down[i]! || h);
      m[i] = 0.9 * m[i]! + 0.1 * gradient;
      v[i] = 0.999 * v[i]! + 0.001 * gradient * gradient;
      const mHat = m[i]! / (1 - Math.pow(0.9, step)),
        vHat = v[i]! / (1 - Math.pow(0.999, step));
      // Steps are proportional to each parameter's range: some span 100, others 0.25.
      const scale = Math.min(1, (max! - min!) / 4);
      next[i] = clamp(w[i]! - (rate * scale * mHat) / (Math.sqrt(vHat) + 1e-8), min!, max!);
    }
    // Initial stabilities stay ordered Again ≤ Hard ≤ Good ≤ Easy.
    for (let i = 1; i < 4; i++) {
      next[i] = Math.max(next[i]!, next[i - 1]!);
    }
    w = next;
    if (step % 10 === 0 || step === steps) {
      const candidate = clip(w),
        loss = objective(items, candidate);
      if (loss < bestLoss) {
        best = candidate;
        bestLoss = loss;
      }
    }
    if (Date.now() - sliceStart > 12) {
      options.onProgress?.(step / steps);
      await pause();
      sliceStart = Date.now();
    }
  }
  if (options.signal?.aborted) {
    throw new OptimizationCancelled();
  }
  options.onProgress?.(1);
  const after = evaluate(items, best);
  return { parameters: best, before, after, improved: after.logLoss < before.logLoss - 1e-6 };
}
