import { ChatCompletionRunner, obsidianHttp, type Http } from './openrouter-runner';
import { customBaseUrl, type CustomConnection } from './custom-connection';
import { deadline, CANCELLED, type AgentTask } from './runner';
import type { VaultReader } from './vault-tools';

export class CustomRunner extends ChatCompletionRunner {
  constructor(
    vault: VaultReader,
    key: () => string | null,
    connection: CustomConnection,
    exclude: string[],
    http: Http = obsidianHttp,
  ) {
    super(vault, key, connection.model.trim(), exclude, http, {
      name: 'Custom AI',
      baseUrl: customBaseUrl(connection.baseUrl),
      custom: true,
    });
  }
}

/** Model discovery is optional: a server without /models can still accept a typed model name. */
export async function customModels(
  connection: CustomConnection,
  key: string | null,
  http: Http = obsidianHttp,
): Promise<string[]> {
  const response = await deadline(
    http(`${customBaseUrl(connection.baseUrl)}/models`, {
      method: 'GET',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }),
    undefined,
    15_000,
    'The custom server',
  );
  const data = (response.json as { data?: unknown } | undefined)?.data;
  if (response.status !== 200 || !Array.isArray(data)) {
    return [];
  }
  return [
    ...new Set(
      data.flatMap((m: unknown) => {
        const id = m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined;
        return typeof id === 'string' && id.trim() ? [id] : [];
      }),
    ),
  ].sort();
}

export interface ConnectionCheck {
  json: boolean;
  tools: boolean;
  message: string;
}
/** Small synthetic requests: testing never accesses the user's vault or changes its data. */
export async function testCustomConnection(
  connection: CustomConnection,
  key: string | null,
  signal?: AbortSignal,
  http: Http = obsidianHttp,
): Promise<ConnectionCheck> {
  const empty = { paths: () => [], read: async () => '' };
  const task: AgentTask = {
    prompt: 'Connection check. Return {"ok":true}.',
    vault: false,
    signal,
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  };
  const result = await new CustomRunner(empty, () => key, connection, [], http).run(task);
  if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) {
    throw new Error(
      'The model replied, but failed the JSON check. Try a model with structured-answer support.',
    );
  }
  const code = crypto.randomUUID();
  let read = false;
  const vault: VaultReader = {
    paths: () => ['Connection test.md'],
    read: async () => {
      read = true;
      return `Connection code: ${code}`;
    },
  };
  try {
    const answer = await new CustomRunner(vault, () => key, connection, [], http).run({
      prompt:
        'Connection check using a synthetic note, not a real vault. Call read_note for "Connection test.md", then return the connection code as {"code":"the code from the note"}. Do not guess the code.',
      schema: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
        additionalProperties: false,
      },
      signal,
    });
    const tools =
      read &&
      !!answer &&
      typeof answer === 'object' &&
      (answer as { code?: unknown }).code === code;
    return {
      json: true,
      tools,
      message: tools
        ? 'Connected. JSON replies and note tools passed. Choose Custom AI under AI roles. Each model should be tested separately.'
        : 'JSON replies passed, but note tools did not. Requests containing all source text may work; tasks that read notes need a model with tool support.',
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new Error(CANCELLED);
    }
    return {
      json: true,
      tools: false,
      message: `JSON replies passed, but note tools failed. ${error instanceof Error ? error.message : 'Choose a model with tool support.'}`,
    };
  }
}
