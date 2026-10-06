import type { Deck, QardCard } from '../cards/card-types';
export function buildDecks(cards: QardCard[]): Deck[] {
  const decks = new Map<string, Deck>();
  for (const card of [...cards].sort(
    (a, b) =>
      a.sourceFile.localeCompare(b.sourceFile) || a.sourcePosition.start - b.sourcePosition.start,
  )) {
    let deck = decks.get(card.deck);
    if (!deck) {
      deck = { name: card.deck, topics: [], cards: [], files: [] };
      decks.set(card.deck, deck);
    }
    deck.cards.push(card);
    if (!deck.files.includes(card.sourceFile)) deck.files.push(card.sourceFile);
    let topic = deck.topics.find((t) => t.name === card.topic);
    if (!topic) {
      topic = { name: card.topic, cards: [] };
      deck.topics.push(topic);
    }
    topic.cards.push(card);
  }
  return [...decks.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function matchesSearch(card: QardCard, query: string): boolean {
  const haystack = [card.deck, card.topic, card.frontMarkdown, ...card.tags]
    .join('\n')
    .toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word.replace(/^#/, '')));
}
export function topicKey(deck: string, topic: string) {
  return JSON.stringify([deck, topic]);
}
