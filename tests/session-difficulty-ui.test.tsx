// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SessionDifficultyChart } from '../src/components/SessionDifficultyChart';
import type { Rating } from '../src/review/scheduler';

let host: HTMLElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(ratings: Rating[]) {
  await act(async () =>
    root.render(
      <SessionDifficultyChart
        results={ratings.map((rating, i) => ({ cardId: String(i), rating }))}
      />,
    ),
  );
}

it('plots actual rating frequencies and percentages with an accessible median', async () => {
  await render([1, 2, 3, 3, 3, 4]);
  expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe(
    '6 rated cards. Again: 1, Hard: 1, Good: 3, Easy: 1. Median: Good.',
  );
  expect(
    [...host.querySelectorAll('.qard-difficulty-point')].map((p) => Number(p.getAttribute('cy'))),
  ).toEqual([108, 108, 28, 108]);
  expect(host.querySelector('.qard-difficulty-marker')?.getAttribute('d')).toBe('M 300 28 V 148');
  expect(
    [...host.querySelectorAll('.qard-difficulty-ratings small')].map((p) => p.textContent),
  ).toEqual(['17%', '17%', '50%', '17%']);
});

it('places an even median between the two middle ratings, including a split distribution', async () => {
  await render([1, 1, 4, 4]);
  expect(host.querySelector('.qard-difficulty-median')?.textContent).toBe('Median Again / Easy');
  expect(host.querySelector('.qard-difficulty-marker')?.getAttribute('d')).toBe('M 240 28 V 148');
  expect(
    [...host.querySelectorAll('.qard-difficulty-point')].map((p) => Number(p.getAttribute('cy'))),
  ).toEqual([28, 148, 148, 28]);
});

it('handles a single rating and omits the chart when there are no rated cards', async () => {
  await render([4]);
  expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain('1 rated card.');
  expect(host.querySelector('.qard-difficulty-scale')?.textContent).toBe('1 card');
  expect(host.querySelector('.qard-difficulty-marker')?.getAttribute('d')).toBe('M 420 28 V 148');
  expect(host.querySelector('.qard-difficulty-line')?.getAttribute('d')).not.toMatch(
    /NaN|Infinity/,
  );
  await render([]);
  expect(host.querySelector('figure')).toBeNull();
});
