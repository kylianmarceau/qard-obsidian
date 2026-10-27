// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { StudyClock, type StudyLog } from '../src/time/study-time';
import { ReviewStore } from '../src/review/review-store';
import { QardView, qardTitle } from '../src/views/QardView';
import type QardPlugin from '../src/main';

vi.mock('../src/views/QardApp', () => ({ QardApp: () => null }));

const clock = () =>
  new StudyClock(
    () => 0,
    () => undefined,
    async (_: StudyLog) => {},
  );
async function openView(time: StudyClock, reviews = new ReviewStore(async () => {})) {
  const leaf = { updateHeader: vi.fn() },
    updateTitle = vi.fn();
  const view = new QardView(leaf as never, { time, reviews } as unknown as QardPlugin);
  view.app = { workspace: { updateTitle, getActiveViewOfType: () => null } } as never;
  await view.onOpen();
  return { view, leaf, updateTitle, reviews };
}

it('tells listeners about each view context, including when a view closes', () => {
  const time = clock(),
    view = {},
    changes: unknown[][] = [];
  const stop = time.onChange((...args) => changes.push(args));
  time.set(view, { activity: 'lessons', course: 'DS346' });
  time.set(view, undefined);
  stop();
  time.set(view, { activity: 'cards' });
  expect(changes).toEqual([
    [view, { activity: 'lessons', course: 'DS346' }],
    [view, undefined],
  ]);
});

it('titles the tab with the course, trimmed, or plain Qard without one', () => {
  expect(qardTitle('DS346')).toBe('Qard · DS346');
  expect(qardTitle(undefined)).toBe('Qard');
  expect(qardTitle('  ')).toBe('Qard');
  const long = qardTitle('DS346 ' + 'x'.repeat(80));
  expect(long.length).toBe('Qard · '.length + 40);
  expect(long.endsWith('…')).toBe(true);
});

it('follows its own course in the tab and window title, once per change', async () => {
  const time = clock();
  const { view, leaf, updateTitle } = await openView(time);
  const other = await openView(time);
  expect(view.getDisplayText()).toBe('Qard');
  time.set(view, { activity: 'cards', course: 'DS346 A1' });
  time.set(view, { activity: 'cards', course: 'DS346 A1' }); // the next card in the same deck
  time.set(view, { activity: 'lessons', course: 'DS346 A1' });
  expect(view.getDisplayText()).toBe('Qard · DS346 A1');
  expect(leaf.updateHeader).toHaveBeenCalledTimes(1);
  expect(updateTitle).toHaveBeenCalledTimes(1);
  expect(other.view.getDisplayText()).toBe('Qard');
  expect(other.leaf.updateHeader).not.toHaveBeenCalled();
  time.set(view, { activity: 'browsing' }); // the library
  expect(view.getDisplayText()).toBe('Qard');
  expect(leaf.updateHeader).toHaveBeenCalledTimes(2);
  time.set(view, { activity: 'tests', course: 'DS346' });
  view.release();
  expect(view.getDisplayText()).toBe('Qard');
  time.set(view, { activity: 'tests', course: 'DS346' }); // closed: no longer listening
  expect(view.getDisplayText()).toBe('Qard');
});

it('keeps the title plain when the setting is off', async () => {
  const time = clock();
  const { view, leaf, reviews } = await openView(time);
  time.set(view, { activity: 'lessons', course: 'DS346' });
  expect(view.getDisplayText()).toBe('Qard · DS346');
  await reviews.saveSettings({ ...reviews.getSnapshot().settings, courseInTitle: false });
  expect(view.getDisplayText()).toBe('Qard');
  expect(leaf.updateHeader).toHaveBeenCalledTimes(2);
  view.release();
});
