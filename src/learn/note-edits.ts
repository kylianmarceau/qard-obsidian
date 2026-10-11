export function insertUnderHeading(text: string, heading: string, addition: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n',
    lines = text.replace(/\s*$/, '').split(/\r?\n/),
    block = addition.trim().split(/\r?\n/);
  const wanted = heading
    .trim()
    .replace(/^#+\s*/, '')
    .toLowerCase();
  const at = wanted
    ? lines.findIndex((l) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)?.[2]?.toLowerCase() === wanted)
    : -1;
  if (at < 0) {
    return [...lines, '', ...block, ''].join(eol);
  }
  const level = /^#+/.exec(lines[at]!)![0].length;
  let end = lines.findIndex((l, i) => i > at && (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 7) <= level);
  if (end < 0) {
    end = lines.length;
  }
  let insert = end;
  while (insert > at + 1 && !lines[insert - 1]!.trim()) {
    insert--;
  }
  const after = lines.slice(end);
  return [...lines.slice(0, insert), '', ...block, '', ...after, ...(after.length ? [''] : [])]
    .join(eol)
    .replace(/(\r?\n)+$/, eol);
}
