// @vitest-environment jsdom
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

import { addToLog, purposeOf, tokens, usageKey, usageReport } from '../src/agents/usage-report';
import { testSchema, marksSchema } from '../src/tests/test-schema';
import { stepSchema, tutorMarkSchema } from '../src/learn/learn-schema';

it('keeps daily totals by feature, role, connection and model, and reports them for a range', () => {
  expect([testSchema, marksSchema, stepSchema, tutorMarkSchema].map(purposeOf)).toEqual(['Writing tests', 'Marking', 'Writing lessons', 'Tutoring']);
  expect(purposeOf({ type: 'string' })).toBe('Other');
  const u = (input: number, output: number, costUsd?: number) => ({ input, output, cacheRead: 10, cacheWrite: 0, costUsd });
  let log = addToLog({}, '2026-09-28', usageKey('Writing tests', 'writer', 'claude-code', ''), u(100, 50, 0.01));
  log = addToLog(log, '2026-09-30', usageKey('Writing tests', 'writer', 'claude-code', ''), u(200, 100, 0.02));
  log = addToLog(log, '2026-09-30', usageKey('Tutoring', 'tutor', 'anthropic', 'claude-haiku-4-5'), u(40, 20));
  const all = usageReport(log);
  expect(all.totals).toMatchObject({ calls: 3, input: 340, output: 170, cacheRead: 30, costCalls: 2 });
  expect(all.totals.costUsd).toBeCloseTo(0.03);
  expect(all.byFeature.map(r => [r.label, r.totals.calls])).toEqual([['Writing tests', 2], ['Tutoring', 1]]);
  expect(all.byModel.map(r => [r.label, r.detail])).toEqual([['Claude Code', 'default model'], ['Anthropic API', 'claude-haiku-4-5']]);
  expect(all.daily.map(d => [d.day, tokens(d.totals)])).toEqual([['2026-09-28', 160], ['2026-09-30', 380]]);
  expect(usageReport(log, '2026-09-30').totals.calls).toBe(2);
  // Old days fall off after the keep window.
  expect(Object.keys(addToLog(log, '2026-10-01', 'k', u(1, 1), 2))).toEqual(['2026-09-30', '2026-10-01']);
});

import { CLAUDE_CODE_MODELS, codexModels, type NodeHost } from '../src/agents/cli-runner';
it('suggests Codex models from its own cache, in its order, without hidden ones', () => {
  const cache = JSON.stringify({ models: [
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', description: 'Balanced.', visibility: 'list', priority: 1 },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 0 },
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', description: 'Reliable agentic workhorse.', visibility: 'list', priority: 0 }
  ] });
  const host = { env: {}, home: '/Users/me', exists: (p: string) => p === '/Users/me/.codex/models_cache.json', readFile: () => cache } as unknown as NodeHost;
  expect(codexModels(host)).toEqual([{ value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol — Reliable agentic workhorse.' }, { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra — Balanced.' }]);
  expect(codexModels({ ...host, env: { CODEX_HOME: '/elsewhere' } } as NodeHost)).toEqual([]);
  expect(codexModels({ ...host, readFile: () => 'not json' } as NodeHost)).toEqual([]);
  expect(CLAUDE_CODE_MODELS.map(m => m.value)).toContain('haiku');
});
