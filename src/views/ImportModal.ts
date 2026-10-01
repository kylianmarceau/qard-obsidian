import { Modal, Setting } from 'obsidian';
import type QardPlugin from '../main';
import { importNotes, loadSrSettings, scanVault, type ScannedNote } from '../migration/sr-importer';
import type { SrSettings } from '../migration/sr-parser';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cardCount = (note: ScannedNote) => note.cards.reduce((n, c) => n + (c.reversed ? 2 : 1), 0);

/** Preview, choose notes, then convert Spaced Repetition cards to Qard callouts in place. */
export class ImportModal extends Modal {
  private settings?: SrSettings;
  private notes: ScannedNote[] = [];
  private selected = new Set<string>();
  private keepSchedule = true;
  private busy = false;
  constructor(private plugin: QardPlugin) { super(plugin.app); }
  onOpen() {
    this.setTitle('Import from Spaced Repetition'); this.modalEl.addClass('qard-import-modal');
    this.contentEl.createEl('p', { text: 'Scanning your vault…', cls: 'qard-muted' });
    void this.scan();
  }
  private async scan() {
    this.settings = await loadSrSettings(this.app);
    this.notes = await scanVault(this.app, this.settings);
    // Likely copies (e.g. an archived duplicate) start unselected to avoid duplicate cards.
    this.selected = new Set(this.notes.filter(n => n.cards.length && !n.copyOf).map(n => n.path));
    this.renderPreview();
  }
  private renderPreview() {
    const el = this.contentEl; el.empty();
    const importable = this.notes.filter(n => n.cards.length);
    if (!importable.length) {
      const tags = this.settings!.tags.map(t => '#' + t).join(', ');
      el.createEl('p', { text: `No Spaced Repetition flashcards found. Qard looks for notes tagged ${tags}.` });
      this.renderSkipped(el, this.notes.flatMap(n => n.skipped.map(s => ({ path: n.path, ...s }))));
      new Setting(el).addButton(b => b.setButtonText('Close').onClick(() => this.close()));
      return;
    }
    const intro = el.createDiv({ cls: 'qard-import-intro' });
    intro.createEl('p', { text: 'Each selected note is rewritten in place. Its cards become Qard callouts, and its headings become topics. The rest of the note is left as it is.' });
    intro.createEl('p', { cls: 'qard-import-warning', text: 'The Spaced Repetition plugin will no longer see these cards. Back up or commit your vault first.' });
    intro.createEl('p', { cls: 'qard-muted', text: 'After importing, you can disable the Spaced Repetition plugin so both plugins do not read the same notes.' });

    const summary = el.createEl('p', { cls: 'qard-import-summary' });
    const list = el.createDiv({ cls: 'qard-import-list' });
    let convert: HTMLButtonElement | undefined;
    const update = () => {
      const chosen = importable.filter(n => this.selected.has(n.path));
      summary.setText(`${plural(chosen.reduce((n, c) => n + cardCount(c), 0), 'card')} from ${plural(chosen.length, 'note')} selected.`);
      if (convert) convert.disabled = !chosen.length || this.busy;
    };
    new Setting(list).setName('Select all').addToggle(t => t.setValue(importable.every(n => this.selected.has(n.path))).onChange(v => {
      this.selected = new Set(v ? importable.map(n => n.path) : []); this.renderPreview();
    }));
    for (const note of importable) {
      const parts = [plural(cardCount(note), 'card')];
      if (note.scheduled) parts.push(`${note.scheduled} scheduled`);
      if (note.deck) parts.push(`deck “${note.deck}”`);
      if (note.skipped.length) parts.push(`${note.skipped.length} skipped`);
      if (note.copyOf) parts.push(`same cards as ${note.copyOf}`);
      new Setting(list).setName(note.path).setDesc(parts.join(' · ')).addToggle(t => t.setValue(this.selected.has(note.path)).onChange(v => {
        if (v) this.selected.add(note.path); else this.selected.delete(note.path); update();
      }));
    }
    if (importable.some(n => n.scheduled)) new Setting(el).setName('Keep review schedule').setDesc('Carry over due dates, intervals and ease from Spaced Repetition. Off imports every card as new.')
      .addToggle(t => t.setValue(this.keepSchedule).onChange(v => { this.keepSchedule = v; }));
    this.renderSkipped(el, this.notes.flatMap(n => n.skipped.map(s => ({ path: n.path, ...s }))));
    new Setting(el)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => { convert = b.buttonEl; b.setButtonText('Convert notes').setCta().onClick(() => void this.run()); });
    update();
  }
  private renderSkipped(el: HTMLElement, skipped: { path: string; line: number; reason: string }[]) {
    if (!skipped.length) return;
    const details = el.createEl('details', { cls: 'qard-import-skipped' });
    details.createEl('summary', { text: `${plural(skipped.length, 'item')} will be left unchanged` });
    const list = details.createEl('ul');
    for (const s of skipped.slice(0, 200)) list.createEl('li', { text: `${s.path}:${s.line + 1} — ${s.reason}` });
    if (skipped.length > 200) list.createEl('li', { text: `…and ${skipped.length - 200} more.` });
  }
  private async run() {
    if (this.busy || !this.settings) return;
    this.busy = true;
    const paths = this.notes.filter(n => n.cards.length && this.selected.has(n.path)).map(n => n.path);
    this.contentEl.empty(); this.contentEl.createEl('p', { text: `Converting ${plural(paths.length, 'note')}…`, cls: 'qard-muted' });
    const result = await importNotes(this.app, this.plugin.index, this.plugin.reviews, paths, this.settings, this.keepSchedule);
    this.busy = false;
    const el = this.contentEl; el.empty();
    el.createEl('p', { text: `Imported ${plural(result.cards, 'card')} from ${plural(result.notes, 'note')}.` + (result.schedules ? ` ${plural(result.schedules, 'review schedule')} kept.` : '') });
    if (result.failures.length) {
      el.createEl('p', { cls: 'qard-import-warning', text: `${plural(result.failures.length, 'note')} could not be converted and were not changed:` });
      const list = el.createEl('ul');
      for (const f of result.failures) list.createEl('li', { text: `${f.path} — ${f.message}` });
    }
    this.renderSkipped(el, result.skipped);
    new Setting(el)
      .addButton(b => b.setButtonText('Close').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Open Qard').setCta().onClick(() => { this.close(); void this.plugin.open(); }));
  }
  onClose() { this.contentEl.empty(); }
}
