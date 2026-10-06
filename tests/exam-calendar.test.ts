import { describe, expect, it } from 'vitest';
import {
  dayDistance,
  examMonth,
  monthDays,
  plansOnDay,
  shiftMonth,
} from '../src/exams/exam-calendar';
import type { ExamPlan } from '../src/exams/exam-plan';
const plan = (date: string, id = 'exam'): ExamPlan => ({
  id,
  name: id,
  date,
  createdAt: new Date('2026-10-06T12:00:00').getTime(),
  weekdays: [2, 4],
  dailyLimit: 30,
  selection: { decks: ['biology'], topics: [], cards: [] },
});
describe('exam calendar', () => {
  it('defaults to the next exam month, then latest past exam or current month', () => {
    expect(
      examMonth([plan('2026-12-04'), plan('2026-09-10'), plan('2026-11-02')], '2026-10-06'),
    ).toBe('2026-11');
    expect(examMonth([plan('2026-12-04'), plan('2026-11-02')], '2026-12-04')).toBe('2026-12');
    expect(examMonth([plan('2026-09-10'), plan('2026-08-01')], '2026-10-06')).toBe('2026-09');
    expect(examMonth([], '2026-10-06')).toBe('2026-10');
  });
  it('creates full Monday-first weeks across leap days and year boundaries', () => {
    const feb = monthDays('2024-02');
    expect(feb[0]).toBe('2024-01-29');
    expect(feb.at(-1)).toBe('2024-03-03');
    expect(feb).toContain('2024-02-29');
    expect(monthDays('2021-02')).toHaveLength(28);
    const jan = monthDays('2027-01');
    expect(jan[0]).toBe('2026-12-28');
    expect(jan.at(-1)).toBe('2027-01-31');
    const march = monthDays('2026-03');
    expect(march).toHaveLength(42);
    expect(new Set(march).size).toBe(42);
    expect(march).toContain('2026-03-29');
  });
  it('moves between years and counts days without DST hour differences', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(dayDistance('2026-03-07', '2026-03-09')).toBe(2);
    expect(dayDistance('2026-11-02', '2026-10-31')).toBe(-2);
  });
  it('includes selected revision weekdays from creation through exam day and all exams on a date', () => {
    const a = plan('2026-10-08', 'first'),
      b = { ...plan('2026-10-08', 'second'), weekdays: [1] };
    expect(plansOnDay([a, b], '2026-10-01').revision).toEqual([]);
    expect(plansOnDay([a, b], '2026-10-06').revision).toEqual([a]);
    expect(plansOnDay([a, b], '2026-10-07').revision).toEqual([]);
    expect(plansOnDay([a, b], '2026-10-08')).toEqual({ exams: [a, b], revision: [a] });
    expect(plansOnDay([a, b], '2026-10-13')).toEqual({ exams: [], revision: [] });
  });
});
