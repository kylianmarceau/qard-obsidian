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
