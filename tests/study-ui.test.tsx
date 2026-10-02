// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { StudyView } from '../src/views/StudyView';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import type { QardServices } from '../src/views/services';
import { ignoresStudyKey } from '../src/review/keyboard';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, services: QardServices;
const cards = parseCards('<!-- qard-id: first -->\n> [!qard]- Question\n> Answer\n', 'a.md').cards;
const exit = vi.fn();
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  services = { host, owner: new Component(), reviews: new ReviewStore(async () => {}), setFocus: vi.fn(), isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } }, openSource: vi.fn() } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount() { await act(async () => root.render(<StudyView cards={cards} services={services} exit={exit} repeat={vi.fn()}/>)); }
async function key(key: string, target: HTMLElement = host) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await services.reviews.flush(); }); }
it('requires reveal, rates exactly once, completes every card, and escapes focus on the summary', async () => {
  await mount(); await key('3'); expect(services.reviews.getSnapshot().history).toHaveLength(0);
  await key('f'); expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await key(' '); expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('false');
  await act(async () => { for (let i = 0; i < 2; i++) host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); await services.reviews.flush(); });
  expect(services.reviews.getSnapshot().history).toHaveLength(1); expect(host.textContent).toContain('1 / 1');
  await key('Escape'); expect(services.setFocus).toHaveBeenLastCalledWith(false);
});
it('ignores typing and inactive workspace views', async () => {
  await mount(); const input = document.createElement('textarea'); host.append(input);
  await key(' ', input); expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  services.isActive = () => false; await key(' '); expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  input.remove();
});
it('unmount removes the keyboard listener, render children and focus state', async () => {
  await mount(); await key('f');
  const remove = vi.spyOn(document, 'removeEventListener');
  await act(async () => root.render(null));
  expect(remove.mock.calls.some(call => call[0] === 'keydown' && call[2] === true)).toBe(true);
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  expect((services.owner as unknown as { children: Set<unknown> }).children.size).toBe(0);
  expect(services.app.workspace.offref).toHaveBeenCalled();
});
it('guards rich text, media, modal fields, composition, held keys and shortcuts', () => {
  for (const element of ['input', 'textarea', 'select', 'audio', 'video', 'div']) {
    const target = document.createElement(element); if (element === 'div') target.setAttribute('contenteditable', 'true');
    const event = new KeyboardEvent('keydown', { key: ' ' }); Object.defineProperty(event, 'target', { value: target }); expect(ignoresStudyKey(event)).toBe(true);
  }
  for (const option of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) expect(ignoresStudyKey(new KeyboardEvent('keydown', { key: '1', [option]: true }))).toBe(true);
});

it('flips in both directions without exposing hidden links or delaying rapid keyboard input', async () => {
  await mount();
  const front = host.querySelector('.qard-study-front')!, back = host.querySelector('.qard-study-back')!;
  expect(back.hasAttribute('inert')).toBe(true);
  await key(' ');
  expect(front.hasAttribute('inert')).toBe(true);
  expect(back.hasAttribute('inert')).toBe(false);
  await key(' ');
  expect(front.hasAttribute('inert')).toBe(false);
  expect(back.hasAttribute('inert')).toBe(true);
  await key(' ');
  expect(host.querySelector('.qard-study-back')).toBe(back);
  expect(host.querySelector('.qard-study-card')?.classList.contains('is-revealed')).toBe(true);
  await key('3');
  expect(host.textContent).toContain('Session complete');
});

it('previews FSRS intervals after reveal without rating the card and hides them with scheduling off', async () => {
  await mount();
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(0);
  await key(' ');
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(4);
  expect(host.querySelector('[aria-label="Next review in 1 min"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Next review in 10 min"]')).not.toBeNull();
  expect(host.querySelector('.qard-rating-2')?.getAttribute('title')).toBe('I recalled it with effort');
  expect(services.reviews.getSnapshot().history).toHaveLength(0);
  await act(async () => services.reviews.saveSettings({ ...services.reviews.getSnapshot().settings, scheduling: false }));
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(0);
  await key('3');
  expect(host.textContent).toContain('Session complete');
  expect(services.reviews.getSnapshot().states.first!.fsrs).toBeDefined();
  expect(services.reviews.getSnapshot().states.first!.due).toBeUndefined();
});
