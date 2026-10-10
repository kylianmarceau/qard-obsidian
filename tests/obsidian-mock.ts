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
export class Setting {
  controlEl = { createEl: () => ({ createSpan: () => ({}) }) };
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
export class FileSystemAdapter {}
export const requestUrl = async () => ({ status: 200, json: {} });
