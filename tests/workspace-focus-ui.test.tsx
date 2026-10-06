// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { QardApp } from '../src/views/QardApp';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import type { QardServices } from '../src/views/services';
import type { QardCard } from '../src/cards/card-types';

let host: HTMLElement, root: Root, services: QardServices;
let activeLeafChanged: () => void;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const index = new CardIndex();
  index.setLoading(false);
  index.update('cards.md', '<!-- qard-id: a -->\n> [!qard]- Question\n> Answer\n');
  const snapshot = { revision: 0, jobs: {} };
  const collection = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    list: async () => [],
    todayList: async () => ({ checks: [], lessons: [], cards: 0 }),
    get: () => undefined,
  };
  services = {
    host,
    owner: new Component(),
    index,
    reviews: new ReviewStore(async () => {}),
    tests: collection,
    learn: collection,
    writer: { ensureStable: async (cards: QardCard[]) => cards },
    setFocus: vi.fn(),
    isActive: () => true,
    app: {
      workspace: {
        on: vi.fn((_event: string, callback: () => void) => {
          activeLeafChanged = callback;
        }),
        offref: vi.fn(),
      },
    },
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function mount() {
  await act(async () => root.render(<QardApp services={services} />));
}
async function key(key: string, target = host, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    await services.reviews.flush();
  });
}
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await services.reviews.flush();
  });
}

it('toggles fullscreen in the library and Statistics, keeps focus through navigation, and exits with Escape', async () => {
  await mount();
  expect(host.querySelector('[aria-label="Enter focus mode"]')).toBeNull();
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await click('Statistics');
  expect(host.querySelector('h1')?.textContent).toBe('Statistics');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await key('F');
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await key('Escape');
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
});

it('leaves typing, held keys, composition, modified shortcuts and other views alone', async () => {
  await mount();
  const field = host.querySelector('input')!;
  await key('f', field);
  for (const option of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey'])
    await key('f', host, { [option]: true });
  services.isActive = () => false;
  await key('f');
  expect(services.setFocus).not.toHaveBeenCalled();
});

it('releases fullscreen when switching views or unmounting and removes its listeners', async () => {
  await mount();
  await key('f');
  services.isActive = () => false;
  await act(async () => activeLeafChanged());
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  services.isActive = () => true;
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await act(async () => root.render(null));
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  expect(services.app.workspace.offref).toHaveBeenCalledOnce();
  vi.mocked(services.setFocus).mockClear();
  await key('f');
  expect(services.setFocus).not.toHaveBeenCalled();
});

it('hands the shortcut to study once and restores it after finishing a session', async () => {
  await mount();
  await key('f');
  await click('Study');
  await click('Select all');
  await click('Start');
  expect(host.querySelector('.qard-study'), host.textContent ?? '').not.toBeNull();
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Session complete');
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  await click('Done');
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
});
