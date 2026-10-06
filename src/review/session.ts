import type { QardCard } from '../cards/card-types';
import { topicKey } from '../decks/deck-index';
import { scheduler, type ReviewState, type Rating } from './scheduler';
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
      if (
        !decks.has(card.deck) &&
        !topics.has(topicKey(card.deck, card.topic)) &&
        !ids.has(card.id)
      ) {
        return false;
      }
      // Deliberately before any scheduling lookup: All means all matching cards.
      if (options.mode === 'all') {
        return true;
      }
      const state = states[card.id];
      if (options.mode === 'new') {
        return !state?.reviewCount;
      }
      if (options.mode === 'due') {
        return scheduler.isDue(state, now);
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
