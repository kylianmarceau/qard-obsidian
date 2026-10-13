import { expect, it } from 'vitest';
import { dueLabel } from '../src/review/due-label';
import { DAY, type ReviewState } from '../src/review/scheduler';

const now = new Date(2026, 9, 13, 10).getTime();
const state = (extra: Partial<ReviewState>): ReviewState => ({
  cardId: 'card',
  interval: 1,
  ease: 2.5,
  reviewCount: 3,
  lapses: 0,
  ...extra,
});

it('describes cards that have not been studied', () => {
  expect(dueLabel(undefined, now, true)).toBe('New · not studied yet');
  expect(dueLabel(state({ reviewCount: 0 }), now, true)).toBe('New · not studied yet');
});

it('counts whole calendar days until a card is due', () => {
  expect(dueLabel(state({ due: now - DAY }), now, true)).toBe('Due now · reviewed 3 times');
  expect(dueLabel(state({ due: now + 600_000, reviewCount: 1 }), now, true)).toBe(
    'Due later today · reviewed once',
  );
  // 20 hours away, but on the next calendar day.
  expect(dueLabel(state({ due: now + 20 * 3_600_000 }), now, true)).toMatch(
    /^Due tomorrow \(.*14.*\) · reviewed 3 times$/,
  );
  expect(dueLabel(state({ due: now + 6 * DAY }), now, true)).toMatch(
    /^Due in 6 days \(.*19.*\) · reviewed 3 times$/,
  );
  expect(dueLabel(state({ due: now + 400 * DAY }), now, true)).toMatch(/2027/);
});

it('treats a changed answer as due and says when scheduling is off', () => {
  expect(dueLabel(state({ due: now + 6 * DAY, needsContentCheck: true }), now, true)).toBe(
    'Due now · reviewed 3 times',
  );
  expect(dueLabel(state({ due: now + 6 * DAY }), now, false)).toBe(
    'Scheduling is off · reviewed 3 times',
  );
});

it('stays quiet when the preview already explains a paused or deferred card', () => {
  expect(dueLabel(state({ due: now + 6 * DAY, paused: true }), now, true)).toBe('');
  expect(dueLabel(state({ due: now + 6 * DAY, buriedUntil: now + DAY }), now, true)).toBe('');
});
