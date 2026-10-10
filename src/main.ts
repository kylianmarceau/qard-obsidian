import { Plugin, addIcon, Notice, MarkdownView, TFile } from 'obsidian';
import { QardView, VIEW_TYPE } from './views/QardView';
import { VaultIndexer } from './cards/indexer';
import { SourceSyncService, sourceSyncPath } from './cards/source-sync-service';
import { CardImprovementService } from './cards/improvement-service';
import { FlashcardGenerationService } from './cards/generation-service';
import { CardWriter } from './cards/card-writer';
import { ReviewStore } from './review/review-store';
import { QardSettingsTab } from './settings/SettingsTab';
import { SelectionModal } from './views/SelectionModal';
import { ImportModal } from './views/ImportModal';
import type { QardCard } from './cards/card-types';
import type { Selection } from './review/session';
import { topicKey } from './decks/deck-index';
import { parseCards, topicAtLine } from './cards/parser';
import { TestService } from './tests/test-service';
import { VaultTestStorage } from './tests/vault-storage';
import { createRunner, type UsageEvent } from './agents/create-runner';
import { usageKey } from './agents/usage-report';
import { LearnService } from './learn/learn-service';
import { VaultLearnStorage } from './learn/vault-learn-storage';
import { isoDay, objectiveLines } from './learn/mastery';
import { todayDueCards } from './review/today-cards';
import { JobClock } from './jobs/job-clock';
import { studyNotes } from './vault-access';
import { QARD_OBSIDIAN_ICON } from './icons/qard-icon';
export default class QardPlugin extends Plugin {
  index!: VaultIndexer;
  writer!: CardWriter;
  flashcards!: FlashcardGenerationService;
  sourceSync!: SourceSyncService;
  improvements!: CardImprovementService;
  reviews!: ReviewStore;
  tests!: TestService;
  learn!: LearnService;
  jobs!: JobClock;
  private disposed = false;
  private selectionModals = new Set<SelectionModal>();
  async onload() {
    this.reviews = new ReviewStore((data) => this.saveData(data));
    try {
      this.reviews.load(await this.loadData());
    } catch {
      new Notice('Could not load review data. Reload the plugin before reviewing.');
      throw new Error('Unable to load Qard review metadata');
    }
    this.initializeServices();
    this.registerWorkspace();
    this.registerCommands();
    this.addSettingTab(new QardSettingsTab(this));
    this.app.workspace.onLayoutReady(() => this.startBackgroundWork());
  }

