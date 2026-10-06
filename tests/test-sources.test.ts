import { expect, it } from 'vitest';
import {
  folderNotes,
  resolveTestNotes,
  testFolders,
  testNotePaths,
} from '../src/tests/test-sources';
import { generatePrompt, planPrompt } from '../src/tests/test-prompts';
const paths = [
  'Courses/AI/01.md',
  'Courses/AI/02.md',
  'Courses/AI/Week 2/03.md',
  'Courses/AI extra/other.md',
  'root.md',
];
it('expands a course recursively without including similarly named sibling folders', () => {
  expect(folderNotes(paths, ['Courses/AI'])).toEqual(paths.slice(0, 3));
});
it('counts every Markdown note in ancestor folders without duplicate entries', () => {
  expect(testFolders([...paths, paths[0]!])).toEqual(
    [
      { path: 'Courses', count: 4 },
      { path: 'Courses/AI', count: 3 },
      { path: 'Courses/AI extra', count: 1 },
      { path: 'Courses/AI/Week 2', count: 1 },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
});
it('excludes generated tests, hidden paths and non-Markdown files', () => {
  expect(
    testNotePaths(
      [
        ...paths,
        'Qard/Tests/old/Test.md',
        'Qard/Tests extra/note.md',
        'Courses/AI/slides.pdf',
        '.hidden/note.md',
        'Courses/.hidden/note.md',
      ],
      'Qard/Tests/',
    ),
  ).toEqual([...paths, 'Qard/Tests extra/note.md']);
});
it('deduplicates overlapping folders and individual notes and excludes removed notes', () => {
  expect(
    resolveTestNotes(
      paths,
      [paths[0]!, 'removed.md'],
      ['Courses', 'Courses/AI', 'Courses/AI/Week 2'],
    ),
  ).toEqual([
    paths[0]!,
    ...paths
      .slice(0, 4)
      .filter((p) => p !== paths[0])
      .sort((a, b) => a.localeCompare(b)),
  ]);
});
it('does not treat an empty folder selection as the whole vault', () => {
  expect(folderNotes(paths, [''])).toEqual([]);
});
it('includes all ten lectures in both planning and direct generation prompts', () => {
  const notes = Array.from({ length: 10 }, (_, i) => `Courses/AI/Lecture ${i + 1}.md`);
  const request = { prompt: '', decks: [], folders: ['Courses/AI'], notes, sources: notes };
  for (const prompt of [
    planPrompt(request, { questions: 12, marking: 'section' }),
    generatePrompt({ request }, { questions: 12, marking: 'section' }),
  ]) {
    expect(prompt).toContain('Course folders the student attached:');
    expect(prompt).toContain('- Courses/AI\n');
    for (const note of notes) expect(prompt).toContain(`- ${note}`);
    expect(prompt).toContain('balance coverage');
  }
});
it('approved plans retain control over their sources after a folder was attached', () => {
  const request = { prompt: '', decks: [], folders: ['Courses/AI'], notes: paths, sources: paths };
  const plan = {
    title: 'Only week 2',
    goal: 'Narrow the scope',
    sources: [{ path: paths[2]!, reason: 'Chosen' }],
    sections: [],
    questionCount: 1,
    totalMarks: 1,
    minutes: 2,
  };
  const prompt = generatePrompt({ request, plan }, { questions: 12, marking: 'section' });
  expect(prompt).toContain('approved plan');
  expect(prompt).toContain(paths[2]);
  expect(prompt).not.toContain(paths[0]);
});
