/** Card formats live in the existing Markdown callout; review IDs and scheduling stay unchanged. */
export interface ImageMask {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageOcclusion {
  image: string;
  masks: ImageMask[];
  target?: string;
}
export type CardFormat =
  | { kind: 'basic'; text: string }
  | { kind: 'cloze'; text: string; target: number }
  | { kind: 'occlusion'; text: string; occlusion: ImageOcclusion };
export const FORMAT_BACK = 'Recall the hidden answer.';
export const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;

/** Ignore literal syntax in fenced/inline code, escaped braces and HTML comments. */
function transformProse(text: string, replace: (text: string) => string): string {
  const blanks: { start: number; end: number }[] = [];
  replaceBlanks(text, (_group, answer, _hint, start, end) => {
    blanks.push({ start, end });
    return answer;
  });
  const protectedSyntax =
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$|(`+)[^\n]*?\2(?!`)|<!--[\s\S]*?-->|\\\{\{/gm;
  let result = '',
    cursor = 0;
  for (const match of text.matchAll(protectedSyntax)) {
    if (blanks.some((blank) => match.index > blank.start && match.index < blank.end)) {
      continue;
    }
    result += replace(text.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return result + replace(text.slice(cursor));
}
function replaceBlanks(
  text: string,
  replace: (group: number, answer: string, hint: string, start: number, end: number) => string,
): string {
  const start = /\{\{c([1-9]\d{0,2})::/g;
  let result = '',
    cursor = 0;
  for (const match of text.matchAll(start)) {
    if (match.index < cursor) {
      continue;
    }
    let depth = 0;
    const bodyStart = match.index + match[0].length;
    for (let i = bodyStart; i < text.length && text[i] !== '\n'; i++) {
      if (text[i] === '}' && text[i + 1] === '}' && depth === 0) {
        const [answer, ...hints] = text.slice(bodyStart, i).split('::');
        if (answer?.trim() && !answer.includes('{{c')) {
          result +=
            text.slice(cursor, match.index) +
            replace(Number(match[1]), answer, hints.join('::'), match.index, i + 2);
          cursor = i + 2;
        }
        break;
      }
      if (text[i] === '{' && text[i - 1] !== '\\') {
        depth++;
      }
      if (text[i] === '}' && text[i - 1] !== '\\') {
        depth--;
      }
      if (depth < 0) {
        break;
      }
    }
  }
  return result + text.slice(cursor);
}
export function clozeGroups(text: string): number[] {
  const groups = new Set<number>();
  transformProse(text, (part) => {
    return replaceBlanks(part, (group, answer) => {
      groups.add(group);
      return answer;
    });
  });
  return [...groups].sort((a, b) => a - b);
}
export function renderCloze(text: string, target: number, revealed: boolean): string {
  return transformProse(text, (part) =>
    replaceBlanks(part, (group, answer, hint) => {
      if (group !== target || revealed) {
        return answer;
      }
      // Hints are plain text: they must never create an image, embed, or HTML element.
      const label = (hint.trim() || '…').replace(/[\\`*_[\]{}()<>!#$|]/g, '\\$&');
      return `**[${label}]**`;
    }),
  );
}
export function clozeFront(text: string, target: number): string {
  return `${text.trim()}\n<!-- qard-cloze: ${target} -->`;
}
export function occlusionFront(text: string, occlusion: ImageOcclusion): string {
  const data = JSON.stringify(occlusion).replace(/</g, '\\u003c');
  return `${text.trim() || 'Identify the hidden part.'}\n![[${occlusion.image}]]\n<!-- qard-occlusion: ${data} -->`;
}
export function readCardFormat(front: string): CardFormat {
  // Format metadata is the final front line, so ordinary code examples remain ordinary cards.
  const lines = front.split('\n');
  const marker = lines[lines.length - 1]!.trim();
  let text = lines.slice(0, -1).join('\n').trim();
  if (marker.startsWith('<!-- qard-cloze:')) {
    const target = Number(marker.match(/^<!-- qard-cloze: ([1-9]\d{0,2}) -->$/)?.[1]);
    if (!text || !clozeGroups(text).includes(target)) {
      throw new Error('Cloze cards need a matching blank, such as {{c1::answer}}.');
    }
    return { kind: 'cloze', text, target };
  }
  if (marker.startsWith('<!-- qard-occlusion:')) {
    const json = marker.match(/^<!-- qard-occlusion: (.+) -->$/)?.[1];
    let raw: unknown;
    try {
      raw = JSON.parse(json || '');
    } catch {
      throw new Error('Image occlusion data is invalid. Reopen the card and redraw its masks.');
    }
    let data = raw as Partial<ImageOcclusion> | null;
    const embed = lines[lines.length - 2]?.match(/^!\[\[(.+)\]\]$/)?.[1];
    if (embed && data && typeof data === 'object') {
      // Obsidian updates this real wikilink when attachments move; prefer it to the JSON snapshot.
      data = { ...data, image: embed };
      text = lines.slice(0, -2).join('\n').trim();
    }
    if (
      !text ||
      !data ||
      typeof data.image !== 'string' ||
      !IMAGE_EXTENSIONS.test(data.image) ||
      /(?:^[a-z][a-z\d+.-]*:|^[\\/]|[\r\n\0]|(?:^|[/\\])\.\.(?:[/\\]|$))/i.test(data.image) ||
      !Array.isArray(data.masks) ||
      !data.masks.length ||
      data.masks.length > 100
    ) {
      throw new Error('Choose a local vault image and add at least one mask.');
    }
    const ids = new Set<string>();
    for (const mask of data.masks) {
      if (
        !mask ||
        typeof mask.id !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(mask.id) ||
        ids.has(mask.id) ||
        ![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) ||
        mask.x < 0 ||
        mask.y < 0 ||
        mask.width <= 0 ||
        mask.height <= 0 ||
        mask.x + mask.width > 1.000001 ||
        mask.y + mask.height > 1.000001
      ) {
        throw new Error('Image masks must fit inside the image and have distinct IDs.');
      }
      ids.add(mask.id);
    }
    if (data.target !== undefined && (typeof data.target !== 'string' || !ids.has(data.target))) {
      throw new Error('The mask this card studies is missing. Choose another mask before saving.');
    }
    return { kind: 'occlusion', text, occlusion: data as ImageOcclusion };
  }
  return { kind: 'basic', text: front };
}

/** Keep existing basic labels identical; distinguish generated variants in the library and picker. */
export function cardTitle(front: string): string {
  const format = readCardFormat(front);
  if (format.kind === 'cloze') {
    return (
      renderCloze(format.text, format.target, false).split('\n')[0]!.replace(/\*\*/g, '') +
      ` · Blank ${format.target}`
    );
  }
  if (format.kind === 'occlusion' && format.occlusion.target) {
    const index = format.occlusion.masks.findIndex((mask) => mask.id === format.occlusion.target);
    return format.text.split('\n')[0] + ` · Mask ${index + 1}`;
  }
  return format.text.split('\n')[0]!;
}
