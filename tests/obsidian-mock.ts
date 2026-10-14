export class Component {
  children = new Set<Component>();
  addChild<T extends Component>(child: T): T {
    this.children.add(child);
    return child;
  }
  removeChild<T extends Component>(child: T): T {
    this.children.delete(child);
    child.unload();
    return child;
  }
  unload() {
    this.children.forEach((child) => child.unload());
    this.children.clear();
  }
}
export const MarkdownRenderer = {
  render: async (
    _app: unknown,
    text: string,
    el: HTMLElement,
    _path: string,
    _owner: Component,
  ) => {
    el.textContent = text;
  },
};
export class TFile {
  extension = 'md';
  constructor(public path: string) {}
  get basename() {
    return this.path.split('/').pop()!.replace(/\.md$/, '');
  }
}
export const normalizePath = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
// Settings-tab stand-ins. Like Obsidian 1.13, Setting has a then() that returns itself, which makes it a thenable.
const settingElement = {
  createEl: () => settingElement,
  createSpan: () => ({}),
  addEventListener() {},
};
export class Setting {
  controlEl = { createEl: () => settingElement };
  constructor(public containerEl?: unknown) {}
  setName() {
    return this;
  }
  setDesc(_d: unknown) {
    return this;
  }
  setHeading() {
    return this;
  }
  addText() {
    return this;
  }
  addDropdown() {
    return this;
  }
  addToggle() {
    return this;
  }
  addButton() {
    return this;
  }
  then(callback: (s: this) => unknown) {
    callback(this);
    return this;
  }
}
export class PluginSettingTab {
  containerEl = { empty() {} };
  refreshDomState() {}
  constructor(
    public app: unknown,
    public plugin: unknown,
  ) {}
}
export class Modal {
  modalEl = typeof document === 'undefined' ? ({} as HTMLElement) : document.createElement('div');
  contentEl = typeof document === 'undefined' ? ({} as HTMLElement) : document.createElement('div');
  constructor(public app: unknown) {
    if (typeof document !== 'undefined') this.modalEl.append(this.contentEl);
  }
  setTitle(_title: string) {}
  onOpen() {}
  onClose() {}
  open() {
    if (typeof document !== 'undefined') document.body.append(this.modalEl);
    this.onOpen();
  }
  close() {
    this.onClose();
    if (typeof document !== 'undefined') this.modalEl.remove();
  }
}
export class Notice {
  constructor(public message: string) {}
}
export const setIcon = () => {};
export const Platform = { isDesktopApp: false, isWin: false };
export const requireApiVersion = () => false;
export class FileSystemAdapter {}
export const requestUrl = async () => ({ status: 200, json: {} });
export const loadPdfJs = async (): Promise<never> => {
  throw new Error('PDF.js is not loaded in tests; pass a fake to PdfReader.');
};
// Workspace view stand-ins: enough for views that render React into contentEl.
export class WorkspaceLeaf {
  view: unknown;
}
export class ItemView extends Component {
  contentEl =
    typeof document === 'undefined'
      ? ({} as HTMLElement)
      : Object.assign(document.createElement('div'), {
          empty(this: HTMLElement) {
            this.replaceChildren();
          },
          createDiv(this: HTMLElement, options?: { cls?: string }) {
            const div = document.createElement('div');
            if (options?.cls) div.className = options.cls;
            this.append(div);
            return div;
          },
        });
  app: unknown;
  constructor(public leaf: WorkspaceLeaf) {
    super();
  }
}
export class Scope {
  handlers: { modifiers: string[] | null; key: string | null; func: () => unknown }[] = [];
  constructor(public parent?: Scope) {}
  register(modifiers: string[] | null, key: string | null, func: () => unknown) {
    const handler = { modifiers, key, func };
    this.handlers.push(handler);
    return handler;
  }
  unregister() {}
}
