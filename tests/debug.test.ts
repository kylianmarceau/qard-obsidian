// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { DebugLog, clip, debug } from '../src/debug/debug-log';
import { runValidated } from '../src/agents/runner';

it('keeps recent events, tracks spans in flight, and writes only when enabled', async () => {
  const log = new DebugLog(), lines: string[] = [], runs: [string, string][] = [];
  log.attach({ append: async line => { lines.push(line); }, saveRun: async (name, body) => { runs.push([name, body]); } });
  const span = log.span('agent', 'run', { purpose: 'Lesson planning' });
  expect([...log.inFlight.values()].map(r => r.name)).toEqual(['run']);
  span.note('turn', { status: 200 });
  span.fail(new Error('OpenRouter didn\'t reply'));
  span.end(); // ignored: already finished
  expect(log.inFlight.size).toBe(0);
  expect(log.recent().map(e => e.event)).toEqual(['run start', 'run turn', 'run failed']);
  expect(log.recent(/failed/)[0]!.data).toMatchObject({ error: 'OpenRouter didn\'t reply', purpose: 'Lesson planning' });
  expect(log.recent('Lesson planning')).toHaveLength(2);
  log.saveRun('x', { a: 1 });
  await log.flush();
  expect(lines).toEqual([]); expect(runs).toEqual([]);
  const quiet = vi.spyOn(console, 'debug').mockImplementation(() => {});
  log.enabled = true;
  log.log('job', 'probe start', { key: 'L.json|probe|' });
  log.saveRun('probe-tutor', { prompt: 'p' });
  await log.flush();
  expect(JSON.parse(lines[0]!)).toMatchObject({ area: 'job', event: 'probe start', data: { key: 'L.json|probe|' } });
  expect(runs[0]![0]).toBe('probe-tutor');
  quiet.mockRestore();
  for (let i = 0; i < 3100; i++) log.log('x', 'e');
  expect(log.recent(undefined, 5000)).toHaveLength(3000);
  expect(clip('a'.repeat(1000), 10)).toBe(`${'a'.repeat(10)} …[980 chars]… ${'a'.repeat(10)}`);
});

it('logs a rejected reply before the retry', async () => {
  debug.clear();
  let n = 0;
  const runner = { name: 'fake', run: async () => (++n === 1 ? { bad: true } : { ok: true }) };
  await runValidated(runner, { prompt: 'p', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } }, v => { if (!(v as { ok?: boolean }).ok) throw new Error('missing ok'); return v; });
  expect(debug.recent(/rejected/)[0]!.data).toMatchObject({ error: 'missing ok', reply: '{"bad":true}' });
});
