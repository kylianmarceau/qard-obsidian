import { expect, it, vi } from 'vitest';
vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<object>(),
  Plugin: class {}, MarkdownView: class {}, Notice: class {}, addIcon: vi.fn(),
}));
vi.mock('../src/views/QardView', () => ({
  VIEW_TYPE: 'qard-workspace', QardView: class { release = vi.fn(); },
}));
vi.mock('../src/settings/SettingsTab', () => ({ QardSettingsTab: class {} }));
vi.mock('../src/views/SelectionModal', () => ({ SelectionModal: class {} }));
import QardPlugin from '../src/main';
import { QardView } from '../src/views/QardView';

it('unload releases UI resources without detaching or relocating workspace tabs', () => {
  const plugin = Object.create(QardPlugin.prototype) as QardPlugin;
  const view = new (QardView as unknown as new () => QardView)();
  const detachLeavesOfType = vi.fn(), disposeIndex = vi.fn(), disposeReviews = vi.fn(), close = vi.fn();
  Object.assign(plugin, {
    app: { workspace: { getLeavesOfType: () => [{ view }], detachLeavesOfType } },
    selectionModals: new Set([{ close }]), index: { dispose: disposeIndex }, reviews: { dispose: disposeReviews },
  });
  plugin.onunload();
  expect(view.release).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(disposeIndex).toHaveBeenCalledOnce();
  expect(disposeReviews).toHaveBeenCalledOnce();
  expect(detachLeavesOfType).not.toHaveBeenCalled();
});
