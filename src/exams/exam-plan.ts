import type { QardCard } from '../cards/card-types';
import { selectCards, type Selection } from '../review/session';
import { scheduler, type ReviewEvent, type ReviewState } from '../review/scheduler';
import { stableId } from '../review/saved-session';
export interface ExamPlan {
  id: string; name: string; date: string; selection: Selection; weekdays: number[]; dailyLimit: number; createdAt: number;
}
export function localDay(now: number | Date = Date.now()): string {
  const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`); return Number.isFinite(d.getTime()) && localDay(d) === value;
}
export function validExam(p: ExamPlan): boolean {
  return !!p && stableId(p.id) && typeof p.name === 'string' && !!p.name.trim() && validDay(p.date)
    && Number.isFinite(p.createdAt) && Number.isInteger(p.dailyLimit) && p.dailyLimit >= 1 && p.dailyLimit <= 1000
    && Array.isArray(p.weekdays) && p.weekdays.length > 0 && p.weekdays.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
    && !!p.selection && ['decks', 'topics', 'cards'].every(k => Array.isArray(p.selection[k as keyof Selection]) && p.selection[k as keyof Selection].every(s => typeof s === 'string'))
    && [p.selection.decks, p.selection.topics, p.selection.cards].some(a => a.length > 0);
}
export function readExams(raw: unknown): ExamPlan[] {
  const seen = new Set<string>();
  return Array.isArray(raw) ? (raw as ExamPlan[]).filter(p => {
    if (!validExam(p) || seen.has(p.id)) return false; seen.add(p.id); return true;
  }).map(p => ({ id: p.id, name: p.name.trim(), date: p.date, selection: { decks: [...p.selection.decks], topics: [...p.selection.topics], cards: [...p.selection.cards] }, weekdays: [...new Set(p.weekdays)], dailyLimit: p.dailyLimit, createdAt: p.createdAt })) : [];
}
export function examProgress(plan: ExamPlan, cards: QardCard[], states: Record<string, ReviewState>, history: ReviewEvent[], now = Date.now()) {
  const today = localDay(now), expired = plan.date < today;
  const selected = selectCards(cards, states, { selection: plan.selection, mode: 'all', order: 'note' });
  const ids = new Set(selected.map(c => c.id)), covered = new Set<string>();
  let doneToday = 0;
  const firstReviews = new Map<string, number>();
  for (const e of history) if (ids.has(e.cardId) && e.at >= plan.createdAt && e.at <= now) {
    if (localDay(e.at) === today) doneToday++;
    if (states[e.cardId]?.needsContentCheck) continue;
    covered.add(e.cardId); firstReviews.set(e.cardId, Math.min(firstReviews.get(e.cardId) ?? Infinity, e.at));
  }
  const weekdays = new Set(plan.weekdays);
  // Calendar arithmetic at noon avoids DST days being treated as 23/25-hour intervals.
  const first = new Date(`${today}T12:00:00`), last = new Date(`${plan.date}T12:00:00`);
  const calendarDays = Math.max(0, Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000) + 1);
  let studyDays = Math.floor(calendarDays / 7) * weekdays.size;
  for (let i = 0; i < calendarDays % 7; i++) if (weekdays.has((first.getDay() + i) % 7)) studyDays++;
  const isStudyDay = !expired && weekdays.has(first.getDay());
  const uncovered = selected.filter(c => !covered.has(c.id));
  const coveredToday = [...firstReviews.values()].filter(at => localDay(at) === today).length;
  const coverageToday = studyDays ? Math.max(0, Math.ceil((uncovered.length + coveredToday) / studyDays) - coveredToday) : uncovered.length;
  const remainingToday = isStudyDay ? Math.max(0, plan.dailyLimit - doneToday) : 0;
  const due = selected.filter(c => covered.has(c.id) && scheduler.isDue(states[c.id], now))
    .sort((a, b) => (states[a.id]?.due ?? 0) - (states[b.id]?.due ?? 0));
  const firstPass = uncovered.slice(0, Math.min(coverageToday, remainingToday));
  const queue = [...firstPass, ...due.slice(0, Math.max(0, remainingToday - firstPass.length))];
  const capacity = Math.max(0, studyDays * plan.dailyLimit - (isStudyDay ? Math.min(doneToday, plan.dailyLimit) : 0));
  return { selected, covered: covered.size, uncovered: uncovered.length, doneToday, studyDays, coverageToday,
    queue, due: due.length, isStudyDay, expired, shortfall: Math.max(0, uncovered.length - capacity) };
}
