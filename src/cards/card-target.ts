/** A note that might receive a new card, described with what the index and metadata cache know. */
export interface NoteCandidate {
  path: string;
  /** The note's own deck: its `qard-deck`, or the name the deck-naming setting gives it. */
  deck: string;
  /** The deck is written in the note's frontmatter. */
  qardDeck: boolean;
  fixedTopic?: string;
  /** Cards of the wanted deck and topic that live in this note without a location override. */
  topicCards: number;
}
export function deckSlug(deck: string): string {
  return (
    deck
      .replace(/[\\/:*?"<>|#^[\]]/g, '-')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 80) || 'Cards'
  );
}
export function parentFolder(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
/** `Folder/Deck.md`, or `Folder/Deck 2.md` and so on when that name is taken. */
export function newNotePath(deck: string, folder: string, exists: (path: string) => boolean) {
  const base = [folder, deckSlug(deck)].filter(Boolean).join('/');
  let path = base + '.md',
    n = 2;
  while (exists(path)) {
    path = `${base} ${n++}.md`;
  }
  return path;
}
/**
 * The note a new card of this deck and topic belongs in, or undefined for a new note. A note that
 * already holds the topic wins; then a deck note in the card folder, any deck note, and finally a
 * note the deck is named after. Decks named after a folder never get an arbitrary note of it.
 */
export function chooseCardNote(
  candidates: NoteCandidate[],
  deck: string,
  topic: string,
  folder: string,
): string | undefined {
  const canonical = [folder, deckSlug(deck) + '.md'].filter(Boolean).join('/');
  const rank = (note: NoteCandidate) => {
    const name = note.path.split('/').pop()!.replace(/\.md$/i, '');
    if (note.deck !== deck || (note.fixedTopic !== undefined && note.fixedTopic !== topic)) {
      return -1;
    }
    if (note.topicCards > 0) {
      return 0;
    }
    if (note.qardDeck) {
      return parentFolder(note.path) === folder ? 1 : 2;
    }
    return name === deck ? 3 : -1;
  };
  return candidates
    .map((note) => ({ note, rank: rank(note) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.note.topicCards - a.note.topicCards ||
        Number(parentFolder(b.note.path) === folder) -
          Number(parentFolder(a.note.path) === folder) ||
        Number(b.note.path === canonical) - Number(a.note.path === canonical) ||
        a.note.path.localeCompare(b.note.path),
    )[0]?.note.path;
}
