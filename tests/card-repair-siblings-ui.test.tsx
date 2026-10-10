// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component, TFile, type App } from 'obsidian';
import { CardWriter } from '../src/cards/card-writer';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
import { ReviewStore } from '../src/review/review-store';
import { serializeCard } from '../src/cards/source-patch';
import { clozeFront, FORMAT_BACK } from '../src/cards/card-format';
import { StudyView } from '../src/views/StudyView';
import { QardApp } from '../src/views/QardApp';
import type { QardServices } from '../src/views/services';
import { DAY } from '../src/review/scheduler';

let root: Root, host: HTMLElement, services: QardServices, index: CardIndex, source: string;
const persist = vi.fn(async () => {});
const now = new Date(2026, 9, 10, 12).getTime();
const exit = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  persist.mockReset();
  exit.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  index = new CardIndex();
  index.setLoading(false);
  source =
    serializeCard('a', 'Question a', 'Answer a') +
    '\n' +
    serializeCard('b', 'Question b', 'Answer b');
  index.update('deck.md', source);
  const file = new (TFile as unknown as new (path: string) => TFile)('deck.md');
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: async () => source,
      process: vi.fn(async (_file: TFile, patch: (text: string) => string) => {
        source = patch(source);
      }),
    },
    workspace: { on: vi.fn(), offref: vi.fn() },
  } as unknown as App;
  Object.assign(index, { refresh: async () => index.update('deck.md', source) });
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
    index: index as VaultIndexer,
    reviews: new ReviewStore(persist),
    writer: new CardWriter(app, index as VaultIndexer),
    app,
    setFocus: vi.fn(),
    isActive: () => true,
    openSource: vi.fn(),
    learn: collection,
    tests: collection,
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function key(key: string, target = host) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await services.reviews.flush().catch(() => {});
  });
}
async function click(text: string) {
  await act(async () => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    expect(button, host.textContent ?? '').toBeDefined();
    button!.click();
    await services.reviews.flush().catch(() => {});
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    await services.reviews.flush().catch(() => {});
  });
}
async function input(selector: string, value: string) {
  await act(async () => {
    const el = host.querySelector<HTMLTextAreaElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(due = false, cram = false) {
  const cards = index.getSnapshot().cards;
  const session = await services.reviews.startSession(
    cards,
    cram ? 'cram' : 'normal',
    undefined,
    due ? 'due' : 'all',
  );
  await act(async () =>
    root.render(
      <StudyView
        cards={cards}
        services={services}
        session={session}
        style={session.style}
        exit={exit}
        repeat={vi.fn()}
      />,
    ),
  );
  return session;
}

it('edits with E, blocks review shortcuts in the editor and returns to the same card with its identity/history intact', async () => {
  await services.reviews.review('a', 4, now - DAY);
  const history = services.reviews.getSnapshot().history;
  const session = await mount();
  await key(' ');
  await key('e');
  expect(host.querySelector('h1')?.textContent).toBe('Edit card');
  await key('3');
  await key('Escape');
  expect(exit).not.toHaveBeenCalled();
  expect(services.reviews.getSnapshot().history).toBe(history);
  await input('textarea[placeholder="Answer…"]', 'Corrected answer');
  await submit();
  expect(host.textContent).toContain('Question a');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.textContent).toContain('This answer changed');
  expect(services.reviews.getSnapshot().sessions[0]).toMatchObject({ id: session.id, position: 0 });
  expect(services.reviews.getSnapshot().history).toBe(history);
  expect(index.getSnapshot().cards[0]?.id).toBe('a');
  await key(' ');
  expect(host.textContent).toContain('Corrected answer');
  await key('3');
  expect(host.textContent).toContain('Question b');
  expect(services.reviews.getSnapshot().states.a?.needsContentCheck).toBeUndefined();
});

it('cancels editing without changing the current answer or saved queue', async () => {
  await mount();
  await key(' ');
  const before = services.reviews.getSnapshot(),
    note = source;
  await key('e');
  await input('textarea[placeholder="Answer…"]', 'Unsaved');
  await click('Cancel');
  expect(source).toBe(note);
  expect(services.reviews.getSnapshot()).toBe(before);
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('false');
});

it('retries a failed answer-check save after the note was edited without rewriting or losing the card', async () => {
  await mount();
  await key('e');
  await input('textarea[placeholder="Answer…"]', 'Correction');
  persist.mockRejectedValueOnce(new Error('disk full'));
  await submit();
  expect(host.textContent).toContain('disk full');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')?.disabled,
  ).toBe(true);
  expect(index.getSnapshot().cards[0]?.backMarkdown).toBe('Correction');
  expect(services.app.vault.process).toHaveBeenCalledOnce();
  await submit();
  expect(services.app.vault.process).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('This answer changed');
  expect(host.querySelector('form')).toBeNull();
});

it('flags through More actions without advancing, reports failed saves, and keeps the flag through review and restart', async () => {
  const session = await mount();
  const before = services.reviews.getSnapshot();
  expect(host.querySelector('.qard-study-foot .qard-card-repair')).not.toBeNull();
  await click('More actions');
  expect(document.activeElement?.textContent).toBe('Needs fixing');
  await key('Escape', document.activeElement as HTMLElement);
  expect(host.querySelector('.qard-repair-menu')).toBeNull();
  expect(document.activeElement?.textContent).toBe('More actions');
  expect(host.textContent).not.toContain('Keep studying');
  persist.mockRejectedValueOnce(new Error('disk full'));
  await click('More actions');
  await click('Needs fixing');
  expect(host.textContent).toContain('disk full');
  expect(services.reviews.getSnapshot()).toBe(before);
  await click('Needs fixing');
  expect(services.reviews.getSnapshot().sessions[0]).toMatchObject({ id: session.id, position: 0 });
  await key(' ');
  await key('3');
  expect(services.reviews.getSnapshot().states.a?.needsFixing).toBe(true);
  const restored = new ReviewStore(persist);
  restored.load(JSON.parse(JSON.stringify(services.reviews.getSnapshot())));
  expect(restored.getSnapshot().states.a?.needsFixing).toBe(true);
});

it('separates sibling clozes in a saved due queue, restores them on undo, and explains deferral on completion', async () => {
  const text = '{{c1::TCP}} is {{c2::reliable}}.';
  source = [1, 2]
    .map((target) =>
      serializeCard(`c${target}`, clozeFront(text, target), FORMAT_BACK, '\n', 'sentence'),
    )
    .join('\n');
  index.update('deck.md', source);
  await mount(true);
  await key(' ');
  await key('4');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('1 related card deferred until tomorrow');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  await key('u');
  expect(host.textContent).toContain('TCP');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().states.c2).toBeUndefined();
  expect(services.reviews.getSnapshot().sessions[0]?.position).toBe(0);
  await key(' ');
  await key('1');
  expect(host.textContent).toContain('Learning cards return soon');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(host.textContent).toContain('Learning review');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
});

