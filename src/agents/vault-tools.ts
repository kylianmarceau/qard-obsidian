import { isPdf } from '../vault-access';
import { pageMarker, splitPages } from '../sources/pdf-text';

/** Read-only vault access for the API runner. The model only sees notes and PDFs through these three tools. */
export interface VaultReader {
  paths(): string[];
  /** A note's Markdown, or a PDF's page-marked text. */
  read(path: string): Promise<string>;
}
export const VAULT_TOOLS = [
  {
    name: 'list_notes',
    description:
      'List Markdown notes and PDFs in the vault, optionally under a folder. Returns vault-relative paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        folder: {
          type: 'string',
          description: 'Vault-relative folder, e.g. "Notes/CS315". Omit for the whole vault.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'search_notes',
    description:
      'Find notes containing all the given words (case-insensitive). Returns up to 15 paths with a short excerpt. PDFs match by file name only.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_note',
    description:
      "Read one Markdown note or PDF by its vault-relative path. A PDF's text comes with [Page N] markers, a few pages at a time.",
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string' },
        start_page: {
          type: 'integer',
          minimum: 1,
          description: 'For a PDF: the page to start from, to continue a long PDF. Default 1.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];
const MAX_NOTE = 60_000;

/** A long PDF is read in parts of whole pages, each ending with where to continue. */
async function readPdf(vault: VaultReader, path: string, start: unknown) {
  let text: string;
  try {
    text = await vault.read(path);
  } catch (error) {
    return error instanceof Error ? error.message : `Could not read ${path}.`;
  }
  const pages = splitPages(text),
    first = typeof start === 'number' && Number.isInteger(start) && start > 1 ? start : 1,
    from = pages.findIndex((p) => p.page >= first);
  if (from < 0) {
    return `${path} has no page ${first}. It has ${pages.length} pages.`;
  }
  let out = '',
    next = from;
  for (; next < pages.length; next++) {
    const page = pages[next]!,
      block = page.text ? `${pageMarker(page.page)}\n${page.text}` : pageMarker(page.page);
    if (out && out.length + block.length > MAX_NOTE) {
      break;
    }
    out = out ? `${out}\n\n${block}` : block.slice(0, MAX_NOTE);
  }
  return next < pages.length
    ? `${out}\n\n[More follows: call read_note with start_page ${pages[next]!.page} to continue. The PDF has ${pages.length} pages.]`
    : out;
}

export async function runVaultTool(
  vault: VaultReader,
  name: string,
  input: unknown,
  exclude: string[] = [],
): Promise<string> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const visible = vault
    .paths()
    .filter(
      (p) =>
        (p.endsWith('.md') || isPdf(p)) && !exclude.some((x) => p === x || p.startsWith(x + '/')),
    );
  if (name === 'list_notes') {
    const folder = typeof args.folder === 'string' ? args.folder.replace(/^\/+|\/+$/g, '') : '';
    const found = visible.filter((p) => !folder || p.startsWith(folder + '/'));
    return found.length
      ? found.slice(0, 400).join('\n') +
          (found.length > 400 ? `\n…and ${found.length - 400} more. Narrow by folder.` : '')
      : 'No notes found.';
  }
  if (name === 'search_notes') {
    const words = (typeof args.query === 'string' ? args.query : '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) {
      return 'Give a query.';
    }
    const hits: string[] = [];
    for (const path of visible) {
      // Extracting every PDF in a large vault would take too long for a search.
      if (isPdf(path)) {
        if (words.every((w) => path.toLowerCase().includes(w))) {
          hits.push(`${path}\n  (PDF matched by file name; read it with read_note)`);
        }
        if (hits.length >= 15) {
          break;
        }
        continue;
      }
      const text = await vault.read(path),
        lower = text.toLowerCase();
      if (!words.every((w) => lower.includes(w) || path.toLowerCase().includes(w))) {
        continue;
      }
      const at = Math.max(0, lower.indexOf(words[0]!) - 80);
      hits.push(`${path}\n  …${text.slice(at, at + 220).replace(/\s+/g, ' ')}…`);
      if (hits.length >= 15) {
        break;
      }
    }
    return hits.length ? hits.join('\n') : 'No matching notes.';
  }
  if (name === 'read_note') {
    const path = typeof args.path === 'string' ? args.path : '';
    if (!visible.includes(path)) {
      return `No note at "${path}". Use list_notes or search_notes to find paths.`;
    }
    if (isPdf(path)) {
      return readPdf(vault, path, args.start_page);
    }
    const text = await vault.read(path);
    return text.length > MAX_NOTE
      ? text.slice(0, MAX_NOTE) + '\n\n[Truncated: the note is longer than this.]'
      : text;
  }
  return `Unknown tool ${name}.`;
}
