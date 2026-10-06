import { parseCards } from './parser';
import { buildDecks } from '../decks/deck-index';
import type { Deck, ParseIssue, ParseResult, QardCard } from './card-types';
export interface IndexSnapshot {
  cards: QardCard[];
  decks: Deck[];
  issues: ParseIssue[];
  loading: boolean;
  revision: number;
}
/** Pure incremental file index; vault events are an adapter around this class. */
export class CardIndex {
  private files = new Map<string, ParseResult>();
  private listeners = new Set<() => void>();
  private snapshot: IndexSnapshot = {
    cards: [],
    decks: [],
    issues: [],
    loading: true,
    revision: 0,
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  update(path: string, content: string, notify = true) {
    this.files.set(path, parseCards(content, path));
    if (notify) {
      this.publish();
    }
  }
  remove(path: string) {
    this.files.delete(path);
    this.publish();
  }
  fail(path: string, message: string) {
    this.files.set(path, { cards: [], issues: [{ file: path, line: 0, message }] });
    this.publish();
  }
  setLoading(loading: boolean) {
    this.snapshot = { ...this.snapshot, loading };
    this.publish();
  }
  publish() {
    const cards = [...this.files.values()].flatMap((f) => f.cards.map((c) => ({ ...c })));
    const issues = [...this.files.values()].flatMap((f) => f.issues);
    const ids = new Map<string, QardCard[]>();
    for (const card of cards) {
      if (card.stable) {
        ids.set(card.id, [...(ids.get(card.id) || []), card]);
      }
    }
    for (const group of ids.values()) {
      if (group.length > 1) {
        for (const card of group) {
          card.duplicateId = true;
          issues.push({
            file: card.sourceFile,
            line: card.sourcePosition.line,
            message: `Duplicate qard-id “${card.id}”. Give copied cards a new ID (or remove the copied ID before studying).`,
          });
        }
      }
    }
    this.snapshot = {
      cards,
      decks: buildDecks(cards),
      issues,
      loading: this.snapshot.loading,
      revision: this.snapshot.revision + 1,
    };
    this.listeners.forEach((listener) => listener());
  }
  dispose() {
    this.listeners.clear();
    this.files.clear();
  }
}
