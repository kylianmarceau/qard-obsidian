import { expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardIndex } from '../src/cards/card-index';
import { CardWriter } from '../src/cards/card-writer';
import type { VaultIndexer } from '../src/cards/indexer';

const note = (id: string, deck = 'Networks') => `---\nqard-deck: ${deck}\n---\n\n# Topic\nKeep this prose.  \n\n<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer\n\nKeep this too.\n`;
function setup() {
  const sources = new Map([['a.md', note('a')], ['b.md', note('b').replace(/\n/g, '\r\n')], ['c.md', note('c', 'Other')]]);
  const files = new Map([...sources.keys()].map(path => [path, new (TFile as unknown as new (p: string) => TFile)(path)]));
  const index = new CardIndex(); sources.forEach((source, path) => index.update(path, source));
  const process = vi.fn(async (file: TFile, patch: (source: string) => string) => { sources.set(file.path, patch(sources.get(file.path)!)); });
  const app = { vault: { getAbstractFileByPath: (path: string) => files.get(path), read: async (file: TFile) => sources.get(file.path)!, process } } as unknown as App;
  Object.assign(index, { refresh: async (file: TFile) => index.update(file.path, sources.get(file.path)!) });
  return { sources, index, process, writer: new CardWriter(app, index as VaultIndexer), cards: index.getSnapshot().decks.find(deck => deck.name === 'Networks')!.cards };
}
it('removes the entire multi-file deck, preserving other notes, prose, headings and line endings', async () => {
  const { sources, index, writer, cards, process } = setup();
  const before = new Map(sources);
  await writer.deleteDeck('Networks', cards);
  expect(process).toHaveBeenCalledTimes(2);
  for (const card of cards) {
    const source = before.get(card.sourceFile)!;
    expect(sources.get(card.sourceFile)).toBe(source.slice(0, card.sourcePosition.start) + source.slice(card.sourcePosition.end));
  }
  expect(sources.get('c.md')).toBe(before.get('c.md'));
  expect(index.getSnapshot().decks.map(deck => deck.name)).toEqual(['Other']);
});
it('preflights all files so a stale card prevents every write', async () => {
  const { sources, writer, cards, process } = setup();
  sources.set('b.md', sources.get('b.md')!.replace('Answer', 'Edited answer'));
  await expect(writer.deleteDeck('Networks', cards)).rejects.toThrow(/changed/);
  expect(process).not.toHaveBeenCalled();
});
it('removes multiple cards in one atomic note edit, including handwritten cards', async () => {
  const { sources, index, writer, process } = setup();
  const source = sources.get('a.md')! + '\n# More notes\n\n> [!qard]- Handwritten\n> Answer\n\nFinal prose.\n';
  sources.set('a.md', source); index.update('a.md', source);
  const cards = index.getSnapshot().decks.find(deck => deck.name === 'Networks')!.cards;
  await writer.deleteDeck('Networks', cards);
  expect(process.mock.calls.filter(([file]) => file.path === 'a.md')).toHaveLength(1);
  expect(sources.get('a.md')).toContain('# More notes\n\n\nFinal prose.');
  expect(sources.get('a.md')).not.toContain('[!qard]');
});
it('rejects a filtered subset rather than silently deleting part of a deck in a note', async () => {
  const { sources, writer, cards, process } = setup();
  sources.set('a.md', sources.get('a.md')! + '\n> [!qard]- Added card\n> Answer\n');
  await expect(writer.deleteDeck('Networks', cards)).rejects.toThrow(/changed/);
  expect(process).not.toHaveBeenCalled();
});
it('rechecks inside the atomic write and reports any completed deletions on failure', async () => {
  const { sources, writer, cards, process, index } = setup();
  process.mockImplementation(async (file, patch) => {
    if (file.path === 'b.md') sources.set(file.path, sources.get(file.path)!.replace('Answer', 'Concurrent answer'));
    sources.set(file.path, patch(sources.get(file.path)!));
  });
  await expect(writer.deleteDeck('Networks', cards)).rejects.toThrow(/1 card was deleted before deletion stopped/);
  expect(sources.get('b.md')).toContain('Concurrent answer');
  expect(index.getSnapshot().cards.filter(card => card.deck === 'Networks')).toHaveLength(1);
});
