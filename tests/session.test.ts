import { it, expect } from 'vitest';
import { parseCards } from '../src/cards/parser';
import { selectCards, shuffle } from '../src/review/session';
import { topicKey } from '../src/decks/deck-index';
import { scheduler, DAY } from '../src/review/scheduler';
const cards = ['Networks', 'Algorithms', 'AI'].flatMap(
  (name, i) =>
    parseCards(
      `---\nqard-deck: ${name}\n---\n# Topic\n<!-- qard-id: id-${i} -->\n> [!qard]- Question ${i}\n> Answer\n`,
      'file' + i + '.md',
    ).cards,
);
const selection = { decks: ['Networks', 'Algorithms'], topics: [], cards: [] };
it('All cards returns every selected card even when due far in the future', () => {
  const states = Object.fromEntries(
    cards.map((c) => [c.id, scheduler.reviewCard(c.id, undefined, 4, 1000)]),
  );
  expect(
    selectCards(cards, states, { selection, mode: 'all', order: 'note', now: 0 }).map((c) => c.id),
  ).toEqual(['id-1', 'id-0']);
});
it('All cards never even reads scheduling state', () => {
  const states = new Proxy(
    {},
    {
      get() {
        throw new Error('Scheduling cannot gate All');
      },
    },
  );
  expect(selectCards(cards, states, { selection, mode: 'all', order: 'note' })).toHaveLength(2);
});
it('Due filters future cards but includes unreviewed cards', () => {
  const states = { 'id-0': scheduler.reviewCard('id-0', undefined, 4, 1000) };
  expect(
    selectCards(cards, states, { selection, mode: 'due', order: 'note', now: 2000 }).map(
      (c) => c.id,
    ),
  ).toEqual(['id-1']);
  expect(
    selectCards(cards, states, { selection, mode: 'due', order: 'note', now: 5 * DAY }),
  ).toHaveLength(2);
});
it('New only includes cards without review history', () => {
  expect(
    selectCards(
      cards,
      { 'id-0': scheduler.reviewCard('id-0', undefined, 1, 0) },
      { selection, mode: 'new', order: 'note' },
    ),
  ).toHaveLength(1);
});
it('Difficult means last rated Again or Hard', () => {
  expect(
    selectCards(
      cards,
      { 'id-0': scheduler.reviewCard('id-0', undefined, 2, 0) },
      { selection, mode: 'difficult', order: 'note' },
    ).map((c) => c.id),
  ).toEqual(['id-0']);
});
it('shuffle contains exactly the same card set, without modifying input', () => {
  const before = [...cards];
  expect(new Set(shuffle(cards, () => 0.2))).toEqual(new Set(cards));
  expect(cards).toEqual(before);
});
it('topic selection and individual cards work without deck selection', () => {
  expect(
    selectCards(
      cards,
      {},
      {
        selection: { decks: [], topics: [topicKey('Networks', 'Topic')], cards: ['id-2'] },
        mode: 'all',
        order: 'note',
      },
    ).map((c) => c.id),
  ).toEqual(['id-2', 'id-0']);
});
it('overlapping deck/topic/individual selection never duplicates cards', () => {
  expect(
    selectCards(
      cards,
      {},
      {
        selection: {
          decks: ['Networks'],
          topics: [topicKey('Networks', 'Topic')],
          cards: ['id-0'],
        },
        mode: 'all',
        order: 'note',
      },
    ),
  ).toHaveLength(1);
});
it('the scheduler uses four ratings with increasing initial intervals', () => {
  const states = ([1, 2, 3, 4] as const).map((r) => scheduler.reviewCard('id', undefined, r, 1000));
  expect(states.map((s) => s.interval)).toEqual(
    [...states.map((s) => s.interval)].sort((a, b) => a - b),
  );
  expect(states[0]?.lapses).toBe(1);
  expect(states[2]?.reviewCount).toBe(1);
});
