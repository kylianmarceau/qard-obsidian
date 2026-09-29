import { useEffect, useRef } from 'react';
import { Component, MarkdownRenderer } from 'obsidian';
import type { QardServices } from '../views/services';
/** Each render owns a Component, so embeds and render-child listeners are unloaded. */
export function Markdown({ text, path, services }: { text: string; path: string; services: QardServices }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    const child = new Component(); services.owner.addChild(child);
    const target = el.createDiv({ cls: 'markdown-rendered' });
    target.remove();
    // Do not automatically request remote image URLs from a local study surface.
    const local = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi, '[$1 (remote image)]($2)');
    void MarkdownRenderer.render(services.app, local, target, path, child).then(() => {
      if (!disposed) el.replaceChildren(target); else child.unload();
    }).catch(() => { if (!disposed) el.textContent = text; else child.unload(); });
    return () => { disposed = true; services.owner.removeChild(child); target.remove(); el.replaceChildren(); };
  }, [text, path, services]);
  return <div ref={ref} className="qard-markdown" onClick={event => {
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>('a.internal-link');
    if (link) { event.preventDefault(); void services.app.workspace.openLinkText(link.getAttribute('data-href') || link.getAttribute('href') || '', path, event.metaKey || event.ctrlKey); }
  }}/>;
}
