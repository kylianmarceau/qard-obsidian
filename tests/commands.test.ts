import { expect, it, vi } from 'vitest';
import QardPlugin, { insertCard } from '../src/main';
import { QardView } from '../src/views/QardView';
import { readSettings } from '../src/settings/settings';
import { parseCards } from '../src/cards/parser';
import type { Editor } from 'obsidian';
vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Plugin: class {},
  MarkdownView: class {},
  Notice: class {},
  addIcon: vi.fn(),
}));
vi.mock('../src/views/QardView', () => ({
  VIEW_TYPE: 'qard-workspace',
  QardView: class {
    studyCommand = vi.fn((action: string) => action === 'good');
  },
}));
vi.mock('../src/debug/dev-tools', () => ({ installDevTools: () => () => {} }));
vi.mock('../src/settings/SettingsTab', () => ({ QardSettingsTab: class {} }));
vi.mock('../src/views/SelectionModal', () => ({ SelectionModal: class {} }));
vi.mock('../src/views/ImportModal', () => ({ ImportModal: class {} }));

type Command = {
  id: string;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean;
  editorCheckCallback?: (checking: boolean, editor: Editor, view: unknown) => boolean;
};
function commands(aiEnabled: boolean, active?: QardView) {
  const plugin = Object.create(QardPlugin.prototype) as QardPlugin;
  const list: Command[] = [];
  let settings = readSettings({ aiEnabled });
  Object.assign(plugin, {
    addCommand: (command: Command) => list.push(command),
    reviews: { getSnapshot: () => ({ settings }) },
    index: { getSnapshot: () => ({ cards: [] }) },
    app: { workspace: { getActiveViewOfType: () => active, getActiveFile: () => null } },
  });
  (plugin as unknown as { registerCommands(): void }).registerCommands();
  const find = (id: string) => list.find((command) => command.id === id)!;
  return {
    find,
    setAi: (on: boolean) => (settings = readSettings({ aiEnabled: on })),
  };
}

it('removes AI commands while AI features are off', () => {
  const { find, setAi } = commands(false);
  for (const id of ['new-practice-test', 'open-practice-tests', 'open-learn', 'open-usage']) {
    expect(find(id).checkCallback!(true)).toBe(false);
  }
  expect(find('generate-cards').checkCallback!(true)).toBe(false);
  setAi(true);
  expect(find('open-learn').checkCallback!(true)).toBe(true);
  expect(find('open-library').callback).toBeTypeOf('function');
  expect(find('open-plans').callback).toBeTypeOf('function');
});

it('routes study commands to the card session in the active Qard tab', () => {
  const view = new (QardView as unknown as new () => QardView)();
  const { find } = commands(true, view);
  expect(find('study-good').checkCallback!(true)).toBe(true);
  expect(find('study-again').checkCallback!(true)).toBe(false);
  expect(view.studyCommand).toHaveBeenCalledWith('good', true);
  expect(commands(true).find('study-good').checkCallback!(true)).toBe(false);
});

/** Just enough of Obsidian's Editor over a string. */
function editor(initial: string, line: number) {
  let text = initial;
  let selection: unknown;
  const lines = () => text.split('\n');
  const offset = (pos: { line: number; ch: number }) =>
    lines()
      .slice(0, pos.line)
      .reduce((sum, l) => sum + l.length + 1, 0) + pos.ch;
  const pos = (at: number) => {
    const before = text.slice(0, at).split('\n');
    return { line: before.length - 1, ch: before.at(-1)!.length };
  };
  const api = {
    getValue: () => text,
    getCursor: () => ({ line, ch: 0 }),
    getLine: (n: number) => lines()[n] ?? '',
    offsetToPos: pos,
    posToOffset: offset,
    replaceRange: (insert: string, at: { line: number; ch: number }) => {
      const o = offset(at);
      text = text.slice(0, o) + insert + text.slice(o);
    },
    setSelection: (from: unknown, to: unknown) => (selection = [from, to]),
    transaction: ({
      changes,
    }: {
      changes: { from: { line: number; ch: number }; text: string }[];
    }) => {
      // CodeMirror applies all changes against the original document.
      const original = text;
      const at = changes.map((c) => ({ o: offset(c.from), text: c.text }));
      text = original;
      for (const change of at.sort((a, b) => b.o - a.o)) {
        text = text.slice(0, change.o) + change.text + text.slice(change.o);
      }
    },
  };
  return { api: api as unknown as Editor, text: () => text, selection: () => selection };
}

it('inserts a card template after the card at the cursor or below the current line', () => {
  const note = 'Intro text\n\n> [!qard]- Q\n> A\nNext paragraph\n';
  const inCard = editor(note, 3);
  insertCard(inCard.api, 'n.md');
  expect(inCard.text()).toBe(
    'Intro text\n\n> [!qard]- Q\n> A\n\n> [!qard]- Question\n> Answer\n\nNext paragraph\n',
  );
  expect(inCard.selection()).toEqual([
    { line: 5, ch: 11 },
    { line: 5, ch: 19 },
  ]);
  const onText = editor('Intro text\nMore', 0);
  insertCard(onText.api, 'n.md');
  expect(onText.text()).toBe('Intro text\n\n> [!qard]- Question\n> Answer\n\nMore');
  const blank = editor('Intro\n\n', 1);
  insertCard(blank.api, 'n.md');
  expect(blank.text()).toBe('Intro\n\n> [!qard]- Question\n> Answer\n');
  expect(parseCards(blank.text(), 'n.md').cards).toHaveLength(1);
});

it('turns the basic card at the cursor into a reverse pair in one undoable change', () => {
  const { find } = commands(true);
  const note = 'Intro\n\n> [!qard]- Capital?\n> Paris\n\nAfter\n';
  const ed = editor(note, 2);
  const command = find('reverse-card-at-cursor');
  expect(command.editorCheckCallback!(true, ed.api, { file: { path: 'n.md' } })).toBe(true);
  command.editorCheckCallback!(false, ed.api, { file: { path: 'n.md' } });
  const cards = parseCards(ed.text(), 'n.md').cards;
  expect(cards.map((c) => [c.frontMarkdown, c.backMarkdown])).toEqual([
    ['Capital?', 'Paris'],
    ['Paris', 'Capital?'],
  ]);
  expect(cards[0]!.reverseId).toBe(cards[1]!.id);
  expect(ed.text().endsWith('\n\nAfter\n')).toBe(true);
  // Already reversed, so the command is unavailable.
  expect(
    command.editorCheckCallback!(true, editor(ed.text(), 4).api, { file: { path: 'n.md' } }),
  ).toBe(false);
  expect(command.editorCheckCallback!(true, editor(note, 0).api, { file: { path: 'n.md' } })).toBe(
    false,
  );
});
