import { isoDay } from '../learn/mastery';
import type { ReviewEvent, ReviewState } from './scheduler';

export const REPAIR_FAILURE_DAYS = 5;

/** One scheduled failure per local study day. Learning repeats and cram never inflate this. */
export function failureDays(
  history: ReviewEvent[],
  states: Record<string, ReviewState>,
  now = Date.now(),
): Map<string, number> {
  const days = new Map<string, Set<string>>();
  for (const event of history) {
    if (
      event.scheduled !== true ||
      event.at > now ||
      event.rating !== 1 ||
      event.at <= (states[event.cardId]?.repairSince ?? -Infinity)
    ) {
      continue;
    }
    const set = days.get(event.cardId) ?? new Set<string>();
    set.add(isoDay(event.at));
    days.set(event.cardId, set);
  }
  return new Map([...days].map(([id, set]) => [id, set.size]));
}

export function needsRepair(state: ReviewState | undefined, days = 0): boolean {
  return !!state?.needsFixing || days >= REPAIR_FAILURE_DAYS;
}
