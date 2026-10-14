import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import type QardPlugin from '../main';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import { CardEditor } from '../components/CardEditor';
import type { QardServices } from './services';
export const CARD_PANEL_VIEW_TYPE = 'qard-new-card';
export interface CardTarget {
  deck: string;
  topic: string;
  sourceFile?: string;
}
type Prefill = CardTarget & { serial: number };
/** Add cards one after another; deck, topic and note carry over to the next card. */
function CardPanel({ services, prefill }: { services: QardServices; prefill?: Prefill }) {
  const [state, setState] = useState<{
    serial: number;
    draft: Partial<CardDraft>;
    last?: QardCard;
  }>(() => ({ serial: 0, draft: prefill ? { ...prefill } : {} }));
  const next = (draft: Partial<CardDraft>, last?: QardCard) =>
    setState((s) => ({ serial: s.serial + 1, draft, last }));
  return (
    <div className="qard-card-panel">
      {state.last && (
        <p className="qard-card-panel-saved" role="status">
          Added to {state.last.deck} › {state.last.topic}
          <button
            className="qard-text-button qard-small"
            onClick={() => void services.openSource(state.last!)}
          >
            Show in note
          </button>
        </p>
      )}
      <CardEditor
        key={state.serial}
        compact
        focusFront={state.serial > 0}
        services={services}
        initial={state.draft}
        prefill={prefill}
        cancelLabel="Clear"
        cancel={() => next(state.draft)}
        saved={(card) =>
          next({ deck: card.deck, topic: card.topic, sourceFile: card.sourceFile }, card)
        }
      />
    </div>
  );
}
/** The card editor in a sidebar, so the note you're reading stays open beside it. */
export class CardPanelView extends ItemView {
  private root?: Root;
  private services?: QardServices;
  private target?: Prefill;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: QardPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return CARD_PANEL_VIEW_TYPE;
  }
  getDisplayText() {
    return 'New card';
  }
  getIcon() {
    return 'qard';
  }
  async onOpen() {
    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: 'qard-root' });
    this.services = {
      app: this.app,
      owner: this,
      host,
      index: this.plugin.index,
      writer: this.plugin.writer,
      reviews: this.plugin.reviews,
      tests: this.plugin.tests,
      learn: this.plugin.learn,
      jobs: this.plugin.jobs,
      setFocus: () => {},
      isActive: () => false,
      openSource: (card) => this.plugin.openSource(card),
    };
    this.root = createRoot(host);
    this.render();
  }
  /** Point the editor at a deck and topic, keeping anything already typed. */
  prefill(target: CardTarget) {
    this.target = { ...target, serial: Date.now() };
    this.render();
  }
  private render() {
    if (this.root && this.services) {
      this.root.render(
        <div className="qard-app">
          <CardPanel services={this.services} prefill={this.target} />
        </div>,
      );
    }
  }
  release() {
    this.root?.unmount();
    this.root = undefined;
    this.contentEl.empty();
  }
  async onClose() {
    this.release();
  }
  onunload() {
    this.release();
  }
}
