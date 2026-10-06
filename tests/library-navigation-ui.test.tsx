// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { QardApp } from '../src/views/QardApp';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { localDay } from '../src/exams/exam-plan';
import type { QardServices } from '../src/views/services';

let host: HTMLElement, root: Root, services: QardServices;
beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const index = new CardIndex();
  index.setLoading(false);
  index.update(
    'networks.md',
    '---\nqard-deck: Networks\n---\n<!-- qard-id: a -->\n> [!qard]- TCP\n> Reliable delivery\n',
  );
  const snapshot = { revision: 0, jobs: {} };
  const collection = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    list: async () => [],
    get: () => undefined,
    todayList: async () => ({ checks: [], lessons: [], cards: 0 }),
    courses: async () => [],
    listLessons: async () => [],
    pending: async () => ({ mapping: [], failed: [], proposals: [], updates: [] }),
  };
  services = {
    host,
    owner: new Component(),
    index,
    reviews: new ReviewStore(async () => {}),
    tests: collection,
    learn: collection,
    setFocus: vi.fn(),
    isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } },
  } as unknown as QardServices;
  await services.reviews.saveExam({
    id: 'exam',
    name: 'Networks final',
    date: localDay(),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    dailyLimit: 30,
    selection: { decks: ['Networks'], topics: [], cards: [] },
    createdAt: Date.now(),
  });
  await act(async () => root.render(<QardApp services={services} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const selected = () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
async function key(value: string) {
  await act(async () => {
    selected().focus();
    selected().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it('navigates all four workspaces with the keyboard, preserves focus and keeps saved plans intact', async () => {
  expect(selected().textContent).toBe('Decks');
  expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
    'Decks',
    'Tests',
    'Learn',
    'Plans',
  ]);
  expect(host.querySelector('.qard-topbar-actions')?.textContent).not.toContain('Exam plans');
  await key('ArrowRight');
  expect(selected().textContent).toBe('Tests');
  expect(host.textContent).toContain('No tests yet.');
  expect(document.activeElement).toBe(selected());
  await key('ArrowRight');
  expect(selected().textContent).toBe('Learn');
  expect(host.textContent).toContain('No courses yet.');
  await key('End');
  expect(selected().textContent).toBe('Plans');
  expect(host.textContent).toContain('Networks final');
  expect(document.activeElement).toBe(selected());
  await click('New exam');
  expect(host.querySelector('input[placeholder="Biology final"]')).not.toBeNull();
  await click('Cancel');
  expect(selected().textContent).toBe('Plans');
  expect(host.textContent).toContain('Networks final');
  await key('ArrowRight');
  expect(selected().textContent).toBe('Decks');
  await key('ArrowLeft');
  expect(selected().textContent).toBe('Plans');
  await key('Home');
  expect(selected().textContent).toBe('Decks');
  expect(services.reviews.getSnapshot().exams).toHaveLength(1);
  expect(services.reviews.getSnapshot().states).toEqual({});
});
