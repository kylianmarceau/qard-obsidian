import { modelIds } from './custom-runner';
import { obsidianHttp, type Http } from './openrouter-runner';
import { CANCELLED, deadline } from './runner';

export interface LocalModelServer {
  name: string;
  baseUrl: string;
  models: string[];
  needsKey: boolean;
}

const LOCAL_SERVERS = [
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { name: 'oMLX', baseUrl: 'http://localhost:8000/v1' },
];

/** Only probe known loopback endpoints, without sending any saved keys or vault text. */
export async function discoverLocalModels(
  signal: AbortSignal,
  http: Http = obsidianHttp,
): Promise<LocalModelServer[]> {
  if (signal.aborted) {
    throw new Error(CANCELLED);
  }
  const servers = await Promise.all(
    LOCAL_SERVERS.map(async (server): Promise<LocalModelServer | undefined> => {
      try {
        const response = await deadline(
          http(`${server.baseUrl}/models`, { method: 'GET', headers: {} }),
          signal,
          3_000,
          server.name,
        );
        if (response.status === 401 || response.status === 403) {
          return { ...server, models: [], needsKey: true };
        }
        const data = (response.json as { data?: unknown } | undefined)?.data;
        if (response.status === 200 && Array.isArray(data)) {
          return { ...server, models: modelIds(data), needsKey: false };
        }
      } catch {
        // A stopped server must not prevent another local server from being discovered.
      }
    }),
  );
  if (signal.aborted) {
    throw new Error(CANCELLED);
  }
  return servers.filter((server): server is LocalModelServer => !!server);
}
