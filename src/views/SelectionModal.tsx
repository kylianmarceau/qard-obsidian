import { Modal } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type QardPlugin from '../main';
import type { CardDraft } from '../cards/card-writer';
import { CardEditor } from '../components/CardEditor';
import type { QardServices } from './services';
/** Transient capture only; the main experience always lives in QardView. */
export class SelectionModal extends Modal {
  private root?: Root;
  constructor(private plugin: QardPlugin, private draft: Partial<CardDraft>) { super(plugin.app); }
  onOpen() {
    this.setTitle('Create card from selection'); this.modalEl.addClass('qard-selection-modal');
    const host = this.contentEl.createDiv({ cls: 'qard-root' });
    const services: QardServices = { app: this.app, owner: this.plugin, host, index: this.plugin.index, writer: this.plugin.writer, reviews: this.plugin.reviews, tests: this.plugin.tests, learn: this.plugin.learn, jobs: this.plugin.jobs, setFocus: () => {}, isActive: () => false, openSource: card => this.plugin.openSource(card) };
    this.root = createRoot(host);
    this.root.render(<div className="qard-app"><CardEditor compact services={services} initial={this.draft} cancel={() => this.close()} saved={() => this.close()}/></div>);
  }
  onClose() { this.root?.unmount(); this.root = undefined; this.contentEl.empty(); }
}
