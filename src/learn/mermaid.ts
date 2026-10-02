/** Node shapes whose label is already wrapped in its own delimiters, e.g. [[subroutine]] or [(database)]. */
const SHAPED = /^(\[.*\]|\(.*\)|\/.*\/|\\.*\\|\/.*\\|\\.*\/)$/s;
const NODE = /^(\s*[A-Za-z_][\w-]*)(\[|\(|\{)(.*)(\]|\)|\})(\s*;?\s*)$/s;
const CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
/** Arrows and edge labels between nodes: -->, ---, -.->, ==>, --text-->, -->|text|, and & joins. */
const LINK = /(\s*(?:<?(?:-{2,}|={2,}|-\.+-?)(?:[^->=|]*?(?:-{2,}|={2,}|\.-))?[>ox]?)(?:\|[^|]*\|)?\s*|\s+&\s+)/;

/**
 * Agents write labels like G[[[1]] takes one node] or A[f(x) = y], which Mermaid can't parse unquoted.
 * Quotes any node label holding brackets, braces, pipes or quotes, and leaves shaped and quoted labels alone.
 */
export function tidyMermaid(source: string): string {
  const body = source.replace(/^\s*```(?:mermaid)?\s*|```\s*$/g, '').trim();
  return body.split('\n').map(line => line.split(LINK).map((part, i) => {
    if (i % 2) return part;
    const m = NODE.exec(part);
    if (!m || CLOSE[m[2]!] !== m[4]) return part;
    const label = m[3]!;
    if (label.startsWith('"') && label.endsWith('"')) return part;
    if (m[2] !== '{' && SHAPED.test(label) && !/[[\](){}]/.test(label.slice(1, -1))) return part;
    if (!/[[\](){}|"<>#;]/.test(label)) return part;
    return `${m[1]}${m[2]}"${label.replace(/"/g, '#quot;')}"${m[4]}${m[5]}`;
  }).join('')).join('\n');
}
