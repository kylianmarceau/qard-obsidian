// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { CardSourceLinks } from '../src/components/CardSourceLinks';
import { NotePicker } from '../src/components/NotePicker';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { ReviewStore } from '../src/review/review-store';
import type { QardServices } from '../src/views/services';

let host: HTMLElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const card = parseCards(serializeCard('tcp', 'TCP?', 'Reliable.'), 'Cards.md').cards[0]!;
const note = (path: string, mtime: number) =>
  Object.assign(new (TFile as unknown as new (p: string) => TFile)(path), {
    stat: { mtime },
    parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' },
  });
function setup(linked: string[] = []) {
  const state = {
    links: linked.length ? { tcp: { sources: linked.map((path) => ({ path })) } } : {},
    changes: [],
    busy: [],
  };
  const track = vi.fn(async () => {}),
    capture = vi.fn(async (paths: string[]) => paths.map((path) => ({ path, text: 'x' })));
  const notes = [
    note('Networks/tcp.md', 3),
    note('Networks/udp.md', 5),
    note('Algorithms.md', 9),
    note('Qard/Tests/quiz.md', 99),
  ];
  const services = {
    app: {
      vault: {
        getMarkdownFiles: () => notes,
        getFiles: () => notes,
      },
      workspace: { openLinkText: vi.fn() },
    },
    reviews: new ReviewStore(async () => {}),
    writer: { ensureStable: async () => [card] },
    sourceSync: {
      subscribe: () => () => {},
      getSnapshot: () => state,
      capture,
      track,
      refresh: async () => {},
      removeSource: vi.fn(),
    },
  } as unknown as QardServices;
  act(() => root.render(<CardSourceLinks card={card} services={services} changed={() => {}} />));
  return { track, capture };
}
const items = () =>
  Array.from(host.querySelectorAll('.qard-popover-item')).map((el) => el.textContent);
const toggle = () => host.querySelector<HTMLButtonElement>('.qard-source-add')!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Linking saves through several awaited steps before the search closes.
    await new Promise((done) => setTimeout(done, 0));
  });
const type = (value: string) =>
  act(() => {
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

it('searches notes as you type, most recent first, and links the chosen note', async () => {
  const { track, capture } = setup();
  expect(host.querySelector('.qard-popover')).toBeNull();
  await click(toggle());
  // Recently edited notes first; generated practice tests are not sources.
  expect(items()).toEqual(['Algorithms', 'udpNetworks', 'tcpNetworks']);
  await type('NETWORKS t');
  expect(items()).toEqual([]);
  expect(host.textContent).toContain('No matching notes.');
  await type('tcp');
  expect(items()).toEqual(['tcpNetworks']);
  host.querySelector<HTMLInputElement>('input[type=search]')!.focus();
  await click(host.querySelector('.qard-popover-item')!);
  expect(capture).toHaveBeenCalledWith(['Networks/tcp.md']);
  expect(track).toHaveBeenCalledWith('tcp', [{ path: 'Networks/tcp.md', text: 'x' }], true);
  expect(host.querySelector('.qard-popover')).toBeNull();
  expect(document.activeElement).toBe(toggle());
});

it('leaves out notes already linked and closes with Escape', async () => {
  setup(['Networks/udp.md']);
  expect(host.querySelector('ul')?.textContent).toContain('Networks/udp.md');
  await click(toggle());
  expect(items()).toEqual(['Algorithms', 'tcpNetworks']);
  host.querySelector<HTMLInputElement>('input[type=search]')!.focus();
  await act(() => {
    host
      .querySelector('input[type=search]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(host.querySelector('.qard-popover')).toBeNull();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle());
});

it('waits until its trigger is enabled before restoring focus after an asynchronous choice', async () => {
  let resolve!: (success: boolean) => void;
  let disabled = false;
  const choose = () => new Promise<boolean>((done) => (resolve = done));
  const render = () =>
    root.render(
      <NotePicker
        label="Link a note"
        disabled={disabled}
        busy={disabled}
        notes={() => [note('Networks.md', 1)]}
        choose={choose}
      />,
    );
  act(render);
  await click(toggle());
  const search = host.querySelector<HTMLInputElement>('input[type=search]')!;
  search.focus();
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    disabled = true;
    render();
  });
  await act(async () => resolve(true));
  expect(host.querySelector('.qard-popover')).toBeNull();
  expect(document.activeElement).not.toBe(toggle());
  await act(async () => {
    disabled = false;
    render();
  });
  expect(document.activeElement).toBe(toggle());
});
