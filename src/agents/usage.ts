/** Token usage for one agent run, summed over its turns. costUsd only when the provider reports it (never estimated). */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  model?: string;
}
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export function addUsage(a: Usage, b: Usage): Usage {
  const cost =
    a.costUsd === undefined && b.costUsd === undefined
      ? undefined
      : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: cost,
    model: b.model ?? a.model,
  };
}
/** Claude Code's result envelope: usage, total_cost_usd, and the model that actually ran. */
export function fromClaudeCode(envelope: {
  usage?: Record<string, unknown>;
  total_cost_usd?: unknown;
  modelUsage?: Record<string, unknown>;
}): Usage | undefined {
  const u = envelope.usage;
  if (!u) {
    return undefined;
  }
  const model = envelope.modelUsage ? Object.keys(envelope.modelUsage)[0] : undefined;
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : undefined,
    model,
  };
}
/** Codex --json events: one turn.completed per turn, each with its usage. Codex counts cached input inside input_tokens. */
export function fromCodexEvents(jsonl: string): Usage | undefined {
  let total: Usage | undefined;
  for (const line of jsonl.split('\n')) {
    let event: { type?: string; usage?: Record<string, unknown> };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event.type !== 'turn.completed' || !event.usage) {
      continue;
    }
    const u = event.usage,
      cached = n(u.cached_input_tokens);
    total = addUsage(total ?? emptyUsage(), {
      input: Math.max(0, n(u.input_tokens) - cached),
      output: n(u.output_tokens),
      cacheRead: cached,
      cacheWrite: n(u.cache_write_input_tokens),
    });
  }
  return total;
}
/** Anthropic Messages API usage for one response. */
export const fromAnthropic = (
  u: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  model: string,
): Usage => ({
  input: n(u.input_tokens),
  output: n(u.output_tokens),
  cacheRead: n(u.cache_read_input_tokens),
  cacheWrite: n(u.cache_creation_input_tokens),
  model,
});
/** OpenRouter (OpenAI-style) usage for one response; prompt_tokens includes cached tokens. */
export function fromOpenRouter(
  u: Record<string, unknown> | undefined,
  model: string,
): Usage | undefined {
  if (!u) {
    return undefined;
  }
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>,
    cached = n(details.cached_tokens);
  return {
    input: Math.max(0, n(u.prompt_tokens) - cached),
    output: n(u.completion_tokens),
    cacheRead: cached,
    cacheWrite: n(details.cache_write_tokens),
    costUsd: typeof u.cost === 'number' ? u.cost : undefined,
    model,
  };
}
