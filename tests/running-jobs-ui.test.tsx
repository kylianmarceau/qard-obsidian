// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { RunningJobs } from '../src/components/jobs/RunningJobs';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import type { QardServices } from '../src/views/services';
import type { LearnNav, TestNav } from '../src/views/navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, cancel: ReturnType<typeof vi.fn>, open: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  cancel = vi.fn();
  open = vi.fn();
  const tests = { jobs: {} };
  const learn = {
    jobs: { 'Courses/Probability|map-course|': { kind: 'map-course', startedAt: Date.now() } },
  };
  const services = {
    owner: new Component(),
    app: {},
    reviews: { getSnapshot: () => ({ settings: DEFAULT_SETTINGS }) },
    tests: { subscribe: () => () => {}, getSnapshot: () => tests },
    learn: {
      subscribe: () => () => {},
      getSnapshot: () => learn,
      cancel,
    },
    jobs: { estimate: () => 240_000 },
  } as unknown as QardServices;
  await act(async () =>
    root.render(
      <RunningJobs
        services={services}
        nav={{} as TestNav}
        learnNav={{ mapCourse: open } as unknown as LearnNav}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const click = (selector: string) =>
  act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());

it('dismisses with Escape and returns keyboard focus to the running indicator', async () => {
  await click('.qard-jobs-button');
  expect(host.querySelector('[aria-label="Running tasks"]')).not.toBeNull();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(host.querySelector('[aria-label="Running tasks"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('.qard-jobs-button'));
});

it('dismisses when clicking outside, while clicks inside preserve the popover', async () => {
  await click('.qard-jobs-button');
  await act(async () => {
    host
      .querySelector('.qard-jobs-heading')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  expect(host.querySelector('.qard-jobs-list')).not.toBeNull();
  await act(async () => {
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  expect(host.querySelector('.qard-jobs-list')).toBeNull();
});

it('keeps opening a task separate from cancelling it', async () => {
  await click('.qard-jobs-button');
  await click('.qard-jobs-cancel');
  expect(cancel).toHaveBeenCalledWith('Courses/Probability', 'map-course', '');
  expect(open).not.toHaveBeenCalled();
  await click('.qard-jobs-item');
  expect(open).toHaveBeenCalledWith('Courses/Probability');
  expect(host.querySelector('.qard-jobs-list')).toBeNull();
});
