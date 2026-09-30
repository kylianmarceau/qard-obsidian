import { describe, it, expect, beforeAll, vi } from 'vitest';
import { placeAnnotations } from '../src/tests/annotate';
import { readMarks, readTest, validate, planSchema, testSchema, marksSchema } from '../src/tests/test-schema';
import { extractJson, runValidated, type AgentRunner, type AgentTask } from '../src/agents/runner';
import { runVaultTool } from '../src/agents/vault-tools';
import { ClaudeCodeRunner, type NodeHost } from '../src/agents/cli-runner';
import { TestService, type TestStorage } from '../src/tests/test-service';
import { DEFAULT_TEST_SETTINGS, readSettings, type TestSettings } from '../src/settings/settings';
import { markPrompt } from '../src/tests/test-prompts';

beforeAll(() => { (globalThis as { window?: unknown }).window ??= globalThis; });

const q = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'short', prompt: `Prompt ${id}`, marks: 2, rubric: [{ point: 'A', marks: 1 }, { point: 'B', marks: 1 }], model: 'Model', source: { path: 'Notes/HMM.md', heading: 'Viterbi' }, ...extra });
const TEST = { title: 'HMM inference', sections: [{ id: 's1', title: 'Structure', questions: [q('q1'), q('q2', { type: 'mcq', marks: 1, rubric: [{ point: 'Viterbi', marks: 1 }], options: ['Forward', 'Viterbi'], answer: 1 })] }, { id: 's2', title: 'Learning', questions: [q('q3')] }] };
const PLAN = { title: 'HMM inference', goal: 'Practise.', sources: [{ path: 'Notes/HMM.md', reason: 'Deck' }, { path: 'Notes/EM.md', reason: 'Found' }], sections: [{ title: 'Structure', focus: 'Basics', questions: '2 short', marks: 4 }], questionCount: 3, totalMarks: 5, minutes: 10 };
const mark = (score: number, awarded: boolean[]) => ({ score, awarded, annotations: [{ quote: 'sums', kind: 'wrong', note: 'Viterbi maximises.' }], mistake: 'misconception', feedback: 'Close.' });

describe('agent replies are validated before Qard saves anything', () => {
  it('accepts a well-formed test and rejects inconsistent rubrics or choices', () => {
    expect(readTest(TEST).sections).toHaveLength(2);
    expect(() => readTest({ ...TEST, sections: [{ id: 's1', title: 'x', questions: [q('q1', { marks: 3 })] }] })).toThrow(/add up to 3/);
    expect(() => readTest({ ...TEST, sections: [{ id: 's1', title: 'x', questions: [q('q1', { type: 'mcq', options: ['a'], answer: 4 })] }] })).toThrow(/multiple choice/);
    expect(() => readTest({ ...TEST, sections: [{ id: 's1', title: 'x', questions: [q('q1'), q('q1')] }] })).toThrow(/used twice/);
  });
  it('reports every schema problem with its path', () => {
    expect(validate(planSchema, { ...PLAN, sources: [{ path: 3 }] })).toEqual(['result.sources[0].reason is missing', 'result.sources[0].path must be a string']);
  });
  it('requires one mark per question and one awarded flag per rubric point', () => {
    expect(() => readMarks({ questions: [{ id: 'q1', ...mark(1, [true]) }] }, [{ id: 'q1', rubric: 2 }])).toThrow(/2 entries/);
    expect(() => readMarks({ questions: [] }, [{ id: 'q1', rubric: 2 }])).toThrow(/no mark for q1/);
  });
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} Done.')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json')).toThrow(/did not return JSON/);
  });
  it('retries once with the validation error', async () => {
    const run = vi.fn<(t: AgentTask) => Promise<unknown>>().mockResolvedValueOnce({ bad: true }).mockResolvedValueOnce(PLAN);
    const result = await runValidated({ name: 'fake', run }, { prompt: 'plan', schema: planSchema }, v => { const e = validate(planSchema, v); if (e.length) throw new Error(e[0]); return v; });
    expect(result).toEqual(PLAN);
    expect(run.mock.calls[1]![0].prompt).toMatch(/previous reply was rejected: result.title is missing/);
  });
});

