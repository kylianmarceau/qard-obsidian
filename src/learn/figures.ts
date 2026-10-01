/** A figure the illustrator drew, saved in the vault and shown with its caption. */
export interface Figure { path: string; caption: string; brief: string }

const MAX_SVG = 1_500_000;
const BANNED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener']);

/**
 * Parses an agent's or a script's SVG and keeps only drawing: no scripts, event handlers, embedded HTML or
 * links outside the file. Throws with a reason the illustrator can act on when it isn't usable.
 */
export function cleanSvg(source: string): string {
  const start = source.indexOf('<svg');
  if (start < 0) throw new Error('svg must contain an <svg> element');
  if (source.length > MAX_SVG) throw new Error('svg is too large; simplify the figure');
  const doc = new DOMParser().parseFromString(source.slice(start), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) throw new Error(`svg is not well-formed XML: ${(doc.getElementsByTagName('parsererror')[0]?.textContent ?? '').trim().slice(0, 200)}`);
  if (root.nodeName.toLowerCase() !== 'svg') throw new Error('the root element must be <svg>');
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (BANNED.has(child.nodeName.toLowerCase().replace(/^svg:/, ''))) { child.remove(); continue; }
      walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase(), value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#') && !value.startsWith('data:image/')) el.removeAttribute(attr.name);
      else if (/url\s*\(\s*['"]?(?!#)/.test(value) || value.includes('javascript:')) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!root.getAttribute('viewBox') && !(root.getAttribute('width') && root.getAttribute('height'))) throw new Error('svg needs a viewBox, or a width and height');
  if (!root.querySelector('path, line, rect, circle, ellipse, polygon, polyline, text, use, image')) throw new Error('svg draws nothing');
  return `${new XMLSerializer().serializeToString(root)}\n`;
}

/** "Beta shapes (α=2)!" → "beta-shapes-2": lowercase, hyphens, no dates, as the vault names its assets. */
export function figureName(name: string): string {
  const slug = name.normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/_/g, '-').trim().toLowerCase().replace(/[\s-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return slug || 'figure';
}
/** A subject subfolder: an existing one when it fits, otherwise a short new name. */
export const figureDomain = (domain: string) => figureName(domain).slice(0, 30) || 'figures';

/** The Markdown that shows a figure: an embed, a blank line, then an italic caption (the vault's style). */
export const figureMarkdown = (figure: Pick<Figure, 'path' | 'caption'>) => `![[${figure.path}|700]]\n\n*Figure: ${figure.caption.replace(/^\*?figure:\s*/i, '').replace(/\*+$/, '').trim()}*`;
