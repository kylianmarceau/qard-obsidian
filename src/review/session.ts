import type { QardCard } from '../cards/card-types';
import { topicKey } from '../decks/deck-index';
import { scheduler, isBuried, type ReviewState, type Rating } from './scheduler';
export type StudyMode = 'all' | 'due' | 'new' | 'difficult';
export type CardOrder = 'note' | 'shuffle';
export type SessionStyle = 'normal' | 'cram';
export interface Selection {
  decks: string[];
  topics: string[];
  cards: string[];
}
export interface SessionOptions {
  selection: Selection;
  mode: StudyMode;
  order: CardOrder;
  now?: number;
  /** Library/plan membership may include paused cards; study queues never do. */
  includePaused?: boolean;
  includeBuried?: boolean;
}
export function shuffle<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function selectCards(
  cards: QardCard[],
  states: Record<string, ReviewState>,
  options: SessionOptions,
): QardCard[] {
  const decks = new Set(options.selection.decks),
    topics = new Set(options.selection.topics),
    ids = new Set(options.selection.cards);
  const now = options.now ?? Date.now();
  const result = cards
    .filter((card) => {
      if (states[card.id]?.paused && !options.includePaused) {
        return false;
      }
      if (isBuried(states[card.id], now) && !options.includeBuried && !options.includePaused) {
        return false;
      }
      if (
        !decks.has(card.deck) &&
        !topics.has(topicKey(card.deck, card.topic)) &&
        !ids.has(card.id)
      ) {
        return false;
      }
      // All ignores scheduling fields; explicit pauses still stay out of study.
      if (options.mode === 'all') {
        return true;
      }
      const state = states[card.id];
      if (options.mode === 'new') {
        return !state?.reviewCount;
      }
      if (options.mode === 'due') {
        return scheduler.isDue(
          options.includeBuried && state ? { ...state, buriedUntil: undefined } : state,
          now,
        );
      }
      return state?.lastRating === 1 || state?.lastRating === 2;
    })
    .sort(
      (a, b) =>
        a.deck.localeCompare(b.deck) ||
        a.sourceFile.localeCompare(b.sourceFile) ||
        a.sourcePosition.start - b.sourcePosition.start,
    );
  return options.order === 'shuffle' ? shuffle(result) : result;
}
export interface SessionResult {
  cardId: string;
  rating: Rating;
}
