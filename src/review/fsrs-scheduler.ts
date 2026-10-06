import { createEmptyCard, fsrs, S_MAX, S_MIN, State, type Card } from 'ts-fsrs';
import type { QardCard } from '../cards/card-types';
import { DAY, type Rating, type ReviewEvent, type ReviewState } from './scheduler';

/** Dates are milliseconds, so plugin data survives JSON round trips without library objects. */
export interface FsrsCard extends Omit<Card, 'due' | 'last_review' | 'elapsed_days'> {
  /** Required compatibility field in ts-fsrs 5; remove when upgrading to 6. */
  elapsed_days: number;
  version: 1;
  due: number;
  last_review: number;
  source: 'reviews' | 'schedule';
}
export const retention = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0.7 && value <= 0.97
    ? value
    : 0.9;
const engine = (target = 0.9) =>
  fsrs({
    request_retention: retention(target),
    enable_fuzz: false,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  });
const validDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(new Date(value).getTime());
const counter = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function validFsrs(value: unknown): value is FsrsCard {
  if (!value || typeof value !== 'object') return false;
  const c = value as FsrsCard;
  return (
    c.version === 1 &&
    (c.source === 'reviews' || c.source === 'schedule') &&
    validDate(c.due) &&
    validDate(c.last_review) &&
    Number.isFinite(c.stability) &&
    c.stability >= S_MIN &&
    c.stability <= S_MAX &&
    Number.isFinite(c.difficulty) &&
    c.difficulty >= 1 &&
    c.difficulty <= 10 &&
    [State.Learning, State.Review, State.Relearning].includes(c.state) &&
    counter(c.reps) &&
    c.reps > 0 &&
    counter(c.lapses) &&
    c.lapses <= c.reps &&
    counter(c.learning_steps) &&
    Number.isFinite(c.elapsed_days) &&
    c.elapsed_days >= 0 &&
    Number.isFinite(c.scheduled_days) &&
    c.scheduled_days >= 0
  );
}
const unpack = (c: FsrsCard): Card => ({
  ...c,
  due: new Date(c.due),
  last_review: new Date(c.last_review),
});
const pack = (c: Card, source: FsrsCard['source']): FsrsCard => ({
  ...c,
  version: 1,
  due: c.due.getTime(),
  last_review: c.last_review!.getTime(),
  source,
});

