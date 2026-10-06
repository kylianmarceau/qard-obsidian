import type { QardCard } from '../cards/card-types';
import { addDays, isoDay } from '../learn/mastery';
import { scheduler, type Rating, type ReviewEvent, type ReviewState } from './scheduler';

/** Counts in rating order: Again, Hard, Good, Easy. No card content is stored. */
export type RatingCounts = [number, number, number, number];
export interface StudyStatistics {
  daily: Record<string, RatingCounts>;
  cards: Record<string, RatingCounts>;
  partialHistory: boolean;
}
export const emptyStatistics = (): StudyStatistics => ({
  daily: {},
  cards: Object.create(null) as Record<string, RatingCounts>,
  partialHistory: false,
});
export const countRatings = (counts: RatingCounts) => counts.reduce((sum, n) => sum + n, 0);
const sumRatings = (a: RatingCounts, b: RatingCounts): RatingCounts => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3],
];
const increment = (counts: RatingCounts | undefined, rating: Rating): RatingCounts => {
  const next: RatingCounts = counts ? [...counts] : [0, 0, 0, 0];
  next[rating - 1] = next[rating - 1]! + 1;
  return next;
};
export function recordReview(
  stats: StudyStatistics,
  cardId: string,
  rating: Rating,
  at: number,
): StudyStatistics {
  const day = isoDay(at);
  return {
    ...stats,
    daily: { ...stats.daily, [day]: increment(stats.daily[day], rating) },
    cards: Object.assign(Object.create(null) as Record<string, RatingCounts>, stats.cards, {
      [cardId]: increment(stats.cards[cardId], rating),
    }),
  };
}

/** Migrate the retained review log exactly once; saved aggregates survive log rotation. */
export function readStatistics(raw: unknown, history: ReviewEvent[]): StudyStatistics {
  if (
    raw &&
    typeof raw === 'object' &&
    'daily' in raw &&
    'cards' in raw &&
    raw.daily &&
    typeof raw.daily === 'object' &&
    raw.cards &&
    typeof raw.cards === 'object'
  ) {
    const value = raw as StudyStatistics;
    const validCounts = (v: unknown): v is RatingCounts =>
      Array.isArray(v) && v.length === 4 && v.every((n) => Number.isSafeInteger(n) && n >= 0);
    const read = (
      entries: unknown,
      validKey: (key: string) => boolean,
    ): Record<string, RatingCounts> =>
      Object.fromEntries(
        Object.entries(entries && typeof entries === 'object' ? entries : {}).filter(
          ([key, counts]) => validKey(key) && validCounts(counts),
        ),
      );
    return {
      daily: read(
        value.daily,
        (key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && isoDay(new Date(`${key}T12:00:00`)) === key,
      ),
      cards: Object.assign(
        Object.create(null) as Record<string, RatingCounts>,
        read(value.cards, (key) => /^[A-Za-z0-9_-]+$/.test(key)),
      ),
      partialHistory: value.partialHistory === true,
    };
  }
  const stats = emptyStatistics();
  stats.partialHistory = history.length >= 10000;
  for (const e of history) {
    if (/^[A-Za-z0-9_-]+$/.test(e.cardId) && Number.isFinite(new Date(e.at).getTime())) {
      const day = isoDay(e.at);
      stats.daily[day] = increment(stats.daily[day], e.rating);
      stats.cards[e.cardId] = increment(stats.cards[e.cardId], e.rating);
    }
  }
  return stats;
}

export function ratingSummary(stats: StudyStatistics, today: string, days?: number) {
  const start = days ? addDays(today, 1 - days) : '';
  let ratings: RatingCounts = [0, 0, 0, 0],
    activeDays = 0;
  for (const [day, counts] of Object.entries(stats.daily)) {
    if (day >= start && day <= today) {
      ratings = sumRatings(ratings, counts);
      if (countRatings(counts)) {
        activeDays++;
      }
    }
  }
  const total = countRatings(ratings);
  return {
    ratings,
    total,
    activeDays,
    recall: total ? ((total - ratings[0]) / total) * 100 : undefined,
  };
}

export function currentStreak(stats: StudyStatistics, today: string) {
  const active = (day: string) => countRatings(stats.daily[day] ?? [0, 0, 0, 0]) > 0;
  let day = active(today) ? today : addDays(today, -1),
    streak = 0;
  while (active(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export interface ActivityDay {
  day: string;
  count: number;
  future: boolean;
}
export function yearActivity(stats: StudyStatistics, year: number, today: string) {
  const start = `${year}-01-01`,
    end = `${year}-12-31`,
    days: ActivityDay[] = [];
  let streak = 0,
    longest = 0,
    total = 0,
    activeDays = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const future = day > today,
      count = future ? 0 : countRatings(stats.daily[day] ?? [0, 0, 0, 0]);
    days.push({ day, count, future });
    total += count;
    if (count) {
      activeDays++;
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }
  return { days, total, activeDays, longest, average: activeDays ? total / activeDays : 0 };
}

/** Observed difficulty: average rating mapped Easy → 0, Good → 33, Hard → 67, Again → 100. */
export function difficultyScore(counts: RatingCounts): number | undefined {
  const n = countRatings(counts);
  return n ? ((counts[0] * 3 + counts[1] * 2 + counts[2]) / (n * 3)) * 100 : undefined;
}
export function cardStatistics(
  cards: QardCard[],
  states: Record<string, ReviewState>,
  stats: StudyStatistics,
  now: number,
  scheduled: boolean,
) {
  const unique = [...new Map(cards.filter((c) => !c.duplicateId).map((c) => [c.id, c])).values()];
  const scores: number[] = [],
    bins = Array<number>(10).fill(0);
  let reviewed = 0,
    due = 0;
  const forecast = Array<number>(7).fill(0),
    today = isoDay(now);
  const decks = new Map<
    string,
    { name: string; total: number; reviewed: number; due: number; ratings: RatingCounts }
  >();
  for (const c of unique) {
    const state = states[c.id],
      counts = stats.cards[c.id] ?? [0, 0, 0, 0];
    const score = difficultyScore(counts);
    if (score !== undefined) {
      scores.push(score);
      const bin = Math.min(9, Math.floor(score / 10));
      bins[bin] = bins[bin]! + 1;
    }
    const seen = (state?.reviewCount ?? 0) > 0;
    const isDue = scheduled && seen && scheduler.isDue(state, now);
    if (seen) {
      reviewed++;
    }
    if (isDue) {
      due++;
    }
    if (scheduled && seen) {
      const dueDay = isDue ? today : state?.due !== undefined ? isoDay(state.due) : today;
      const i = forecast.findIndex((_, index) => addDays(today, index) === dueDay);
      if (i >= 0) {
        forecast[i] = forecast[i]! + 1;
      }
    }
    const deck = decks.get(c.deck) ?? {
      name: c.deck,
      total: 0,
      reviewed: 0,
      due: 0,
      ratings: [0, 0, 0, 0],
    };
    deck.total++;
    if (seen) {
      deck.reviewed++;
    }
    if (isDue) {
      deck.due++;
    }
    deck.ratings = sumRatings(deck.ratings, counts);
    decks.set(c.deck, deck);
  }
  scores.sort((a, b) => a - b);
  const middle = Math.floor(scores.length / 2);
  const median = scores.length
    ? scores.length % 2
      ? scores[middle]!
      : (scores[middle - 1]! + scores[middle]!) / 2
    : undefined;
  return {
    total: unique.length,
    reviewed,
    due,
    forecast,
    scores,
    bins,
    median,
    decks: [...decks.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name)),
  };
}
