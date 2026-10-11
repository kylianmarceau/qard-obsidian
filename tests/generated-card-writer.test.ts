import { expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardWriter } from '../src/cards/card-writer';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
function setup() {
  const texts: Record<string, string> = {},
    files = new Map<string, TFile | object>(),
    index = new CardIndex();
  const makeFile = (path: string) => new (TFile as unknown as new (path: string) => TFile)(path);
  const create = vi.fn(async (path: string, text: string) => {
    if (files.has(path)) throw new Error('Exists');
    const file = makeFile(path);
    files.set(path, file);
    texts[path] = text;
    return file;
  });
  const process = vi.fn(async (file: TFile, patch: (text: string) => string) => {
    texts[file.path] = patch(texts[file.path]!);
  });
  const refresh = vi.fn(async (file: TFile) => {
    index.update(file.path, texts[file.path]!);
  });
  Object.assign(index, { refresh });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p),
      createFolder: async (p: string) => {
        files.set(p, {});
      },
      create,
      process,
      read: async (f: TFile) => texts[f.path],
    },
  } as unknown as App;
  return {
    writer: new CardWriter(app, index as VaultIndexer),
    texts,
    files,
    index,
    refresh,
    create,
  };
}
const target = { deck: 'Networks', topic: 'Transport', folder: 'Qard', batchId: 'batch-1' };
const cards = [
  { id: 'card-1', front: 'TCP?', back: '**Reliable.**' },
  { id: 'card-2', front: 'UDP?', back: 'No delivery guarantee.' },
];
it('persists explicit variant groups and keeps them on a batch retry', async () => {
  const { writer, index, create } = setup();
  const grouped = { ...target, label: 'cloze' as const, siblingGroup: 'sentence-1' };
  await writer.createBatch(grouped, cards);
  const first = index.getSnapshot().cards;
  expect(first.map((card) => card.siblingGroup)).toEqual(['sentence-1', 'sentence-1']);
  await writer.createBatch(grouped, cards);
  expect(create).toHaveBeenCalledOnce();
  await expect(
    writer.createBatch({ ...grouped, siblingGroup: 'different' }, cards),
  ).rejects.toThrow('changed');
});
it('saves a whole batch in one note and indexes stable cards in the chosen deck and topic', async () => {
  const { writer, create, index } = setup();
  const result = await writer.createBatch(target, cards);
  expect(create).toHaveBeenCalledOnce();
  expect(result).toHaveLength(2);
  expect(new Set(result.map((c) => c.sourceFile)).size).toBe(1);
  expect(index.getSnapshot().cards.map((c) => [c.deck, c.topic, c.stable])).toEqual([
    ['Networks', 'Transport', true],
    ['Networks', 'Transport', true],
  ]);
});
it('validates the entire batch before creating any file or folder', async () => {
  const { writer, texts, files } = setup();
  await expect(writer.createBatch(target, [cards[0]!, { ...cards[1]!, back: '' }])).rejects.toThrow(
    'required',
  );
  expect(texts).toEqual({});
  expect(files.size).toBe(0);
  await expect(writer.createBatch({ ...target, topic: 'Two\nlines' }, cards)).rejects.toThrow(
    'single lines',
  );
  expect(files.size).toBe(0);
});
it('retries after an index failure without duplicating cards or creating another note', async () => {
  const { writer, refresh, create, index } = setup();
  refresh.mockRejectedValueOnce(new Error('Index temporarily unavailable'));
  await expect(writer.createBatch(target, cards)).rejects.toThrow('temporarily');
  await writer.createBatch(target, cards);
  expect(create).toHaveBeenCalledOnce();
  expect(index.getSnapshot().cards).toHaveLength(2);
});
it('adds later selections to the same generated note and preserves edits to already saved cards', async () => {
  const { writer, texts, create } = setup();
  const [first] = await writer.createBatch(target, [cards[0]!]);
  texts[first!.sourceFile] = texts[first!.sourceFile]!.replace('**Reliable.**', 'Edited answer.');
  const result = await writer.createBatch(target, cards);
  expect(create).toHaveBeenCalledOnce();
  expect(result[0]?.backMarkdown).toBe('Edited answer.');
  expect(result).toHaveLength(2);
});
it('never overwrites a generated note whose deck or Markdown boundary has changed', async () => {
  const { writer, texts } = setup();
  const [first] = await writer.createBatch(target, [cards[0]!]);
  texts[first!.sourceFile] = texts[first!.sourceFile]!.replace('"Networks"', '"Changed"');
  const before = texts[first!.sourceFile];
  await expect(writer.createBatch(target, cards)).rejects.toThrow('changed');
  expect(texts[first!.sourceFile]).toBe(before);
});
it('deletes a topic across notes while preserving other topics, decks and prose', async () => {
  const { writer, texts, index } = setup();
  const a = await writer.createBatch(target, cards);
  const b = await writer.createBatch({ ...target, batchId: 'batch-2' }, [
    { ...cards[0]!, id: 'card-3' },
  ]);
  await writer.createBatch({ ...target, topic: 'Routing', batchId: 'batch-3' }, [
    { ...cards[0]!, id: 'card-4' },
  ]);
  await writer.createBatch({ ...target, deck: 'Other', batchId: 'batch-4' }, [
    { ...cards[0]!, id: 'card-5' },
  ]);
  for (const path of [a[0]!.sourceFile, b[0]!.sourceFile]) texts[path] += '\nKeep this prose.\n';
  await writer.deleteGroup('Networks', 'Transport');
  expect(index.getSnapshot().cards.map((c) => c.id)).toEqual(['card-4', 'card-5']);
  expect(texts[a[0]!.sourceFile]).toContain('Keep this prose.');
  expect(texts[b[0]!.sourceFile]).toContain('Keep this prose.');
  await writer.deleteGroup('Networks');
  expect(index.getSnapshot().cards.map((c) => c.id)).toEqual(['card-5']);
});
it('uses current note contents and preserves a card moved out of the selected topic', async () => {
  const { writer, texts, index } = setup();
  const [a] = await writer.createBatch(target, cards);
  texts[a!.sourceFile] = texts[a!.sourceFile]!.replace('# Transport', '# Edited topic');
  await writer.deleteGroup('Networks', 'Transport');
  expect(index.getSnapshot().cards).toHaveLength(2);
  expect(index.getSnapshot().cards[0]?.topic).toBe('Edited topic');
});

