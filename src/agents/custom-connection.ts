/** Connection metadata only; authentication is kept in Obsidian's secret storage. */
export interface CustomConnection {
  baseUrl: string;
  model: string;
}
export const DEFAULT_CUSTOM_CONNECTION: CustomConnection = {
  baseUrl: 'http://localhost:11434/v1',
  model: '',
};

/** Accept a server root or API prefix, never credentials embedded in an address. */
export function customBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter the full server address, including http:// or https://.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP or HTTPS server address without a password, query or fragment. Put any API key in the key field.',
    );
  }
  if (/\/(chat\/completions|models)\/?$/.test(url.pathname)) {
    throw new Error(
      'Enter the API base address ending in /v1, without /chat/completions or /models.',
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
  return url.toString().replace(/\/$/, '');
}
export function readCustomConnection(raw: unknown): CustomConnection {
  const value = raw && typeof raw === 'object' ? (raw as Partial<CustomConnection>) : {};
  let baseUrl = DEFAULT_CUSTOM_CONNECTION.baseUrl;
  if (typeof value.baseUrl === 'string') {
    try {
      baseUrl = customBaseUrl(value.baseUrl);
    } catch {
      baseUrl = '';
    }
  }
  return { baseUrl, model: typeof value.model === 'string' ? value.model.trim() : '' };
}
