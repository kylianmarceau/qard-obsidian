import { requestUrl } from 'obsidian';
import { debug } from '../debug/debug-log';
import { PREAMBLE } from '../tests/test-prompts';
import {
  CANCELLED,
  REQUEST_TIMEOUT,
  SCHEMA_INSTRUCTION,
  deadline,
  extractJson,
  type AgentRunner,
  type AgentTask,
} from './runner';
import { VAULT_TOOLS, runVaultTool, type VaultReader } from './vault-tools';
import { addUsage, emptyUsage, fromOpenRouter } from './usage';

const BASE = 'https://openrouter.ai/api/v1';
const MAX_TURNS = 16;
export interface HttpResponse {
  status: number;
  json: unknown;
}
/** A POST or GET that returns parsed JSON. Injected so tests never touch the network. */
export type Http = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;
export const obsidianHttp: Http = async (url, init) => {
  const response = await requestUrl({
    url,
    method: init.method,
    headers: init.headers,
    body: init.body,
    throw: false,
  });
  let json: unknown;
  try {
    json = response.json as unknown;
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
};

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
interface Completion {
  usage?: Record<string, unknown>;
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string;
  }[];
  error?: { message?: string };
}
const TOOLS = VAULT_TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));
const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://obsidian.md',
  'X-Title': 'Qard',
});

function failure(status: number, body: unknown): Error {
  const message = (body as Completion | undefined)?.error?.message ?? '';
  if (status === 401) {
    return new Error('The OpenRouter API key was rejected. Check it in Settings → Qard.');
  }
  if (status === 402) {
    return new Error('Your OpenRouter account is out of credits.');
  }
  if (status === 429) {
    return new Error('Rate limited by OpenRouter. Wait a moment and try again.');
  }
  return new Error(`OpenRouter error ${status}${message ? `: ${message}` : ''}`);
}

export interface ChatConnection {
  name: string;
  baseUrl: string;
  custom?: boolean;
}

