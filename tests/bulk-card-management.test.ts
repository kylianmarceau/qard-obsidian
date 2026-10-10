import { expect, it, vi } from 'vitest';
import { transferFixture } from './transfer-fixture';
import { CardWriter } from '../src/cards/card-writer';
import type { VaultIndexer } from '../src/cards/indexer';
import { parseCards, topicAtLine, locationAtLine } from '../src/cards/parser';
import { serializeCard, replaceCardInSource, deleteCardInSource } from '../src/cards/source-patch';
import { ReviewStore } from '../src/review/review-store';
import { clozeFront, FORMAT_BACK } from '../src/cards/card-format';
import { matchesSearch } from '../src/decks/deck-index';

async function setup(sources: Record<string, string>) {
  const f = transferFixture();
  const process = vi.fn(async (file: { path: string }, transform: (text: string) => string) => {
    f.texts[file.path] = transform(f.texts[file.path]!);
  });
  Object.assign(f.app.vault, { process });
  for (const [path, source] of Object.entries(sources)) {
    await f.refresh(await f.create(path, source));
  }
  return { ...f, process, writer: new CardWriter(f.app, f.index as VaultIndexer) };
}
const source = (id: string) =>
  `---\nqard-deck: Networks\nqard-topic: Fixed\ntags: [networking]\n---\n\nProse stays.\n\n${serializeCard(id, '![[./diagram.png]]\nTCP?', '**Reliable**, ordered.')}\nAfterword stays.\n`;
