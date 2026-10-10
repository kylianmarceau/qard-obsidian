import TurndownService from 'turndown';

/** Interpret supported Anki substitutions as data; never run templates' JavaScript. */
export function renderTemplate(
  template: string,
  fields: Record<string, string>,
  side: 'front' | 'back',
  cloze: 'keep' | 'omit' = 'keep',
) {
  const stack: { name: string; show: boolean }[] = [];
  let output = '',
    at = 0;
  const visible = () => stack.every((s) => s.show);
  for (const match of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (visible()) {
      output += template.slice(at, match.index);
    }
    const token = match[1]!.trim();
    at = match.index + match[0].length;
    if (token.startsWith('#') || token.startsWith('^')) {
      const name = token.slice(1);
      stack.push({ name, show: token[0] === '#' ? !!fields[name]?.trim() : !fields[name]?.trim() });
    } else if (token.startsWith('/')) {
      if (stack.pop()?.name !== token.slice(1)) {
        throw new Error('Unsupported unbalanced Anki template.');
      }
    } else if (visible()) {
      if (token === 'FrontSide') {
        continue;
      }
      const parts = token.split(':'),
        name = parts.pop()!;
      if (!(name in fields)) {
        throw new Error(`Unsupported Anki template field: ${name}.`);
      }
      let value = fields[name]!;
      for (const filter of parts.reverse()) {
        if (filter === 'cloze') {
          if (cloze === 'omit') {
            value = '';
          }
        } else if (filter === 'type') {
          if (side === 'front') {
            value = '';
          }
        } else if (filter === 'text') {
          value = new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '';
        } else {
          throw new Error(`Unsupported Anki template filter: ${filter}.`);
        }
      }
      output += value;
    }
  }
  if (stack.length) {
    throw new Error('Unsupported unbalanced Anki template.');
  }
  return output + template.slice(at);
}

export function ankiMarkdown(html: string, media: Map<string, string>): string {
  // Anki sound tags become local Obsidian media embeds, never a remote request.
  html = html.replace(/\[sound:([^\]\n]+)\]/g, (_all, name: string) => {
    const path = media.get(name);
    if (!path) {
      throw new Error(`Missing or unsupported media: ${name}.`);
    }
    return `<qard-media>${path}</qard-media>`;
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((el) => el.remove());
  doc.querySelectorAll('img,audio,video,source').forEach((el) => {
    const name = el.getAttribute('src') ?? '';
    if (!name) {
      return;
    }
    let decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      /* use original */
    }
    const path = media.get(decoded);
    if (path) {
      const marker = doc.createElement('qard-media');
      marker.textContent = path;
      el.replaceWith(marker);
    } else if (/^https?:\/\//i.test(name)) {
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', name);
      anchor.textContent = el.getAttribute('alt') || 'Remote media';
      el.replaceWith(anchor);
    } else {
      throw new Error(`Missing or unsupported media: ${decoded}.`);
    }
  });
  doc.querySelectorAll('a').forEach((a) => {
    if (/^(?:javascript|data|file):/i.test(a.getAttribute('href') ?? '')) {
      a.removeAttribute('href');
    }
  });
  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  converter.addRule('local-media', {
    filter: 'qard-media' as keyof HTMLElementTagNameMap,
    replacement: (_content, node) => `![[${node.textContent}]]`,
  });
  converter.addRule('math', {
    filter: (node) => node.nodeName === 'ANKI-MATH',
    replacement: (_content, node) => node.getAttribute('data-content') ?? '',
  });
  // Keep Anki's TeX delimiters intact rather than escaping them as ordinary Markdown.
  const walker = doc.createTreeWalker(doc.body, 4),
    texts: Node[] = [];
  while (walker.nextNode()) {
    texts.push(walker.currentNode);
  }
  for (const node of texts) {
    const text = node.textContent ?? '',
      math = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
    if (!math.test(text)) {
      continue;
    }
    math.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let at = 0;
    for (const match of text.matchAll(math)) {
      fragment.append(doc.createTextNode(text.slice(at, match.index)));
      const marker = doc.createElement('anki-math'),
        delimiter = match[1] === undefined ? '$$' : '$';
      marker.textContent = delimiter + (match[1] ?? match[2]) + delimiter;
      marker.setAttribute('data-content', marker.textContent);
      fragment.append(marker);
      at = match.index + match[0].length;
    }
    fragment.append(doc.createTextNode(text.slice(at)));
    node.parentNode?.replaceChild(fragment, node);
  }
  converter.addRule('table', {
    filter: (node) => node.nodeName === 'PRE' && node.hasAttribute('data-qard-table'),
    replacement: (_content, node) => '\n\n' + (node.textContent ?? '') + '\n\n',
  });
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.querySelector('table,[rowspan],[colspan]')) {
      throw new Error('Tables with nested or merged cells need manual conversion.');
    }
    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) =>
        converter.turndown(cell.innerHTML).replace(/\|/g, '\\|').replace(/\n/g, '<br>'),
      ),
    );
    if (!rows.length) {
      continue;
    }
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row: string[]) =>
      '| ' + Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ') + ' |';
    const marker = doc.createElement('pre');
    marker.setAttribute('data-qard-table', '');
    marker.textContent = [
      line(rows[0]!),
      line(Array<string>(width).fill('---')),
      ...rows.slice(1).map(line),
    ].join('\n');
    table.replaceWith(marker);
  }
  const text = converter
    .turndown(doc.body)
    .replace(/\\([{}])/g, '$1')
    .trim();
  if (/\[latex\]|\[\$\$?\]/i.test(text)) {
    throw new Error(
      'Anki-generated LaTeX images need conversion to Markdown math before importing.',
    );
  }
  return text;
}
