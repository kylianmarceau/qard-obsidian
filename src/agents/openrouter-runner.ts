import { requestUrl } from 'obsidian';
import { PREAMBLE } from '../tests/test-prompts';
import { SCHEMA_INSTRUCTION, extractJson, type AgentRunner, type AgentTask } from './runner';
import { VAULT_TOOLS, runVaultTool, type VaultReader } from './vault-tools';

const BASE = 'https://openrouter.ai/api/v1';
const MAX_TURNS = 16;
export interface HttpResponse { status: number; json: unknown }
/** A POST or GET that returns parsed JSON. Injected so tests never touch the network. */
export type Http = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;
export const obsidianHttp: Http = async (url, init) => {
  const response = await requestUrl({ url, method: init.method, headers: init.headers, body: init.body, throw: false });
  let json: unknown; try { json = response.json as unknown; } catch { json = undefined; }
  return { status: response.status, json };
};

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type Message = { role: 'system' | 'user'; content: string } | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] } | { role: 'tool'; tool_call_id: string; content: string };
interface Completion { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[]; error?: { message?: string } }
const TOOLS = VAULT_TOOLS.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }));
const headers = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://obsidian.md', 'X-Title': 'Qard' });

function failure(status: number, body: unknown): Error {
  const message = (body as Completion | undefined)?.error?.message ?? '';
  if (status === 401) return new Error('The OpenRouter API key was rejected. Check it in Settings → Qard.');
  if (status === 402) return new Error('Your OpenRouter account is out of credits.');
  if (status === 429) return new Error('Rate limited by OpenRouter. Wait a moment and try again.');
  return new Error(`OpenRouter error ${status}${message ? `: ${message}` : ''}`);
}

/** Any OpenRouter model through its OpenAI-style chat API, reading notes through the same three tools. */
export class OpenRouterRunner implements AgentRunner {
  readonly name = 'OpenRouter';
  constructor(private vault: VaultReader, private apiKey: () => string | null, private model: string, private exclude: string[], private http: Http = obsidianHttp) {}
  async run(task: AgentTask): Promise<unknown> {
    const key = this.apiKey();
    if (!key) throw new Error('Add an OpenRouter API key in Settings → Qard.');
    const tools = task.vault !== false;
    // Not every model supports structured output, so the schema is also in the prompt and replies are validated anyway.
    const messages: Message[] = [{ role: 'system', content: PREAMBLE }, { role: 'user', content: `${task.prompt}\n\n${SCHEMA_INSTRUCTION(task.schema)}` }];
    let structured = true;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (task.signal?.aborted) throw new Error('Cancelled.');
      const body = {
        model: this.model, messages, max_tokens: 16000,
        ...(tools ? { tools: TOOLS } : {}),
        ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'qard_result', strict: false, schema: task.schema } } } : {}),
        ...(task.effort ? { reasoning: { effort: task.effort } } : {})
      };
      const response = await this.http(`${BASE}/chat/completions`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) });
      // Some providers reject response_format next to tools; the prompt still carries the schema.
      if (response.status === 400 && structured) { structured = false; turn--; continue; }
      if (response.status !== 200) throw failure(response.status, response.json);
      const choice = (response.json as Completion).choices?.[0], message = choice?.message;
      if (!message) throw new Error((response.json as Completion).error?.message || 'OpenRouter returned no reply.');
      if (choice.finish_reason === 'length') throw new Error('The reply was cut off. Try a shorter request.');
      if (message.tool_calls?.length) {
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
        for (const call of message.tool_calls) {
          let args: unknown = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* the tool reports the bad input */ }
          messages.push({ role: 'tool', tool_call_id: call.id, content: await runVaultTool(this.vault, call.function.name, args, this.exclude) });
        }
        continue;
      }
      return extractJson(message.content ?? '');
    }
    throw new Error('The agent took too many steps without finishing.');
  }
}

/** Models that can call tools, for the settings model picker. */
export async function openRouterModels(http: Http = obsidianHttp): Promise<string[]> {
  const response = await http(`${BASE}/models`, { method: 'GET', headers: {} });
  if (response.status !== 200) return [];
  const data = (response.json as { data?: { id?: unknown; supported_parameters?: unknown }[] } | undefined)?.data ?? [];
  return data.filter(m => typeof m.id === 'string' && (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools'))).map(m => m.id as string).sort();
}
