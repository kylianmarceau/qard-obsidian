import { expect, it, vi } from 'vitest';
import { CANCELLED, guardRunner, type AgentTask } from '../src/agents/runner';

const task: AgentTask = {
  prompt: 'Test prompt',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

it('forwards the same task and reply, including the provider name', async () => {
  const result = { answer: 'Test reply' };
  const run = vi.fn(async () => result);
  const wrapped = guardRunner({ name: 'Test provider', run }, new AbortController().signal);
  expect(wrapped.name).toBe('Test provider');
  expect(await wrapped.run(task)).toBe(result);
  expect(run).toHaveBeenCalledWith(task);
});

it('does not invoke a provider after the job has already been cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const run = vi.fn();
  const wrapped = guardRunner({ name: 'Test provider', run }, controller.signal);
  await expect(wrapped.run(task)).rejects.toThrow(CANCELLED);
  expect(run).not.toHaveBeenCalled();
});

it('rejects a late reply from a provider that ignores cancellation', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  const wrapped = guardRunner(
    {
      name: 'Test provider',
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    controller.signal,
  );
  const work = wrapped.run(task);
  controller.abort();
  finish({ answer: 'Late reply' });
  await expect(work).rejects.toThrow(CANCELLED);
});

it('preserves the original provider error', async () => {
  const error = new Error('Provider unavailable');
  const wrapped = guardRunner(
    { name: 'Test provider', run: () => Promise.reject(error) },
    new AbortController().signal,
  );
  await expect(wrapped.run(task)).rejects.toBe(error);
});
