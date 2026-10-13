import { afterEach, expect, it, vi } from 'vitest';
import { defaultDeck, locationAtLine, parseCards, setDeckNaming } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import {
  buildDecks,
  buildDeckTree,
  canonicalDeck,
  deckLineage,
  isWithinDeck,
} from '../src/decks/deck-index';
import { deckLimits, deckRetention, withDeckOptions } from '../src/decks/deck-options';
import { reviewWithFsrs } from '../src/review/fsrs-scheduler';
import { clip, DEFAULT_PARAMETERS } from '../src/review/fsrs-optimizer';
import { introductionsToday, limitsNewCards, newAllowance, paceCards } from '../src/review/pacing';
import { ReviewStore } from '../src/review/review-store';
import { readSettings, type QardSettings } from '../src/settings/settings';

afterEach(() => {
  setDeckNaming('note');
  vi.useRealTimers();
});
const now = new Date(2026, 9, 10, 12).getTime();
const card = (id: string, deck: string) =>
  parseCards(
    `---\nqard-deck: ${JSON.stringify(deck)}\n---\n\n${serializeCard(id, id, 'Answer')}`,
    `${id}.md`,
  ).cards[0]!;
const settings = (deckOptions: QardSettings['deckOptions'], extra: Partial<QardSettings> = {}) =>
  readSettings({ scheduler: 'fsrs', deckOptions, ...extra });

it('reads nesting from deck names and tolerates spacing around the separator', () => {
  expect(deckLineage('Biology :: Cells::Mitosis')).toEqual([
    'Biology::Cells::Mitosis',
    'Biology::Cells',
    'Biology',
  ]);
  expect(canonicalDeck(' Biology ::Cells ')).toBe('Biology::Cells');
  expect(isWithinDeck('Biology::Cells', 'Biology')).toBe(true);
  expect(isWithinDeck('Biology', 'Biology')).toBe(true);
  // A shared prefix is not a parent.
  expect(isWithinDeck('Biology 2::Cells', 'Biology')).toBe(false);
  expect(isWithinDeck('Biology', 'Biology::Cells')).toBe(false);
});

it('groups decks under parents, adding up cards and creating parents that have no cards', () => {
  const decks = buildDecks([
    card('a', 'Biology::Cells'),
    card('b', 'Biology::Cells'),
    card('c', 'Biology::Genetics::DNA'),
    card('d', 'Biology'),
    card('e', 'Chemistry'),
  ]);
  const tree = buildDeckTree(decks);
  expect(tree.map((node) => [node.name, node.cards, !!node.deck])).toEqual([
    ['Biology', 4, true],
    ['Chemistry', 1, true],
  ]);
  const biology = tree[0]!;
  expect(biology.decks.sort()).toEqual(['Biology', 'Biology::Cells', 'Biology::Genetics::DNA']);
  expect(biology.children.map((node) => [node.label, node.cards, !!node.deck])).toEqual([
    ['Cells', 2, true],
    ['Genetics', 1, false],
  ]);
  expect(biology.children[1]!.children[0]).toMatchObject({
    name: 'Biology::Genetics::DNA',
    label: 'DNA',
    cards: 1,
  });
  // Decks without the separator are a flat list, exactly as before.
  expect(buildDeckTree(buildDecks([card('x', 'Maths'), card('y', 'Art')]))).toMatchObject([
    { name: 'Art', children: [] },
    { name: 'Maths', children: [] },
  ]);
});

it('names decks after notes by default and after folders only when asked', () => {
  const source = serializeCard('a', 'Q', 'A');
  expect(parseCards(source, 'Courses/Networks/tcp.md').cards[0]!.deck).toBe('tcp');
  expect(defaultDeck('Courses/Networks/tcp.md')).toBe('tcp');
  setDeckNaming('folder');
  expect(parseCards(source, 'Courses/Networks/tcp.md').cards[0]!.deck).toBe('Courses::Networks');
  expect(locationAtLine(source, 'Courses/Networks/tcp.md', 0).deck).toBe('Courses::Networks');
  // Root notes have no folder to be named after.
  expect(parseCards(source, 'tcp.md').cards[0]!.deck).toBe('tcp');
  // An explicit deck and a moved card always win.
  expect(
    parseCards(`---\nqard-deck: Exam\n---\n\n${source}`, 'Courses/Networks/tcp.md').cards[0]!.deck,
  ).toBe('Exam');
  expect(readSettings({ deckNaming: 'folder' }).deckNaming).toBe('folder');
  expect(readSettings({ deckNaming: 'tags' }).deckNaming).toBe('note');
});