it('indexes separate topics in one deck and retries a mixed-topic save without duplicates', async () => {
  const { writer, refresh, create, index } = setup();
  const mixed = [
    { ...cards[0]!, topic: 'Introduction I' },
    { ...cards[1]!, topic: 'Agent architectures' },
  ];
  refresh.mockRejectedValueOnce(new Error('Index failed after save'));
  await expect(writer.createBatch(target, mixed)).rejects.toThrow('Index failed');
  const result = await writer.createBatch(target, mixed);
  expect(create).toHaveBeenCalledOnce();
  expect(result.map((c) => [c.id, c.deck, c.topic])).toEqual([
    ['card-1', 'Networks', 'Introduction I'],
    ['card-2', 'Networks', 'Agent architectures'],
  ]);
  expect(index.getSnapshot().decks[0]?.topics.map((t) => t.name)).toEqual([
    'Introduction I',
    'Agent architectures',
  ]);
});
it('rejects an invalid individual topic before writing and detects topic changes on retry', async () => {
  const { writer, files, texts } = setup();
  await expect(writer.createBatch(target, [{ ...cards[0]!, topic: 'One\nTwo' }])).rejects.toThrow(
    'single lines',
  );
  expect(files.size).toBe(0);
  const [saved] = await writer.createBatch(target, [{ ...cards[0]!, topic: 'Introduction' }]);
  const before = texts[saved!.sourceFile];
  await expect(
    writer.createBatch(target, [{ ...cards[0]!, topic: 'Changed' }, cards[1]!]),
  ).rejects.toThrow('changed');
  expect(texts[saved!.sourceFile]).toBe(before);
});
it('appends later selections to their own topic while preserving saved answers', async () => {
  const { writer, texts, create } = setup();
  const mixed = [
    { ...cards[0]!, topic: 'TCP' },
    { ...cards[1]!, topic: 'UDP' },
  ];
  const [saved] = await writer.createBatch(target, [mixed[0]!]);
  texts[saved!.sourceFile] = texts[saved!.sourceFile]!.replace('**Reliable.**', 'Edited answer.');
  const result = await writer.createBatch(target, mixed);
  expect(create).toHaveBeenCalledOnce();
  expect(result[0]?.backMarkdown).toBe('Edited answer.');
  expect(result.map((c) => c.topic)).toEqual(['TCP', 'UDP']);
});

