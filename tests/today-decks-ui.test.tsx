// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { CardIndex } from '../src/cards/card-index';
import { serializeCard } from '../src/cards/source-patch';
import { ReviewStore } from '../src/review/review-store';
import { DAY } from '../src/review/scheduler';
import { todayDueCards } from '../src/review/today-cards';
import { TodayView } from '../src/components/learn/TodayView';
import { QardApp } from '../src/views/QardApp';
import type { LearnNav } from '../src/views/navigation';
import type { QardServices } from '../src/views/services';
import type { QardCard } from '../src/cards/card-types';

let root: Root, host: HTMLElement, services: QardServices, index: CardIndex;
const now = new Date(2026, 9, 10, 12).getTime();
const nav: LearnNav = {
  library: vi.fn(),
  today: vi.fn(),
  learn: vi.fn(),
  mapCourse: vi.fn(),
  course: vi.fn(),
  check: vi.fn(),
  lesson: vi.fn(),
  studyDue: vi.fn(),
};
function note(deck: string, ids: string[], topic?: string) {
  return (
    `---\nqard-deck: ${deck}\n${topic ? `qard-topic: ${topic}\n` : ''}---\n` +
    ids.map((id) => serializeCard(id, `Question ${id}`, `Answer ${id}`)).join('\n')
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  index = new CardIndex();
  index.setLoading(false);
  index.update(
    'Networks.md',
    note('Networks', ['recent', 'oldest', 'new', 'paused', 'buried', 'future', 'duplicate']),
  );
  index.update('Biology.md', note('Biology', ['bio', 'duplicate']));
  index.update('History.md', note('History', ['history-new']));
  const reviews = new ReviewStore(async () => {});
  await reviews.saveSettings({ ...reviews.getSnapshot().settings, scheduler: 'simple' });
  for (const id of ['recent', 'bio', 'paused', 'buried', 'duplicate'])
    await reviews.review(id, 3, now - 30 * DAY);
  await reviews.review('oldest', 3, now - 40 * DAY);
  await reviews.review('future', 3, now);
  await reviews.setPaused('paused', true);
  const data = reviews.getSnapshot();
  reviews.load({
    ...data,
    states: { ...data.states, buried: { ...data.states.buried!, buriedUntil: now + DAY } },
  });
  const snapshot = { revision: 0, jobs: {} };
  const collection = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    list: async () => [],
    get: () => undefined,
    // Deliberately stale: the visible queue must use the live card/review index.
    todayList: async () => ({ checks: [], lessons: [], moreLessons: 0, cards: 99 }),
    prepare: vi.fn(),
    job: () => undefined,
  };
  services = {
    host,
    owner: new Component(),
    index,
    reviews,
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
  vi.restoreAllMocks();
});
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await services.reviews.flush();
}
async function mount(app = false) {
  await act(async () => {
    root.render(
      app ? (
        <QardApp services={services} request={{ kind: 'today', serial: 1 }} />
      ) : (
        <TodayView services={services} nav={nav} />
      ),
    );
    await tick();
  });
  await act(tick);
}
async function click(button: HTMLButtonElement | null) {
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
    await tick();
  });
}

it('shows each eligible deck with an accurate count and sends its identity to Study', async () => {
  await mount();
  expect(host.textContent).toContain('3 due cards · 2 decks');
  expect([...host.querySelectorAll('.qard-today-deck')].map((row) => row.textContent)).toEqual([
    'Biology1 card due for review Study all',
    'Networks2 cards due for review Study all',
  ]);
  expect(host.querySelector('.qard-doc-footer')).toBeNull();
  await click(host.querySelector('[aria-label="Study Networks: 2 due cards"]'));
  expect(nav.studyDue).toHaveBeenCalledWith('Networks');
  expect(
    todayDueCards(index.getSnapshot().cards, services.reviews.getSnapshot().states).map(
      (c) => c.id,
    ),
  ).toEqual(['oldest', 'recent', 'bio']);
});

async function addTopics() {
  index.update(
    'Networks.md',
    note('Networks', ['recent', 'new', 'paused', 'buried', 'future', 'duplicate'], 'Routing'),
  );
  index.update('Transport.md', note('Networks', ['oldest', 'transport-oldest'], 'Transport'));
  index.update('Biology.md', note('Biology', ['bio', 'duplicate'], 'Transport'));
  index.update('Not-due.md', note('Networks', ['topic-new'], 'Not due'));
  await services.reviews.review('transport-oldest', 3, now - 50 * DAY);
}

