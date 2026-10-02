import { expect, it } from 'vitest';
import { ReviewStore } from '../src/review/review-store';
import { cardStatistics, countRatings, currentStreak, difficultyScore, emptyStatistics, ratingSummary, readStatistics, recordReview, yearActivity } from '../src/review/statistics';
import { parseCards } from '../src/cards/parser';
import { DAY, type ReviewEvent, type ReviewState } from '../src/review/scheduler';

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const event = (cardId: string, day: string, rating: 1 | 2 | 3 | 4): ReviewEvent => ({ cardId, at: at(day), rating, scheduled: true });

it('migrates existing ratings once and keeps daily totals as the full history grows and restarts', async () => {
  const history = Array.from({ length: 10000 }, (_, i) => event('card', i === 0 ? '2023-01-01' : '2024-01-02', 3));
  const store = new ReviewStore(async () => {});
  store.load({ history });
  expect(store.getSnapshot().statistics.partialHistory).toBe(true);
  await store.review('card', 1, at('2024-01-03'));
  expect(store.getSnapshot().history).toHaveLength(10001);
  expect(store.getSnapshot().history.some(e => e.at === at('2023-01-01'))).toBe(true);
  expect(countRatings(store.getSnapshot().statistics.daily['2023-01-01']!)).toBe(1);
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect(ratingSummary(restored.getSnapshot().statistics, '2024-01-03').total).toBe(10001);
  await restored.review('card', 4, at('2024-01-03'));
  expect(restored.getSnapshot().statistics.daily['2024-01-03']).toEqual([1, 0, 0, 1]);
});

it('keeps statistics atomic with review saves, including concurrent reviews and scheduling off', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({ ...store.getSnapshot().settings, scheduling: false });
  await Promise.all([store.review('a', 1, at('2024-06-01')), store.review('b', 2, at('2024-06-01')), store.review('a', 4, at('2024-06-01'))]);
  expect(store.getSnapshot().statistics.daily['2024-06-01']).toEqual([1, 1, 0, 1]);
  expect(store.getSnapshot().statistics.cards.a).toEqual([1, 0, 0, 1]);
  const failed = new ReviewStore(async () => { throw new Error('disk full'); });
  await expect(failed.review('a', 1, at('2024-06-01'))).rejects.toThrow('disk full');
  expect(failed.getSnapshot().statistics.daily).toEqual({});
});

it('rejects invalid reviews and safely records IDs matching object prototype names', async () => {
  const store = new ReviewStore(async () => {});
  for (const id of ['constructor', '__proto__', 'toString']) await store.review(id, 3, at('2024-06-01'));
  const restored = new ReviewStore(async () => {}); restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  await restored.review('constructor', 4, at('2024-06-01'));
  expect(restored.getSnapshot().statistics.cards.constructor).toEqual([0, 0, 1, 1]);
  await expect(store.review('a', 0 as 1)).rejects.toThrow('valid rating');
  await expect(store.review('a', 1, Infinity)).rejects.toThrow('valid rating');
});

it('sanitizes saved aggregates and falls back to migration for an invalid structure', () => {
  const stats = readStatistics({ daily: { '2024-02-30': [1, 0, 0, 0], '2024-02-29': [1, 2, 3, 4], '2024-03-01': [-1, 0, 0, 0], '2024-03-02': [1, 2] }, cards: { valid: [1, 0, 0, 0], 'bad:id': [0, 0, 1, 0], nan: [NaN, 0, 0, 0] } }, []);
  expect(Object.keys(stats.daily)).toEqual(['2024-02-29']);
  expect(Object.keys(stats.cards)).toEqual(['valid']);
  expect(readStatistics({ daily: null, cards: null }, [event('a', '2024-02-29', 4)]).daily['2024-02-29']).toEqual([0, 0, 0, 1]);
});

