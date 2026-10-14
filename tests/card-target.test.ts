import { expect, it } from 'vitest';
import {
  chooseCardNote,
  deckSlug,
  newNotePath,
  type NoteCandidate,
} from '../src/cards/card-target';

const note = (path: string, extra: Partial<NoteCandidate> = {}): NoteCandidate => ({
  path,
  deck: 'Bio',
  qardDeck: true,
  topicCards: 0,
  ...extra,
});

it('prefers a note that already holds the topic, then deck notes in the card folder', () => {
  const notes = [
    note('Elsewhere/Bio.md'),
    note('Qard/Bio 2.md'),
    note('Qard/Bio.md'),
    note('Notes/Cells.md', { topicCards: 1 }),
    note('Notes/Cells 2.md', { topicCards: 3 }),
  ];
  expect(chooseCardNote(notes, 'Bio', 'Cells', 'Qard')).toBe('Notes/Cells 2.md');
  expect(chooseCardNote(notes.slice(0, 3), 'Bio', 'Cells', 'Qard')).toBe('Qard/Bio.md');
  expect(chooseCardNote(notes.slice(0, 1), 'Bio', 'Cells', 'Qard')).toBe('Elsewhere/Bio.md');
});
it('skips other decks, fixed topics and notes the deck only gets from a folder', () => {
  expect(
    chooseCardNote(
      [
        note('Qard/Chem.md', { deck: 'Chem' }),
        note('Qard/Fixed.md', { fixedTopic: 'Other' }),
        note('Courses/Bio/Week 1.md', { qardDeck: false }),
      ],
      'Bio',
      'Cells',
      'Qard',
    ),
  ).toBeUndefined();
  expect(chooseCardNote([note('Notes/Bio.md', { qardDeck: false })], 'Bio', 'Cells', 'Qard')).toBe(
    'Notes/Bio.md',
  );
  expect(chooseCardNote([note('Qard/F.md', { fixedTopic: 'Cells' })], 'Bio', 'Cells', 'Qard')).toBe(
    'Qard/F.md',
  );
});
it('names new notes after the deck and numbers them only when the name is taken', () => {
  expect(deckSlug('Bio: Cells/1')).toBe('Bio- Cells-1');
  expect(newNotePath('Bio', 'Qard', () => false)).toBe('Qard/Bio.md');
  const taken = new Set(['Qard/Bio.md', 'Qard/Bio 2.md']);
  expect(newNotePath('Bio', 'Qard', (p) => taken.has(p))).toBe('Qard/Bio 3.md');
  expect(newNotePath('Bio', '', () => false)).toBe('Bio.md');
});
