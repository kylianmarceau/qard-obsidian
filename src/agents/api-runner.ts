import Anthropic from '@anthropic-ai/sdk';
import { requestUrl } from 'obsidian';
import { PREAMBLE } from '../tests/test-prompts';
import { REQUEST_TIMEOUT, deadline, extractJson, type AgentRunner, type AgentTask } from './runner';
import { VAULT_TOOLS, runVaultTool, type VaultReader } from './vault-tools';
import { addUsage, emptyUsage, fromAnthropic } from './usage';

export const API_MODELS: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
};
export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const FAST_API_MODEL = 'claude-haiku-4-5';
const MAX_TURNS = 16;

/** Obsidian's requestUrl avoids CORS and works on mobile; the SDK accepts any fetch. */
export async function obsidianFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    if (key !== 'content-length') headers[key] = value;
  });
  // The SDK aborts through the signal on its own timeout or a cancel; requestUrl ignores signals, so stop waiting instead.
  const response = await deadline(
    requestUrl({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      throw: false,
    }),
    init?.signal ?? undefined,
    REQUEST_TIMEOUT + 30_000,
    'The Anthropic API',
  );
  return new Response(response.arrayBuffer, { status: response.status, headers: response.headers });
}

/** Claude through the Messages API, reading the vault only through three read-only tools. */
export class AnthropicRunner implements AgentRunner {
  readonly name = 'Claude';
  constructor(
    private vault: VaultReader,
    private apiKey: () => string | null,
    private model: string,
    private exclude: string[],
  ) {}
  async run(task: AgentTask): Promise<unknown> {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error('Add an Anthropic API key in Settings → Qard.');
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      fetch: obsidianFetch,
      timeout: REQUEST_TIMEOUT,
      maxRetries: 1,
    });
    const model = this.model || DEFAULT_API_MODEL;
    // Server-side fallback reroutes a declined request instead of failing it (Opus 5.5 / Sonnet 5.5).
    const fallback = model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task.prompt }];
    let usage = emptyUsage();
    // Usage is reported once per run, summed over the tool loop, including runs that end in an error after some turns.
    const report = () => {
      if (usage.input || usage.output) task.onUsage?.(usage);
    };
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages.create(
            {
              model,
              max_tokens: 16000,
              system: PREAMBLE,
              messages,
              ...(task.vault === false ? {} : { tools: VAULT_TOOLS }),
              cache_control: { type: 'ephemeral' },
              output_config: {
                ...(model.startsWith('claude-haiku') ? {} : { effort: task.effort ?? 'medium' }),
                format: { type: 'json_schema', schema: task.schema },
              },
              ...(fallback
                ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
                : {}),
            },
            { signal: task.signal },
          );
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError)
            throw new Error('The Anthropic API key was rejected. Check it in Settings → Qard.');
          if (error instanceof Anthropic.RateLimitError)
            throw new Error('Rate limited by the Anthropic API. Wait a moment and try again.');
          if (error instanceof Anthropic.APIError)
            throw new Error(`Anthropic API error ${error.status ?? ''}: ${error.message}`);
          throw error;
        }
        usage = addUsage(usage, fromAnthropic(response.usage, response.model));
        if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.');
        if (response.stop_reason === 'max_tokens')
          throw new Error('The reply was cut off. Try a shorter test.');
        messages.push({ role: 'assistant', content: response.content });
        if (response.stop_reason === 'pause_turn') continue;
        const uses = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
        );
        if (uses.length) {
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of uses)
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: await runVaultTool(this.vault, use.name, use.input, this.exclude),
            });
          messages.push({ role: 'user', content: results });
          continue;
        }
        return extractJson(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
            .map((b) => b.text)
            .join(''),
        );
      }
      throw new Error('The agent took too many steps without finishing.');
    } finally {
      report();
    }
  }
}
