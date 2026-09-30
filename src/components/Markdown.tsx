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
    // Render into the page, not a detached element: Mermaid and other renderers measure text while drawing, and a
    // detached element measures as zero. When replacing earlier content, the new render stays hidden until it is done.
    const replacing = el.childElementCount > 0;
    const target = el.createDiv({ cls: replacing ? 'markdown-rendered qard-md-pending' : 'markdown-rendered' });
    const show = () => { for (const old of Array.from(el.children)) if (old !== target) old.remove(); target.classList.remove('qard-md-pending'); };
    // Do not automatically request remote image URLs from a local study surface.
    const local = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi, '[$1 (remote image)]($2)');
    void MarkdownRenderer.render(services.app, local, target, path, child).then(() => {
      if (!disposed) show(); else child.unload();
    }).catch(() => { if (!disposed) { target.textContent = text; show(); } else child.unload(); });
    return () => { disposed = true; services.owner.removeChild(child); target.remove(); el.replaceChildren(); };
  }, [text, path, services]);
  return <div ref={ref} className="qard-markdown" onClick={event => {
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>('a.internal-link');
    if (link) { event.preventDefault(); void services.app.workspace.openLinkText(link.getAttribute('data-href') || link.getAttribute('href') || '', path, event.metaKey || event.ctrlKey); }
  }}/>;
}

/** Titles and labels that may hold maths or inline formatting: rendered inline, in the surrounding font. Plain text skips the renderer. */
export function InlineMarkdown({ text, path, services }: { text: string; path: string; services: QardServices }) {
  const ref = useRef<HTMLSpanElement>(null);
  const plain = !/[$`*_\\[]/.test(text);
  useEffect(() => {
    const el = ref.current;
    if (!el || plain) return;
    let disposed = false;
    const child = new Component(); services.owner.addChild(child);
    const target = el.createSpan({ cls: 'qard-md-pending' });
    void MarkdownRenderer.render(services.app, text, target, path, child).then(() => {
      if (disposed) return;
      // The renderer wraps text in a paragraph; a title needs just its contents.
      const only = target.children.length === 1 && target.firstElementChild?.tagName === 'P' ? target.firstElementChild : undefined;
      if (only) target.replaceChildren(...Array.from(only.childNodes));
      for (const old of Array.from(el.childNodes)) if (old !== target) old.remove();
      target.classList.remove('qard-md-pending');
    }).catch(() => { if (!disposed) target.remove(); });
    return () => { disposed = true; services.owner.removeChild(child); };
  }, [text, path, services, plain]);
  // Keyed by text: rendered nodes are added outside React, so a reused span would keep the previous title's.
  return <span key={text} ref={ref} className="qard-inline-md">{plain ? text : <span className="qard-inline-fallback">{text}</span>}</span>;
}
