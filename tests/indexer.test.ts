import { afterEach, expect, it, vi } from 'vitest';
import { TFile, type App, type Plugin } from 'obsidian';
import { VaultIndexer } from '../src/cards/indexer';
function setup() {
  const file = new (TFile as unknown as new (p: string) => TFile)('a.md');
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const read = vi.fn(async () => '> [!qard]- Question\n> Answer');
  const app = { vault: { on: (name: string, callback: (...args: unknown[]) => void) => { handlers[name] = callback; return name; }, cachedRead: read, getMarkdownFiles: () => [file], getAbstractFileByPath: () => file } } as unknown as App;
  const plugin = { registerEvent: vi.fn() } as unknown as Plugin;
  return { index: new VaultIndexer(app, plugin), file, read, handlers, plugin };
}
afterEach(() => vi.useRealTimers());
it.each([{ paths: [] }, { paths: ['Notes.md'] }])('starts without decks when the vault has no Qard cards: $paths', async ({ paths }) => {
  const files = paths.map(path => new (TFile as unknown as new (p: string) => TFile)(path));
  const write = vi.fn(() => { throw new Error('Indexing must not create or modify notes'); });
  const app = { vault: {
    on: vi.fn(), getMarkdownFiles: () => files,
    cachedRead: vi.fn(async () => '# My notes\n\nOrdinary Markdown, without flashcards.'),
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
    create: write, createFolder: write, modify: write, process: write,
  } } as unknown as App;
  const index = new VaultIndexer(app, { registerEvent: vi.fn() } as unknown as Plugin);
  await index.start();
  expect(index.getSnapshot()).toMatchObject({ cards: [], decks: [], loading: false });
  expect(write).not.toHaveBeenCalled();
  index.dispose();
});
it('debounces edits to the affected note and cancels work on disposal', async () => {
  vi.useFakeTimers(); const { index, file, read, handlers, plugin } = setup(); await index.start();
  expect(plugin.registerEvent).toHaveBeenCalledTimes(4); expect(read).toHaveBeenCalledTimes(1);
  handlers.modify!(file); handlers.modify!(file); await vi.advanceTimersByTimeAsync(250); expect(read).toHaveBeenCalledTimes(2);
  handlers.modify!(file); index.dispose(); await vi.advanceTimersByTimeAsync(500); expect(read).toHaveBeenCalledTimes(2);
});
it('does not let an older read replace a newer edit', async () => {
  const { index, file, read } = setup(); let finish!: (s: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const older = index.refresh(file); read.mockResolvedValueOnce('> [!qard]- Newer question\n> Answer'); await index.refresh(file);
  finish('> [!qard]- Older question\n> Answer'); await older;
  expect(index.getSnapshot().cards[0]?.frontMarkdown).toBe('Newer question'); index.dispose();
});
it('a pending read cannot resurrect a deleted card', async () => {
  const { index, file, read, handlers } = setup(); await index.start(); let finish!: (s: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const pending = index.refresh(file);
  handlers.delete!(file); finish('> [!qard]- Question\n> Answer'); await pending;
  expect(index.getSnapshot().cards).toHaveLength(0); index.dispose();
});