describe('placing the marker\'s annotations on the answer', () => {
  const text = 'Both use dynamic programming. Viterbi sums over the previous states and picks the best path.';
  it('anchors highlights and missing-point markers, tolerating whitespace and case changes', () => {
    const placed = placeAnnotations(text, [
      { quote: 'dynamic   PROGRAMMING', kind: 'correct', note: 'Yes.' },
      { quote: 'sums over the previous states', kind: 'wrong', note: 'Max, not sum.' },
      { quote: 'best path', kind: 'missing', note: 'Backpointers.' },
      { quote: 'not in the answer', kind: 'vague', note: 'Unplaced.' }
    ]);
    expect(placed.segments.map(s => [s.text, s.kind, s.note])).toEqual([
      ['Both use ', undefined, undefined], ['dynamic programming', 'correct', 1], ['. Viterbi ', undefined, undefined],
      ['sums over the previous states', 'wrong', 2], [' and picks the best path', undefined, undefined], ['', 'missing', 3], ['.', undefined, undefined]
    ]);
    expect(placed.notes.map(n => n.placed)).toEqual([true, true, true, false]);
    expect(placed.segments.map(s => s.text).join('')).toBe(text);
  });
  it('moves a missing point that lands inside a highlight to the highlight\'s end', () => {
    const placed = placeAnnotations('I multiply alpha by the transition', [{ quote: 'I multiply alpha', kind: 'vague', note: '' }, { quote: 'I multiply', kind: 'missing', note: '' }]);
    expect(placed.segments.map(s => [s.text, s.kind])).toEqual([['I multiply alpha', 'vague'], ['', 'missing'], [' by the transition', undefined]]);
  });
  it('never overlaps highlights and puts empty-quote missing points at the end', () => {
    const placed = placeAnnotations('a b a', [{ quote: 'a b', kind: 'correct', note: '' }, { quote: 'a', kind: 'vague', note: '' }, { quote: '', kind: 'missing', note: '' }]);
    expect(placed.segments.map(s => [s.text, s.kind])).toEqual([['a b', 'correct'], [' ', undefined], ['a', 'vague'], ['', 'missing']]);
  });
});

describe('read-only vault tools for the API provider', () => {
  const vault = { paths: () => ['Notes/HMM.md', 'Notes/EM.md', 'Qard/Tests/x/test.json', 'Qard/Tests/_profile.md'], read: async (p: string) => p === 'Notes/HMM.md' ? 'Viterbi uses max.' : 'EM iterates.' };
  it('lists and searches notes but hides the tests folder', async () => {
    expect(await runVaultTool(vault, 'list_notes', {}, ['Qard/Tests'])).toBe('Notes/HMM.md\nNotes/EM.md');
    expect(await runVaultTool(vault, 'search_notes', { query: 'viterbi max' }, ['Qard/Tests'])).toMatch(/^Notes\/HMM\.md/);
    expect(await runVaultTool(vault, 'read_note', { path: 'Qard/Tests/_profile.md' }, ['Qard/Tests'])).toMatch(/No note/);
    expect(await runVaultTool(vault, 'read_note', { path: 'Notes/EM.md' })).toBe('EM iterates.');
  });
});

