import { retention } from '../review/fsrs-scheduler';
import type { DeckOptions, QardSettings } from '../settings/settings';
import { canonicalDeck, deckLineage } from './deck-index';

type Options = Pick<QardSettings, 'deckOptions' | 'desiredRetention'>;
/** A deck uses its own target, else its nearest parent's, else the global one. */
export function deckRetention(settings: Options, deck?: string): { value: number; from?: string } {
  for (const name of deck ? deckLineage(deck) : []) {
    const own = settings.deckOptions[name]?.desiredRetention;
    if (own !== undefined) {
      return { value: retention(own), from: name };
    }
  }
  return { value: settings.desiredRetention };
}
/** Every new-card limit on the way up applies: a parent's limit covers all its subdecks together. */
export function deckLimits(
  settings: Pick<QardSettings, 'deckOptions'>,
  deck?: string,
): { deck: string; limit: number }[] {
  return (deck ? deckLineage(deck) : []).flatMap((name) => {
    const limit = settings.deckOptions[name]?.newCardsPerDay;
    return limit ? [{ deck: name, limit }] : [];
  });
}
export const hasDeckLimits = (settings: Pick<QardSettings, 'deckOptions'>) =>
  Object.values(settings.deckOptions).some((options) => !!options.newCardsPerDay);
/** Returns the options map with this deck's entry replaced, or removed when nothing is set. */
export function withDeckOptions(
  all: Record<string, DeckOptions>,
  deck: string,
  options: DeckOptions,
): Record<string, DeckOptions> {
  const { [canonicalDeck(deck)]: _old, ...rest } = all;
  const next: DeckOptions = {
    ...(options.desiredRetention !== undefined
      ? { desiredRetention: retention(options.desiredRetention) }
      : {}),
    ...(options.newCardsPerDay ? { newCardsPerDay: options.newCardsPerDay } : {}),
  };
  return Object.keys(next).length ? { ...rest, [canonicalDeck(deck)]: next } : rest;
}
