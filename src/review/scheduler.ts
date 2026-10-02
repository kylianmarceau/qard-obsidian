import type { FsrsCard } from './fsrs-scheduler';
export type Rating = 1 | 2 | 3 | 4;
export interface ReviewState { cardId: string; lastReviewed?: number; due?: number; interval: number; ease: number; reviewCount: number; lapses: number; lastRating?: Rating; fsrs?: FsrsCard }
export interface ReviewEvent { cardId: string; at: number; rating: Rating; scheduled: boolean; scheduler?: 'simple' | 'fsrs'; desiredRetention?: number }
export interface Scheduler {
  getCardState(cardId: string, states: Record<string, ReviewState>): ReviewState | undefined;
  isDue(state: ReviewState | undefined, now: number): boolean;
  reviewCard(cardId: string, state: ReviewState | undefined, rating: Rating, now: number): ReviewState;
}
export const DAY = 86_400_000;
/** Small transparent interval scheduler, not FSRS. Manual selection never calls it. */
export const scheduler: Scheduler = {
  getCardState: (id, states) => states[id],
  isDue: (state, now) => !state?.reviewCount || state.due === undefined || state.due <= now,
  reviewCard(cardId, state, rating, now) {
    const ease = Math.max(1.3, Math.min(3.2, (state?.ease || 2.5) + (rating === 1 ? -.2 : rating === 2 ? -.15 : rating === 4 ? .15 : 0)));
    const previous = state?.interval || 0;
    const interval = rating === 1 ? 1 / 144 : rating === 2 ? Math.max(.5, previous * 1.2) : rating === 3 ? Math.max(1, previous * ease) : Math.max(4, previous * ease * 1.3);
    return { cardId, lastReviewed: now, due: now + interval * DAY, interval, ease, reviewCount: (state?.reviewCount || 0) + 1, lapses: (state?.lapses || 0) + (rating === 1 ? 1 : 0), lastRating: rating };
  }
};
