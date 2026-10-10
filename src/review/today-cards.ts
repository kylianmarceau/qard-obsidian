import type { QardCard } from '../cards/card-types';
import { scheduler, type ReviewState } from './scheduler';

/** Today reviews existing cards in rotation, oldest due date first. */
export function todayDueCards(
  cards: QardCard[],
  states: Record<string, ReviewState>,
  now = Date.now(),
): QardCard[] {
  return cards
    .filter(
      (card) =>
        !card.duplicateId &&
        (states[card.id]?.reviewCount ?? 0) > 0 &&
        scheduler.isDue(states[card.id], now),
    )
    .sort((a, b) => (states[a.id]?.due ?? 0) - (states[b.id]?.due ?? 0));
}
