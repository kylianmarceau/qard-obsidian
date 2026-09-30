import { expect, it, vi } from 'vitest';
import { fromClaudeCode, fromCodexEvents, fromOpenRouter, addUsage } from '../src/agents/usage';
import { OpenRouterRunner, type Http } from '../src/agents/openrouter-runner';
import type { Usage } from '../src/agents/usage';

it('reads usage from Claude Code, Codex and OpenRouter replies', () => {
  expect(fromClaudeCode({ total_cost_usd: 0.015, usage: { input_tokens: 9, output_tokens: 431, cache_read_input_tokens: 0, cache_creation_input_tokens: 6396 }, modelUsage: { 'claude-haiku-4-5-20251001': {} } }))
    .toEqual({ input: 9, output: 431, cacheRead: 0, cacheWrite: 6396, costUsd: 0.015, model: 'claude-haiku-4-5-20251001' });
  expect(fromClaudeCode({})).toBeUndefined();
  const events = ['{"type":"thread.started"}', '{"type":"turn.completed","usage":{"input_tokens":14537,"cached_input_tokens":6656,"cache_write_input_tokens":0,"output_tokens":5}}', 'not json', '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":20}}'].join('\n');
  expect(fromCodexEvents(events)).toEqual({ input: 7981, output: 25, cacheRead: 6656, cacheWrite: 0, costUsd: undefined, model: undefined });
  expect(fromCodexEvents('{"type":"thread.started"}')).toBeUndefined();
  expect(fromOpenRouter({ prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 }, cost: 0.0021 }, 'anthropic/claude-haiku-4.5'))
    .toEqual({ input: 200, output: 80, cacheRead: 1000, cacheWrite: 0, costUsd: 0.0021, model: 'anthropic/claude-haiku-4.5' });
  expect(addUsage({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, { input: 3, output: 4, cacheRead: 5, cacheWrite: 6 }).costUsd).toBeUndefined();
});

it('OpenRouter reports usage once per run, summed over its tool loop, and asks for it', async () => {
  const vault = { paths: () => ['Notes/A.md'], read: async () => 'Alpha.' };
  const reply = (message: unknown, usage: unknown) => ({ status: 200, json: { model: 'anthropic/claude-haiku-4.5', usage, choices: [{ message, finish_reason: 'stop' }] } });
  const http = vi.fn<Http>()
    .mockResolvedValueOnce(reply({ content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'read_note', arguments: '{"path":"Notes/A.md"}' } }] }, { prompt_tokens: 500, completion_tokens: 20, cost: 0.001 }))
    .mockResolvedValueOnce(reply({ content: '{"a":1}' }, { prompt_tokens: 600, completion_tokens: 10, cost: 0.002 }));
  const seen: Usage[] = [];
  await new OpenRouterRunner(vault, () => 'k', 'anthropic/claude-haiku-4.5', [], http).run({ prompt: 'x', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, onUsage: u => seen.push(u) });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ input: 1100, output: 30, model: 'anthropic/claude-haiku-4.5' });
  expect(seen[0]!.costUsd).toBeCloseTo(0.003);
  expect(JSON.parse(http.mock.calls[0]![1].body!).usage).toEqual({ include: true });
});
