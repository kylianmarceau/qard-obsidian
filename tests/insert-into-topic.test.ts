import { describe, expect, it } from 'vitest';
import { parseCards, topicSections } from '../src/cards/parser';
import {
  addReverseInSource,
  cardAtLine,
  insertIntoTopic,
  removeReverseInSource,
  replaceCardInSource,
  serializeCard,
} from '../src/cards/source-patch';
import { locationComment } from '../src/cards/card-location';

const card =
  (id: string, front = `Q ${id}?`, back = `A ${id}`) =>
  (eol: string, location?: Parameters<typeof serializeCard>[5]) =>
    serializeCard(id, front, back, eol, undefined, location);
const placed = (source: string, path = 'Deck.md') =>
  parseCards(source, path).cards.map((c) => `${c.id}@${c.deck}/${c.topic}`);
const deckNote = (body: string) => `---\nqard-deck: Deck\n---\n\n${body}`;

describe('topicSections', () => {
  it('reports frontmatter, ATX and setext headings, ignoring fences, comments and moved cards', () => {
    const source = deckNote(
      'Intro\n\n# One\n\n```\n# not a heading\n```\n<!--\n# hidden\n-->\n' +
        locationComment({ deck: 'Other', topic: 'Moved' }) +
        '\n> [!qard]- Q\n> A\n\nTwo\n===\n\nText\n',
    );
    const note = topicSections(source, 'Deck.md')!;
    expect(note.deck).toBe('Deck');
    expect(note.sections.map((s) => [s.topic, s.line, s.end])).toEqual([
      ['General', 3, 6],
      ['One', 6, 18],
      ['Two', 18, 22],
    ]);
  });
  it('reports a fixed topic and nothing for invalid frontmatter', () => {
    expect(topicSections('---\nqard-topic: Fixed\n---\n# H\n', 'n.md')?.fixedTopic).toBe('Fixed');
    expect(topicSections('---\nbroken\n', 'n.md')).toBeUndefined();
  });
});

describe('insertIntoTopic', () => {
  it('adds after the last card of the topic, before the next heading', () => {
    const source = deckNote(
      '# One\n\n' + card('a')('\n') + '\nNotes.\n\n# Two\n\n' + card('b')('\n'),
    );
    const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'One', card('c'));
    expect(placed(next)).toEqual(['a@Deck/One', 'c@Deck/One', 'b@Deck/Two']);
    expect(next).toContain('> A a\n\n<!-- qard-id: c -->');
    expect(next).toContain('> A c\n\nNotes.');
  });
  it('fills a heading section that has no cards yet, using the last section of that name', () => {
    const source = deckNote('# One\n\nProse.\n\n# Two\n\n# One\n\nMore prose.\n\n\n# Three\n');
    const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'One', card('c'));
    expect(next).toContain('More prose.\n\n<!-- qard-id: c -->');
    expect(next).toContain('> A c\n\n\n# Three');
    expect(placed(next)).toEqual(['c@Deck/One']);
  });
  it('puts General cards before the first heading', () => {
    const source = deckNote('# One\n');
    const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'General', card('c'));
    expect(placed(next)).toEqual(['c@Deck/General']);
    expect(next.indexOf('qard-id: c')).toBeLessThan(next.indexOf('# One'));
  });
  it('appends a new heading when the topic is new, with or without a final newline', () => {
    for (const source of [deckNote('# One'), deckNote('# One\n'), '---\nqard-deck: Deck\n---\n']) {
      const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'New', card('c'));
      expect(next.startsWith(source)).toBe(true);
      expect(placed(next)).toEqual(['c@Deck/New']);
      expect(next).not.toMatch(/\n{3}/);
    }
  });
  it('keeps a blank line before a following setext heading', () => {
    const source = deckNote('# One\n\n' + card('a')('\n') + 'Two\n---\n');
    const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'One', card('c'));
    expect(next).toContain('> A c\n\nTwo\n---');
    expect(placed(next)).toEqual(['a@Deck/One', 'c@Deck/One']);
  });
  it('inherits a location override when the only cards of the topic were moved here', () => {
    const moved = locationComment({ deck: 'Elsewhere', topic: 'Moved' }) + '\n' + card('a')('\n');
    const next = insertIntoTopic(deckNote(moved), 'Deck.md', 'Elsewhere', 'Moved', card('c'));
    expect(placed(next)).toEqual(['a@Elsewhere/Moved', 'c@Elsewhere/Moved']);
  });
  it('respects a fixed topic and rejects other decks', () => {
    const fixed = '---\nqard-deck: Deck\nqard-topic: Fixed\n---\n\n# Heading\n\nText\n';
    const next = insertIntoTopic(fixed, 'Deck.md', 'Deck', 'Fixed', card('c'));
    expect(next.endsWith('Text\n\n' + card('c')('\n'))).toBe(true);
    expect(() => insertIntoTopic(fixed, 'Deck.md', 'Deck', 'Other', card('c'))).toThrow(
      /fixes its topic/,
    );
    expect(() => insertIntoTopic(deckNote(''), 'Deck.md', 'Another', 'T', card('c'))).toThrow(
      /changed/,
    );
  });
  it('keeps CRLF notes CRLF', () => {
    const source = deckNote('# One\n\n' + card('a')('\n') + '\n# Two\n').replace(/\n/g, '\r\n');
    const next = insertIntoTopic(source, 'Deck.md', 'Deck', 'One', card('c'));
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
    expect(placed(next)).toEqual(['a@Deck/One', 'c@Deck/One']);
  });
});