it('moves only selected cards in place, keeping IDs, attachments, tags, callouts and neighbouring prose intact', async () => {
  const text = source('a') + '\n' + serializeCard('b', 'UDP?', 'Datagrams.'),
    f = await setup({ 'Notes/Transport.md': text });
  const [a, b] = f.index.getSnapshot().cards;
  const body = text.slice(a!.sourcePosition.calloutStart, a!.sourcePosition.end);
  const moved = await f.writer.move([a!], { deck: 'Revision', topic: 'Protocols' });
  expect(moved[0]).toMatchObject({
    id: 'a',
    deck: 'Revision',
    topic: 'Protocols',
    sourceFile: 'Notes/Transport.md',
    tags: ['networking'],
    frontMarkdown: a!.frontMarkdown,
    backMarkdown: a!.backMarkdown,
  });
  const next = f.texts['Notes/Transport.md']!;
  expect(next.slice(moved[0]!.sourcePosition.calloutStart, moved[0]!.sourcePosition.end)).toBe(
    body,
  );
  expect(next).toContain('Prose stays.');
  expect(next).toContain('Afterword stays.');
  expect(f.index.getSnapshot().cards.find((c) => c.id === b!.id)).toMatchObject({
    deck: 'Networks',
    topic: 'Fixed',
  });
  expect(topicAtLine(next, 'Notes/Transport.md', moved[0]!.sourcePosition.line)).toBe('Protocols');
  expect(locationAtLine(next, 'Notes/Transport.md', moved[0]!.sourcePosition.line)).toEqual({
    deck: 'Revision',
    topic: 'Protocols',
  });
  expect(locationAtLine(next, 'Notes/Transport.md', 0)).toEqual({
    deck: 'Networks',
    topic: 'Fixed',
  });
  expect(
    topicAtLine(
      next,
      'Notes/Transport.md',
      f.index.getSnapshot().cards.find((c) => c.id === 'b')!.sourcePosition.line,
    ),
  ).toBe('Fixed');
  expect(f.process).toHaveBeenCalledOnce();
  expect(f.create).toHaveBeenCalledOnce();
});
it('preserves placement through later edits, splits and deletion and safely encodes comment boundaries', async () => {
  const f = await setup({ 'a.md': source('a') });
  const [moved] = await f.writer.move(f.index.getSnapshot().cards, {
    deck: 'A --> < B',
    topic: '# Symbols',
  });
  const edited = await f.writer.edit(moved!, 'Changed?', 'New answer.');
  expect(edited).toMatchObject({ deck: 'A --> < B', topic: '# Symbols', id: 'a' });
  const split = await f.writer.insertSplit(edited, [
    { id: 'new1', front: 'One?', back: 'First.' },
    { id: 'new2', front: 'Two?', back: 'Second.' },
  ]);
  expect(split.every((c) => c.deck === edited.deck && c.topic === edited.topic)).toBe(true);
  const deleted = deleteCardInSource(f.texts['a.md']!, edited);
  expect(parseCards(deleted, 'a.md').cards.map((c) => c.id)).toEqual(['new1', 'new2']);
  expect(deleted.match(/qard-location:/g)).toHaveLength(2);
});
it('moves handwritten cloze siblings with persistent IDs and preserves sibling separation', async () => {
  const text = '{{c1::TCP}} is {{c2::reliable}}.';
  const original = [1, 2]
    .map((target) =>
      serializeCard(`id${target}`, clozeFront(text, target), FORMAT_BACK).replace(
        /<!-- qard-id: .+ -->\n/,
        '',
      ),
    )
    .join('\n');
  const f = await setup({ 'a.md': original });
  const moved = await f.writer.move(f.index.getSnapshot().cards, {
    deck: 'Revision',
    topic: 'Transport',
  });
  expect(moved.every((c) => c.stable)).toBe(true);
  expect(moved[0]?.siblingGroup).toBeTruthy();
  expect(moved[0]?.siblingGroup).toBe(moved[1]?.siblingGroup);
  expect(moved.map((c) => c.frontMarkdown)).toEqual(
    parseCards(original, 'a.md').cards.map((c) => c.frontMarkdown),
  );
});
it('validates the whole selection before writing, blocks ambiguous IDs and refuses changed cards', async () => {
  const f = await setup({ 'a.md': source('a'), 'b.md': source('b') });
  const cards = f.index.getSnapshot().cards;
  f.texts['b.md'] = source('b').replace('ordered', 'Changed');
  await expect(f.writer.move(cards, { deck: 'Revision', topic: 'Transport' })).rejects.toThrow(
    'changed',
  );
  expect(f.process).not.toHaveBeenCalled();
  await expect(f.writer.move(cards, { deck: '', topic: 'Transport' })).rejects.toThrow('names');
  expect(f.process).not.toHaveBeenCalled();
  f.index.update('copy.md', source('a'));
  await expect(
    f.writer.move([cards[0]!], { deck: 'Revision', topic: 'Transport' }),
  ).rejects.toThrow('more than one');
});
it('reports partial progress after a save failure without losing cards or rewriting the failed note', async () => {
  const f = await setup({ 'a.md': source('a'), 'b.md': source('b') });
  f.process
    .mockImplementationOnce(async (file, transform) => {
      f.texts[file.path] = transform(f.texts[file.path]!);
    })
    .mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(
    f.writer.move(f.index.getSnapshot().cards, { deck: 'Revision', topic: 'Transport' }),
  ).rejects.toThrow('1 of 2 cards moved');
  expect(parseCards(f.texts['a.md']!, 'a.md').cards[0]?.deck).toBe('Revision');
  expect(f.texts['b.md']).toBe(source('b'));
  expect(f.index.getSnapshot().cards).toHaveLength(2);
  await f.writer.move(
    f.index.getSnapshot().cards.filter((c) => c.deck === 'Networks'),
    { deck: 'Revision', topic: 'Transport' },
  );
  expect(f.index.getSnapshot().cards.every((c) => c.deck === 'Revision')).toBe(true);
});
it('replaces a placement override without accumulating comments and respects CRLF', async () => {
  const f = await setup({ 'a.md': source('a').replace(/\n/g, '\r\n') });
  let cards = await f.writer.move(f.index.getSnapshot().cards, { deck: 'One', topic: 'First' });
  cards = await f.writer.move(cards, { deck: 'Two', topic: 'Second' });
  expect(f.texts['a.md']!.match(/qard-location:/g)).toHaveLength(1);
  expect(f.texts['a.md']).not.toMatch(/(?<!\r)\n/);
  expect(cards[0]?.deck).toBe('Two');
  expect(replaceCardInSource(f.texts['a.md']!, cards[0]!, 'Edited?', 'Answer', 'a')).toContain(
    '"deck":"Two"',
  );
});
it('rejects malformed location metadata instead of indexing a card in the wrong deck', () => {
  const result = parseCards(
    '<!-- qard-location: {"deck":"A"} -->\n' + serializeCard('a', 'Q?', 'A.'),
    'a.md',
  );
  expect(result.cards).toEqual([]);
  expect(result.issues[0]?.message).toContain('override');
});
it('matches answer-only words alongside deck, topic and tag search terms', () => {
  const [card] = parseCards(source('a'), 'a.md').cards;
  expect(matchesSearch(card!, 'ordered #networking')).toBe(true);
  expect(matchesSearch(card!, 'notpresent')).toBe(false);
});
it('persists pause, resume and repair together without changing memory, histories or statistics', async () => {
  const persist = vi.fn(async () => {}),
    store = new ReviewStore(persist);
  await store.review('a', 3, new Date(2026, 9, 1).getTime());
  await store.review('b', 1, new Date(2026, 9, 1).getTime());
  const before = store.getSnapshot();
  persist.mockClear();
  await store.updateCards(['a', 'b'], 'pause');
  expect(persist).toHaveBeenCalledOnce();
  const paused = store.getSnapshot();
  for (const id of ['a', 'b']) {
    expect(paused.states[id]).toEqual({ ...before.states[id], paused: true });
  }
  expect(paused.history).toBe(before.history);
  expect(paused.statistics).toBe(before.statistics);
  await store.updateCards(['a', 'b'], 'resume');
  expect(store.getSnapshot().states).toEqual(before.states);
  await store.updateCards(['a', 'b'], 'repair');
  for (const id of ['a', 'b']) {
    expect(store.getSnapshot().states[id]).toEqual({ ...before.states[id], needsFixing: true });
  }
});
it('keeps the entire selection unchanged on metadata persistence failure and rejects invalid IDs', async () => {
  const persist = vi.fn(async () => {}),
    store = new ReviewStore(persist);
  await store.review('a', 3);
  const before = store.getSnapshot();
  persist.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(store.updateCards(['a', 'b'], 'pause')).rejects.toThrow('Disk unavailable');
  expect(store.getSnapshot()).toBe(before);
  await expect(store.updateCards(['a', 'volatile:path'], 'repair')).rejects.toThrow('valid card');
  expect(store.getSnapshot()).toBe(before);
});
it('removes paused cards from saved learning queues without advancing other cards or changing due dates', async () => {
  const store = new ReviewStore(async () => {});
  const cards = parseCards(
    serializeCard('a', 'Q?', 'A') + serializeCard('b', 'R?', 'B'),
    'a.md',
  ).cards;
  const session = await store.startSession(cards, 'normal', undefined, 'due');
  await store.review('a', 1, Date.now(), { id: session.id, position: 0 });
  const before = store.getSnapshot();
  expect(before.sessions[0]?.learning?.[0]?.cardId).toBe('a');
  await store.updateCards(['a'], 'pause');
  expect(store.getSnapshot().sessions[0]?.learning).toEqual([]);
  expect(store.getSnapshot().sessions[0]?.position).toBe(before.sessions[0]?.position);
  expect(store.getSnapshot().states.a?.due).toBe(before.states.a?.due);
  expect(store.getSnapshot().history).toBe(before.history);
});
