import { expect, it } from 'vitest';
import { parseCards } from '../src/cards/parser';
import {
  serializeCard,
  replaceCardInSource,
  deleteCardInSource,
  placeCardInSource,
} from '../src/cards/source-patch';
import { siblingIds } from '../src/cards/siblings';
import { ReviewStore } from '../src/review/review-store';
import { isBuried } from '../src/review/scheduler';

const pairSource = () =>
  'Prose.\n\n' +
  serializeCard('a', 'Capital of France?', 'Paris', '\n', 'pair', undefined, 'b') +
  '\n' +
  serializeCard('b', 'Paris', 'Capital of France?', '\n', 'pair', undefined, 'a') +
  '\nTail.\n';
it('preserves prose and reciprocal links and safely rejects a missing, relinked or manually changed partner', () => {
  const source = pairSource();
  const [a, b] = parseCards(source, 'note.md').cards;
  expect(siblingIds(a!, [a!, b!])).toEqual(['b']);
  const changed = replaceCardInSource(source, a!, 'Country of Paris?', 'France', 'a');
  const pair = parseCards(changed, 'note.md').cards;
  expect(pair[1]).toMatchObject({
    id: 'b',
    reverseId: 'a',
    frontMarkdown: 'France',
    backMarkdown: 'Country of Paris?',
  });
  expect(changed.startsWith('Prose.\n\n')).toBe(true);
  expect(changed.endsWith('\nTail.\n')).toBe(true);
  const stale = source.replace('> [!qard]- Paris', '> [!qard]- Lyon');
  expect(() => replaceCardInSource(stale, a!, 'New', 'Answer', 'a')).toThrow(
    /reverse pair changed/,
  );
  expect(() =>
    replaceCardInSource(
      source.replace('qard-reverse: b', 'qard-reverse: c'),
      a!,
      'New',
      'Answer',
      'a',
    ),
  ).toThrow(/changed/);
  expect(() =>
    replaceCardInSource(source.replace(b!.sourceText, ''), a!, 'New', 'Answer', 'a'),
  ).toThrow(/reverse pair changed/);
});
it('deleting one direction unlinks its surviving card and preserves its content; moving preserves the link', () => {
  const source = pairSource();
  const [a] = parseCards(source, 'note.md').cards;
  const moved = placeCardInSource(source, a!, { deck: 'Moved', topic: 'Topic' });
  expect(parseCards(moved, 'note.md').cards.find((card) => card.id === 'a')).toMatchObject({
    deck: 'Moved',
    reverseId: 'b',
  });
  const remaining = parseCards(deleteCardInSource(source, a!), 'note.md').cards;
  expect(remaining).toHaveLength(1);
  expect(remaining[0]).toMatchObject({
    id: 'b',
    frontMarkdown: 'Paris',
    backMarkdown: 'Capital of France?',
  });
  expect(remaining[0]!.reverseId).toBeUndefined();
});
it('keeps independent histories, defers the other direction and undo restores both schedules', async () => {
  const cards = parseCards(pairSource(), 'note.md').cards;
  const store = new ReviewStore(async () => {});
  await store.saveSettings({ ...store.getSnapshot().settings, scheduler: 'simple' });
  const session = await store.startSession(cards);
  const undo = await store.review(
    'a',
    4,
    Date.now(),
    { id: session.id, position: 0 },
    siblingIds(cards[0]!, cards),
  );
  expect(store.getSnapshot().states.a!.reviewCount).toBe(1);
  expect(store.getSnapshot().states.b!.reviewCount).toBe(0);
  expect(isBuried(store.getSnapshot().states.b)).toBe(true);
  expect(store.getSnapshot().history.map((event) => event.cardId)).toEqual(['a']);
  await store.undoReview(undo);
  expect(store.getSnapshot().states.a).toBeUndefined();
  expect(store.getSnapshot().states.b).toBeUndefined();
});