it('uses calendar-day boundaries, includes zero days and leap day, and excludes future reviews', () => {
  const stats = readStatistics(undefined, [event('a', '2024-02-28', 1), event('a', '2024-02-29', 2), event('a', '2024-03-01', 3), event('a', '2024-03-02', 4)]);
  const activity = yearActivity(stats, 2024, '2024-03-01');
  expect(activity.days).toHaveLength(366);
  expect(activity.activeDays).toBe(3); expect(activity.total).toBe(3); expect(activity.longest).toBe(3);
  expect(activity.days.find(d => d.day === '2024-03-02')).toEqual({ day: '2024-03-02', count: 0, future: true });
  expect(yearActivity(stats, 2023, '2024-03-01').days).toHaveLength(365);
  expect(ratingSummary(stats, '2024-03-01', 2).ratings).toEqual([0, 1, 1, 0]);
  expect(ratingSummary(stats, '2024-03-01', 2).recall).toBe(100);
  expect(ratingSummary(emptyStatistics(), '2024-03-01').recall).toBeUndefined();
  const midnight = recordReview(emptyStatistics(), 'a', 3, at('2024-03-01', 0));
  expect(midnight.daily['2024-03-01']).toEqual([0, 0, 1, 0]);
});

it('keeps a streak alive until the end of today, bridges year boundaries and resets after a missed day', () => {
  const stats = readStatistics(undefined, [event('a', '2023-12-30', 3), event('a', '2023-12-31', 3), event('a', '2024-01-01', 3)]);
  expect(currentStreak(stats, '2024-01-01')).toBe(3);
  expect(currentStreak(stats, '2024-01-02')).toBe(3);
  expect(currentStreak(stats, '2024-01-03')).toBe(0);
  expect(yearActivity(stats, 2024, '2024-01-03').longest).toBe(1);
});

it('computes difficulty from actual ratings, including endpoints and an even-sized median', () => {
  expect(difficultyScore([0, 0, 0, 1])).toBe(0);
  expect(difficultyScore([1, 0, 0, 0])).toBe(100);
  expect(difficultyScore([1, 0, 0, 1])).toBe(50);
  expect(difficultyScore([0, 0, 0, 0])).toBeUndefined();
  const cards = parseCards('<!-- qard-id: a -->\n> [!qard]- A\n> Answer\n\n<!-- qard-id: b -->\n> [!qard]- B\n> Answer\n', 'cards.md').cards;
  const stats = readStatistics(undefined, [event('a', '2024-01-01', 1), event('b', '2024-01-01', 4), event('deleted', '2024-01-01', 2)]);
  const report = cardStatistics(cards, {}, stats, at('2024-01-01'), true);
  expect(report.median).toBe(50); expect(report.bins[0]).toBe(1); expect(report.bins[9]).toBe(1);
  expect(report.scores).toHaveLength(2);
  expect(ratingSummary(stats, '2024-01-01').total).toBe(3);
});

it('counts imported schedules without inventing ratings, and forecasts overdue and due cards only', () => {
  const cards = ['overdue', 'later', 'new', 'imported'].map(id => parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Question\n> Answer\n`, `${id}.md`).cards[0]!);
  const now = at('2024-03-01');
  const state = (cardId: string, due: number): ReviewState => ({ cardId, due, reviewCount: 1, interval: 1, ease: 2.5, lapses: 0 });
  const states = { overdue: state('overdue', now - DAY), later: state('later', now + DAY), imported: state('imported', now + 8 * DAY) };
  const stats = readStatistics(undefined, [event('overdue', '2024-02-29', 1)]);
  const report = cardStatistics(cards, states, stats, now, true);
  expect(report.total).toBe(4); expect(report.reviewed).toBe(3); expect(report.due).toBe(1);
  expect(report.forecast).toEqual([1, 1, 0, 0, 0, 0, 0]); expect(report.scores).toHaveLength(1);
  expect(report.decks.reduce((sum, d) => sum + d.due, 0)).toBe(1);
  expect(cardStatistics(cards, states, stats, now, false).forecast).toEqual([0, 0, 0, 0, 0, 0, 0]);
  const duplicates = cards.map(c => ({ ...c, duplicateId: true }));
  expect(cardStatistics(duplicates, states, stats, now, true).total).toBe(0);
});
