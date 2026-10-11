// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { requestUrl, TFile, type RequestUrlParam } from 'obsidian';
import { CustomRunner, customModels, testCustomConnection } from '../src/agents/custom-runner';
import { customBaseUrl } from '../src/agents/custom-connection';
import { type Http } from '../src/agents/openrouter-runner';
import { CANCELLED, type AgentTask } from '../src/agents/runner';
import { createRunner, CUSTOM_KEY_SECRET } from '../src/agents/create-runner';
import { readSettings } from '../src/settings/settings';
vi.mock('obsidian', async (original) => ({
  ...(await original<typeof import('obsidian')>()),
  requestUrl: vi.fn(),
}));
const connection = { baseUrl: 'http://localhost:11434/v1', model: 'local-model' };
const vault = {
  paths: () => ['Notes/A.md', 'Tests/private.md'],
  read: vi.fn(async (_path: string) => 'Private note text'),
};
const task: AgentTask = {
  prompt: 'Question',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  vault: false,
};
const ok = (content: string, extra = {}) => ({
  status: 200,
  json: { choices: [{ message: { content }, finish_reason: 'stop' }], ...extra },
});
const call = (path = 'Notes/A.md') => ({
  status: 200,
  json: {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'a',
              type: 'function',
              function: { name: 'read_note', arguments: JSON.stringify({ path }) },
            },
          ],
        },
      },
    ],
  },
});
const runner = (http: Http, key: string | null = null) =>
  new CustomRunner(vault, () => key, connection, ['Tests'], http);
beforeEach(() => vi.clearAllMocks());

