import { parseDocument } from 'yaml';
import { readCardFormat } from './card-format';
import { readCardLocation, type CardLocation } from './card-location';
import type { ParseResult, QardCard } from './card-types';

interface Line {
  text: string;
  start: number;
  end: number;
}
export function sourceLines(source: string): Line[] {
  const result: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) && match[0].length) {
    result.push({ text: match[1]!, start: match.index, end: re.lastIndex });
  }
  return result;
}
function hash(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return (result >>> 0).toString(36);
}
const header = /^ {0,3}> ?\[!qard\][+-]?(?:[ \t]+(.*))?$/i;
const idComment = /^\s*<!--\s*qard-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;
const quoted = /^ {0,3}> ?(.*)$/;
const fenceStart = /^ {0,3}(`{3,}|~{3,})/;
function closesFence(line: string, fence: string) {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return !!match && match[1]![0] === fence[0] && match[1]!.length >= fence.length;
}
export function parseCards(
  source: string,
  path: string,
  onTopic?: (line: number, topic: string, deck: string) => void,
): ParseResult {
  const lines = sourceLines(source);
  const result: ParseResult = { cards: [], issues: [] };
  const issue = (line: number, message: string) =>
    result.issues.push({ file: path, line, message });
  let metadata: Record<string, unknown> = {};
  let start = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, '') === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line.text));
    if (end < 0) {
      issue(0, 'Unclosed frontmatter; file was not indexed.');
      return result;
    }
    try {
      const doc = parseDocument(
        lines
          .slice(1, end)
          .map((l) => l.text)
          .join('\n'),
      );
      if (doc.errors.length) {
        throw new Error('Invalid YAML');
      }
      const value: unknown = doc.toJS({ maxAliasCount: 20 });
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        metadata = value as Record<string, unknown>;
      }
    } catch {
      issue(0, 'Invalid frontmatter; file was not indexed.');
      return result;
    }
    start = end + 1;
  }
  const name = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const deck =
    name(metadata['qard-deck']) || path.replace(/\.md$/i, '').split('/').pop() || 'Untitled';
  const topicOverride = name(metadata['qard-topic']);
  onTopic?.(0, topicOverride || 'General', deck);
  const rawTags = Array.isArray(metadata.tags)
    ? metadata.tags
    : typeof metadata.tags === 'string'
      ? metadata.tags.split(/[,\s]+/)
      : [];
  const tags = rawTags
    .filter((x): x is string => typeof x === 'string')
    .map((t) => t.replace(/^#/, ''));
  let topic = 'General';
  let fence = '';
  let comment = false;
  const occurrences = new Map<string, number>();
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      if (closesFence(line.text, fence)) {
        fence = '';
      }
      continue;
    }
    if (comment) {
      if (line.text.includes('-->')) {
        comment = false;
      }
      continue;
    }
    const opening = line.text.match(fenceStart);
    if (opening) {
      fence = opening[1]!;
      continue;
    }
    if (/^\s*<!--/.test(line.text)) {
      if (!line.text.includes('-->')) {
        comment = true;
      }
      continue;
    }
    const heading = line.text.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (heading) {
      topic = heading[1]!.trim();
      onTopic?.(i, topicOverride || topic, deck);
      continue;
    }
    // Setext headings are ordinary Markdown headings too.
    if (
      /^ {0,3}(?:=+|-+)\s*$/.test(line.text) &&
      i > start &&
      lines[i - 1]!.text.trim() &&
      !/^\s*>/.test(lines[i - 1]!.text)
    ) {
      topic = lines[i - 1]!.text.trim();
      onTopic?.(i - 1, topicOverride || topic, deck);
      continue;
    }
    const match = line.text.match(header);
    if (!match) {
      continue;
    }
    let end = i + 1;
    let insideFence = (match[1] || '').match(fenceStart)?.[1] || '';
    let separator = -1;
    const body: string[] = [];
    while (end < lines.length) {
      const content = lines[end]!.text.match(quoted);
      if (!content) {
        break;
      }
      const value = content[1]!;
      if (!insideFence && header.test(lines[end]!.text)) {
        break;
      }
      if (insideFence) {
        if (closesFence(value, insideFence)) {
          insideFence = '';
        }
      } else {
        const code = value.match(fenceStart);
        if (code) {
          insideFence = code[1]!;
        } else if (value.trim() === '<!-- qard-answer -->' && separator < 0) {
          separator = body.length;
        }
      }
      body.push(value);
      end++;
    }
    const title = match[1] || '';
    const front =
      separator >= 0 ? [title, ...body.slice(0, separator)].join('\n').trim() : title.trim();
    const back = (separator >= 0 ? body.slice(separator + 1) : body).join('\n').trim();
    if (!front || !back || insideFence) {
      issue(
        i,
        !front
          ? 'Qard callout needs a question.'
          : !back
            ? 'Qard callout needs an answer.'
            : 'Qard callout has an unclosed code fence.',
      );
      i = end - 1;
      continue;
    }
    try {
      readCardFormat(front);
    } catch (error) {
      issue(i, (error as Error).message);
      i = end - 1;
      continue;
    }
    let idLine = i - 1;
    if (idLine >= 0 && lines[idLine]!.text.trim() === '') {
      idLine--;
    }
    let identity: string | undefined,
      siblingGroup: string | undefined,
      reverseId: string | undefined,
      location: CardLocation | undefined;
    let first = line,
      invalidLocation = false;
    for (let n = idLine; n >= start; n--) {
      const text = lines[n]!.text;
      const id = text.match(idComment)?.[1];
      const group = text.match(/^\s*<!-- qard-siblings: ([A-Za-z0-9_-]+) -->\s*$/)?.[1];
      const reverse = text.match(/^\s*<!-- qard-reverse: ([A-Za-z0-9_-]+) -->\s*$/)?.[1];
      const placement = text.match(/^\s*<!-- qard-location: (.+) -->\s*$/)?.[1];
      if (id && !identity) {
        identity = id;
      } else if (group && !siblingGroup) {
        siblingGroup = group;
      } else if (reverse && !reverseId) {
        reverseId = reverse;
      } else if (placement && !location) {
        try {
          location = readCardLocation(JSON.parse(placement));
        } catch {
          invalidLocation = true;
        }
      } else {
        break;
      }
      first = lines[n]!;
    }
    if (invalidLocation) {
      issue(i, 'Invalid card deck/topic override. Fix its qard-location comment.');
      i = end - 1;
      continue;
    }
    if (location) {
      onTopic?.(i, location.topic, location.deck);
      onTopic?.(end, topicOverride || topic, deck);
    }
    const finish = lines[end - 1]!.end;
    const fingerprint = hash(front + '\0' + back);
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    const inlineTags = [...(front + '\n' + back).matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(
      (m) => m[1]!,
    );
    result.cards.push({
      id: identity || `volatile:${path}:${fingerprint}:${occurrence}`,
      stable: !!identity,
      ...(siblingGroup ? { siblingGroup } : {}),
      ...(reverseId ? { reverseId } : {}),
      ...(location ? { location } : {}),
      deck: location?.deck || deck,
      topic: location?.topic || topicOverride || topic,
      frontMarkdown: front,
      backMarkdown: back,
      sourceFile: path,
      sourcePosition: { start: first.start, end: finish, calloutStart: line.start, line: i },
      sourceText: source.slice(first.start, finish),
      tags: [...new Set([...tags, ...inlineTags])],
    });
    i = end - 1;
  }
  return result;
}
export function sameContent(a: QardCard, b: QardCard) {
  return a.frontMarkdown === b.frontMarkdown && a.backMarkdown === b.backMarkdown;
}

/** Same heading rules as indexing, including code fences and file overrides. */
export function locationAtLine(source: string, path: string, line: number): CardLocation {
  let location = {
    deck: path.replace(/\.md$/i, '').split('/').pop() || 'Untitled',
    topic: 'General',
  };
  parseCards(source, path, (headingLine, topic, deck) => {
    if (headingLine <= line) {
      location = { deck, topic };
    }
  });
  return location;
}
export function topicAtLine(source: string, path: string, line: number): string {
  return locationAtLine(source, path, line).topic;
}