it('inherits target retention from the nearest deck above and stacks daily limits', () => {
  const s = settings(
    {
      Biology: { desiredRetention: 0.85, newCardsPerDay: 10 },
      'Biology::Cells': { newCardsPerDay: 3 },
      'Biology::Cells::Mitosis': { desiredRetention: 0.95 },
    },
    { desiredRetention: 0.9 },
  );
  expect(deckRetention(s, 'Chemistry')).toEqual({ value: 0.9 });
  expect(deckRetention(s)).toEqual({ value: 0.9 });
  expect(deckRetention(s, 'Biology::Cells')).toEqual({ value: 0.85, from: 'Biology' });
  expect(deckRetention(s, 'Biology :: Cells :: Mitosis')).toEqual({
    value: 0.95,
    from: 'Biology::Cells::Mitosis',
  });
  expect(deckLimits(s, 'Biology::Cells::Mitosis')).toEqual([
    { deck: 'Biology::Cells', limit: 3 },
    { deck: 'Biology', limit: 10 },
  ]);
  expect(deckLimits(s, 'Chemistry')).toEqual([]);
});

it('saves only valid deck options and removes a deck with nothing set', () => {
  expect(
    readSettings({
      deckOptions: {
        A: { desiredRetention: 0.5, newCardsPerDay: 0 },
        B: { desiredRetention: 0.8, newCardsPerDay: 2.5 },
        C: { newCardsPerDay: 7 },
        '': { newCardsPerDay: 7 },
      },
    }).deckOptions,
  ).toEqual({ B: { desiredRetention: 0.8 }, C: { newCardsPerDay: 7 } });
  expect(readSettings({ deckOptions: [1] }).deckOptions).toEqual({});
  const all = withDeckOptions({}, ' A :: B ', { desiredRetention: 0.8, newCardsPerDay: 5 });
  expect(all).toEqual({ 'A::B': { desiredRetention: 0.8, newCardsPerDay: 5 } });
  expect(withDeckOptions(all, 'A::B', {})).toEqual({});
  expect(limitsNewCards(settings(all))).toBe(true);
  expect(limitsNewCards(settings({}))).toBe(false);
});

it('holds back new cards per deck subtree while other decks keep going', async () => {
  const cards = [
    card('c1', 'Biology::Cells'),
    card('c2', 'Biology::Cells'),
    card('g1', 'Biology::Genetics'),
    card('g2', 'Biology::Genetics'),
    card('x1', 'Chemistry'),
    card('x2', 'Chemistry'),
  ];
  const store = new ReviewStore(async () => {});
  await store.saveSettings(
    settings({ Biology: { newCardsPerDay: 3 }, 'Biology::Cells': { newCardsPerDay: 1 } }),
  );
  let paced = paceCards(cards, store.getSnapshot(), {}, now);
  // One from Cells, two more from the rest of Biology, and Chemistry is unlimited.
  expect(paced.batch.map((c) => c.id)).toEqual(['c1', 'g1', 'g2', 'x1', 'x2']);
  expect(paced.heldNew).toBe(1);
  expect(paceCards(cards, store.getSnapshot(), { extraNew: true }, now).batch).toHaveLength(6);

  await store.review('g1', 3, now, undefined, [], 'Biology::Genetics');
  expect(store.getSnapshot().history[0]).toMatchObject({ deck: 'Biology::Genetics' });
  expect(introductionsToday(store.getSnapshot().history, now, 'Biology')).toBe(1);
  expect(introductionsToday(store.getSnapshot().history, now, 'Biology::Cells')).toBe(0);
  expect(newAllowance(store.getSnapshot(), now, 'Biology::Cells')).toBe(1);
  expect(newAllowance(store.getSnapshot(), now, 'Biology::Genetics')).toBe(2);
  expect(newAllowance(store.getSnapshot(), now, 'Chemistry')).toBe(Infinity);
  paced = paceCards(cards, store.getSnapshot(), {}, now);
  // g1 is now a review; two Biology introductions remain, one of them at most from Cells.
  expect(paced.batch.map((c) => c.id)).toEqual(['g1', 'c1', 'g2', 'x1', 'x2']);

  // The overall limit still caps everything.
  await store.saveSettings({ ...store.getSnapshot().settings, newCardsPerDay: 2 });
  expect(
    paceCards(cards, store.getSnapshot(), {}, now)
      .batch.filter((c) => c.id !== 'g1')
      .map((c) => c.id),
  ).toEqual(['c1']);
  // Ratings saved before decks were recorded count towards the overall limit only.
  const legacy = [{ cardId: 'old', at: now, rating: 3 as const, scheduled: true }];
  expect(introductionsToday(legacy, now)).toBe(1);
  expect(introductionsToday(legacy, now, 'Biology')).toBe(0);
});