  private initializeServices() {
    this.index = new VaultIndexer(this.app, this);
    this.writer = new CardWriter(this.app, this.index);
    const settings = () => this.reviews.getSnapshot().settings;
    // Every run's tokens are added to per-day totals by feature, role, connection and model.
    const record = (e: UsageEvent) =>
      void this.reviews
        .recordUsage(isoDay(Date.now()), usageKey(e.purpose, e.role, e.provider, e.model), e.usage)
        .catch(() => {});
    const runner = (role: Parameters<typeof createRunner>[2]) =>
      createRunner(this.app, settings(), role, record);
    const links = {
      get: (id: string) => this.reviews.getSnapshot().links[id],
      set: (id: string, link: { mastery: string; objective: string; lapses: number }) =>
        this.reviews.link(id, link),
    };
    // Today counts only cards already in review; brand-new cards are studied on purpose, not scheduled.
    const dueCards = () =>
      todayDueCards(this.index.getSnapshot().cards, this.reviews.getSnapshot().states).length;
    this.jobs = new JobClock(
      () => this.reviews.getSnapshot().timings,
      (key, ms) => this.reviews.recordTiming(key, ms),
      () => settings().agents.roles,
    );
    const timing = (kind: string, ms: number) => this.jobs.record(kind, ms);
    this.sourceSync = new SourceSyncService(
      new VaultTestStorage(this.app),
      sourceSyncPath('Qard'),
      () => this.index.getSnapshot().cards,
      this.writer,
      (id) => this.reviews.requireContentCheck(id),
      () => runner('writer'),
    );
    const captureSources = (paths: string[], unchangedSince?: number) =>
      this.sourceSync.capture(paths, unchangedSince);
    this.writer.trackSources = async (id, paths, versions) => {
      const saved = versions?.filter((s) => paths.includes(s.path)) ?? [];
      const missing = paths.filter((p) => !saved.some((s) => s.path === p));
      await this.sourceSync.track(id, [...saved, ...(await captureSources(missing))]);
    };
    void this.sourceSync.load();
    this.improvements = new CardImprovementService(
      new VaultTestStorage(this.app),
      () => this.index.getSnapshot().cards,
      this.writer,
      this.reviews,
      this.sourceSync,
      () => runner('writer'),
    );
    void this.improvements.load();
    this.flashcards = new FlashcardGenerationService(
      new VaultTestStorage(this.app),
      () => settings().cardFolder,
      () => studyNotes(this.app, [settings().tests.folder]).map((f) => f.path),
      () => runner('writer'),
      this.writer,
      (message) => new Notice(message, 8000),
      timing,
      () =>
        this.index
          .getSnapshot()
          .decks.map((d) => ({ name: d.name, topics: d.topics.map((t) => t.name) })),
      captureSources,
    );
    void this.flashcards.load();
    this.learn = new LearnService(
      new VaultLearnStorage(this.app),
      settings,
      runner,
      links,
      dueCards,
      undefined,
      (message) => new Notice(message, 8000),
      timing,
      captureSources,
    );
    this.tests = new TestService(
      new VaultTestStorage(this.app),
      () => settings().tests,
      runner,
      undefined,
      {
        objectives: async (paths) => {
          const m = await this.learn.courseFor(paths);
          return m && { mastery: m.path, lines: objectiveLines(m) };
        },
        record: (test, attempt) => this.learn.recordTest(test, attempt),
      },
      (message) => new Notice(message, 8000),
      timing,
      captureSources,
    );
  }

  private registerWorkspace() {
    addIcon('qard', QARD_OBSIDIAN_ICON);
    this.registerView(VIEW_TYPE, (leaf) => new QardView(leaf, this));
    this.addRibbonIcon('qard', 'Open study workspace', () => {
      void this.open().catch((e) => new Notice(String(e)));
    });
  }

