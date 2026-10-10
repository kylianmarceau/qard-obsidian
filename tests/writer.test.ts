import { expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardWriter } from '../src/cards/card-writer';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { clozeFront, FORMAT_BACK } from '../src/cards/card-format';
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

it('assigns IDs and persists legacy sibling groups before a variant is edited', async () => {
  const text = '{{c1::TCP}} provides {{c2::reliability}}.';
  const source =
    'Prose.\n\n' +
    [1, 2]
      .map((target) =>
        serializeCard(`c${target}`, clozeFront(text, target), FORMAT_BACK).replace(
          /<!-- qard-id: .+ -->\n/,
          '',
        ),
      )
      .join('\n');
  const { writer, read } = setup(source);
  const stable = await writer.ensureStable(parseCards(source, 'a.md').cards);
  expect(stable.every((c) => c.stable && c.siblingGroup)).toBe(true);
  expect(stable[0]?.siblingGroup).toBe(stable[1]?.siblingGroup);
  const edited = await writer.edit(
    stable[0]!,
    clozeFront('{{c1::TCP}} is a transport protocol.', 1),
    'Explanation',
  );
  expect(edited.id).toBe(stable[0]?.id);
  expect(edited.siblingGroup).toBe(stable[1]?.siblingGroup);
  expect(read().startsWith('Prose.\n\n')).toBe(true);
});

it('creates a linked basic pair atomically and editing either direction updates both identities', async () => {
  const original = '---\r\nqard-deck: Networks\r\n---\r\n\r\nOriginal prose.\r\n';
  const { writer, read } = setup(original);
  const forward = await writer.create({ ...draft, reverse: true });
  const pair = parseCards(read(), 'a.md').cards;
  expect(pair).toHaveLength(2);
  const reverse = pair.find((card) => card.id === forward.reverseId)!;
  expect(reverse.reverseId).toBe(forward.id);
  expect(reverse.siblingGroup).toBe(forward.siblingGroup);
  expect(reverse.frontMarkdown).toBe(forward.backMarkdown);
  expect(reverse.backMarkdown).toBe(forward.frontMarkdown);
  expect(read().startsWith(original)).toBe(true);
  expect(read().replace(/\r\n/g, '')).not.toContain('\n');
  await writer.edit(reverse, 'Reliable delivery', 'TCP transport');
  const changed = parseCards(read(), 'a.md').cards;
  expect(changed.map((card) => card.id)).toEqual(pair.map((card) => card.id));
  expect(changed[0]).toMatchObject({
    frontMarkdown: 'TCP transport',
    backMarkdown: 'Reliable delivery',
    reverseId: reverse.id,
  });
  expect(changed[1]).toMatchObject({
    frontMarkdown: 'Reliable delivery',
    backMarkdown: 'TCP transport',
    reverseId: forward.id,
  });
  await expect(writer.edit(forward, 'Stale', 'Answer')).rejects.toThrow(/changed/);
});

it('does not write half a reverse pair when the opposite content cannot be safely serialized', async () => {
  const source = '---\nqard-deck: Networks\n---\nProse.\n';
  const { writer, read } = setup(source);
  await expect(
    writer.create({ ...draft, reverse: true, back: '```md\nUnfinished fence' }),
  ).rejects.toThrow();
  expect(read()).toBe(source);
});
