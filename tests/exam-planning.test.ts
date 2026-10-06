import { expect, it } from 'vitest';
import { examProgress, localDay, readExams, validDay, type ExamPlan } from '../src/exams/exam-plan';
import { parseCards } from '../src/cards/parser';
import { ReviewStore } from '../src/review/review-store';
import { topicKey } from '../src/decks/deck-index';
const now = new Date('2026-10-05T12:00:00').getTime(); // Monday, local calendar.
const cards = Array.from(
  { length: 10 },
  (_, i) =>
    parseCards(
      `---\nqard-deck: Biology\n---\n# ${i < 5 ? 'Cells' : 'Plants'}\n<!-- qard-id: id-${i} -->\n> [!qard]- Question ${i}\n> Answer`,
      `note${i}.md`,
    ).cards[0]!,
);
const plan: ExamPlan = {
  id: 'exam',
  name: 'Biology final',
  date: '2026-10-09',
  weekdays: [1, 2, 3, 4, 5],
  dailyLimit: 5,
  selection: { decks: ['Biology'], topics: [], cards: [] },
  createdAt: now - 1000,
};
it('spreads first-pass coverage over selected study days, including an eligible exam day', () => {
  const p = examProgress(plan, cards, {}, [], now);
  expect(p.studyDays).toBe(5);
  expect(p.coverageToday).toBe(2);
  expect(p.queue).toHaveLength(2);
  expect(p.shortfall).toBe(0);
});
it('counts review coverage since plan creation, keeps a stable daily quota and fills capacity with due repeats', () => {
  const history = [
    { cardId: 'id-0', at: now, rating: 1 as const, scheduled: true },
    { cardId: 'id-1', at: now - 2000, rating: 3 as const, scheduled: true },
  ];
  const p = examProgress(
    plan,
    cards,
    {
      'id-0': {
        cardId: 'id-0',
        reviewCount: 1,
        interval: 1,
        ease: 2.5,
        lapses: 1,
        due: now + 60000,
      },
    },
    history,
    now,
  );
  expect(p.covered).toBe(1);
  expect(p.coverageToday).toBe(1);
  expect(p.doneToday).toBe(1);
  expect(p.queue.map((c) => c.id)).toEqual(['id-1']);
  const yesterday = new Date('2026-10-04T12:00:00').getTime();
  const q = examProgress(
    { ...plan, createdAt: yesterday },
    cards,
    {},
    [{ ...history[0]!, at: yesterday }],
    now,
  );
  expect(q.queue.map((c) => c.id)).toEqual(['id-1', 'id-2', 'id-0']);
});
it('warns when coverage exceeds capacity and never exceeds the daily limit', () => {
  const p = examProgress({ ...plan, date: '2026-10-05', dailyLimit: 3 }, cards, {}, [], now);
  expect(p.shortfall).toBe(7);
  expect(p.queue).toHaveLength(3);
});
it('respects rest days, expired exams, topic scopes and cards added later', () => {
  expect(examProgress({ ...plan, weekdays: [2] }, cards, {}, [], now).queue).toEqual([]);
  expect(examProgress({ ...plan, weekdays: [2] }, cards, {}, [], now).studyDays).toBe(1);
  const expired = examProgress({ ...plan, date: '2026-10-04' }, cards, {}, [], now);
  expect(expired.expired).toBe(true);
  expect(expired.queue).toEqual([]);
  const scoped = {
    ...plan,
    selection: { decks: [], topics: [topicKey('Biology', 'Plants')], cards: [] },
  };
  expect(examProgress(scoped, cards, {}, [], now).selected).toHaveLength(5);
  expect(
    examProgress(scoped, [...cards, { ...cards[9]!, id: 'new' }], {}, [], now).selected,
  ).toHaveLength(6);
});
it('counts repeated reviews toward daily workload and handles unsorted history without counting future events', () => {
  const yesterday = now - 86400000;
  const history = [now, yesterday, now, now + 1000].map((at, i) => ({
    cardId: i === 3 ? 'id-1' : 'id-0',
    at,
    rating: 3 as const,
    scheduled: true,
  }));
  const p = examProgress({ ...plan, createdAt: yesterday }, cards, {}, history, now);
  expect(p.covered).toBe(1);
  expect(p.doneToday).toBe(2);
  expect(p.coverageToday).toBe(2);
});
it('validates calendar dates and stored plans, and persists edits without resetting coverage or FSRS', async () => {
  expect(validDay('2026-02-30')).toBe(false);
  expect(validDay('2028-02-29')).toBe(true);
  expect(localDay(new Date('2026-10-05T23:59:59'))).toBe('2026-10-05');
  expect(
    readExams([
      null,
      { ...plan, weekdays: [] },
      { ...plan, dailyLimit: 0 },
      { ...plan, selection: {} },
    ]),
  ).toEqual([]);
  const store = new ReviewStore(async () => {});
  await store.saveExam(plan);
  await store.review('id-0', 3, now);
  const states = store.getSnapshot().states;
  await store.saveExam({ ...plan, name: 'Updated', dailyLimit: 40 });
  expect(store.getSnapshot().states).toBe(states);
  expect(store.getSnapshot().exams).toHaveLength(1);
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect(restored.getSnapshot().exams[0]!.createdAt).toBe(plan.createdAt);
  expect(restored.getSnapshot().exams[0]!.dailyLimit).toBe(40);
  await restored.deleteExam(plan.id);
  expect(restored.getSnapshot().exams).toEqual([]);
  expect(restored.getSnapshot().states['id-0']).toBeDefined();
});

it('includes a same-day learning review when due and leaves cards with changed answers uncovered', () => {
  const history = [{ cardId: 'id-0', at: now - 60000, rating: 1 as const, scheduled: true }];
  const states = {
    'id-0': { cardId: 'id-0', reviewCount: 1, interval: 1 / 1440, ease: 2.5, lapses: 1, due: now },
  };
  const started = { ...plan, createdAt: now - 120000 };
  const p = examProgress(started, cards, states, history, now);
  expect(p.queue.map((c) => c.id)).toEqual(['id-1', 'id-0']);
  expect(p.doneToday).toBe(1);
  const changed = examProgress(
    started,
    cards,
    { 'id-0': { ...states['id-0'], needsContentCheck: true } },
    history,
    now,
  );
  expect(changed.covered).toBe(0);
  expect(changed.doneToday).toBe(1);
  expect(changed.queue[0]!.id).toBe('id-0');
});
