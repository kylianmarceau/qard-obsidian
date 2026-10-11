// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { NewTest } from '../src/components/tests/NewTest';
import { CardIndex } from '../src/cards/card-index';
import { ReviewStore } from '../src/review/review-store';
import type { QardServices } from '../src/views/services';
import type { TestNav } from '../src/views/navigation';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, services: QardServices, files: TFile[];
const file = (path: string) =>
  ({
    path,
    basename: path.split('/').pop()!.replace(/\.md$/, ''),
    parent: { path: path.split('/').slice(0, -1).join('/') },
    stat: { mtime: 1 },
  }) as TFile;
let plan: ReturnType<typeof vi.fn>, generate: ReturnType<typeof vi.fn>, nav: TestNav;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  files = Array.from({ length: 10 }, (_, i) =>
    file(`Courses/AI/${i < 5 ? '' : 'Week 2/'}Lecture ${i + 1}.md`),
  );
  files.push(
    file('Courses/AI extra/other.md'),
    file('Qard/Tests/old/Test.md'),
    file('Notes/other.md'),
  );
  plan = vi.fn().mockResolvedValue('Qard/Tests/new');
  generate = vi.fn().mockResolvedValue('Qard/Tests/new');
  nav = {
    library: vi.fn(),
    tests: vi.fn(),
    newTest: vi.fn(),
    plan: vi.fn(),
    take: vi.fn(),
    results: vi.fn(),
    review: vi.fn(),
    cards: vi.fn(),
  };
  const index = new CardIndex();
  index.setLoading(false);
  services = {
    index,
    reviews: new ReviewStore(async () => {}),
    tests: { plan, generate },
    app: { vault: { getMarkdownFiles: () => files } },
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () => act(async () => root.render(<NewTest services={services} nav={nav} />));
const click = async (el: Element | null | undefined) =>
  act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
const attach = async (path = 'Courses/AI', count = 10) => {
  await click(button('+ Folder'));
  await click(host.querySelector(`[aria-label="Attach folder ${path}, ${count} notes"]`));
};
it('attaches ten notes with one folder selection and starts a plan without a prompt', async () => {
  await render();
  expect(button('Start').disabled).toBe(true);
  await attach();
  expect(host.textContent).toContain('10 notes attached, including subfolders.');
  expect(button('Start').disabled).toBe(false);
  await click(button('Start'));
  expect(plan).toHaveBeenCalledOnce();
  const request = plan.mock.calls[0]![0];
  expect(request.folders).toEqual(['Courses/AI']);
  expect(request.notes).toEqual(
    files
      .slice(0, 10)
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b)),
  );
  expect(request.sources).toHaveLength(10);
  expect(nav.plan).toHaveBeenCalledWith('Qard/Tests/new');
  expect(generate).not.toHaveBeenCalled();
});
it('searches full folder paths and hides the tests folder', async () => {
  await render();
  await click(button('+ Folder'));
  await act(async () => {
    const input = host.querySelector(
      'input[aria-label="Find a course folder"]',
    ) as HTMLInputElement;
    input.value = 'AI/Week';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelectorAll('.qard-folder-picker button')).toHaveLength(1);
  expect(host.querySelector('.qard-folder-picker')?.textContent).toContain('Courses/AI/Week 2');
  expect(host.querySelector('.qard-folder-picker')?.textContent).not.toContain('Qard/Tests');
  await click(host.querySelector('[aria-label="Attach folder Courses/AI/Week 2, 5 notes"]'));
  expect(host.textContent).toContain('5 notes attached');
});
it('deduplicates a folder with an individual note and retains the individual note when the folder is removed', async () => {
  await render();
  await click(button('+ Note'));
  await click(
    [...host.querySelectorAll('.qard-popover-item')].find((b) =>
      b.textContent?.includes('Lecture 1'),
    ),
  );
  await attach();
  expect(host.textContent).toContain('10 notes attached');
  await click(host.querySelector('[aria-label="Remove folder Courses/AI"]'));
  expect(host.textContent).toContain('1 note attached.');
  await attach();
  await click(button('+ Folder'));
  await click(host.querySelector('[aria-label="Attach folder Courses/AI/Week 2, 5 notes"]'));
  await click(
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Plan first')),
  );
  await click(button('Start'));
  const request = generate.mock.calls[0]![0].request;
  expect(request.sources).toHaveLength(10);
  expect(new Set(request.sources).size).toBe(10);
  expect(request.folders).toHaveLength(2);
  expect(nav.take).toHaveBeenCalled();
});
it('refreshes folder contents at Start to include new material and skip deleted notes', async () => {
  await render();
  await attach();
  files = files.filter((f) => !f.path.endsWith('Lecture 1.md'));
  files.push(file('Courses/AI/New lecture.md'));
  await click(button('Start'));
  expect(plan.mock.calls[0]![0].sources).toContain('Courses/AI/New lecture.md');
  expect(plan.mock.calls[0]![0].sources).not.toContain('Courses/AI/Lecture 1.md');
});
it('handles a folder that becomes empty before Start without invoking the AI', async () => {
  await render();
  await attach();
  files = [];
  await click(button('Start'));
  expect(plan).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'no longer contain any Markdown notes',
  );
});
