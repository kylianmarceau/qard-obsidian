// The Obsidian DOM helper used by Markdown rendering, scoped to the owning document.
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.createDiv = function (options?: string | DomElementInfo) {
    const child = this.ownerDocument.createElement('div');
    if (typeof options === 'string') child.className = options;
    else if (options?.cls) child.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    this.appendChild(child);
    return child;
  };
}