it('shows only due topics under their deck, including the default General topic', async () => {
  await mount();
  expect(host.querySelectorAll('.qard-today-topic')).toHaveLength(2);
  expect(
    host.querySelector('[aria-label="Study General in Networks: 2 due cards"]'),
  ).not.toBeNull();
  await act(addTopics);
  expect(host.textContent).toContain('4 due cards · 2 decks');
  const topics = [...host.querySelectorAll('.qard-today-topic')].map((row) =>
    row.getAttribute('aria-label'),
  );
  expect(topics).toEqual([
    'Study Transport in Biology: 1 due card',
    'Study Routing in Networks: 1 due card',
    'Study Transport in Networks: 2 due cards',
  ]);
  expect(host.textContent).not.toContain('Not due');
  await click(host.querySelector('[aria-label="Study Transport in Networks: 2 due cards"]'));
  expect(nav.studyDue).toHaveBeenCalledWith('Networks', 'Transport');
});

it('starts and saves only the chosen topic in the chosen deck, oldest due first', async () => {
  await addTopics();
  const start = vi.spyOn(services.reviews, 'startSession');
  await mount(true);
  await click(host.querySelector('[aria-label="Study Transport in Networks: 2 due cards"]'));
  expect(host.textContent).toContain('Question transport-oldest');
  expect(services.reviews.getSnapshot().sessions[0]).toMatchObject({
    cardIds: ['transport-oldest', 'oldest'],
    title: 'Networks',
    style: 'normal',
  });
  expect(start).toHaveBeenCalledWith(expect.any(Array), 'normal', undefined, 'due');
  expect(host.textContent).not.toContain('Question bio');
  expect(host.textContent).not.toContain('Question recent');
});

it('updates topic membership and removes topics when their last due card is paused', async () => {
  await addTopics();
  await mount();
  await act(async () => services.reviews.setPaused('recent', true));
  expect(host.querySelector('[aria-label="Study Routing in Networks: 1 due card"]')).toBeNull();
  await act(async () =>
    index.update(
      'Transport.md',
      note('Networks', ['oldest', 'transport-oldest'], 'Reliable delivery'),
    ),
  );
  expect(host.querySelector('[aria-label="Study Transport in Networks: 2 due cards"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Study Reliable delivery in Networks: 2 due cards"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('[aria-label="Study Transport in Biology: 1 due card"]'),
  ).not.toBeNull();
});

it('starts and saves only the chosen deck in overdue order', async () => {
  await addTopics();
  await mount(true);
  await click(host.querySelector('[aria-label="Study Networks: 3 due cards"]'));
  expect(host.textContent).toContain('Question transport-oldest');
  expect(services.reviews.getSnapshot().sessions[0]).toMatchObject({
    cardIds: ['transport-oldest', 'oldest', 'recent'],
    title: 'Networks',
    style: 'normal',
  });
  expect(host.textContent).not.toContain('Question bio');
});

it('updates the visible deck counts after pauses, note changes and answer checks', async () => {
  await mount();
  await act(async () => {
    await services.reviews.setPaused('recent', true);
  });
  expect(host.querySelector('[aria-label="Study Networks: 1 due card"]')).not.toBeNull();
  await act(async () => {
    await services.reviews.requireContentCheck('future');
  });
  expect(host.querySelector('[aria-label="Study Networks: 2 due cards"]')).not.toBeNull();
  await act(async () => index.remove('Biology.md'));
  expect(host.textContent).not.toContain('Biology');
  await act(async () => index.remove('Networks.md'));
  expect(host.textContent).toContain('Nothing is due.');
  expect(host.querySelector('.qard-today-deck')).toBeNull();
});

it('keeps due checks separate from deck review actions', async () => {
  vi.spyOn(services.learn, 'todayList').mockResolvedValue({
    cards: 99,
    lessons: [],
    moreLessons: 0,
    checks: [
      {
        mastery: 'Course.md',
        course: 'Networks',
        objective: 'tcp',
        title: 'Reliable delivery',
        state: 'taught',
        due: '2026-10-10',
        check: 'Check.json',
      },
    ],
  });
  await mount();
  await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Start checks')!);
  expect(nav.check).toHaveBeenCalledWith('Check.json');
  expect(nav.studyDue).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.qard-today-deck')).toHaveLength(2);
});

it('shows the live due count on the study desk and starts only eligible cards across decks', async () => {
  const start = vi.spyOn(services.reviews, 'startSession');
  await act(async () => {
    root.render(<QardApp services={services} />);
    await tick();
  });
  expect(host.querySelector('.qard-desk-due strong')?.textContent).toBe('3');
  expect(host.querySelector('.qard-today-row')).toBeNull();
  await act(async () => services.reviews.setPaused('recent', true));
  expect(host.querySelector('.qard-desk-due strong')?.textContent).toBe('2');
  await click(
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Start review',
    )!,
  );
  expect(services.reviews.getSnapshot().sessions[0]).toMatchObject({
    cardIds: ['oldest', 'bio'],
    style: 'normal',
  });
  expect(start).toHaveBeenCalledWith(expect.any(Array), 'normal', undefined, 'due');
});