it('refuses a new card in a session once its deck limit is reached, but not in other decks', async () => {
  const cards = [card('c1', 'Biology'), card('c2', 'Biology'), card('x1', 'Chemistry')];
  const store = new ReviewStore(async () => {});
  await store.saveSettings(settings({ Biology: { newCardsPerDay: 1 } }));
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const session = await store.startSession(cards, 'normal', undefined, 'all', {});
  expect(session.cardIds).toEqual(['c1', 'x1']);
  const step = (position: number) => ({ id: session.id, position });
  await store.review('c1', 3, now, step(0), [], 'Biology');
  await expect(store.review('c2', 3, now + 1, step(1), [], 'Biology')).rejects.toThrow(
    'daily new-card allowance',
  );
  await expect(store.review('x1', 3, now + 2, step(1), [], 'Chemistry')).resolves.toBeDefined();
});

it('schedules with the deck’s target retention and records it on the rating', async () => {
  const store = new ReviewStore(async () => {});
  await store.saveSettings(
    settings({ Law: { desiredRetention: 0.97 } }, { desiredRetention: 0.8 }),
  );
  const start = new Date(2026, 0, 1, 12).getTime();
  for (const id of ['law', 'other']) {
    const deck = id === 'law' ? 'Law::Contracts' : 'History';
    await store.review(id, 3, start, undefined, [], deck);
    await store.review(id, 3, start + 600_000, undefined, [], deck);
    await store.review(id, 3, start + 5 * 86_400_000, undefined, [], deck);
  }
  const { states, history } = store.getSnapshot();
  // A higher target means the card comes back sooner.
  expect(states.law!.interval).toBeLessThan(states.other!.interval);
  expect(history.filter((e) => e.cardId === 'law').every((e) => e.desiredRetention === 0.97)).toBe(
    true,
  );
  expect(history.find((e) => e.cardId === 'other')).toMatchObject({
    desiredRetention: 0.8,
    deck: 'History',
  });
  let expected = reviewWithFsrs('law', undefined, 3, start, 0.97);
  expected = reviewWithFsrs('law', expected, 3, start + 600_000, 0.97);
  expected = reviewWithFsrs('law', expected, 3, start + 5 * 86_400_000, 0.97);
  expect(states.law!.due).toBe(expected.due);
  // Without a deck the global target applies, as before.
  await store.review('plain', 3, start);
  expect(store.getSnapshot().history.at(-1)).toMatchObject({ desiredRetention: 0.8 });
  expect(store.getSnapshot().history.at(-1)).not.toHaveProperty('deck');
});

it('combines a deck’s target retention with personal FSRS parameters', async () => {
  const weights = clip(DEFAULT_PARAMETERS.map((w, i) => (i < 4 ? w * 3 : i === 8 ? 2.4 : w)));
  const store = new ReviewStore(async () => {});
  await store.saveSettings(
    settings({ Law: { desiredRetention: 0.95 } }, { fsrsParameters: weights }),
  );
  const start = new Date(2026, 0, 1, 12).getTime();
  let expected = reviewWithFsrs('law', undefined, 4, start, 0.95, weights);
  await store.review('law', 4, start, undefined, [], 'Law');
  expected = reviewWithFsrs('law', expected, 3, start + 9 * 86_400_000, 0.95, weights);
  await store.review('law', 3, start + 9 * 86_400_000, undefined, [], 'Law');
  expect(store.getSnapshot().states.law!.due).toBe(expected.due);
  expect(store.getSnapshot().states.law!.fsrs!.stability).toBe(expected.fsrs!.stability);
  // Neither setting alone gives this schedule.
  const alone = reviewWithFsrs(
    'law',
    reviewWithFsrs('law', undefined, 4, start, 0.95),
    3,
    start + 9 * 86_400_000,
    0.95,
  );
  expect(alone.fsrs!.stability).not.toBe(expected.fsrs!.stability);
});
