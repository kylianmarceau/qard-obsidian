// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { discoverLocalModels } from '../src/agents/local-models';
import type { Http } from '../src/agents/openrouter-runner';
import { CANCELLED } from '../src/agents/runner';

it('finds both default servers and deduplicates model choices, using only keyless loopback GETs', async () => {
  const http = vi.fn<Http>().mockResolvedValue({
    status: 200,
    json: { data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { id: 3 }] },
  });
  const servers = await discoverLocalModels(new AbortController().signal, http);
  expect(servers.map((s) => [s.name, s.models])).toEqual([
    ['Ollama', ['a', 'b']],
    ['LM Studio', ['a', 'b']],
  ]);
  expect(http.mock.calls).toEqual([
    ['http://localhost:11434/v1/models', { method: 'GET', headers: {} }],
    ['http://localhost:1234/v1/models', { method: 'GET', headers: {} }],
  ]);
});

it('recognizes empty and authenticated servers and ignores unrelated or stopped services', async () => {
  const http = vi
    .fn<Http>()
    .mockResolvedValueOnce({ status: 200, json: { data: [] } })
    .mockResolvedValueOnce({ status: 401, json: {} });
  expect(await discoverLocalModels(new AbortController().signal, http)).toMatchObject([
    { name: 'Ollama', models: [], needsKey: false },
    { name: 'LM Studio', models: [], needsKey: true },
  ]);
  http
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockResolvedValueOnce({ status: 200, json: { unrelated: true } });
  expect(await discoverLocalModels(new AbortController().signal, http)).toEqual([]);
});

it('does not let a stalled server delay detection past three seconds', async () => {
  vi.useFakeTimers();
  try {
    const http = vi
      .fn<Http>()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'chat' }] } });
    const work = discoverLocalModels(new AbortController().signal, http);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await work).toMatchObject([{ name: 'LM Studio', models: ['chat'] }]);
  } finally {
    vi.useRealTimers();
  }
});

it('cancels detection without accepting late replies or starting already cancelled requests', async () => {
  const abort = new AbortController();
  const http = vi.fn<Http>().mockReturnValue(new Promise(() => {}));
  const work = expect(discoverLocalModels(abort.signal, http)).rejects.toThrow(CANCELLED);
  abort.abort();
  await work;
  http.mockClear();
  await expect(discoverLocalModels(abort.signal, http)).rejects.toThrow(CANCELLED);
  expect(http).not.toHaveBeenCalled();
});
