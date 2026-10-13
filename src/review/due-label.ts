import { isBuried, type ReviewState } from './scheduler';

const localMidnight = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const times = (n: number) => `reviewed ${n === 1 ? 'once' : `${n} times`}`;

/** One line for a card's place in the schedule; empty when the preview already explains it (paused, deferred). */
export function dueLabel(state: ReviewState | undefined, now: number, scheduling: boolean): string {
  if (state?.paused || isBuried(state, now)) {
    return '';
  }
  if (!state?.reviewCount) {
    return 'New · not studied yet';
  }
  const reviewed = times(state.reviewCount);
  if (!scheduling) {
    return `Scheduling is off · ${reviewed}`;
  }
  if (state.needsContentCheck || state.due === undefined || state.due <= now) {
    return `Due now · ${reviewed}`;
  }
  const days = Math.round((localMidnight(state.due) - localMidnight(now)) / 86_400_000);
  if (days === 0) {
    return `Due later today · ${reviewed}`;
  }
  const due = new Date(state.due);
  const date = due.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(due.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
  return `Due ${days === 1 ? 'tomorrow' : `in ${days} days`} (${date}) · ${reviewed}`;
}
