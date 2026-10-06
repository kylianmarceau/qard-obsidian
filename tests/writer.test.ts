import { expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardWriter } from '../src/cards/card-writer';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
function setup(source: string, cachedDeck = 'Networks') {
  const file = new (TFile as unknown as new (path: string) => TFile)('a.md');
  let text = source;
  const index = new CardIndex();
  index.update(file.path, source);
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: async () => text,
      process: async (_file: unknown, transform: (s: string) => string) => {
        text = transform(text);
      },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: { 'qard-deck': cachedDeck } }) },
  } as unknown as App;
  Object.assign(index, { refresh: async () => index.update(file.path, text) });
  return { writer: new CardWriter(app, index as VaultIndexer), read: () => text };
}
const draft = {
  deck: 'Networks',
  topic: 'Transport',
  front: 'TCP?',
  back: '**Reliable**',
  sourceFile: 'a.md',
  folder: 'Qard',
};
it('appends through an atomic vault operation while preserving the original note', async () => {
  const source = '---\nqard-deck: Networks\n---\n\nOriginal prose.\n';
  const { writer, read } = setup(source);
  const card = await writer.create(draft);
  expect(read().startsWith(source)).toBe(true);
  expect(card.stable).toBe(true);
  expect(card.backMarkdown).toBe('**Reliable**');
});
it('does not mutate a note with an unfinished fenced block', async () => {
  const source = '---\nqard-deck: Networks\n---\n```md\nunfinished';
  const { writer, read } = setup(source);
  await expect(writer.create(draft)).rejects.toThrow('unfinished');
  expect(read()).toBe(source);
});
it('does not write to a different deck when cached metadata is stale', async () => {
  const source = '---\nqard-deck: Changed\n---\n';
  const { writer, read } = setup(source);
  await expect(writer.create(draft)).rejects.toThrow('changed');
  expect(read()).toBe(source);
});
