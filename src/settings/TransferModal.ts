import { Modal, Setting } from 'obsidian';
import type QardPlugin from '../main';
import { readCardFormat, renderCloze, FORMAT_BACK } from '../cards/card-format';
import { TransferService, journalPath, type ImportPlan } from '../migration/transfer-service';
import { readAnki, MAX_PACKAGE } from '../migration/anki';
import {
  readDelimited,
  guessColumns,
  mapRows,
  MAX_TEXT,
  type Delimiter,
  type ColumnMap,
  type Column,
} from '../migration/tabular';
import type { TransferInput } from '../migration/transfer-types';

export type TransferMode = 'import' | 'export' | 'resume';
/** Settings-only transfer flow. It adds no controls or commands to the study workspace. */
export class TransferModal extends Modal {
  private service: TransferService;
  private folder: string;
  private exportFolder: string;
  private filename = '';
  private delimiter: Delimiter = ',';
  private header = true;
  private columns: ColumnMap = { front: 0, back: 1, deck: -1, topic: -1, tags: -1, group: -1 };
  private rows?: string[][];
  private text = '';
  private input?: TransferInput;
  private plan?: ImportPlan;
  private approved = false;
  private skipDuplicates = true;
  private keepSchedule = true;
  private deck = 'Imported';
  private topic = 'General';
  private exportDeck = '';
  private exportDecks: string[] = [];
  private page = 0;
  private busy = false;
  private opened = false;
  private generation = 0;
  private error = '';
  constructor(
    plugin: QardPlugin,
    private mode: TransferMode,
  ) {
    super(plugin.app);
    this.service = new TransferService(plugin.app, plugin.index, plugin.reviews);
    this.folder = plugin.reviews.getSnapshot().settings.cardFolder;
    this.exportFolder = [this.folder, 'Exports'].filter(Boolean).join('/');
  }
  onOpen() {
    this.opened = true;
    this.setTitle(
      this.mode === 'export'
        ? 'Export flashcards'
        : this.mode === 'resume'
          ? 'Resume an import'
          : 'Import flashcards',
    );
    this.modalEl.addClass('qard-import-modal');
    if (this.mode === 'resume') {
      void this.resumeList();
    } else if (this.mode === 'export') {
      void this.loadExport();
    } else {
      this.render();
    }
  }
  private async loadExport() {
    try {
      this.exportDecks = [
        ...new Set((await this.service.currentCards()).map((c) => c.deck)),
      ].sort();
    } catch (e) {
      this.error = (e as Error).message;
    }
    if (this.opened) {
      this.render();
    }
  }
  private async resumeList() {
    try {
      const pending = await this.service.pending();
      if (!this.opened) {
        return;
      }
      this.contentEl.empty();
      if (!pending.length) {
        this.contentEl.createEl('p', { text: 'There are no unfinished imports.' });
      }
      for (const plan of pending) {
        new Setting(this.contentEl)
          .setName(plan.filename)
          .setDesc(`${plan.cards.length} cards · ${plan.folder || 'Vault root'}`)
          .addButton((b) =>
            b.setButtonText('Resume…').onClick(() => {
              this.plan = plan;
              this.approved = true;
              this.mode = 'import';
              this.filename = plan.filename;
              this.render();
            }),
          );
      }
      this.closeButton();
    } catch (e) {
      if (this.opened) {
        this.error = (e as Error).message;
        this.render();
      }
    }
  }
  private closeButton() {
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText('Close')
        .setDisabled(this.busy)
        .onClick(() => this.close()),
    );
  }
  private render() {
    const el = this.contentEl;
    const inputs = Array.from(el.querySelectorAll<HTMLInputElement>('input[type=text]'));
    const active = inputs.findIndex((input) => input === el.ownerDocument.activeElement);
    const selection = active >= 0 ? inputs[active]!.selectionStart : null;
    el.empty();
    if (this.mode === 'export') {
      this.renderExport();
      return;
    }
    if (!this.approved) {
      el.createEl('p', {
        text: 'Choose CSV, TSV, or an Anki .apkg file. Review the cards before adding them to your vault. Existing notes are not rewritten.',
      });
      const picker = el.createEl('input', {
        attr: { type: 'file', accept: '.csv,.tsv,.txt,.apkg', 'aria-label': 'Flashcard file' },
      });
      picker.disabled = this.busy;
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (file) {
          void this.read(file);
        }
      });
      if (this.filename) {
        el.createEl('p', { text: this.filename });
      }
      new Setting(el)
        .setName('Import folder')
        .setDesc('New notes are placed in an import folder here.')
        .addText((t) =>
          t
            .setValue(this.folder)
            .setDisabled(this.busy)
            .onChange((v) => {
              this.folder = v;
              void this.preview();
            }),
        );
      if (this.rows) {
        new Setting(el).setName('Separator').addDropdown((d) =>
          d
            .addOptions({ comma: 'Comma (CSV)', tab: 'Tab (TSV)' })
            .setValue(this.delimiter === ',' ? 'comma' : 'tab')
            .setDisabled(this.busy)
            .onChange((v) => {
              this.delimiter = v === 'comma' ? ',' : '\t';
              try {
                this.rows = readDelimited(this.text, this.delimiter);
                const guess = guessColumns(this.rows[0]!);
                this.columns = guess.columns;
                this.header = guess.header;
                void this.preview();
              } catch (e) {
                this.error = (e as Error).message;
                this.plan = undefined;
                this.render();
              }
            }),
        );
        new Setting(el).setName('First row contains column headings').addToggle((t) =>
          t
            .setValue(this.header)
            .setDisabled(this.busy)
            .onChange((v) => {
              this.header = v;
              void this.preview();
            }),
        );
        const count = Math.max(...this.rows.map((r) => r.length));
        const options = {
          '-1': 'Use default / omit',
          ...Object.fromEntries(
            Array.from({ length: count }, (_, i) => [
              String(i),
              this.header ? `${i + 1}: ${this.rows![0]?.[i] || 'Untitled'}` : `Column ${i + 1}`,
            ]),
          ),
        };
        for (const [key, label] of Object.entries({
          front: 'Question column',
          back: 'Answer column',
          deck: 'Deck column',
          topic: 'Topic column',
          tags: 'Tags column',
          group: 'Sibling group column',
        })) {
          new Setting(el).setName(label).addDropdown((d) =>
            d
              .addOptions(options)
              .setValue(String(this.columns[key as Column]))
              .setDisabled(this.busy)
              .onChange((v) => {
                this.columns = { ...this.columns, [key]: Number(v) };
                void this.preview();
              }),
          );
        }
        new Setting(el).setName('Default deck').addText((t) =>
          t
            .setValue(this.deck)
            .setDisabled(this.busy)
            .onChange((v) => {
              this.deck = v;
              void this.preview();
            }),
        );
        new Setting(el).setName('Default topic').addText((t) =>
          t
            .setValue(this.topic)
            .setDisabled(this.busy)
            .onChange((v) => {
              this.topic = v;
              void this.preview();
            }),
        );
      }
      if (this.input || this.rows) {
        new Setting(el)
          .setName('Skip duplicate cards')
          .setDesc(
            'Skip matching question, answer, deck and topic, including duplicates within this file.',
          )
          .addToggle((t) =>
            t
              .setValue(this.skipDuplicates)
              .setDisabled(this.busy)
              .onChange((v) => {
                this.skipDuplicates = v;
                void this.preview();
              }),
          );
        if (this.input?.cards.some((c) => c.state?.reviewCount || c.state?.paused)) {
          new Setting(el)
            .setName('Keep Anki review data')
            .setDesc(
              'Keep supported due dates, intervals, ratings and suspended cards. Qard handles future reviews; Anki learning steps and custom scheduling are not carried over. Off starts all cards as new.',
            )
            .addToggle((t) =>
              t
                .setValue(this.keepSchedule)
                .setDisabled(this.busy)
                .onChange((v) => {
                  this.keepSchedule = v;
                  void this.preview();
                }),
            );
        }
      }
    }
    if (this.busy) {
      el.createEl('p', {
        text: this.approved ? 'Saving import…' : 'Preparing preview…',
        attr: { role: 'status' },
      });
    }
    if (this.plan) {
      const plan = this.plan;
      el.createEl('p', {
        text: `${plan.cards.length} cards ready to import · ${plan.duplicates} duplicates skipped.`,
        cls: 'qard-import-summary',
      });
      this.renderCards(plan);
      if (this.approved) {
        el.createEl('p', {
          text: 'This import has started saving. Its approved contents are locked. Finish importing to complete it safely.',
        });
      }
      if (plan.media.length) {
        el.createEl('p', {
          text: `${plan.media.length} local attachments will be saved. A copy of the original Anki package is kept in the import folder for recovery.`,
        });
      }
      new Setting(el).addButton((b) =>
        b
          .setButtonText(this.approved ? 'Finish import' : 'Import cards')
          .setCta()
          .setDisabled(this.busy || !plan.cards.length)
          .onClick(() => void this.run()),
      );
    }
    if (this.input?.issues.length) {
      const details = el.createEl('details', { cls: 'qard-import-skipped' });
      details.createEl('summary', { text: `${this.input.issues.length} items cannot be imported` });
      const list = details.createEl('ul');
      for (const issue of this.input.issues) {
        list.createEl('li', { text: `Row ${issue.row}: ${issue.message}` });
      }
    }
    if (this.error) {
      el.createEl('p', { text: this.error, cls: 'qard-import-warning', attr: { role: 'alert' } });
    }
    this.closeButton();
    if (active >= 0) {
      const input = el.querySelectorAll<HTMLInputElement>('input[type=text]')[active];
      input?.focus();
      if (selection !== null) {
        input?.setSelectionRange(selection, selection);
      }
    }
  }
  private renderCards(plan: ImportPlan) {
    const el = this.contentEl,
      list = el.createDiv({ cls: 'qard-import-list' }),
      table = list.createEl('table');
    const tr = table.createEl('thead').createEl('tr');
    for (const label of ['Question', 'Answer', 'Deck', 'Topic']) {
      tr.createEl('th', { text: label });
    }
    const body = table.createEl('tbody');
    const pageSize = 25;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(plan.cards.length / pageSize) - 1));
    for (const card of plan.cards.slice(this.page * pageSize, (this.page + 1) * pageSize)) {
      const row = body.createEl('tr');
      const format = readCardFormat(card.front);
      const question =
        format.kind === 'cloze'
          ? renderCloze(format.text, format.target, false)
          : format.kind === 'occlusion'
            ? `${format.text} (image with ${format.occlusion.masks.length} masks)`
            : format.text;
      const answer =
        format.kind === 'cloze'
          ? renderCloze(format.text, format.target, true) +
            (card.back === FORMAT_BACK ? '' : '\n\n' + card.back)
          : card.back;
      for (const text of [question, answer, card.deck, card.topic]) {
        const cell = row.createEl('td');
        if (text.length > 200) {
          const details = cell.createEl('details');
          details.createEl('summary', { text: text.slice(0, 150) + '…' });
          details.createEl('pre', { text });
        } else {
          cell.setText(text);
        }
      }
    }
    if (plan.cards.length > pageSize) {
      new Setting(el)
        .setName(
          `Cards ${this.page * pageSize + 1}–${Math.min((this.page + 1) * pageSize, plan.cards.length)} of ${plan.cards.length}`,
        )
        .addButton((b) =>
          b
            .setButtonText('Previous cards')
            .setDisabled(this.busy || !this.page)
            .onClick(() => {
              this.page--;
              this.render();
            }),
        )
        .addButton((b) =>
          b
            .setButtonText('Next cards')
            .setDisabled(this.busy || (this.page + 1) * pageSize >= plan.cards.length)
            .onClick(() => {
              this.page++;
              this.render();
            }),
        );
    }
  }
  private async read(file: File) {
    if (this.busy) {
      return;
    }
    const token = ++this.generation;
    this.busy = true;
    this.error = '';
    this.plan = undefined;
    this.input = undefined;
    this.rows = undefined;
    this.filename = file.name;
    this.render();
    try {
      const anki = /\.apkg$/i.test(file.name);
      if (file.size > (anki ? MAX_PACKAGE : MAX_TEXT)) {
        throw new Error(
          anki
            ? 'Choose an Anki package smaller than 100 MB.'
            : 'Choose a text file smaller than 20 MB.',
        );
      }
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsArrayBuffer(file);
      });
      if (anki) {
        this.input = await readAnki(new Uint8Array(bytes));
      } else {
        this.text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        this.delimiter = /\.(?:tsv|txt)$/i.test(file.name) ? '\t' : ',';
        this.rows = readDelimited(this.text, this.delimiter);
        const guess = guessColumns(this.rows[0]!);
        this.header = guess.header;
        this.columns = guess.columns;
      }
      if (!this.opened || token !== this.generation) {
        return;
      }
      this.busy = false;
      await this.preview();
    } catch (e) {
      if (this.opened && token === this.generation) {
        this.busy = false;
        this.error = (e as Error).message;
        this.render();
      }
    }
  }
  private async preview() {
    if (this.approved || (!this.rows && !this.input) || this.busy) {
      return;
    }
    const token = ++this.generation;
    this.error = '';
    this.plan = undefined;
    try {
      if (this.rows) {
        this.input = mapRows(this.rows, this.columns, this.header, this.deck, this.topic);
      }
      if (!this.input!.cards.length) {
        this.render();
        return;
      }
      const plan = await this.service.prepare(
        this.input!,
        this.folder,
        this.filename,
        this.skipDuplicates,
        this.keepSchedule,
      );
      if (this.opened && token === this.generation) {
        this.plan = plan;
        this.page = 0;
        this.render();
      }
    } catch (e) {
      if (this.opened && token === this.generation) {
        this.error = (e as Error).message;
        this.render();
      }
    }
  }
  private async run() {
    if (this.busy || !this.plan) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.approved = true;
    this.render();
    try {
      const result = await this.service.apply(this.plan, this.input);
      if (!this.opened) {
        return;
      }
      this.busy = false;
      this.contentEl.empty();
      this.contentEl.createEl('p', {
        text: `Imported ${result.cards} cards into ${result.folder}.`,
      });
      this.closeButton();
    } catch (e) {
      if (!this.opened) {
        return;
      }
      this.busy = false;
      // Before the approval record is saved, the form can still be corrected safely.
      this.approved = !!this.app.vault.getAbstractFileByPath(journalPath(this.plan));
      this.error = (e as Error).message;
      this.render();
    }
  }
  private renderExport() {
    const el = this.contentEl;
    el.createEl('p', {
      text: 'Export questions, answers, decks, topics, tags and sibling groups as UTF-8 Markdown text. CSV/TSV does not include review history or attachment files; copy linked attachments separately when moving to another vault.',
    });
    new Setting(el).setName('Deck').addDropdown((d) =>
      d
        .addOptions({ '': 'All decks', ...Object.fromEntries(this.exportDecks.map((s) => [s, s])) })
        .setValue(this.exportDeck)
        .setDisabled(this.busy)
        .onChange((v) => {
          this.exportDeck = v;
        }),
    );
    new Setting(el).setName('Format').addDropdown((d) =>
      d
        .addOptions({ csv: 'CSV', tsv: 'TSV' })
        .setValue(this.delimiter === ',' ? 'csv' : 'tsv')
        .setDisabled(this.busy)
        .onChange((v) => {
          this.delimiter = v === 'csv' ? ',' : '\t';
        }),
    );
    new Setting(el)
      .setName('Export folder')
      .setDesc('Save a new file in the vault, ready to copy or share.')
      .addText((t) =>
        t
          .setValue(this.exportFolder)
          .setDisabled(this.busy)
          .onChange((v) => {
            this.exportFolder = v;
          }),
      );
    new Setting(el).addButton((b) =>
      b
        .setButtonText('Export cards')
        .setCta()
        .setDisabled(this.busy || !this.exportDecks.length)
        .onClick(() => void this.runExport()),
    );
    if (this.error) {
      el.createEl('p', { text: this.error, attr: { role: 'alert' }, cls: 'qard-import-warning' });
    }
    this.closeButton();
  }
  private async runExport() {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.render();
    try {
      const result = await this.service.export(
        this.exportFolder,
        this.delimiter,
        this.exportDeck || undefined,
      );
      if (!this.opened) {
        return;
      }
      this.busy = false;
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: `Exported ${result.cards} cards to ${result.path}.` });
      this.closeButton();
    } catch (e) {
      if (this.opened) {
        this.busy = false;
        this.error = (e as Error).message;
        this.render();
      }
    }
  }
  onClose() {
    this.opened = false;
    this.generation++;
    this.contentEl.empty();
  }
}
