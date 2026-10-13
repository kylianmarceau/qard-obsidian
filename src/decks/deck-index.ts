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
    if (!deck.files.includes(card.sourceFile)) {
      deck.files.push(card.sourceFile);
    }
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
  const haystack = [card.deck, card.topic, card.frontMarkdown, card.backMarkdown, ...card.tags]
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

/** Deck names nest with `::`, the convention Anki uses and its imports already produce. */
export const DECK_SEPARATOR = '::';
export const deckPath = (name: string) =>
  name
    .split(DECK_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
export const canonicalDeck = (name: string) => deckPath(name).join(DECK_SEPARATOR);
/** The deck itself first, then each parent up to the top level. */
export function deckLineage(name: string): string[] {
  const parts = deckPath(name);
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(DECK_SEPARATOR));
}
export const isWithinDeck = (deck: string, ancestor: string) =>
  deckLineage(deck).includes(canonicalDeck(ancestor));

export interface DeckNode {
  /** Full canonical name, such as `Biology::Cells`. */
  name: string;
  /** The last part of the name, shown inside its parent. */
  label: string;
  /** Absent for a parent that only groups other decks. */
  deck?: Deck;
  children: DeckNode[];
  /** Cards in this deck and every deck beneath it. */
  cards: number;
  /** Names of the real decks in this subtree, as written in notes. */
  decks: string[];
}
export function buildDeckTree(decks: Deck[]): DeckNode[] {
  const roots: DeckNode[] = [],
    nodes = new Map<string, DeckNode>();
  const node = (parts: string[]): DeckNode => {
    const name = parts.join(DECK_SEPARATOR);
    let found = nodes.get(name);
    if (!found) {
      found = { name, label: parts[parts.length - 1]!, children: [], cards: 0, decks: [] };
      nodes.set(name, found);
      (parts.length > 1 ? node(parts.slice(0, -1)).children : roots).push(found);
    }
    return found;
  };
  for (const deck of decks) {
    const parts = deckPath(deck.name);
    // A name made only of separators cannot nest; show it as written.
    const own = node(parts.length ? parts : [deck.name]);
    if (own.deck) {
      // Two spellings of one path, such as `A::B` and `A :: B`: keep both reachable as separate rows.
      roots.push({
        name: deck.name,
        label: deck.name,
        deck,
        children: [],
        cards: deck.cards.length,
        decks: [deck.name],
      });
      continue;
    }
    own.deck = deck;
    for (let depth = 1; depth <= Math.max(1, parts.length); depth++) {
      const ancestor = node(parts.length ? parts.slice(0, depth) : [deck.name]);
      ancestor.cards += deck.cards.length;
      ancestor.decks.push(deck.name);
    }
  }
  const sort = (list: DeckNode[]) => {
    list.sort((a, b) => a.label.localeCompare(b.label));
    list.forEach((child) => sort(child.children));
  };
  sort(roots);
  return roots;
}
