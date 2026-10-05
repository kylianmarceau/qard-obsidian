// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StatisticsView } from '../src/components/statistics/StatisticsView';
import { QardApp } from '../src/views/QardApp';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { addDays, isoDay } from '../src/learn/mastery';
import type { QardServices } from '../src/views/services';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, services: QardServices;
const back = vi.fn(), study = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 2, 12));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const index = new CardIndex(); index.setLoading(false);
  index.update('cards.md', '---\nqard-deck: Networks\n---\n<!-- qard-id: a -->\n> [!qard]- TCP\n> Reliable delivery\n');
  services = { reviews: new ReviewStore(async () => {}), index, host, setFocus: vi.fn(), isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } } } as unknown as QardServices;
  back.mockClear(); study.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()); };
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;

it('shows honest empty states and offers studying without fabricating performance', async () => {
  await act(async () => root.render(<StatisticsView services={services} back={back} study={study}/>));
  expect(host.textContent).toContain('Your first review starts the story.');
  expect(host.querySelectorAll('.qard-stats-cell')).toHaveLength(365);
  expect(host.querySelectorAll('.qard-stats-cell:not([disabled])')).toHaveLength(275);
  expect(host.textContent).toContain('Review a card to see its difficulty here.');
  expect(host.textContent).not.toContain('NaN');
  await click(button('Study cards')); expect(study).toHaveBeenCalledWith();
  await click(button('Back to decks')); expect(back).toHaveBeenCalledOnce();
});

it('updates after a review, filters periods, navigates years and supports keyboard day inspection', async () => {
  const today = isoDay(Date.now());
  await services.reviews.review('a', 1, new Date(`${addDays(today, -20)}T12:00:00`).getTime());
  await services.reviews.review('a', 4, Date.now());
  await services.reviews.review('a', 3, new Date(2025, 11, 31, 12).getTime());
  await act(async () => root.render(<StatisticsView services={services} back={back} study={study}/>));
  expect(host.querySelector('.qard-stats-metrics')?.textContent).toContain('50%');
  await click(button('7 days')); expect(host.querySelector('.qard-stats-metrics')?.textContent).toContain('100%');
  await click(button('Saved history')); expect(host.querySelector('.qard-stats-metrics dd')?.textContent).toBe('3');
  await act(async () => { await services.reviews.review('a', 2, Date.now()); });
  expect(host.querySelector('.qard-stats-metrics dd')?.textContent).toBe('4');
  const cell = host.querySelector<HTMLButtonElement>(`[data-day="${today}"]`)!;
  await act(async () => { cell.focus(); cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  expect(document.activeElement?.getAttribute('data-day')).toBe(addDays(today, -7));
  expect(host.querySelectorAll('.qard-stats-cell[tabindex="0"]')).toHaveLength(1);
  await click(host.querySelector('[aria-label="Previous year"]'));
  expect((host.querySelector('[aria-label="Activity year"]') as HTMLSelectElement).value).toBe('2025');
  expect(host.querySelectorAll('.qard-stats-cell[disabled]')).toHaveLength(0);
  await click(host.querySelector('[aria-label="Study Networks"]')); expect(study).toHaveBeenCalledWith('Networks');
});

it('opens from the workspace header and a command request, and returns to the deck study builder', async () => {
  const snapshot = { revision: 0, jobs: {} };
  Object.assign(services, { tests: { getSnapshot: () => snapshot, subscribe: () => () => {}, list: async () => [], todayList: async () => ({ checks: [], lessons: [], cards: 0 }), get: () => undefined }, learn: { getSnapshot: () => snapshot, subscribe: () => () => {}, list: async () => [], todayList: async () => ({ checks: [], lessons: [], cards: 0 }) } });
  await act(async () => root.render(<QardApp services={services} request={{ serial: 1, kind: 'statistics' }}/>));
  expect(host.querySelector('h1')?.textContent).toBe('Statistics');
  expect(host.querySelector('[aria-label="Study statistics"]')?.getAttribute('aria-current')).toBe('page');
  await click(host.querySelector('[aria-label="Study Networks"]'));
  expect(host.querySelector('h1')?.textContent).toBe('Study');
  await click(host.querySelector('[aria-label="Study statistics"]'));
  expect(host.querySelector('h1')?.textContent).toBe('Statistics');
});

it('shows real FSRS memory estimates and explains incomplete migrated history', async () => {
  await services.reviews.review('a', 4, Date.now());
  await act(async () => root.render(<StatisticsView services={services} back={back} study={study}/>));
  const panel = host.querySelector('[aria-label="FSRS memory estimates"]')!;
  expect(panel.textContent).toContain('90% target retention');
  expect(panel.textContent).toContain('Predicted recall now100%');
  expect(panel.textContent).toContain('Median stability');
  expect(panel.textContent).not.toContain('incomplete history');
  await act(async () => { vi.setSystemTime(Date.now() + 7 * 86400000); vi.advanceTimersByTime(60_000); });
  expect(panel.textContent).not.toContain('Predicted recall now100%');
  await act(async () => services.reviews.saveSettings({ ...services.reviews.getSnapshot().settings, scheduler: 'simple' }));
  expect(host.querySelector('[aria-label="FSRS memory estimates"]')).toBeNull();
  expect(host.textContent).toContain('Choose FSRS in Settings');
});