describe('reverse pairs on existing cards', () => {
  const ids = { reverseId: 'r', group: 'g' };
  it('adds a mirrored partner without touching the callout, then still edits both', () => {
    const source = 'Prose.\n\n' + card('a', 'Capital?', 'Paris')('\n') + 'Tail.\n';
    const original = parseCards(source, 'n.md').cards[0]!;
    const next = addReverseInSource(source, original, ids);
    const [a, r] = parseCards(next, 'n.md').cards;
    expect(a).toMatchObject({ id: 'a', reverseId: 'r', siblingGroup: 'g' });
    expect(r).toMatchObject({ id: 'r', reverseId: 'a', frontMarkdown: 'Paris' });
    expect(next).toContain(original.sourceText.replace('<!-- qard-id: a -->\n', ''));
    expect(next).toContain('> Capital?\n\nTail.');
    const edited = replaceCardInSource(next, a!, 'Capital of France?', 'Paris', 'a');
    expect(parseCards(edited, 'n.md').cards[1]!.backMarkdown).toBe('Capital of France?');
  });
  it('gives a handwritten card an ID, works at the end of a note and with CRLF', () => {
    const source = 'Intro\r\n\r\n> [!qard]- Q\r\n> A';
    const handwritten = parseCards(source, 'n.md').cards[0]!;
    expect(() => addReverseInSource(source, handwritten, ids)).toThrow(/could not|ID/);
    const next = addReverseInSource(source, handwritten, { ...ids, id: 'new' });
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parseCards(next, 'n.md').cards.map((c) => [c.id, c.reverseId])).toEqual([
      ['new', 'r'],
      ['r', 'new'],
    ]);
  });
  it('rejects non-basic and already reversed cards', () => {
    const pair = addReverseInSource(
      card('a')('\n'),
      parseCards(card('a')('\n'), 'n.md').cards[0]!,
      ids,
    );
    const reversed = parseCards(pair, 'n.md').cards[0]!;
    expect(() => addReverseInSource(pair, reversed, { reverseId: 'x', group: 'y' })).toThrow(
      /basic/,
    );
  });
  it('removes the partner and unlinks the card that stays', () => {
    const pair = addReverseInSource(
      card('a')('\n'),
      parseCards(card('a')('\n'), 'n.md').cards[0]!,
      ids,
    );
    const [a] = parseCards(pair, 'n.md').cards;
    const next = removeReverseInSource(pair, a!);
    const left = parseCards(next, 'n.md').cards;
    expect(left).toHaveLength(1);
    expect(left[0]!.reverseId).toBeUndefined();
    const broken = pair.replace('qard-reverse: a', 'qard-reverse: z');
    expect(() => removeReverseInSource(broken, parseCards(broken, 'n.md').cards[0]!)).toThrow(
      /changed/,
    );
  });
  it('finds the card covering a line, including its comment lines', () => {
    const source = 'Intro\n\n' + card('a')('\n') + '\nAfter\n';
    const cards = parseCards(source, 'n.md').cards;
    expect(cardAtLine(source, cards, 2)?.id).toBe('a');
    expect(cardAtLine(source, cards, 4)?.id).toBe('a');
    expect(cardAtLine(source, cards, 0)).toBeUndefined();
    expect(cardAtLine(source, cards, 6)).toBeUndefined();
  });
});
