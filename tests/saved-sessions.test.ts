import { expect, it, vi } from 'vitest';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import { readSessions } from '../src/review/saved-session';
const cards = ['a', 'b', 'c'].map(
  (id) =>
    parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer`, 'deck.md').cards[0]!,
);
it('persists exact shuffled order and advances rating and cursor atomically across a restart', async () => {
  const write = vi.fn(async () => {}),
    store = new ReviewStore(write);
  const session = await store.startSession([cards[2]!, cards[0]!, cards[1]!]);
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.review('c', 3, 1000, { id: session.id, position: 0 })).rejects.toThrow(
    'disk full',
  );
  expect(store.getSnapshot().history).toHaveLength(0);
  expect(store.getSnapshot().sessions[0]!.position).toBe(0);
  await store.review('c', 3, 1000, { id: session.id, position: 0 });
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  const resumed = await restored.resumeSession(session.id, cards.slice().reverse());
  expect(resumed.cards.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  expect(resumed.session.position).toBe(1);
  expect(resumed.session.results).toEqual([{ cardId: 'c', rating: 3 }]);
  expect(JSON.stringify(restored.getSnapshot().sessions)).not.toMatch(
    /frontMarkdown|backMarkdown|sourceText/,
  );
});
it('rejects duplicate advancement from another view without double rating', async () => {
  const store = new ReviewStore(async () => {}),
    session = await store.startSession(cards);
  const results = await Promise.allSettled([
    store.review('a', 3, 1000, { id: session.id, position: 0 }),
    store.review('a', 4, 1000, { id: session.id, position: 0 }),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(store.getSnapshot().history).toHaveLength(1);
});
it('resolves edits and skips deleted or ambiguous cards while keeping the next available position', async () => {
  const store = new ReviewStore(async () => {}),
    session = await store.startSession(cards);
  await store.review('a', 3, 1000, { id: session.id, position: 0 });
  const result = await store.resumeSession(session.id, [
    { ...cards[1]!, duplicateId: true },
    { ...cards[2]!, frontMarkdown: 'Edited', sourceFile: 'renamed.md' },
  ]);
  expect(result.skipped).toBe(2);
  expect(result.session.position).toBe(0);
  expect(result.cards[0]!.frontMarkdown).toBe('Edited');
  await store.review('c', 4, 2000, { id: session.id, position: 0 });
  expect(store.getSnapshot().sessions).toEqual([]);
  expect(store.getSnapshot().history).toHaveLength(2);
});
it('persists cram positions without modifying ratings or schedules; failed saves do not advance', async () => {
  const write = vi.fn(async () => {}),
    store = new ReviewStore(write),
    session = await store.startSession(cards, 'cram');
  const before = store.getSnapshot();
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.advanceCram({ id: session.id, position: 0 }, 'a')).rejects.toThrow(
    'disk full',
  );
  expect(store.getSnapshot()).toBe(before);
  await store.advanceCram({ id: session.id, position: 0 }, 'a');
  const restored = new ReviewStore(async () => {});
  restored.load(JSON.parse(JSON.stringify(store.getSnapshot())));
  expect(restored.getSnapshot().sessions[0]!.position).toBe(1);
  expect(restored.getSnapshot().sessions[0]!.style).toBe('cram');
  expect(store.getSnapshot().states).toBe(before.states);
  expect(store.getSnapshot().history).toBe(before.history);
});
it('keeps multiple sessions independently and discards only their queues', async () => {
  const store = new ReviewStore(async () => {}),
    first = await store.startSession(cards),
    second = await store.startSession(cards, 'cram');
  await store.review('a', 3, 1000, { id: first.id, position: 0 });
  await store.discardSession(first.id);
  expect(store.getSnapshot().sessions.map((s) => s.id)).toEqual([second.id]);
  expect(store.getSnapshot().history).toHaveLength(1);
});
it('cleans up an entirely missing remaining queue and rejects malformed persisted sessions', async () => {
  const store = new ReviewStore(async () => {}),
    session = await store.startSession(cards);
  const result = await store.resumeSession(session.id, []);
  expect(result.cards).toEqual([]);
  expect(store.getSnapshot().sessions).toEqual([]);
  expect(
    readSessions([
      null,
      { ...session, position: -1 },
      { ...session, cardIds: ['x', 'x'] },
      { ...session, results: [null] },
    ]),
  ).toEqual([]);
  expect(readSessions([session, session])).toHaveLength(1);
});