it('records generated sources before writing cards, and blocks creation if tracking cannot be saved', async () => {
  const { writer, create, texts } = setup();
  writer.trackSources = vi
    .fn()
    .mockRejectedValueOnce(new Error('Source metadata unavailable'))
    .mockResolvedValue(undefined);
  const versions = [{ path: 'Notes/TCP.md', text: 'TCP is reliable.' }];
  const generated = [{ ...cards[0]!, source: 'Notes/TCP.md', sourceSnapshots: versions }];
  await expect(writer.createBatch(target, generated)).rejects.toThrow('Source metadata');
  expect(create).not.toHaveBeenCalled();
  expect(texts).toEqual({});
  await writer.createBatch(target, generated);
  expect(writer.trackSources).toHaveBeenCalledWith('card-1', ['Notes/TCP.md'], versions);
  expect(create).toHaveBeenCalledOnce();
});
it('records sources for generated individual cards while leaving manual cards unlinked', async () => {
  const { writer } = setup();
  writer.trackSources = vi.fn().mockResolvedValue(undefined);
  await writer.create({
    deck: 'Networks',
    topic: 'Transport',
    folder: 'Qard',
    front: 'TCP?',
    back: 'Reliable.',
  });
  expect(writer.trackSources).not.toHaveBeenCalled();
  const created = await writer.create({
    deck: 'Networks',
    topic: 'Transport',
    folder: 'Qard',
    front: 'UDP?',
    back: 'Unreliable.',
    generatedFrom: ['Notes/UDP.md'],
    sourceSnapshots: [{ path: 'Notes/UDP.md', text: 'UDP has no delivery guarantee.' }],
  });
  expect(writer.trackSources).toHaveBeenCalledWith(
    created.id,
    ['Notes/UDP.md'],
    [{ path: 'Notes/UDP.md', text: 'UDP has no delivery guarantee.' }],
  );
});

it('saves independent cloze and image variants in one atomic note, with separate review identities', async () => {
  const { clozeFront, occlusionFront, FORMAT_BACK, readCardFormat } = await import(
    '../src/cards/card-format'
  );
  const { writer, create, index } = setup();
  const sentence = '{{c1::TCP}} is {{c2::reliable}}.';
  const masks = [
    { id: 'one', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { id: 'two', x: 0.5, y: 0.1, width: 0.2, height: 0.2 },
  ];
  const variants = [
    { id: 'cloze-1', front: clozeFront(sentence, 1), back: FORMAT_BACK },
    { id: 'cloze-2', front: clozeFront(sentence, 2), back: FORMAT_BACK },
    ...masks.map((mask) => ({
      id: 'image-' + mask.id,
      front: occlusionFront('Diagram', {
        image: 'Attachments/network.svg',
        masks,
        target: mask.id,
      }),
      back: FORMAT_BACK,
    })),
  ];
  const saved = await writer.createBatch({ ...target, label: 'cloze' }, variants);
  expect(create).toHaveBeenCalledOnce();
  expect(index.getSnapshot().issues).toEqual([]);
  expect(new Set(saved.map((c) => c.id)).size).toBe(4);
  expect(new Set(saved.map((c) => c.sourceFile)).size).toBe(1);
  const edited = await writer.edit(
    saved[0]!,
    clozeFront(sentence.replace('TCP', 'Transmission Control Protocol'), 1),
    'Notes',
  );
  expect(edited.id).toBe('cloze-1');
  expect(readCardFormat(edited.frontMarkdown).kind).toBe('cloze');
  expect(index.getSnapshot().cards.find((c) => c.id === 'cloze-2')?.frontMarkdown).toBe(
    variants[1]!.front,
  );
});
