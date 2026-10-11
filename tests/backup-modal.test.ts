// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Setting } from 'obsidian';
import { BackupModal } from '../src/settings/BackupModal';
import { ReviewStore, type PluginData } from '../src/review/review-store';
import { progressSnapshot } from '../src/review/progress-backups';

afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const reviews = new ReviewStore(async () => {});
  await reviews.review('a', 4, 1000);
  const backup = {
    version: 1 as const,
    createdAt: 2000,
    progress: progressSnapshot(reviews.getSnapshot()),
    checksum: 'verified-in-domain-tests',
  };
  await reviews.review('b', 4, 3000);
  const capture = vi.fn(async (_data: PluginData, _force?: boolean) => {}),
    show = vi.fn(async () => {});
  const backups = {
    list: async () => [{ name: 'backup', backup }],
    read: vi.fn(async () => backup),
    capture,
  };
  const modal = new BackupModal({ app: {}, reviews, backups, show } as never);
  Object.assign(modal.contentEl, {
    empty() {
      modal.contentEl.replaceChildren();
    },
    createEl(tag: string, options: { text: string; cls?: string }) {
      const element = document.createElement(tag);
      element.textContent = options.text;
      element.className = options.cls ?? '';
      modal.contentEl.append(element);
      return element;
    },
  });
  vi.spyOn(Setting.prototype, 'addButton').mockImplementation(function (this: Setting, callback) {
    const element = document.createElement('button');
    modal.contentEl.append(element);
    const button = {
      setButtonText(text: string) {
        element.textContent = text;
        return button;
      },
      setDisabled(value: boolean) {
        element.disabled = value;
        return button;
      },
      setClass(value: string) {
        element.className = value;
        return button;
      },
      onClick(handler: () => void) {
        element.onclick = handler;
        return button;
      },
    };
    callback(button as never);
    return this;
  });
  modal.open();
  const click = async (text: string) => {
    [...modal.contentEl.querySelectorAll('button')]
      .find((button) => button.textContent === text)!
      .click();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await reviews.flush();
  };
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return { modal, reviews, backups, capture, show, click };
}
it('previews replacement counts, leaves progress untouched until confirmation and saves the current progress first', async () => {
  const f = await fixture();
  try {
    await f.click('Preview restore');
    expect(f.modal.contentEl.textContent).toContain('current 2 reviews with 1');
    expect(f.reviews.getSnapshot().history).toHaveLength(2);
    expect(f.capture).not.toHaveBeenCalled();
    await f.click('Restore this backup');
    expect(f.capture.mock.calls[0]![0]).toMatchObject({
      history: expect.arrayContaining([expect.objectContaining({ cardId: 'b' })]),
    });
    expect(f.reviews.getSnapshot().history).toHaveLength(1);
    expect(f.show).toHaveBeenCalledWith('today');
  } finally {
    f.modal.close();
  }
});
it('keeps current progress if the fresh safety backup fails', async () => {
  const f = await fixture();
  try {
    await f.click('Preview restore');
    f.capture.mockRejectedValueOnce(new Error('disk full'));
    await f.click('Restore this backup');
    expect(f.reviews.getSnapshot().history).toHaveLength(2);
    expect(f.modal.contentEl.textContent).toContain('disk full');
    expect(f.show).not.toHaveBeenCalled();
  } finally {
    f.modal.close();
  }
});
