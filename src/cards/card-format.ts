import type { CardFormat, ImageMask } from './card-types';

interface Blank { start: number; end: number; answer: string; hint: string }
/** Balance single braces inside a blank so LaTeX such as {{\\frac{a}{b}}} works. */
function findBlanks(text: string): { blanks: Blank[]; invalid: boolean } {
  const blanks: Blank[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{{', cursor);
    if (start < 0) break;
    let depth = 0, end = start + 2;
    for (; end < text.length; end++) {
      if (depth === 0 && text.startsWith('}}', end)) break;
      if (text.startsWith('{{', end)) return { blanks, invalid: true };
      if (text[end] === '{') depth++;
      else if (text[end] === '}') { if (!depth) return { blanks, invalid: true }; depth--; }
    }
    if (end >= text.length) return { blanks, invalid: true };
    const [answer, ...hint] = text.slice(start + 2, end).split('::');
    blanks.push({ start, end: end + 2, answer: answer!, hint: hint.join('::').trim() });
    cursor = end + 2;
  }
  return { blanks, invalid: false };
}
/** All blanks in one card are recalled together; ordinary cards never interpret this syntax. */
export function clozeMarkdown(text: string, revealed: boolean): string {
  let result = '', cursor = 0;
  for (const blank of findBlanks(text).blanks) {
    result += text.slice(cursor, blank.start);
    // Hints are plain text, not executable Markdown or image embeds.
    const label = blank.hint.replace(/[\\`*_{}[\]()<>!$]/g, '');
    result += revealed ? blank.answer : label ? `[${label}]` : '[…]';
    cursor = blank.end;
  }
  return result + text.slice(cursor);
}
export function validateCloze(text: string) {
  const { blanks, invalid } = findBlanks(text);
  if (invalid || blanks.some(blank => !blank.answer.trim())) {
    throw new Error('Each blank needs an answer and matching {{ and }}. Nested blanks are not supported.');
  }
  if (!blanks.length) throw new Error('Mark at least one blank with {{answer}} or {{answer::hint}}.');
}
export function validMask(mask: ImageMask): boolean {
  return [mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) && mask.x >= 0 && mask.y >= 0 && mask.width > 0 && mask.height > 0 && mask.x + mask.width <= 100.000001 && mask.y + mask.height <= 100.000001;
}
export function readCardFormat(value: unknown): CardFormat {
  if (!value || typeof value !== 'object') throw new Error('Invalid card format.');
  const format = value as Record<string, unknown>;
  if (format.type === 'cloze') return { type: 'cloze' };
  const image = typeof format.image === 'string' ? format.image.trim() : '';
  if (format.type !== 'occlusion' || !image || /[\r\n<>|[\]]/.test(image) || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(image) || !/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(image) || !Array.isArray(format.masks) || !format.masks.length || format.masks.length > 100) {
    throw new Error('Choose a local vault image and between 1 and 100 masks.');
  }
  const masks = format.masks.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid image mask.');
    const { x, y, width, height } = value as ImageMask;
    const mask = { x, y, width, height };
    if (!validMask(mask)) throw new Error('Image masks must stay inside the image.');
    return mask;
  });
  return { type: 'occlusion', image, masks };
}
export function validateCardFormat(format: CardFormat | undefined, front: string) {
  if (!format) return;
  readCardFormat(format);
  if (format.type === 'cloze') validateCloze(front);
}
