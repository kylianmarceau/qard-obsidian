import { expect, it } from 'vitest';
import { QardSettingsTab } from '../src/settings/SettingsTab';
import { Setting } from 'obsidian';
import { readSettings } from '../src/settings/settings';

it('settings rows never return an Obsidian Setting from a promise callback (it is a thenable and would freeze the app)', async () => {
  const settings = readSettings({});
  const plugin = {
    app: {},
    reviews: { getSnapshot: () => ({ settings }), saveSettings: async () => {} },
  };
  const tab = new QardSettingsTab(plugin as never);
  let adopted = 0;
  class Watched extends Setting {
    override then(callback: (s: this) => unknown) {
      // A promise resolving to this row calls then() again and again; stop after a few and fail.
      if (++adopted > 20) throw new Error('a promise is adopting a Setting');
      return super.then(callback);
    }
  }
  for (const group of tab.getSettingDefinitions())
    for (const row of group.items) row.render(new Watched({} as never) as never);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
  expect(adopted).toBe(0);
});

it('opens transfer tools exclusively from Qard settings', async () => {
  const { vi } = await import('vitest');
  const openTransfer = vi.fn(),
    openImport = vi.fn();
  const plugin = {
    app: {},
    reviews: { getSnapshot: () => ({ settings: readSettings({}) }) },
    openTransfer,
    openImport,
  };
  const tab = new QardSettingsTab(plugin as never);
  const group = tab.getSettingDefinitions().find((g) => g.heading === 'Import and export')!;
  expect(group.items.map((row) => row.name)).toEqual([
    'Import flashcards from a file',
    'Export flashcards',
    'Resume an unfinished import',
    'Import from Spaced Repetition',
  ]);
  for (const row of group.items) {
    const button = {
      setButtonText: () => button,
      onClick: (callback: () => void) => {
        callback();
        return button;
      },
    };
    row.render({ addButton: (callback: (b: typeof button) => void) => callback(button) } as never);
  }
  expect(openTransfer.mock.calls).toEqual([['import'], ['export'], ['resume']]);
  expect(openImport).toHaveBeenCalledOnce();
});