/** Shared OpenAI-style tool loop. OpenRouter's existing defaults remain unchanged. */
export class ChatCompletionRunner implements AgentRunner {
  readonly name: string;
  constructor(
    private vault: VaultReader,
    private apiKey: () => string | null,
    private model: string,
    private exclude: string[],
    private http: Http = obsidianHttp,
    private connection: ChatConnection = { name: 'OpenRouter', baseUrl: BASE },
  ) {
    this.name = connection.name;
  }
  async run(task: AgentTask): Promise<unknown> {
    if (task.signal?.aborted) {
      throw new Error(CANCELLED);
    }
    const key = this.apiKey();
    if (!key && !this.connection.custom) {
      throw new Error('Add an OpenRouter API key in Settings → Qard.');
    }
    if (this.connection.custom && !this.model.trim()) {
      throw new Error('Choose a custom model in Settings → Qard → AI connections or AI roles.');
    }
    const tools = task.vault !== false;
    // Not every model supports structured output, so the schema is also in the prompt and replies are validated anyway.
    const messages: Message[] = [
      { role: 'system', content: PREAMBLE },
      { role: 'user', content: `${task.prompt}\n\n${SCHEMA_INSTRUCTION(task.schema)}` },
    ];
    // A final-answer grammar can suppress native tool calls on local servers, even with HTTP 200.
    // Tool requests keep the schema in the prompt; the final reply is still parsed and validated.
    let structured: 'schema' | 'json' | 'prompt' =
        this.connection.custom && tools ? 'prompt' : 'schema',
      usage = emptyUsage();
    const report = () => {
      if (usage.input || usage.output) {
        task.onUsage?.(usage);
      }
    };
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (task.signal?.aborted) {
          throw new Error(CANCELLED);
        }
        const body = {
          model: this.model,
          messages,
          max_tokens: 16000,
          ...(tools ? { tools: TOOLS } : {}),
          ...(structured === 'schema'
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'qard_result', strict: false, schema: task.schema },
                },
              }
            : structured === 'json'
              ? { response_format: { type: 'json_object' } }
              : {}),
          ...(!this.connection.custom && task.effort ? { reasoning: { effort: task.effort } } : {}),
          // Ask OpenRouter to include token counts and cost in each response.
          ...(!this.connection.custom ? { usage: { include: true } } : {}),
          ...(this.connection.custom ? { stream: false } : {}),
        };
        const sent = Date.now();
        debug.log(this.connection.custom ? 'custom-ai' : 'openrouter', 'request', {
          model: this.model,
          turn,
          messages: messages.length,
          structured,
          tools,
        });
        const response = await deadline(
          this.http(`${this.connection.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.connection.custom
              ? {
                  'Content-Type': 'application/json',
                  ...(key ? { Authorization: `Bearer ${key}` } : {}),
                }
              : headers(key!),
            body: JSON.stringify(body),
          }).catch((error: unknown) => {
            if (this.connection.custom) {
              throw new Error(
                'Could not reach the custom AI server. Start its server and check the address. On mobile, localhost refers to the phone.',
              );
            }
            throw error;
          }),
          task.signal,
          REQUEST_TIMEOUT,
          this.name,
        );
        // Some providers reject response_format next to tools; the prompt still carries the schema.
        const reply =
          response.json && typeof response.json === 'object'
            ? (response.json as Completion)
            : undefined;
        debug.log(this.connection.custom ? 'custom-ai' : 'openrouter', 'response', {
          turn,
          status: response.status,
          ms: Date.now() - sent,
          finish: reply?.choices?.[0]?.finish_reason,
          ...(!this.connection.custom
            ? { toolCalls: reply?.choices?.[0]?.message?.tool_calls?.map((c) => c.function.name) }
            : {}),
          servedBy: reply?.model,
          tokens: reply?.usage,
          ...(!this.connection.custom ? { error: reply?.error?.message } : {}),
        });
        if (
          (response.status === 400 || (this.connection.custom && response.status === 422)) &&
          structured !== 'prompt'
        ) {
          debug.log(
            this.connection.custom ? 'custom-ai' : 'openrouter',
            'structured output rejected; retrying with the schema in the prompt only',
            { turn },
          );
          structured = this.connection.custom && structured === 'schema' ? 'json' : 'prompt';
          turn--;
          continue;
        }
        if (response.status !== 200) {
          throw this.connection.custom
            ? customFailure(response.status, tools)
            : failure(response.status, response.json);
        }
        const turnUsage = fromOpenRouter(reply?.usage, reply?.model ?? this.model);
        if (turnUsage) {
          usage = addUsage(usage, turnUsage);
        }
        const choice = reply?.choices?.[0],
          message = choice?.message;
        if (!message || typeof message !== 'object') {
          throw new Error(
            this.connection.custom
              ? 'The custom server returned no chat reply. Check the server address and model.'
              : reply?.error?.message || 'OpenRouter returned no reply.',
          );
        }
        if (choice?.finish_reason === 'length') {
          throw new Error('The reply was cut off. Try a shorter request.');
        }
        if (message.tool_calls?.length) {
          if (
            !tools ||
            !Array.isArray(message.tool_calls) ||
            message.tool_calls.length > 16 ||
            message.tool_calls.some(
              (call) =>
                !call ||
                typeof call.id !== 'string' ||
                !call.function ||
                typeof call.function.name !== 'string' ||
                typeof call.function.arguments !== 'string',
            )
          ) {
            throw new Error(
              'The model returned unsupported note-tool calls. Choose a model with tool support.',
            );
          }
          messages.push({
            role: 'assistant',
            content: message.content ?? null,
            tool_calls: message.tool_calls,
          });
          for (const call of message.tool_calls) {
            if (task.signal?.aborted) {
              throw new Error(CANCELLED);
            }
            let args: unknown = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              /* the tool reports the bad input */
            }
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: await runVaultTool(this.vault, call.function.name, args, this.exclude),
            });
          }
          continue;
        }
        if (typeof message.content !== 'string') {
          throw new Error(
            'The model returned no text answer. Choose a model that supports JSON replies.',
          );
        }
        return extractJson(message.content);
      }
      throw new Error('The agent took too many steps without finishing.');
    } finally {
      report();
    }
  }
}

/** OpenRouter uses its fixed endpoint, attribution headers and reported billing. */
export class OpenRouterRunner extends ChatCompletionRunner {
  constructor(
    vault: VaultReader,
    apiKey: () => string | null,
    model: string,
    exclude: string[],
    http: Http = obsidianHttp,
  ) {
    super(vault, apiKey, model, exclude, http);
  }
}

function customFailure(status: number, tools: boolean): Error {
  if (status === 401 || status === 403) {
    return new Error('The custom server rejected access. Check its API key in Settings → Qard.');
  }
  if (status === 404) {
    return new Error(
      'The custom server could not find the endpoint or model. Check the API base address and exact model name.',
    );
  }
  if (status === 429) {
    return new Error('The custom server is busy or rate limited. Wait a moment and try again.');
  }
  if (status === 400 || status === 422) {
    return new Error(
      tools
        ? 'The custom server rejected this request. Check the model and choose one with note-tool support; use Test connection in settings.'
        : 'The custom server rejected this request. Check the model name and its chat/JSON support.',
    );
  }
  return new Error(`Custom AI server error ${status}. Check the server logs and try again.`);
}

/** Models that can call tools, for the settings model picker. */
export async function openRouterModels(http: Http = obsidianHttp): Promise<string[]> {
  const response = await http(`${BASE}/models`, { method: 'GET', headers: {} });
  if (response.status !== 200) {
    return [];
  }
  const data =
    (response.json as { data?: { id?: unknown; supported_parameters?: unknown }[] } | undefined)
      ?.data ?? [];
  return data
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools')),
    )
    .map((m) => m.id as string)
    .sort();
}
