// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { QardApp } from '../src/views/QardApp';
import { ReviewStore, type PluginData } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import type { QardServices } from '../src/views/services';
import type { QardCard } from '../src/cards/card-types';
let host: HTMLElement, root: Root, services: QardServices, persisted: PluginData;
const source = ['a', 'b', 'c']
  .map((id) => `<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer ${id}\n`)
  .join('\n');
const persist = async (data: PluginData) => {
  persisted = JSON.parse(JSON.stringify(data));
};
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const index = new CardIndex();
  index.setLoading(false);
  index.update('deck.md', source);
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
    reviews: new ReviewStore(persist),
    tests: collection,
    learn: collection,
    writer: { ensureStable: async (cards: QardCard[]) => cards },
    setFocus: vi.fn(),
    isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } },
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await services.reviews.flush().catch(() => {});
}
async function mount() {
  await act(async () => {
    root.render(<QardApp services={services} />);
    await tick();
  });
}
async function click(text: string, contains = false) {
  await act(async () => {
    const button = [...host.querySelectorAll('button')].find((b) =>
      contains ? b.textContent?.includes(text) : b.textContent === text,
    );
    expect(button, host.textContent ?? '').toBeDefined();
    button!.click();
    await tick();
  });
}
async function key(key: string) {
  await act(async () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await tick();
  });
}
async function reload() {
  await act(async () => root.render(null));
  const restored = new ReviewStore(persist);
  restored.load(persisted);
  services = { ...services, reviews: restored };
  await mount();
}
it('leaves midway, survives a full store/UI restart, resumes the next card, and clears the completed session', async () => {
  await mount();
  await click('Study');
  await click('Select all');
  await click('Start');
  expect(host.textContent).toContain('Question a');
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Question b');
  await click('Save and leave');
  await click('Leave session');
  expect(host.textContent).toContain('1 of 3 completed');
  await reload();
  await click('Resume', true);
  expect(host.textContent).toContain('Question b');
  expect(host.textContent).toContain('2 / 3');
  await key(' ');
  await key('4');
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('3 / 3');
  expect(services.reviews.getSnapshot().history.map((e) => e.cardId)).toEqual(['a', 'b', 'c']);
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
  await click('Done');
  expect(host.querySelector('[aria-label="Saved flashcard sessions"]')).toBeNull();
});
it('resumes a shuffled cram session with no rating history and saves even when the view closes directly', async () => {
  const cards = services.index.getSnapshot().cards;
  await services.reviews.startSession([cards[2]!, cards[0]!, cards[1]!], 'cram');
  await mount();
  await click('Resume', true);
  expect(host.textContent).toContain('Question c');
  await key(' ');
  await key(' ');
  expect(host.textContent).toContain('Question a');
  await reload();
  await click('Resume', true);
  expect(host.textContent).toContain('Question a');
  expect(host.textContent).toContain('2 / 3');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().history).toEqual([]);
});
it('shows save failure without moving the card and retries without duplicating the review', async () => {
  const session = await services.reviews.startSession(services.index.getSnapshot().cards);
  let fail = true;
  const store = new ReviewStore(async (d) => {
    if (fail) throw new Error('Disk full');
    await persist(d);
  });
  store.load(persisted);
  services = { ...services, reviews: store };
  await mount();
  await click('Resume', true);
  expect(host.textContent).toContain('Disk full');
  fail = false;
  await click('Resume', true);
  await key(' ');
  fail = true;
  await key('3');
  expect(host.textContent).toContain('Disk full');
  expect(host.textContent).toContain('Question a');
  expect(store.getSnapshot().sessions.find((s) => s.id === session.id)!.position).toBe(0);
  fail = false;
  await key('3');
  expect(host.textContent).toContain('Question b');
  expect(store.getSnapshot().history).toHaveLength(1);
});

it('starts Due study with learning repeats and resumes a queue after every original card was visited', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = new Date('2026-10-09T12:00:00Z').getTime();
  vi.setSystemTime(now);
  await mount();
  await click('Study');
  await click('Select all');
  const mode = host.querySelector('[aria-label="Study mode"]') as HTMLSelectElement;
  await act(async () => {
    mode.value = 'due';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Start');
  expect(services.reviews.getSnapshot().sessions[0]!.repeatLearning).toBe(true);
  await key(' ');
  await key('1');
  await key(' ');
  await key('4');
  await key(' ');
  await key('4');
  expect(host.textContent).toContain('Learning cards return soon');
  await click('Save and leave');
  expect(host.textContent).toContain('3 of 3 reviewed · 1 learning');
  await reload();
  await click('Resume', true);
  expect(host.textContent).toContain('Learning cards return soon');
  await click('Save and leave');
  vi.setSystemTime(now + 60_000);
  await reload();
  await click('Resume', true);
  expect(host.textContent).toContain('Question a');
  expect(host.textContent).toContain('Learning review');
  await key(' ');
  await key('4');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('3 / 3');
  expect(host.textContent).toContain('4 reviews, including learning repeats');
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
});
