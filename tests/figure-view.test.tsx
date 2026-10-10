// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { DrawButton, FigureView } from '../src/components/learn/FigureView';
import { readSettings } from '../src/settings/settings';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows drawing progress, the figure with its caption, and redraws with a note', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const snapshot = { settings: readSettings({}) };
  const services = {
    host,
    owner: new Component(),
    app: {},
    jobs: { estimate: () => 30_000 },
    reviews: { subscribe: () => () => {}, getSnapshot: () => snapshot },
  } as unknown as QardServices;
  const draw = vi.fn(),
    cancel = vi.fn();
  const figure = { path: 'assets/statistics/beta.svg', caption: 'Beta(2,5).', brief: 'b' };
  const show = (f?: typeof figure, job?: { kind: string; startedAt?: number; error?: string }) =>
    act(async () => {
      root.render(
        <>
          <FigureView
            services={services}
            path="L.md"
            figure={f}
            job={job}
            draw={draw}
            cancel={cancel}
            dismiss={() => {}}
          />
          <DrawButton figure={f} job={job} draw={() => draw()} />
        </>,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
  await show();
  expect(host.textContent).toBe(' Draw this');
  await show(undefined, { kind: 'figure', startedAt: Date.now() });
  expect(host.textContent).toContain('Drawing a figure…');
  expect(host.textContent).toContain('Illustrator · Claude Code');
  await act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
  });
  expect(cancel).toHaveBeenCalled();
  await show(figure);
  expect(host.querySelector('.qard-figure')!.textContent).toContain(
    '![[assets/statistics/beta.svg|700]]',
  );
  expect(host.querySelector('.qard-figure')!.textContent).toContain('*Figure: Beta(2,5).*');
  expect(host.textContent).not.toContain('Draw this');
  await act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Redraw…')!.click();
  });
  await act(async () => {
    const input = host.querySelector('input')!;
    input.value = 'label the mode';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(draw).toHaveBeenCalledWith('label the mode');
  await show(undefined, { kind: 'figure', error: 'Python 3 was not found.' });
  expect(host.textContent).toContain('Python 3 was not found.Try again');
  await act(async () => root.unmount());
  host.remove();
});
