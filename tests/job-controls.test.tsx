// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { JobControls } from '../src/components/jobs/JobControls';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('offers Cancel, warns when a job is stuck, and restarts one that was lost', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const services = { jobs: { estimate: () => 60_000 } } as unknown as QardServices;
  const cancel = vi.fn(),
    start = vi.fn();
  const show = (job?: { kind: string; startedAt?: number; error?: string }) =>
    act(async () => {
      root.render(<JobControls services={services} job={job} cancel={cancel} start={start} />);
    });
  await show({ kind: 'probe', startedAt: Date.now() - 10_000 });
  expect(host.querySelector('.is-stuck')).toBeNull();
  expect(host.textContent).toBe('Cancel');
  await show({ kind: 'probe', startedAt: Date.now() - 4.5 * 60_000 });
  expect(host.textContent).toContain('This has taken 4 min, much longer than usual');
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(cancel).toHaveBeenCalled();
  await show({ kind: 'probe', error: 'Cancelled.' });
  expect(host.textContent).toBe('');
  await show(undefined);
  expect(host.textContent).toContain('Nothing is working on this right now.');
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(start).toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
});
