import { expect, it, vi } from 'vitest';
import { type App, TFile } from 'obsidian';
import { isStudyNote, studyNotes } from '../src/vault-access';

it('discovers ordinary Markdown without reading files, and excludes hidden notes and configured folders', () => {
  const paths = [
    'Course/Topic.md',
    'Course/Nested/Other.md',
    '.obsidian/secret.md',
    'Course/.private/secret.md',
    'Qard/Tests/_profile.md',
    'Qard/Tests-old/Notes.md',
    'image.png',
  ];
  const files = paths.map((path) => new (TFile as unknown as new (path: string) => TFile)(path));
  const read = vi.fn();
  const app = {
    vault: { getMarkdownFiles: () => files, cachedRead: read, read },
  } as unknown as App;
  expect(studyNotes(app, ['Qard/Tests/']).map((file) => file.path)).toEqual([
    'Course/Topic.md',
    'Course/Nested/Other.md',
    'Qard/Tests-old/Notes.md',
  ]);
  expect(read).not.toHaveBeenCalled();
});

it.each([
  '../secret.md',
  '/absolute.md',
  'Notes/./secret.md',
  'Notes//secret.md',
  'Notes/.private.md',
  'Notes/attachment.pdf',
])('does not expose %s as a study note', (path) => {
  expect(isStudyNote(path)).toBe(false);
});
