import type { QardCard } from '../cards/card-types';
import { isWithinDeck } from '../decks/deck-index';
import { deckLimits, hasDeckLimits } from '../decks/deck-options';
import type { PluginData } from './review-store';
import type { ReviewEvent } from './scheduler';

/** Each card's first rating, when that happened today and counts as an introduction. */
function introducedToday(history: ReviewEvent[], now: number): ReviewEvent[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const first = new Map<string, ReviewEvent>();
  for (const event of history) {
    if (!first.has(event.cardId) || event.at < first.get(event.cardId)!.at) {
      first.set(event.cardId, event);
    }
  }
  return [...first.values()].filter(
    (event) =>
      event.introduced !== false && event.at >= start.getTime() && event.at < end.getTime(),
  );
}
/**
 * Count distinct introductions, not learning repeats; undo removes an introduction too.
 * With a deck, only cards rated while in that deck or one nested under it are counted.
 */
export function introductionsToday(
  history: ReviewEvent[],
  now = Date.now(),
  deck?: string,
): number {
  const events = introducedToday(history, now);
  return deck === undefined
    ? events.length
    : events.filter((event) => event.deck !== undefined && isWithinDeck(event.deck, deck)).length;
}

export interface PacingOptions {
  extraNew?: boolean;
}
/** How many more new cards may start today, overall and within every limited deck above this one. */
export function newAllowance(
  data: Pick<PluginData, 'settings' | 'history'>,
  now = Date.now(),
  deck?: string,
) {
  const overall = data.settings.newCardsPerDay
    ? Math.max(0, data.settings.newCardsPerDay - introductionsToday(data.history, now))
    : Infinity;
  return deckLimits(data.settings, deck).reduce(
    (least, entry) =>
      Math.min(least, Math.max(0, entry.limit - introductionsToday(data.history, now, entry.deck))),
    overall,
  );
}
/** Whether any daily new-card limit, global or per deck, is in force. */
export const limitsNewCards = (settings: PluginData['settings']) =>
  settings.newCardsPerDay > 0 || hasDeckLimits(settings);

export function paceCards(
  cards: QardCard[],
  data: Pick<PluginData, 'settings' | 'history' | 'states'>,
  options: PacingOptions = {},
  now = Date.now(),
) {
  let allowance = options.extraNew ? Infinity : newAllowance(data, now);
  // Deck limits are shared by every card beneath that deck, so they count down across the selection.
  const left = new Map<string, number>();
  const admit = (card: QardCard) => {
    if (options.extraNew) {
      return true;
    }
    const limits = deckLimits(data.settings, card.deck);
    for (const entry of limits) {
      if (!left.has(entry.deck)) {
        left.set(
          entry.deck,
          Math.max(0, entry.limit - introductionsToday(data.history, now, entry.deck)),
        );
      }
    }
    if (allowance <= 0 || limits.some((entry) => left.get(entry.deck)! <= 0)) {
      return false;
    }
    allowance--;
    limits.forEach((entry) => left.set(entry.deck, left.get(entry.deck)! - 1));
    return true;
  };
  // Due reviews first; preserve the selected order within reviews and within new cards.
  const reviews = cards.filter((card) => !!data.states[card.id]?.reviewCount);
  const fresh = cards.filter((card) => !data.states[card.id]?.reviewCount);
  const size = data.settings.reviewBatchSize;
  if (!size && !limitsNewCards(data.settings)) {
    return { batch: cards, remaining: [], heldNew: 0 };
  }
  const allowed = fresh.filter(admit);
  const eligible = [...reviews, ...allowed];
  const batch = size ? eligible.slice(0, size) : eligible;
  return { batch, remaining: eligible.slice(batch.length), heldNew: fresh.length - allowed.length };
}