/** Complete logs rebuild memory; older/imported schedules use an explicitly labelled initial estimate. */
export function initializeFsrs(
  state: ReviewState,
  history: ReviewEvent[],
  target = 0.9,
  now = Date.now(),
): ReviewState {
  if (!state.reviewCount) {
    const { fsrs: _memory, ...fresh } = state;
    return fresh;
  }
  if (
    validFsrs(state.fsrs) &&
    state.fsrs.reps === state.reviewCount &&
    state.fsrs.last_review === state.lastReviewed
  )
    return state;
  const events = history.filter((e) => e.cardId === state.cardId).sort((a, b) => a.at - b.at);
  let memory: Card, source: FsrsCard['source'];
  if (events.length === state.reviewCount && events[events.length - 1]?.at === state.lastReviewed) {
    memory = createEmptyCard(events[0]!.at);
    for (const e of events)
      memory = engine(e.desiredRetention ?? target).next(memory, e.at, e.rating).card;
    source = 'reviews';
  } else {
    const last = validDate(state.lastReviewed)
      ? state.lastReviewed
      : validDate(state.due)
        ? state.due - Math.max(0, state.interval) * DAY
        : now;
    const reviewed = validDate(last) ? last : now;
    memory = engine(target).next(
      createEmptyCard(reviewed),
      reviewed,
      [1, 2, 3, 4].includes(state.lastRating ?? 0) ? state.lastRating! : 3,
    ).card;
    memory.stability = Math.min(
      S_MAX,
      Math.max(S_MIN, state.interval > 0 ? state.interval : memory.stability),
    );
    memory.state = State.Review;
    memory.learning_steps = 0;
    memory.reps = Math.max(1, Math.round(state.reviewCount));
    memory.lapses = Math.min(memory.reps, Math.max(0, Math.round(state.lapses || 0)));
    memory.scheduled_days = Math.max(0, state.interval);
    source = 'schedule';
  }
  if (validDate(state.due)) memory.due = new Date(state.due);
  return { ...state, lastReviewed: memory.last_review!.getTime(), fsrs: pack(memory, source) };
}
export function migrateFsrs(
  states: Record<string, ReviewState>,
  history: ReviewEvent[],
  target: number,
): Record<string, ReviewState> {
  const byCard = new Map<string, ReviewEvent[]>();
  for (const e of history) {
    const events = byCard.get(e.cardId) ?? [];
    events.push(e);
    byCard.set(e.cardId, events);
  }
  return Object.assign(
    Object.create(null) as Record<string, ReviewState>,
    Object.fromEntries(
      Object.entries(states).map(([id, state]) => [
        id,
        initializeFsrs(state, byCard.get(id) ?? [], target),
      ]),
    ),
  );
}
export function reviewWithFsrs(
  cardId: string,
  previous: ReviewState | undefined,
  rating: Rating,
  now: number,
  target: number,
): ReviewState {
  const prepared = previous ? initializeFsrs(previous, [], target, now) : undefined;
  const card =
    prepared?.fsrs && validFsrs(prepared.fsrs) ? unpack(prepared.fsrs) : createEmptyCard(now);
  // A device clock moving backwards must not feed negative elapsed time into the memory model.
  if (card.last_review && card.last_review.getTime() > now) card.last_review = new Date(now);
  const next = engine(target).next(card, now, rating).card;
  return {
    cardId,
    lastReviewed: now,
    due: next.due.getTime(),
    interval: (next.due.getTime() - now) / DAY,
    ease: previous?.ease ?? 2.5,
    reviewCount: (previous?.reviewCount ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (rating === 1 ? 1 : 0),
    lastRating: rating,
    fsrs: pack(next, prepared?.fsrs?.source ?? 'reviews'),
  };
}
export function intervalLabel(days: number): string {
  const minutes = Math.max(1, Math.round(days * 1440));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  const n = Math.round(days);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}
export function reviewIntervals(
  cardId: string,
  previous: ReviewState | undefined,
  now: number,
  target: number,
): string[] {
  return ([1, 2, 3, 4] as Rating[]).map((r) =>
    intervalLabel(reviewWithFsrs(cardId, previous, r, now, target).interval),
  );
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2
    : undefined;
};
export function memoryStatistics(
  cards: QardCard[],
  states: Record<string, ReviewState>,
  now: number,
  target: number,
) {
  const seen = new Set<string>(),
    difficulties: number[] = [],
    stabilities: number[] = [],
    recalls: number[] = [],
    bins = Array<number>(10).fill(0);
  let estimated = 0,
    belowTarget = 0;
  const model = engine(target);
  for (const card of cards) {
    if (!card.stable || card.duplicateId || seen.has(card.id)) continue;
    seen.add(card.id);
    if (states[card.id]?.needsContentCheck) continue;
    const c = states[card.id]?.fsrs;
    if (!validFsrs(c) || c.last_review > now) continue;
    const difficulty = ((c.difficulty - 1) / 9) * 100;
    const recall = model.get_retrievability(unpack(c), now, false);
    difficulties.push(difficulty);
    stabilities.push(c.stability);
    recalls.push(recall);
    const bin = Math.min(9, Math.floor(difficulty / 10));
    bins[bin] = bins[bin]! + 1;
    if (c.source === 'schedule') estimated++;
    if (recall < target - 1e-9) belowTarget++;
  }
  return {
    count: recalls.length,
    bins,
    medianDifficulty: median(difficulties),
    medianStability: median(stabilities),
    recall: recalls.length
      ? (recalls.reduce((sum, n) => sum + n, 0) / recalls.length) * 100
      : undefined,
    estimated,
    belowTarget,
  };
}