describe('Claude Code runner', () => {
  it('runs print mode with read-only tools in the vault and unwraps the result', async () => {
    const calls: { command: string; args: string[]; cwd: string; input: string }[] = [];
    const host: NodeHost = {
      env: { PATH: '/usr/bin' }, home: '/home/me', windows: false, exists: p => p === '/opt/claude', readFile: () => '', remove: () => {}, tempFile: n => `/tmp/${n}`,
      spawn: (command, args, options) => {
        const handlers: Record<string, (x: unknown) => void> = {}, out: Record<string, (c: { toString(): string }) => void> = {};
        const child = { stdout: { on: (_: string, l: (c: { toString(): string }) => void) => { out.stdout = l; } }, stderr: { on: () => {} }, kill: () => true,
          stdin: { on: () => {}, end: (input: string) => { calls.push({ command, args, cwd: options.cwd, input }); window.setTimeout(() => { out.stdout?.({ toString: () => JSON.stringify({ type: 'result', is_error: false, result: 'Sure:\n{"answer":"Because max."}' }) }); handlers.close?.(0); }, 0); } },
          on: (event: string, listener: (x: unknown) => void) => { handlers[event] = listener; } };
        return child as never;
      }
    };
    const runner = new ClaudeCodeRunner(host, '/vault', '/opt/claude', '');
    expect(await runner.run({ prompt: 'Explain', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } })).toEqual({ answer: 'Because max.' });
    const call = calls.find(c => c.command === '/opt/claude')!; // the other spawn is the login-shell PATH lookup
    expect(call.cwd).toBe('/vault');
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--json-schema', '--allowedTools', 'Read,Grep,Glob', '--disallowedTools']));
    expect(call.args.join(' ')).toMatch(/Bash,Edit,Write/);
    expect(call.input).toMatch(/never create, edit or delete files/);
    expect(call.args).toContain('--no-session-persistence');
    // A self-contained tutor task gets no tools at all, and its effort level.
    await runner.run({ prompt: 'Mark', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }, vault: false, effort: 'low' });
    const fast = calls.filter(c => c.command === '/opt/claude').at(-1)!.args;
    expect(fast.join(' ')).toMatch(/--tools {2}--effort low$|--tools  .*--effort low/);
    expect(fast).not.toContain('--allowedTools');
    expect(fast[fast.indexOf('--tools') + 1]).toBe('');
  });
});

function memory(files: Record<string, string> = {}): TestStorage & { files: Record<string, string> } {
  return {
    files,
    folders: async root => [...new Set(Object.keys(files).filter(p => p.startsWith(root + '/') && p.split('/').length === root.split('/').length + 2).map(p => p.split('/').slice(0, -1).join('/')))],
    read: async p => files[p] ?? null,
    write: async (p, t) => { files[p] = t; },
    exists: p => Object.keys(files).some(f => f === p || f.startsWith(p + '/'))
  };
}
class Script implements AgentRunner {
  name = 'script'; prompts: string[] = [];
  constructor(private replies: ((prompt: string) => unknown)[]) {}
  async run(task: AgentTask) { this.prompts.push(task.prompt); const next = this.replies.shift(); if (!next) throw new Error('unexpected call'); return next(task.prompt); }
}
const settle = () => new Promise(r => window.setTimeout(r, 0));
async function until(check: () => boolean) { for (let i = 0; i < 50 && !check(); i++) await settle(); expect(check()).toBe(true); }

