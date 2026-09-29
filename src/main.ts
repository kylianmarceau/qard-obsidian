import { Plugin, addIcon, Notice, MarkdownView, TFile } from 'obsidian';
import { QardView, VIEW_TYPE } from './views/QardView';
import { VaultIndexer } from './cards/indexer';
import { CardWriter } from './cards/card-writer';
import { ReviewStore } from './review/review-store';
import { QardSettingsTab } from './settings/SettingsTab';
import { SelectionModal } from './views/SelectionModal';
import type { QardCard } from './cards/card-types';
import type { Selection } from './review/session';
import { topicKey } from './decks/deck-index';
import { parseCards, topicAtLine } from './cards/parser';
import { TestService } from './tests/test-service';
import { VaultTestStorage } from './tests/vault-storage';
import { createRunner } from './agents/create-runner';
export default class QardPlugin extends Plugin {
  index!: VaultIndexer;
  writer!: CardWriter;
  reviews!: ReviewStore;
  tests!: TestService;
  private disposed = false;
  private selectionModals = new Set<SelectionModal>();
  async onload() {
    this.reviews = new ReviewStore(data => this.saveData(data));
    try { this.reviews.load(await this.loadData()); } catch { new Notice('Could not load review data. Reload the plugin before reviewing.'); throw new Error('Unable to load Qard review metadata'); }
    this.index = new VaultIndexer(this.app, this); this.writer = new CardWriter(this.app, this.index);
    this.tests = new TestService(new VaultTestStorage(this.app), () => this.reviews.getSnapshot().settings.tests, () => createRunner(this.app, this.reviews.getSnapshot().settings.tests));
    addIcon('qard', '<path d="M17 34 50 16 83 34 50 52Z M17 50 50 68 83 50 M17 66 50 84 83 66" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>');
    this.registerView(VIEW_TYPE, leaf => new QardView(leaf, this));
    this.addRibbonIcon('qard', 'Open study workspace', () => { void this.open().catch(e => new Notice(String(e))); });
    this.addCommand({ id: 'open', name: 'Open study workspace', callback: () => this.open() });
    this.addCommand({ id: 'new-practice-test', name: 'New practice test', callback: () => this.show('new-test') });
    this.addCommand({ id: 'open-practice-tests', name: 'Open practice tests', callback: () => this.show('tests') });
    this.addCommand({ id: 'study-selected-decks', name: 'Study selected deck(s)', callback: () => this.openBuilder({ decks: [], topics: [], cards: [] }) });
    for (const scope of ['deck', 'topic', 'note'] as const) this.addCommand({ id: `study-this-${scope}`, name: `Study this ${scope}`, checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view?.file) return false;
      const cards = this.index.getSnapshot().cards.filter(c => c.sourceFile === view.file!.path); if (!cards.length) return false;
      if (!checking) {
        const line = view.editor?.getCursor().line ?? 0;
        const topic = topicAtLine(view.editor.getValue(), view.file.path, line);
        const selection = scope === 'deck' ? { decks: [...new Set(cards.map(c => c.deck))], topics: [], cards: [] } : scope === 'topic' ? { decks: [], topics: [topicKey(cards[0]!.deck, topic)], cards: [] } : { decks: [], topics: [], cards: cards.map(c => c.id) };
        void this.openBuilder(selection);
      }
      return true;
    } });
    this.addCommand({ id: 'create-card-from-selection', name: 'Create card from selection', editorCheckCallback: (checking, editor, view) => {
      const selection = editor.getSelection(); if (!view.file || !selection.trim()) return false;
      if (!checking) {
        const file = view.file, source = editor.getValue(), cards = parseCards(source, file.path).cards;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const line = editor.getCursor('from').line;
        const topic = topicAtLine(source, file.path, line);
        const modal = new SelectionModal(this, { sourceFile: file.path, back: selection, deck: typeof fm?.['qard-deck'] === 'string' ? fm['qard-deck'] : cards[0]?.deck || file.basename, topic });
        this.selectionModals.add(modal); const close = modal.onClose.bind(modal); modal.onClose = () => { close(); this.selectionModals.delete(modal); }; modal.open();
      }
      return true;
    } });
    this.addSettingTab(new QardSettingsTab(this));
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) void this.index.start().catch(() => new Notice('Qard could not index the vault. Reload the plugin to retry.')); });
  }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!(leaf.view instanceof QardView)) throw new Error('Qard workspace could not be opened.');
    return leaf.view;
  }
  async show(kind: 'tests' | 'new-test') { const view = await this.open(); view.show({ serial: Date.now(), kind }); }
  async openBuilder(selection: Selection) { const view = await this.open(); view.show({ serial: Date.now(), kind: 'builder', selection }); }
  async openSource(card: QardCard) {
    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) throw new Error('Source note no longer exists. Reopen the card from the library.');
    const fresh = parseCards(await this.app.vault.read(file), file.path).cards.find(c => c.id === card.id) || card;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { eState: { line: fresh.sourcePosition.line } });
    if (leaf.view instanceof MarkdownView) { leaf.view.editor.setCursor({ line: fresh.sourcePosition.line, ch: 0 }); leaf.view.editor.scrollIntoView({ from: { line: fresh.sourcePosition.line, ch: 0 }, to: { line: fresh.sourcePosition.line + 1, ch: 0 } }, true); }
  }
  onunload() {
    this.disposed = true;
    this.selectionModals.forEach(modal => modal.close()); this.selectionModals.clear();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => { if (leaf.view instanceof QardView) leaf.view.release(); });
    this.index?.dispose(); this.tests?.dispose(); this.reviews?.dispose();
  }
}
