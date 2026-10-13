import { Marked, type Tokens } from 'marked';

/** Maps a link as written in the card to the media filename Anki should load, when it is a vault file. */
export type MediaResolver = (link: string) => string | undefined;

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;
const SOUND = /\.(?:mp3|wav|ogg|m4a|mp4|webm)$/i;
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (href: string) => {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
};
let resolve: MediaResolver = () => undefined;
function media(link: string, label: string, size?: string) {
  const name = resolve(link);
  if (!name) {
    return escape(label);
  }
  if (SOUND.test(name)) {
    return `[sound:${name}]`;
  }
  if (!IMAGE.test(name)) {
    return escape(label);
  }
  const width = size?.match(/^(\d+)/)?.[1];
  return `<img src="${escape(name)}"${width ? ` width="${width}"` : ''}>`;
}
const text = (name: string, pattern: RegExp, start: string, render: (m: string[]) => string) => ({
  name,
  level: 'inline' as const,
  start: (src: string) => {
    const at = src.indexOf(start);
    return at < 0 ? undefined : at;
  },
  tokenizer(src: string) {
    const match = pattern.exec(src);
    return match ? { type: name, raw: match[0], html: render(match) } : undefined;
  },
  renderer: (token: Tokens.Generic) => token.html as string,
});
/** Obsidian syntax that Markdown itself does not define. Code spans and fences are read first, so they stay literal. */
const converter = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (src: string) => {
        const at = src.indexOf('$$');
        return at < 0 ? undefined : at;
      },
      tokenizer(src: string) {
        const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        return match
          ? { type: 'blockMath', raw: match[0], html: `<p>\\[${escape(match[1]!.trim())}\\]</p>\n` }
          : undefined;
      },
      renderer: (token: Tokens.Generic) => token.html as string,
    },
    text('displayMath', /^\$\$([^\n]+?)\$\$/, '$$', (m) => `\\[${escape(m[1]!.trim())}\\]`),
    text(
      'inlineMath',
      /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/,
      '$',
      (m) => `\\(${escape(m[1]!)}\\)`,
    ),
    text('embed', /^!\[\[([^\]\n]+)\]\]/, '![[', (m) => {
      const [link, size] = m[1]!.split('|');
      return media(link!.split('#')[0]!, link!, size);
    }),
    text('wikilink', /^\[\[([^\]\n]+)\]\]/, '[[', (m) => {
      const [link, alias] = m[1]!.split('|');
      return escape(alias ?? link!);
    }),
    text('highlight', /^==(?!\s)([^=\n]+?)==/, '==', (m) => `<mark>${escape(m[1]!)}</mark>`),
  ],
  renderer: {
    image({ href, text: alt }: Tokens.Image) {
      return /^[a-z][a-z\d+.-]*:/i.test(href)
        ? `<img src="${escape(href)}" alt="${escape(alt)}">`
        : media(decode(href), alt || href);
    },
  },
});

/** Anki fields are HTML with MathJax delimiters and flat media filenames. */
export function ankiHtml(markdown: string, resolver: MediaResolver = () => undefined): string {
  resolve = resolver;
  try {
    const html = converter.parse(markdown.replace(/<!--[\s\S]*?-->/g, ''), { async: false });
    const trimmed = html.trim();
    // A single paragraph needs no wrapper; Anki centres and spaces fields itself.
    const single = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
    return single && !single[1]!.includes('<p>') ? single[1]!.trim() : trimmed;
  } finally {
    resolve = () => undefined;
  }
}
export const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
