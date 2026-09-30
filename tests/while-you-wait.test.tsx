// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { WhileYouWait, cardsFor } from '../src/components/jobs/WhileYouWait';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000, NOW = Date.now();
const card = (id: string, file: string) => ({ id, stable: true, deck: 'DS346', topic: 'T', frontMarkdown: `Front ${id}`, backMarkdown: `Back ${id}`, sourceFile: file, sourcePosition: { start: 0, end: 0, line: 0, calloutStart: 0 }, sourceText: '', tags: [] });
const state = (id: string, due: number) => ({ cardId: id, reviewCount: 2, due, interval: 1, ease: 2.5, lapses: 0 });
let host: HTMLElement, root: Root, services: QardServices, review: ReturnType<typeof vi.fn>;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  review = vi.fn(async () => {});
  const cards = [card('topic', 'Notes/Topic Models.md'), card('other', 'Notes/Cloud.md'), card('prereq', 'Notes/Dirichlet.md'), card('fresh', 'Notes/Cloud.md')];
  const states = { topic: state('topic', NOW - DAY), other: state('other', NOW - 2 * DAY), prereq: state('prereq', NOW + 5 * DAY) };
  services = { host, owner: new Component(), app: { workspace: { openLinkText: vi.fn() } },
    index: { getSnapshot: () => ({ cards }) }, reviews: { getSnapshot: () => ({ states, links: { prereq: { mastery: 'm', objective: 'dir', lapses: 0 } } }), review },
    learn: { todayList: async () => ({ checks: [], lessons: [], moreLessons: 0, cards: 0 }), cardLapse: vi.fn(async () => {}) },
    tests: { list: async () => [] } } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await new Promise(r => setTimeout(r, 0)); }); };
const buttons = (text: string) => [...host.querySelectorAll('button')].filter(b => b.textContent?.includes(text));

it('picks cards for the situation: nothing from the test being written, prerequisites before a lesson', () => {
  expect(cardsFor(services, { kind: 'mapping' }, NOW).cards.map(c => c.id)).toEqual(['other', 'topic']);
  expect(cardsFor(services, { kind: 'test', avoid: { files: ['Notes/Topic Models.md'] } }, NOW).cards.map(c => c.id)).toEqual(['other']);
  // Warm-up includes a prerequisite's cards even before they are due.
  expect(cardsFor(services, { kind: 'lesson', prefer: { objectives: ['dir'] } }, NOW)).toMatchObject({ cards: [{ id: 'prereq' }], warmup: true });
  expect(cardsFor(services, { kind: 'lesson', prefer: { files: ['Notes/Nothing.md'] } }, NOW).warmup).toBe(false);
});

it('offers cards while waiting, keeps you there once you start, and shows a ready bar when the job is done', async () => {
  const onEngage = vi.fn(), onContinue = vi.fn();
  const render = (ready: boolean) => act(async () => { root.render(<WhileYouWait services={services} title="Writing your test…" context={{ kind: 'test', avoid: { files: ['Notes/Topic Models.md'] } }} ready={ready} readyLabel="Your test is ready" onEngage={onEngage} onContinue={onContinue}/>); });
  await render(false); await tick();
  expect(host.textContent).toContain('Writing your test…');
  expect(host.textContent).toContain('Front other');
  await click(buttons('Show answer')[0]);
  expect(onEngage).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Back other');
  await click(buttons('Good')[0]);
  expect(review).toHaveBeenCalledWith('other', 3);
  expect(host.textContent).toContain('1 card reviewed');
  await render(true);
  expect(host.querySelector('.qard-wait-ready')?.textContent).toContain('Your test is ready');
  await click(buttons('Continue')[0]);
  expect(onContinue).toHaveBeenCalledOnce();
});

it('prefers a due check when there is time, and lets you switch activity', async () => {
  (services.learn as unknown as { todayList: () => Promise<unknown> }).todayList = async () => ({ checks: [{ mastery: 'm', objective: 'dir', title: 'Dirichlet draws', check: 'Qard/Checks/x.json', state: 'taught', due: '2026-09-30', course: 'DS346' }], lessons: [], moreLessons: 0, cards: 0 });
  (services.learn as unknown as Record<string, unknown>).loadCheck = () => new Promise(() => {});
  (services.learn as unknown as Record<string, unknown>).checkAt = () => undefined;
  (services.learn as unknown as Record<string, unknown>).subscribe = () => () => {};
  const snapshot = { revision: 0, jobs: {} };
  (services.learn as unknown as Record<string, unknown>).getSnapshot = () => snapshot;
  await act(async () => { root.render(<WhileYouWait services={services} title="Mapping DS346…" context={{ kind: 'mapping' }}/>); }); await tick();
  expect(buttons('Check · Dirichlet draws')[0]?.getAttribute('aria-pressed')).toBe('true');
  await click(buttons('Cards · 2')[0]);
  expect(host.textContent).toContain('Front other');
});
