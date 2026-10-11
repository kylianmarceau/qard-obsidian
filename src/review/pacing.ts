import type { QardCard } from '../cards/card-types';
import type { PluginData } from './review-store';
import type { ReviewEvent } from './scheduler';

/** Count distinct introductions, not learning repeats; undo removes an introduction too. */
export function introductionsToday(history: ReviewEvent[], now = Date.now()): number {
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
  ).length;
}

export interface PacingOptions {
  extraNew?: boolean;
}
export function newAllowance(data: Pick<PluginData, 'settings' | 'history'>, now = Date.now()) {
  return data.settings.newCardsPerDay
    ? Math.max(0, data.settings.newCardsPerDay - introductionsToday(data.history, now))
    : Infinity;
}

export function paceCards(
  cards: QardCard[],
  data: Pick<PluginData, 'settings' | 'history' | 'states'>,
  options: PacingOptions = {},
  now = Date.now(),
) {
  let allowance = options.extraNew ? Infinity : newAllowance(data, now);
  // Due reviews first; preserve the selected order within reviews and within new cards.
  const reviews = cards.filter((card) => !!data.states[card.id]?.reviewCount);
  const fresh = cards.filter((card) => !data.states[card.id]?.reviewCount);
  const allowed = fresh.filter(() => allowance-- > 0);
  const eligible = [...reviews, ...allowed];
  const size = data.settings.reviewBatchSize;
  if (!size && !data.settings.newCardsPerDay) {
    return { batch: cards, remaining: [], heldNew: 0 };
  }
  const batch = size ? eligible.slice(0, size) : eligible;
  return { batch, remaining: eligible.slice(batch.length), heldNew: fresh.length - allowed.length };
}
