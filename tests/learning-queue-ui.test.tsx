// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { StudyView } from '../src/views/StudyView';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import type { QardServices } from '../src/views/services';
import type { SavedSession } from '../src/review/saved-session';

let host: HTMLElement, root: Root, services: QardServices;
const now = new Date('2026-10-09T12:00:00Z').getTime();
const cards = ['a', 'b', 'c'].map(
  (id) =>
    parseCards(`<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer ${id}`, 'deck.md')
      .cards[0]!,
);
const exit = vi.fn();
const persist = vi.fn(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  exit.mockReset();
  persist.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  services = {
    host,
    owner: new Component(),
    reviews: new ReviewStore(persist),
    setFocus: vi.fn(),
    isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } },
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function mount(session: SavedSession, selected = cards) {
  await act(async () =>
    root.render(
      <StudyView
        cards={selected}
        session={session}
        services={services}
        exit={exit}
        repeat={vi.fn()}
      />,
    ),
  );
}
async function key(key: string) {
  await act(async () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await services.reviews.flush().catch(() => {});
  });
}
async function click(text: string) {
  await act(async () => {
    const button = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith(text),
    );
    expect(button, host.textContent ?? '').toBeDefined();
    button!.click();
    await services.reviews.flush().catch(() => {});
  });
}
async function elapsed(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it('keeps a missed card unfinished in a 52-card deck and completes it only after its returning review', async () => {
  const deck = Array.from(
    { length: 52 },
    (_, i) =>
      parseCards(
        `<!-- qard-id: card${i} -->\n> [!qard]- Deck question ${i}\n> Answer ${i}`,
        'deck.md',
      ).cards[0]!,
  );
  const session = await services.reviews.startSession(deck);
  await mount(session, deck);
  const progress = () => host.querySelector('progress')!.value;
  expect(host.textContent).toContain('0 / 52 completed');
  await key(' ');
  await key('1');
  expect(host.textContent).toContain('Deck question 1');
  expect(host.textContent).toContain('0 / 52 completed · 1 learning');
  expect(progress()).toBe(0);
  await key(' ');
  await key('4');
  expect(progress()).toBe(1);
  await elapsed(60_000);
  expect(host.textContent).toContain('Deck question 2');
  await key(' ');
  await key('4');
  expect(host.textContent).toContain('Deck question 0');
  expect(host.textContent).toContain('Learning review · 2 / 52 completed');
  expect(progress()).toBe(2);
  await key(' ');
  await key('4');
  expect(host.textContent).toContain('Deck question 3');
  expect(host.textContent).toContain('3 / 52 completed');
  expect(progress()).toBe(3);
  expect(services.reviews.getSnapshot().history).toHaveLength(4);
  await key('u');
  expect(host.textContent).toContain('Learning review · 2 / 52 completed');
  expect(progress()).toBe(2);
  expect(services.reviews.getSnapshot().history).toHaveLength(3);
});

it('waits for real FSRS intervals, returns hidden questions automatically, and counts unique cards separately from repeats', async () => {
  const session = await services.reviews.startSession([cards[0]!], 'normal', undefined, 'due');
  await mount(session, [cards[0]!]);
  await key(' ');
  await key('1');
  expect(host.textContent).toContain('Learning cards return soon');
  expect(host.textContent).toContain('0 / 1 completed');
  expect(host.textContent).toContain('next card returns in 1 minute');
  await elapsed(59_999);
  expect(host.querySelector('.qard-study-card')).toBeNull();
  await elapsed(1);
  expect(host.textContent).toContain('Learning review');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('next card returns in 10 minutes');
  expect(host.textContent).toContain('0 / 1 completed');
  await elapsed(600_000);
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('1 / 1');
  expect(host.textContent).toContain('3 reviews, including learning repeats');
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
});

it('does not interrupt the current question when another card becomes due; interleaves it at the next boundary', async () => {
  const session = await services.reviews.startSession(cards, 'normal', undefined, 'due');
  await mount(session);
  await key(' ');
  await key('1');
  expect(host.textContent).toContain('Question b');
  await key(' ');
  await elapsed(60_000);
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('false');
  expect(host.textContent).toContain('Question b');
  await key('4');
  expect(host.textContent).toContain('Question a');
  expect(host.textContent).toContain('Learning review');
  await key('s');
  expect(host.textContent).toContain('Question c');
  expect(host.textContent).toContain('1 / 3 completed');
  expect(services.reviews.getSnapshot().sessions[0]!.position).toBe(2);
  expect(services.reviews.getSnapshot().sessions[0]!.learning).toEqual([]);
});

it('saves waiting sessions and resumes the pending card after a full restart', async () => {
  const session = await services.reviews.startSession([cards[0]!], 'normal', undefined, 'due');
  await mount(session, [cards[0]!]);
  await key(' ');
  await key('1');
  await click('Save and leave');
  expect(exit).toHaveBeenCalledOnce();
  const persisted = JSON.parse(JSON.stringify(services.reviews.getSnapshot()));
  const clear = vi.spyOn(window, 'clearInterval');
  await act(async () => root.render(null));
  expect(clear).toHaveBeenCalled();
  await elapsed(120_000);
  const restored = new ReviewStore(persist);
  restored.load(persisted);
  services = { ...services, reviews: restored };
  const resumed = await restored.resumeSession(session.id, cards);
  await mount(resumed.session, resumed.cards);
  expect(host.textContent).toContain('Question a');
  expect(host.textContent).toContain('Learning review');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(restored.getSnapshot().history).toHaveLength(1);
});

it('undo restores the first-pass card from waiting and the repeated card after graduation', async () => {
  const session = await services.reviews.startSession([cards[0]!], 'normal', undefined, 'due');
  await mount(session, [cards[0]!]);
  await key(' ');
  await key('1');
  await key('u');
  expect(host.textContent).toContain('0 / 1 completed');
  expect(host.textContent).toContain('Question a');
  expect(services.reviews.getSnapshot().history).toEqual([]);
  await key(' ');
  await key('3');
  await elapsed(600_000);
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Session complete');
  await key('u');
  expect(host.textContent).toContain('Learning review');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(services.reviews.getSnapshot().sessions[0]!.learning).toHaveLength(1);
});

it('finishes early without changing schedules, reports a failed finish and allows retry', async () => {
  const session = await services.reviews.startSession([cards[0]!], 'normal', undefined, 'due');
  await mount(session, [cards[0]!]);
  await key(' ');
  await key('1');
  const before = services.reviews.getSnapshot();
  persist.mockRejectedValueOnce(new Error('disk full'));
  await click('Finish session');
  expect(host.textContent).toContain('disk full');
  expect(host.textContent).toContain('Learning cards return soon');
  expect(services.reviews.getSnapshot()).toBe(before);
  await click('Finish session');
  expect(host.textContent).toContain('Session complete');
  expect(services.reviews.getSnapshot().states).toBe(before.states);
  expect(services.reviews.getSnapshot().history).toBe(before.history);
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
  await elapsed(120_000);
  expect(host.textContent).toContain('Session complete');
});

it('pauses a returning card without recording another rating or leaving a pending session', async () => {
  const session = await services.reviews.startSession([cards[0]!], 'normal', undefined, 'due');
  await mount(session, [cards[0]!]);
  await key(' ');
  await key('1');
  await elapsed(60_000);
  await click('Pause card');
  expect(host.textContent).toContain('Session complete');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(services.reviews.getSnapshot().states.a!.paused).toBe(true);
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
});