  private registerCommands() {
    this.addCommand({ id: 'open', name: 'Open study workspace', callback: () => this.open() });
    this.addCommand({
      id: 'new-practice-test',
      name: 'New practice test',
      callback: () => this.show('new-test'),
    });
    this.addCommand({
      id: 'open-practice-tests',
      name: 'Open practice tests',
      callback: () => this.show('tests'),
    });
    this.addCommand({ id: 'open-today', name: 'Open today', callback: () => this.show('today') });
    this.addCommand({ id: 'open-learn', name: 'Open courses', callback: () => this.show('learn') });
    this.addCommand({
      id: 'source-updates',
      name: 'Review source updates',
      callback: () => this.show('source-updates'),
    });
    this.addCommand({
      id: 'open-statistics',
      name: 'Show study statistics',
      callback: () => this.show('statistics'),
    });
    this.addCommand({
      id: 'open-usage',
      name: 'Show token usage',
      callback: () => this.show('usage'),
    });
    this.addCommand({
      id: 'teach-this-note',
      name: 'Teach me this note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
          return false;
        }
        if (!checking) {
          void this.teach(file);
        }
        return true;
      },
    });
    this.addCommand({
      id: 'study-selected-decks',
      name: 'Study selected deck(s)',
      callback: () => this.openBuilder({ decks: [], topics: [], cards: [] }),
    });
    for (const scope of ['deck', 'topic', 'note'] as const) {
      this.addCommand({
        id: `study-this-${scope}`,
        name: `Study this ${scope}`,
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view?.file) {
            return false;
          }
          const cards = this.index
            .getSnapshot()
            .cards.filter((c) => c.sourceFile === view.file!.path);
          if (!cards.length) {
            return false;
          }
          if (!checking) {
            const line = view.editor?.getCursor().line ?? 0;
            const topic = topicAtLine(view.editor.getValue(), view.file.path, line);
            const selection =
              scope === 'deck'
                ? { decks: [...new Set(cards.map((c) => c.deck))], topics: [], cards: [] }
                : scope === 'topic'
                  ? { decks: [], topics: [topicKey(cards[0]!.deck, topic)], cards: [] }
                  : { decks: [], topics: [], cards: cards.map((c) => c.id) };
            void this.openBuilder(selection);
          }
          return true;
        },
      });
    }
    this.addCommand({
      id: 'create-card-from-selection',
      name: 'Create card from selection',
      editorCheckCallback: (checking, editor, view) => {
        const selection = editor.getSelection();
        if (!view.file || !selection.trim()) {
          return false;
        }
        if (!checking) {
          const file = view.file,
            source = editor.getValue(),
            cards = parseCards(source, file.path).cards;
          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
          const line = editor.getCursor('from').line;
          const topic = topicAtLine(source, file.path, line);
          const modal = new SelectionModal(this, {
            sourceFile: file.path,
            back: selection,
            deck:
              typeof fm?.['qard-deck'] === 'string'
                ? fm['qard-deck']
                : cards[0]?.deck || file.basename,
            topic,
          });
          this.selectionModals.add(modal);
          const close = modal.onClose.bind(modal);
          modal.onClose = () => {
            close();
            this.selectionModals.delete(modal);
          };
          modal.open();
        }
        return true;
      },
    });
    this.addCommand({
      id: 'import-spaced-repetition',
      name: 'Import from Spaced Repetition',
      callback: () => this.openImport(),
    });
  }

  private startBackgroundWork() {
    if (this.disposed) {
      return;
    }
    let sourceTimer: number | undefined;
    const scanSources = () => {
      window.clearTimeout(sourceTimer);
      sourceTimer = window.setTimeout(() => {
        void this.sourceSync.refresh();
      }, 350);
    };
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          scanSources();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          scanSources();
        }
      }),
    );
    this.registerEvent(this.app.vault.on('delete', () => scanSources()));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        void this.sourceSync.rename(oldPath, file.path).catch(() => scanSources());
      }),
    );
    const offSourceIndex = this.index.subscribe(scanSources);
    this.register(() => {
      window.clearTimeout(sourceTimer);
      offSourceIndex();
    });
    void this.index
      .start()
      .then(() => this.sourceSync.refresh())
      .catch(() => new Notice('Qard could not index the vault. Reload the plugin to retry.'));
    // Pick up background work that a reload of Obsidian or Qard interrupted.
    void this.learn.resumeBackground().catch(() => {});
    void this.tests.resume().catch(() => {});
  }

  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!(leaf.view instanceof QardView)) {
      throw new Error('Qard workspace could not be opened.');
    }
    return leaf.view;
  }
  openImport() {
    new ImportModal(this).open();
  }
  async show(
    kind: 'tests' | 'new-test' | 'today' | 'learn' | 'usage' | 'statistics' | 'source-updates',
  ) {
    const view = await this.open();
    view.show({ serial: Date.now(), kind });
  }
  async teach(file: TFile) {
    const path = await this.learn.startLesson({ topic: file.basename, notes: [file.path] });
    const view = await this.open();
    view.show({ serial: Date.now(), kind: 'lesson', path });
  }
  async openBuilder(selection: Selection) {
    const view = await this.open();
    view.show({ serial: Date.now(), kind: 'builder', selection });
  }
  async openSource(card: QardCard) {
    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) {
      throw new Error('Source note no longer exists. Reopen the card from the library.');
    }
    const fresh =
      parseCards(await this.app.vault.read(file), file.path).cards.find((c) => c.id === card.id) ||
      card;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { eState: { line: fresh.sourcePosition.line } });
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setCursor({ line: fresh.sourcePosition.line, ch: 0 });
      leaf.view.editor.scrollIntoView(
        {
          from: { line: fresh.sourcePosition.line, ch: 0 },
          to: { line: fresh.sourcePosition.line + 1, ch: 0 },
        },
        true,
      );
    }
  }
  onunload() {
    this.disposed = true;
    this.selectionModals.forEach((modal) => modal.close());
    this.selectionModals.clear();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof QardView) {
        leaf.view.release();
      }
    });
    this.sourceSync?.dispose();
    this.improvements?.dispose();
    this.flashcards?.dispose();
    this.index?.dispose();
    this.tests?.dispose();
    this.learn?.dispose();
    this.reviews?.dispose();
  }
}
