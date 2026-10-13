import type { ReviewState } from '../src/review/scheduler';

/** A card's memory and markers, without the time its markers last changed (used only to merge synced copies). */
export function unstamp(state: ReviewState | undefined) {
  if (!state) {
    return state;
  }
  const { flagsAt: _flagsAt, ...rest } = state;
  return rest;
}
export const unstampAll = (states: Record<string, ReviewState>) =>
  Object.fromEntries(Object.entries(states).map(([id, state]) => [id, unstamp(state)]));
