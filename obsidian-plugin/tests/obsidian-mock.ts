export class Component {
  children = new Set<Component>();
  addChild<T extends Component>(child: T): T { this.children.add(child); return child; }
  removeChild<T extends Component>(child: T): T { this.children.delete(child); child.unload(); return child; }
  unload() { this.children.forEach(child => child.unload()); this.children.clear(); }
}
export const MarkdownRenderer = { render: async (_app: unknown, text: string, el: HTMLElement, _path: string, _owner: Component) => { el.textContent = text; } };
export class TFile { extension = 'md'; constructor(public path: string) {} get basename() { return this.path.split('/').pop()!.replace(/\.md$/, ''); } }
export const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
