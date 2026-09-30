import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { QardApp } from './QardApp';
import type QardPlugin from '../main';
import type { QardServices, UiRequest } from './services';
export const VIEW_TYPE = 'qard-workspace';
export class QardView extends ItemView {
  private root?: Root;
  private host?: HTMLElement;
  private home?: HTMLElement;
  private focus = false;
  private services?: QardServices;
  private request?: UiRequest;
  constructor(leaf: WorkspaceLeaf, private plugin: QardPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Qard'; }
  getIcon() { return 'qard'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('qard-view-content');
    this.home = this.contentEl;
    this.host = this.contentEl.createDiv({ cls: 'qard-root' });
    this.services = { app: this.app, owner: this, host: this.host, index: this.plugin.index, writer: this.plugin.writer, reviews: this.plugin.reviews, tests: this.plugin.tests, learn: this.plugin.learn,
      setFocus: enabled => this.setFocus(enabled), isActive: () => this.app.workspace.getActiveViewOfType(QardView) === this,
      openSource: card => this.plugin.openSource(card) };
    this.root = createRoot(this.host); this.render();
  }
  show(request: UiRequest) { this.request = request; this.render(); }
  private render() { if (this.root && this.services) this.root.render(<QardApp services={this.services} request={this.request}/>); }
  setFocus(enabled: boolean) {
    if (!this.host || !this.home || enabled === this.focus) return;
    this.focus = enabled;
    const body = this.host.ownerDocument.body;
    if (enabled) {
      // Move the existing React host, rather than cloning its content. No Electron API required.
      body.appendChild(this.host); this.host.addClass('qard-focus-overlay'); body.addClass('qard-focus-active');
    } else {
      this.host.removeClass('qard-focus-overlay'); this.home.appendChild(this.host);
      if (!body.querySelector('.qard-focus-overlay')) body.removeClass('qard-focus-active');
    }
  }
  release() {
    this.setFocus(false); this.root?.unmount(); this.root = undefined;
    this.host?.remove(); this.host = undefined;
    this.contentEl.removeClass('qard-view-content');
  }
  async onClose() { this.release(); }
  onunload() { this.release(); }
}
