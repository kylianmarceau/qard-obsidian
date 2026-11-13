import { expect, it } from 'vitest';
import { parseCards } from '../src/cards/parser';
import { renameGroupInSource, setFrontmatterValue } from '../src/cards/source-patch';
import { renamedDeck, topicKey } from '../src/decks/deck-index';
import { ReviewStore } from '../src/review/review-store';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const card = (id: string, front: string, back: string) =>
  `<!-- qard-id: ${id} -->\n> [!qard]- ${front}\n> ${back}\n`;
const placement = (source: string, path: string) =>
  parseCards(source, path).cards.map((c) => [c.id, c.deck, c.topic]);
/** Every callout survives byte-for-byte. */
const callouts = (source: string, path: string) =>
  parseCards(source, path).cards.map((c) =>
    source.slice(c.sourcePosition.calloutStart, c.sourcePosition.end),
  );

it('renames a deck named after its note by adding qard-deck, leaving the cards intact', () => {
  const source = `Intro prose.\n\n# Transport\n${card('a', 'TCP?', 'Reliable.')}`;
  const next = renameGroupInSource(source, 'Networks.md', {
    deck: 'Networks',
    to: 'Computer networks',
  });
  expect(next).toBe(`---\nqard-deck: "Computer networks"\n---\n${source}`);
  expect(placement(next, 'Networks.md')).toEqual([['a', 'Computer networks', 'Transport']]);
  expect(callouts(next, 'Networks.md')).toEqual(callouts(source, 'Networks.md'));
});

it('replaces an existing qard-deck and keeps the other frontmatter lines', () => {
  const source = `---\ntags: [net]\nqard-deck: Old\naliases: x\n---\n${card('a', 'Q', 'A')}`;
  const next = renameGroupInSource(source, 'n.md', { deck: 'Old', to: 'New' });
  expect(next).toBe(`---\ntags: [net]\nqard-deck: "New"\naliases: x\n---\n${card('a', 'Q', 'A')}`);
});

it('moves subdecks with their parent, including cards with their own location', () => {
  const source =
    `---\nqard-deck: Bio::Cells\n---\n${card('a', 'Q1', 'A1')}\n` +
    `<!-- qard-location: {"deck":"Bio::Genes","topic":"DNA"} -->\n${card('b', 'Q2', 'A2')}\n` +
    `<!-- qard-location: {"deck":"Chemistry","topic":"Acids"} -->\n${card('c', 'Q3', 'A3')}`;
  const next = renameGroupInSource(source, 'n.md', { deck: 'Bio', to: 'Biology' });
  expect(placement(next, 'n.md')).toEqual([
    ['a', 'Biology::Cells', 'General'],
    ['b', 'Biology::Genes', 'DNA'],
    ['c', 'Chemistry', 'Acids'],
  ]);
  expect(renamedDeck('Bio :: Genes', 'Bio', 'Biology')).toBe('Biology::Genes');
  expect(renamedDeck('Biology', 'Bio', 'X')).toBeUndefined();
});

it('renames a topic by its heading and leaves other headings alone', () => {
  const source = `# Transport\n${card('a', 'TCP?', 'Reliable.')}\n## Network ##\n${card('b', 'IP?', 'Routing.')}`;
  const next = renameGroupInSource(source, 'Net.md', {
    deck: 'Net',
    topic: 'Network',
    to: 'Layer 3',
  });
  expect(next).toBe(
    `# Transport\n${card('a', 'TCP?', 'Reliable.')}\n## Layer 3 ##\n${card('b', 'IP?', 'Routing.')}`,
  );
  expect(placement(next, 'Net.md')).toEqual([
    ['a', 'Net', 'Transport'],
    ['b', 'Net', 'Layer 3'],
  ]);
});

it('renames setext headings and a fixed qard-topic', () => {
  const setext = `Transport\n=========\n${card('a', 'Q', 'A')}`;
  expect(renameGroupInSource(setext, 'Net.md', { deck: 'Net', topic: 'Transport', to: 'L4' })).toBe(
    `L4\n=========\n${card('a', 'Q', 'A')}`,
  );
  const fixed = `---\nqard-topic: Old\n---\n# Heading\n${card('a', 'Q', 'A')}`;
  const next = renameGroupInSource(fixed, 'Net.md', { deck: 'Net', topic: 'Old', to: 'New' });
  expect(next).toBe(`---\nqard-topic: "New"\n---\n# Heading\n${card('a', 'Q', 'A')}`);
});

it('gives cards before any heading their own location, since there is no heading to rename', () => {
  const source = `${card('a', 'Q1', 'A1')}\n# Later\n${card('b', 'Q2', 'A2')}`;
  const next = renameGroupInSource(source, 'Net.md', {
    deck: 'Net',
    topic: 'General',
    to: 'Basics',
  });
  expect(placement(next, 'Net.md')).toEqual([
    ['a', 'Net', 'Basics'],
    ['b', 'Net', 'Later'],
  ]);
  expect(next).toContain('<!-- qard-location: {"deck":"Net","topic":"Basics"} -->');
  expect(callouts(next, 'Net.md')).toEqual(callouts(source, 'Net.md'));
});

it('leaves notes without the deck or topic untouched and rejects invalid names', () => {
  const source = `# T\n${card('a', 'Q', 'A')}`;
  expect(renameGroupInSource(source, 'Other.md', { deck: 'Net', to: 'X' })).toBe(source);
  expect(() => renameGroupInSource(source, 'Net.md', { deck: 'Net', to: 'two\nlines' })).toThrow();
  expect(setFrontmatterValue('\r\nbody', 'qard-deck', 'D')).toBe(
    '---\r\nqard-deck: "D"\r\n---\r\n\r\nbody',
  );
});

it('carries deck options and exam plans across a rename', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings({
    ...DEFAULT_SETTINGS,
    deckOptions: {
      Bio: { newCardsPerDay: 5, icon: 'terminal', color: '#123456' },
      'Bio::Cells': { newCardsPerDay: 2, icon: 'network', color: '#abcdef' },
      Other: { newCardsPerDay: 1 },
    },
  });
  await store.saveExam({
    id: 'exam-1',
    name: 'Final',
    date: '2030-01-10',
    selection: { decks: ['Bio::Cells'], topics: [topicKey('Bio', 'Intro')], cards: [] },
    weekdays: [1],
    dailyLimit: 10,
    createdAt: 1,
  });
  await store.renameGroup({ deck: 'Bio', to: 'Biology' });
  expect(store.getSnapshot().settings.deckOptions).toEqual({
    Biology: { newCardsPerDay: 5, icon: 'terminal', color: '#123456' },
    'Biology::Cells': { newCardsPerDay: 2, icon: 'network', color: '#abcdef' },
    Other: { newCardsPerDay: 1 },
  });
  await store.renameGroup({ deck: 'Biology', topic: 'Intro', to: 'Overview' });
  expect(store.getSnapshot().exams[0]!.selection).toEqual({
    decks: ['Biology::Cells'],
    topics: [topicKey('Biology', 'Overview')],
    cards: [],
  });
});