it('keeps every sibling available in cram without recording a rating', async () => {
  source =
    serializeCard('a', 'Question a', 'Answer', '\n', 'pair') +
    serializeCard('b', 'Question b', 'Answer', '\n', 'pair');
  index.update('deck.md', source);
  await services.reviews.review('a', 4, now, undefined, ['b']);
  const before = services.reviews.getSnapshot();
  await mount(false, true);
  await key(' ');
  await key(' ');
  expect(host.textContent).toContain('Question b');
  await key(' ');
  await key(' ');
  expect(host.textContent).toContain('Cram session complete');
  expect(services.reviews.getSnapshot().history).toBe(before.history);
  expect(services.reviews.getSnapshot().states).toBe(before.states);
});

it('offers repair guidance after failures across five days and keeps pause advisory', async () => {
  for (let day = 5; day > 0; day--) {
    for (let repeat = 0; repeat < 3; repeat++)
      await services.reviews.review('a', 1, now - day * DAY + repeat * 1000);
  }
  await mount();
  expect(host.textContent).toContain('Often forgotten');
  expect(host.textContent).toContain('Forgotten on 5 study days');
  expect(host.textContent).toContain('splitting the question');
  expect(services.reviews.getSnapshot().states.a?.paused).toBeUndefined();
  const history = services.reviews.getSnapshot().history;
  await click('Mark fixed');
  expect(host.textContent).not.toContain('Often forgotten');
  expect(services.reviews.getSnapshot().history).toBe(history);
  await click('More actions');
  await click('Needs fixing');
  await click('Pause card');
  expect(host.textContent).toContain('Question b');
  expect(services.reviews.getSnapshot().states.a).toMatchObject({
    paused: true,
    needsFixing: true,
  });
  expect(services.reviews.getSnapshot().history).toBe(history);
});

it('finds flagged and often-forgotten cards through the library filter and shows their markers in the existing deck', async () => {
  await services.reviews.setNeedsFixing('a', true);
  await act(async () => root.render(<QardApp services={services} />));
  await click('Needs fixing · 1');
  expect(host.textContent).toContain('1 cards');
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.className === 'qard-deck')!.click(),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.qard-topic-heading button')!.click(),
  );
  expect(host.querySelector('.qard-question-list')?.textContent).toContain('Needs fixing');
  expect(host.textContent).not.toContain('Question b');
  await act(async () => host.querySelector<HTMLButtonElement>('.qard-question-row')!.click());
  await click('Mark fixed');
  expect(services.reviews.getSnapshot().states.a?.needsFixing).toBeUndefined();
});