describe('practice test lifecycle', () => {
  const request = { prompt: 'HMM inference, exam style', decks: ['cs315'], notes: [], sources: ['Notes/HMM.md'] };
  function service(replies: ((prompt: string) => unknown)[], settings: Partial<TestSettings> = {}, files: Record<string, string> = {}) {
    const storage = memory(files), runner = new Script(replies);
    return { storage, runner, tests: new TestService(storage, () => ({ ...DEFAULT_TEST_SETTINGS, ...settings }), () => runner, () => new Date(2026, 8, 29).getTime()) };
  }

  it('plans, revises, writes, marks per section, and wraps up with a profile', async () => {
    const { storage, runner, tests } = service([
      () => PLAN,
      () => ({ ...PLAN, questionCount: 4 }),
      () => TEST,
      () => ({ questions: [{ id: 'q1', ...mark(99, [true, false]) }] }),
      () => ({ questions: [{ id: 'q3', ...mark(0, [false, false]) }] }),
      () => ({ fixes: [{ questionId: 'q3', title: 'Learn EM', body: 'Revise.' }, { questionId: 'nope', title: 'x', body: 'y' }], cards: [{ questionId: 'q3', front: 'F', back: 'B' }], profile: '## Weak spots\n- EM' })
    ], {}, { 'Qard/Tests/_profile.md': '## Weak spots\n- Viterbi' });
    const folder = await tests.plan(request);
    expect(folder).toBe('Qard/Tests/2026-09-29 HMM inference, exam style');
    await until(() => !!tests.get(folder)?.plan);
    expect(runner.prompts[0]).toMatch(/Notes\/HMM\.md[\s\S]*<profile>[\s\S]*Viterbi/);
    await tests.revise(folder, 'one more question');
    expect(tests.get(folder)?.plan?.questionCount).toBe(4);
    await tests.removeSource(folder, 'Notes/EM.md');
    expect(JSON.parse(storage.files[`${folder}/plan.json`]!).sources).toHaveLength(1);

    await tests.generate({ folder });
    await until(() => !!tests.get(folder)?.test);
    expect(runner.prompts[2]).toMatch(/approved plan/);
    tests.answer(folder, 'q1', { text: 'Viterbi sums', confidence: 'sure' });
    tests.answer(folder, 'q2', { choice: 1 });
    await tests.submit(folder, 's1');
    await until(() => tests.get(folder)?.attempt?.sections.s1?.status === 'marked');
    const attempt = tests.get(folder)!.attempt!;
    expect(attempt.marks.q1!.score).toBe(1); // recomputed from the rubric, not the agent's 99
    expect(attempt.marks.q2!.score).toBe(1); // multiple choice, marked locally
    expect(runner.prompts[3]).toMatch(/<student_answer confidence="sure">Viterbi sums/);
    expect(runner.prompts[3]).not.toMatch(/id="q2"/);

    await tests.finish(folder);
    await until(() => !!tests.get(folder)?.attempt?.wrapup);
    const done = JSON.parse(storage.files[`${folder}/attempt.json`]!);
    expect(done.wrapup.fixes).toEqual([{ questionId: 'q3', title: 'Learn EM', body: 'Revise.' }]);
    expect(done.finishedAt).toBeDefined();
    expect(storage.files['Qard/Tests/_profile.md']).toBe('## Weak spots\n- EM\n');
    expect((await tests.list())[0]).toMatchObject({ folder, status: 'marked', score: 2, marks: 5 });
  });

  it('keeps a failed job visible and leaves files untouched', async () => {
    const { storage, tests } = service([() => { throw new Error('Claude Code was not found.'); }]);
    const folder = await tests.plan(request);
    await until(() => !!tests.job(folder, 'plan')?.error);
    expect(tests.job(folder, 'plan')?.error).toBe('Claude Code was not found.');
    expect(storage.files[`${folder}/plan.json`]).toBeUndefined();
  });

  it('exam mode marks everything at the end in one call', async () => {
    const { runner, tests } = service([() => TEST, () => ({ questions: [{ id: 'q1', ...mark(2, [true, true]) }, { id: 'q3', ...mark(1, [true, false]) }] }), () => ({ fixes: [], cards: [], profile: '' })], { marking: 'end', useProfile: false });
    const folder = await tests.generate({ request });
    await until(() => !!tests.get(folder)?.test);
    expect(runner.prompts[0]).not.toMatch(/approved plan/);
    await tests.submit(folder, 's1');
    expect(runner.prompts).toHaveLength(1);
    await tests.finish(folder);
    await until(() => !!tests.get(folder)?.attempt?.wrapup);
    expect(runner.prompts[1]).toMatch(/id="q1"[\s\S]*id="q3"/);
  });

  it('dispute re-marks one answer; retry and follow-ups are saved with the question', async () => {
    const { tests } = service([() => TEST, () => ({ questions: [{ id: 'q1', ...mark(0, [false, false]) }] }),
      () => ({ ...mark(0, [true, true]), reply: 'You did say it.' }), () => ({ feedback: 'Better.', score: 5 }), () => ({ answer: 'Because.' })]);
    const folder = await tests.generate({ request });
    await until(() => !!tests.get(folder)?.test);
    await tests.submit(folder, 's1');
    await until(() => tests.get(folder)?.attempt?.sections.s1?.status === 'marked');
    await tests.dispute(folder, 'q1', 'I said A');
    await tests.retry(folder, 'q1', 'A and B');
    await tests.ask(folder, 'q1', 'Why?');
    const a = tests.get(folder)!.attempt!;
    expect(a.marks.q1).toMatchObject({ score: 2, awarded: [true, true] });
    expect(a.review.q1).toMatchObject({ dispute: { reply: 'You did say it.' }, retry: { score: 2 }, followups: [{ q: 'Why?', a: 'Because.' }] });
    await tests.override(folder, 'q1', [true, false]);
    expect(tests.get(folder)!.attempt!.marks.q1!.score).toBe(1);
  });

  it('opens tests written outside Qard and validates them', async () => {
    const files = { 'Qard/Tests/External/test.json': JSON.stringify(TEST), 'Qard/Tests/Broken/test.json': JSON.stringify({ title: 'x', sections: [] }) };
    const { tests } = service([], {}, files);
    const list = await tests.list();
    expect(list.find(t => t.folder.endsWith('External'))).toMatchObject({ title: 'HMM inference', status: 'ready' });
    expect(list.find(t => t.folder.endsWith('Broken'))).toMatchObject({ status: 'failed' });
  });
});