it('normalizes roots and prefixed API addresses and refuses addresses containing credentials', () => {
  expect(customBaseUrl(' http://localhost:1234/ ')).toBe('http://localhost:1234/v1');
  expect(customBaseUrl('https://example.org/ai/v1/')).toBe('https://example.org/ai/v1');
  for (const value of [
    'file:///tmp/a',
    'not a url',
    'https://user:pass@example.org/v1',
    'https://example.org/v1?key=secret',
    'http://localhost:1234/v1#secret',
    'http://localhost:1234/v1/chat/completions',
  ])
    expect(() => customBaseUrl(value)).toThrow();
});
it('migrates old settings without changing providers and strips keys from custom metadata', () => {
  const old = readSettings({
    agents: { roles: { writer: { provider: 'openrouter', model: 'old' } } },
  });
  expect(old.agents.roles.writer).toEqual({ provider: 'openrouter', model: 'old' });
  expect(old.agents.custom).toEqual({ baseUrl: 'http://localhost:11434/v1', model: '' });
  const settings = readSettings({
    agents: {
      custom: { baseUrl: 'http://localhost:1234', model: ' m ', apiKey: 'secret' },
      roles: { tutor: { provider: 'custom', model: '' } },
    },
  });
  expect(settings.agents.custom).toEqual({ baseUrl: 'http://localhost:1234/v1', model: 'm' });
  expect(settings.agents.roles.tutor.provider).toBe('custom');
  expect(JSON.stringify(settings)).not.toContain('secret');
  expect(
    readSettings({ agents: { custom: { baseUrl: 'https://user:secret@example.org' } } }).agents
      .custom.baseUrl,
  ).toBe('');
});
it('calls a keyless server without OpenRouter-only headers or request options and reports usage', async () => {
  const http = vi.fn<Http>().mockResolvedValue(
    ok('{"answer":"yes"}', {
      usage: { prompt_tokens: 12, completion_tokens: 5 },
      model: 'served-model',
    }),
  );
  const onUsage = vi.fn();
  expect(await runner(http).run({ ...task, effort: 'high', onUsage })).toEqual({ answer: 'yes' });
  const [url, init] = http.mock.calls[0]!;
  expect(url).toBe('http://localhost:11434/v1/chat/completions');
  expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  const body = JSON.parse(init.body!);
  expect(body).toMatchObject({ model: 'local-model', stream: false });
  expect(body.tools).toBeUndefined();
  expect(body.usage).toBeUndefined();
  expect(body.reasoning).toBeUndefined();
  expect(body.messages[1].content).toContain('JSON Schema');
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({ input: 12, output: 5, model: 'served-model' }),
  );
  expect(vault.read).not.toHaveBeenCalled();
});
it('uses an optional key only in the authorization header', async () => {
  const http = vi.fn<Http>().mockResolvedValue(ok('{"ok":true}'));
  await runner(http, 'private-key').run(task);
  expect(http.mock.calls[0]![1].headers.Authorization).toBe('Bearer private-key');
  expect(http.mock.calls[0]![1].body).not.toContain('private-key');
});
it('falls back through JSON mode and prompt-only output while retaining tools', async () => {
  const http = vi
    .fn<Http>()
    .mockResolvedValueOnce({ status: 400, json: {} })
    .mockResolvedValueOnce({ status: 422, json: {} })
    .mockResolvedValueOnce(ok('{"ok":true}'));
  expect(await runner(http).run({ ...task, vault: true })).toEqual({ ok: true });
  const bodies = http.mock.calls.map(([, init]) => JSON.parse(init.body!));
  expect(bodies.map((b) => b.response_format?.type)).toEqual([
    'json_schema',
    'json_object',
    undefined,
  ]);
  expect(bodies.every((b) => b.tools.length === 3)).toBe(true);
});
it('runs read-only tools but never reads excluded or unlisted paths', async () => {
  const http = vi
    .fn<Http>()
    .mockResolvedValueOnce(call())
    .mockResolvedValueOnce(call('Tests/private.md'))
    .mockResolvedValueOnce(call('../outside.md'))
    .mockResolvedValueOnce(ok('{"ok":true}'));
  await runner(http).run({ ...task, vault: true });
  expect(vault.read.mock.calls).toEqual([['Notes/A.md']]);
  const final = JSON.parse(http.mock.calls[3]![1].body!);
  expect(
    final.messages
      .filter((m: { role: string }) => m.role === 'tool')
      .map((m: { content: string }) => m.content),
  ).toEqual([
    'Private note text',
    expect.stringContaining('No note'),
    expect.stringContaining('No note'),
  ]);
});
it('refuses tool calls for prompt-only tasks and malformed tool arguments without reading notes', async () => {
  await expect(runner(vi.fn<Http>().mockResolvedValue(call())).run(task)).rejects.toThrow(
    'unsupported note-tool',
  );
  const malformed = call();
  (malformed.json.choices[0]!.message.tool_calls[0]!.function as { arguments: unknown }).arguments =
    { path: 'Notes/A.md' };
  await expect(
    runner(vi.fn<Http>().mockResolvedValue(malformed)).run({ ...task, vault: true }),
  ).rejects.toThrow('unsupported note-tool');
  expect(vault.read).not.toHaveBeenCalled();
});
it('requires a model, caps tool loops and rejects empty or truncated replies', async () => {
  const http = vi.fn<Http>();
  await expect(
    new CustomRunner(vault, () => null, { ...connection, model: '' }, [], http).run(task),
  ).rejects.toThrow('Choose a custom model');
  expect(http).not.toHaveBeenCalled();
  http.mockResolvedValue(call());
  await expect(runner(http).run({ ...task, vault: true })).rejects.toThrow('too many steps');
  expect(http).toHaveBeenCalledTimes(16);
  await expect(
    runner(vi.fn<Http>().mockResolvedValue({ status: 200, json: undefined })).run(task),
  ).rejects.toThrow('no chat reply');
  await expect(
    runner(
      vi.fn<Http>().mockResolvedValue({
        status: 200,
        json: { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] },
      }),
    ).run(task),
  ).rejects.toThrow('cut off');
});
it('explains authentication and model errors without reflecting server content or request secrets', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await expect(
      runner(
        vi
          .fn<Http>()
          .mockResolvedValue({ status, json: { error: { message: 'sensitive-secret' } } }),
      ).run(task),
    ).rejects.not.toThrow('sensitive-secret');
  }
  await expect(
    runner(vi.fn<Http>().mockResolvedValue({ status: 401, json: {} })).run(task),
  ).rejects.toThrow('rejected access');
  await expect(
    runner(vi.fn<Http>().mockResolvedValue({ status: 404, json: {} })).run(task),
  ).rejects.toThrow('endpoint or model');
  await expect(
    runner(vi.fn<Http>().mockRejectedValue(new Error('Bearer sensitive-secret'))).run(task),
  ).rejects.toThrow('Could not reach');
});
it('cancels pending requests, rejects late replies and times out stalled servers', async () => {
  vi.useFakeTimers();
  try {
    const abort = new AbortController();
    let finish!: (value: ReturnType<typeof ok>) => void;
    const http = vi.fn<Http>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const work = expect(runner(http).run({ ...task, signal: abort.signal })).rejects.toThrow(
      CANCELLED,
    );
    abort.abort();
    finish(ok('{"ok":true}'));
    await work;
    const timeout = expect(
      runner(vi.fn<Http>().mockReturnValue(new Promise(() => {}))).run(task),
    ).rejects.toThrow('within 5 minutes');
    await vi.advanceTimersByTimeAsync(300000);
    await timeout;
    await expect(runner(http).run({ ...task, signal: abort.signal })).rejects.toThrow(CANCELLED);
    expect(http).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it('discovers unique model names using the optional key and permits servers without a model list', async () => {
  const http = vi.fn<Http>().mockResolvedValue({
    status: 200,
    json: { data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { id: 4 }, {}] },
  });
  expect(await customModels(connection, 'key', http)).toEqual(['a', 'b']);
  expect(http.mock.calls[0]).toEqual([
    'http://localhost:11434/v1/models',
    { method: 'GET', headers: { Authorization: 'Bearer key' } },
  ]);
  expect(
    await customModels(
      connection,
      null,
      vi.fn<Http>().mockResolvedValue({ status: 404, json: {} }),
    ),
  ).toEqual([]);
});
it('tests JSON and a real synthetic tool round-trip, with no access to user notes', async () => {
  const http = vi
    .fn<Http>()
    .mockResolvedValueOnce(ok('{"ok":true}'))
    .mockResolvedValueOnce(call('Connection test.md'))
    .mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(init.body!);
      const code = body.messages.at(-1).content.replace('Connection code: ', '');
      return ok(JSON.stringify({ code }));
    });
  expect(await testCustomConnection(connection, null, undefined, http)).toMatchObject({
    json: true,
    tools: true,
  });
  expect(vault.read).not.toHaveBeenCalled();
  expect(JSON.stringify(http.mock.calls)).not.toContain('Private note text');
});
it('reports partial compatibility honestly when a model ignores or rejects tools', async () => {
  const http = vi
    .fn<Http>()
    .mockResolvedValueOnce(ok('{"ok":true}'))
    .mockResolvedValueOnce(ok('{"code":"guessed"}'));
  expect(await testCustomConnection(connection, null, undefined, http)).toMatchObject({
    json: true,
    tools: false,
    message: expect.stringContaining('note tools did not'),
  });
  const noTools = vi
    .fn<Http>()
    .mockResolvedValueOnce(ok('{"ok":true}'))
    .mockResolvedValue({ status: 400, json: {} });
  expect(await testCustomConnection(connection, null, undefined, noTools)).toMatchObject({
    json: true,
    tools: false,
  });
  await expect(
    testCustomConnection(
      connection,
      null,
      undefined,
      vi.fn<Http>().mockResolvedValue(ok('{"ok":false}')),
    ),
  ).rejects.toThrow('failed the JSON check');
});
it('routes roles to the custom server, applies defaults and overrides, uses secret storage and records usage', async () => {
  const settings = readSettings({
    agents: {
      custom: connection,
      roles: {
        writer: { provider: 'custom', model: '' },
        tutor: { provider: 'custom', model: 'override' },
      },
    },
  });
  const getSecret = vi.fn(() => 'secret');
  const app = {
    secretStorage: { getSecret },
    vault: {
      getMarkdownFiles: () => [Object.assign(new TFile(), { path: 'Notes/A.md' })],
      getAbstractFileByPath: () => Object.assign(new TFile(), { path: 'Notes/A.md' }),
      cachedRead: async () => 'note',
    },
  };
  vi.mocked(requestUrl).mockResolvedValue(
    ok('{"ok":true}', { usage: { prompt_tokens: 1, completion_tokens: 2 } }) as never,
  );
  const record = vi.fn();
  expect(await createRunner(app as never, settings, 'writer', record).run(task)).toEqual({
    ok: true,
  });
  expect(getSecret).toHaveBeenCalledWith(CUSTOM_KEY_SECRET);
  expect(
    JSON.parse(String((vi.mocked(requestUrl).mock.calls[0]![0] as RequestUrlParam).body)).model,
  ).toBe('local-model');
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'custom', role: 'writer', model: 'local-model' }),
  );
  await createRunner(app as never, settings, 'tutor').run(task);
  expect(
    JSON.parse(String((vi.mocked(requestUrl).mock.calls[1]![0] as RequestUrlParam).body)).model,
  ).toBe('override');
});
