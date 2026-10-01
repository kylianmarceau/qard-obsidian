// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { StudyClock, addStudy, courseOf, duration, studyReport, type StudyLog } from '../src/time/study-time';
import { StudyTimeLine, StudyTimeView } from '../src/components/usage/StudyTimeView';
import { ReviewStore } from '../src/review/review-store';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 1, h, m, s).getTime();

describe('study clock', () => {
  it('counts focused, active time per activity and course, and pauses when idle or unfocused', async () => {
    let now = at(10), focused: object | undefined;
    const saved: StudyLog[] = [], a = {}, b = {};
    const clock = new StudyClock(() => now, () => focused, async log => { saved.push(log); });
    const step = (seconds: number) => { for (let i = 0; i < seconds / 5; i++) { now += 5000; clock.tick(); } };
    focused = a;
    clock.set(a, { activity: 'lessons', course: 'DS346' });
    clock.set(b, { activity: 'cards', course: 'CS345 Graphs' });
    clock.input();
    step(60);                       // a minute in a lesson
    focused = b; clock.input();
    step(30);                       // switched to the other Qard tab
    step(5 * 60);                   // idle: only the first 2 minutes after the last input count
    focused = undefined; clock.input();
    step(60);                       // another app in front
    focused = a; clock.input();
    now += 3 * 3600_000; clock.tick(); // the computer slept: at most 15 seconds
    await clock.flush();
    expect(saved).toEqual([{ '2026-10-01': { 'lessons|DS346': 75, 'cards|CS345 Graphs': 120 } }]);
    await clock.flush();
    expect(saved).toHaveLength(1);
  });

  it('keeps a year, groups decks under courses, and reports by day, activity and course', () => {
    let log = addStudy({ '2025-01-01': { 'cards|X': 60 } }, { '2026-10-01': { 'cards|DS346 A1': 600, 'lessons|DS346': 1200, 'checks|': 90 }, '2026-09-30': { 'tests|CS345': 300 } }, '2026-10-01');
    log = addStudy(log, { '2026-10-01': { 'lessons|DS346': 60 } }, '2026-10-01');
    expect(Object.keys(log).sort()).toEqual(['2026-09-30', '2026-10-01']);
    expect(courseOf('DS346 A1', ['DS346', 'DS3'])).toBe('DS346');
    expect(courseOf('Geography', ['DS346'])).toBe('Geography');
    const report = studyReport(log, '2026-10-01', ['DS346']);
    expect(report.total).toBe(1950);
    expect(report.byCourse.map(r => [r.label, r.total, r.byActivity])).toEqual([['DS346', 1860, { cards: 600, lessons: 1260 }], ['No course', 90, { checks: 90 }]]);
    expect(report.byActivity.map(r => r.label)).toEqual(['Lessons', 'Cards', 'Checks']);
    expect(studyReport(log, undefined, []).daily.map(d => [d.day, d.total])).toEqual([['2026-09-30', 300], ['2026-10-01', 1950]]);
    expect([duration(20), duration(95), duration(4000), duration(7200)]).toEqual(['under a minute', '2 min', '1 h 7 min', '2 h']);
  });
});

it('shows study time by course and activity', async () => {
  const store = new ReviewStore(async () => {});
  const day = (offset: number) => { const d = new Date(Date.now() - offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  store.load({ study: { [day(0)]: { 'cards|DS346 A1': 600, 'lessons|DS346': 1500 }, [day(2)]: { 'tests|CS345': 900 }, bad: { x: 1 } } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const services = { reviews: store, learn: { courses: async () => [{ course: 'DS346' }, { course: 'CS345' }] } } as unknown as QardServices;
  await act(async () => { root.render(<><StudyTimeView services={services}/><StudyTimeLine services={services} course="DS346" days={30}/><StudyTimeLine services={services} days={1}/></>); await new Promise(r => setTimeout(r, 0)); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(host.querySelector('.qard-usage-total')!.textContent).toBe('50 minin the last 7 days · 7 min a day on average');
  expect([...host.querySelectorAll('.qard-usage-table tbody tr')].map(r => r.textContent)).toEqual(['DS34635m10m25m—', 'CS34515m——15m']);
  expect(host.querySelectorAll('.qard-usage-day')).toHaveLength(7);
  expect([...host.querySelectorAll('.qard-time-line')].map(p => p.textContent)).toEqual(['35 min on DS346 in the last 30 days', '35 min studied today']);
  await act(async () => root.unmount()); host.remove();
});
