import { expect, it } from 'vitest';
import fixtures from './fixtures/lesson-note.json';
import { formatLessonNote } from '../src/learn/lesson-note';
import type { Lesson } from '../src/learn/learn-types';

// Expected transcripts were captured from b72f3fa before extracting the formatter.
for (const fixture of fixtures) {
  it(`preserves the saved Markdown for a ${fixture.name}`, () => {
    const lesson = {
      ...fixture.lesson,
      createdAt: new Date('2026-10-06T12:00:00').getTime(),
    } as Lesson;
    expect(formatLessonNote(fixture.path, lesson, fixture.summary)).toEqual(fixture.expected);
  });
}

it('exports filled cloze answers in their Markdown context', () => {
  const lesson = {
    version: 1,
    createdAt: 1,
    topic: 'Recall',
    notes: [],
    current: 0,
    steps: [
      {
        title: 'Method',
        explain: 'Explanation.',
        connect: 'Connection.',
        checkFirst: false,
        misconceptions: [],
        check: {
          id: 'c',
          type: 'cloze',
          prompt: 'Use **{{method}}** for {{task}}.',
          marks: 2,
          blanks: [{ id: 'method' }, { id: 'task' }],
          rubric: [
            { point: 'method', marks: 1 },
            { point: 'task', marks: 1 },
          ],
          model: 'DP for paths.',
        },
      },
    ],
    state: [{ asks: [], answer: { blanks: { method: 'DP', task: 'paths' } } }],
  } satisfies Lesson;
  expect(formatLessonNote('lesson.json', lesson, 'Summary.').text).toContain(
    '**My answer:** Use **DP** for paths.',
  );
});