it('marking prompts include rubric, model answer and confidence', () => {
  const test = { version: 1 as const, createdAt: 0, ...readTest(TEST) };
  const prompt = markPrompt(test, { version: 1, startedAt: 0, answers: { q1: { text: 'x', confidence: 'guess' } }, marks: {}, review: {}, sections: {} }, ['q1']);
  expect(prompt).toMatch(/1\. \(1\) A[\s\S]*<model_answer>Model[\s\S]*confidence="guess"/);
});
it('settings default to Claude Code with plans and per-section marking', () => {
  expect(readSettings({}).tests).toEqual(DEFAULT_TEST_SETTINGS);
  expect(readSettings({ tests: { provider: 'nope', questions: 999, folder: '' } }).tests).toMatchObject({ questions: 10, folder: 'Qard/Tests' });
  expect(readSettings({}).agents.roles).toEqual({ tutor: { provider: 'claude-code', model: 'haiku' }, writer: { provider: 'claude-code', model: '' }, marker: { provider: 'claude-code', model: '' } });
});

it('moves the old single agent setting into roles, with a fast tutor', () => {
  const agents = readSettings({ tests: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }).agents;
  expect(agents.roles).toEqual({ tutor: { provider: 'anthropic', model: 'claude-haiku-4-5' }, writer: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, marker: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  expect(readSettings({ tests: { provider: 'codex', agentPath: '/bin/codex' } }).agents).toMatchObject({ codexPath: '/bin/codex', claudePath: '' });
  // Once roles exist they win, and unknown providers fall back per role.
  expect(readSettings({ tests: { provider: 'codex' }, agents: { roles: { tutor: { provider: 'openrouter', model: 'x/y' }, writer: { provider: 'bad' } } } }).agents.roles).toMatchObject({ tutor: { provider: 'openrouter', model: 'x/y' }, writer: { provider: 'claude-code', model: '' } });
});

it('after a reload, writes again a test that was being written, and marks sections left marking', async () => {
  const now = Date.now();
  const files: Record<string, string> = {
    'Qard/Tests/a/request.json': JSON.stringify({ prompt: 'HMM', decks: [], notes: [], sources: [], writing: now - 60_000 }),
    'Qard/Tests/b/request.json': JSON.stringify({ prompt: 'Old', decks: [], notes: [], sources: [], writing: now - 3 * 86_400_000 }),
    'Qard/Tests/c/test.json': JSON.stringify({ version: 1, createdAt: now, ...TEST }),
    'Qard/Tests/c/attempt.json': JSON.stringify({ version: 1, startedAt: now - 1000, answers: { q1: { text: 'x' } }, marks: {}, review: {}, sections: { s1: { status: 'marking' }, s2: { status: 'open' } } })
  };
  const storage = memory(files), roles: string[] = [];
  const service = new TestService(storage, () => DEFAULT_TEST_SETTINGS, role => ({ name: 'fake', run: async (task: AgentTask) => { roles.push(`${role}:${task.schema === testSchema ? 'test' : task.schema === marksSchema ? 'marks' : 'other'}`); return new Promise(() => {}); } }), () => now);
  await service.resume();
  await new Promise(r => setTimeout(r, 0));
  expect(roles.sort()).toEqual(['marker:marks', 'writer:test']);
  expect(JSON.parse(files['Qard/Tests/a/request.json']!).writing).toBeGreaterThan(now - 1000);
});
