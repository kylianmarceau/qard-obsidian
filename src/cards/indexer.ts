import { TFile, type App, type Plugin } from 'obsidian';
import { CardIndex } from './card-index';
import { isStudyNote, studyNotes } from '../vault-access';
export class VaultIndexer extends CardIndex {
  private pending = new Map<string, number>();
  private generations = new Map<string, number>();
  private stopped = false;
  constructor(private app: App, private plugin: Plugin) { super(); }
  async start() {
    if (this.stopped) return;
    const { vault } = this.app;
    this.plugin.registerEvent(vault.on('create', file => { if (file instanceof TFile && file.extension === 'md') this.schedule(file); }));
    this.plugin.registerEvent(vault.on('modify', file => { if (file instanceof TFile && file.extension === 'md') this.schedule(file); }));
    this.plugin.registerEvent(vault.on('delete', file => {
      for (const card of this.getSnapshot().cards) if (card.sourceFile === file.path || card.sourceFile.startsWith(file.path + '/')) this.invalidate(card.sourceFile);
      this.invalidate(file.path);
    }));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
      this.invalidate(oldPath);
      if (file instanceof TFile && file.extension === 'md') this.schedule(file);
      else for (const note of studyNotes(this.app)) if (note.path.startsWith(file.path + '/')) this.schedule(note);
      // Folder rename may arrive without per-file events.
      for (const card of this.getSnapshot().cards) if (card.sourceFile.startsWith(oldPath + '/')) this.invalidate(card.sourceFile);
    }));
    const files = studyNotes(this.app);
    for (let i = 0; i < files.length && !this.stopped; i++) {
      await this.refresh(files[i]!, false);
      if (i % 20 === 19) { this.publish(); await new Promise<void>(resolve => window.setTimeout(resolve, 0)); }
    }
    if (!this.stopped) this.setLoading(false);
  }
  private invalidate(path: string) {
    window.clearTimeout(this.pending.get(path)); this.pending.delete(path);
    this.generations.set(path, (this.generations.get(path) || 0) + 1); this.remove(path);
  }
  private schedule(file: TFile) {
    const path = file.path;
    window.clearTimeout(this.pending.get(path));
    this.pending.set(path, window.setTimeout(() => { this.pending.delete(path); void this.refresh(file); }, 250));
  }
  async refresh(file: TFile, notify = true) {
    if (!isStudyNote(file.path)) { this.invalidate(file.path); return; }
    const path = file.path, generation = (this.generations.get(path) || 0) + 1;
    this.generations.set(path, generation);
    try {
      const source = await this.app.vault.cachedRead(file);
      if (!this.stopped && this.generations.get(path) === generation && file.path === path && this.app.vault.getAbstractFileByPath(path) === file) this.update(path, source, notify);
    } catch { if (!this.stopped && this.generations.get(path) === generation) this.fail(path, 'Could not read this note. Try opening it in Obsidian.'); }
  }
  override dispose() { this.stopped = true; this.pending.forEach(timer => window.clearTimeout(timer)); this.pending.clear(); this.generations.clear(); super.dispose(); }
}
