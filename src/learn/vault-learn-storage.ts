import { TFile, TFolder, normalizePath, type App } from 'obsidian';
import type { LearnStorage } from './learn-service';
import { isStudyNote, studyNotes } from '../vault-access';

/** Mastery files, checks and lessons through the Vault API, so sync and file explorers see every change. */
export class VaultLearnStorage implements LearnStorage {
  constructor(private app: App) {}
  private file(path: string) { const f = this.app.vault.getAbstractFileByPath(normalizePath(path)); return f instanceof TFile ? f : undefined; }
  async read(path: string) { const f = this.file(path); return f ? this.app.vault.read(f) : null; }
  exists(path: string) { return !!this.app.vault.getAbstractFileByPath(normalizePath(path)); }
  async write(path: string, text: string) {
    const target = normalizePath(path), parts = target.split('/');
    let built = '';
    for (const part of parts.slice(0, -1)) { built = built ? `${built}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(built)) await this.app.vault.createFolder(built); }
    const f = this.file(target);
    if (f) await this.app.vault.modify(f, text); else await this.app.vault.create(target, text);
  }
  async process(path: string, fn: (text: string) => string) {
    const f = this.file(path);
    if (!f) throw new Error(`${path} no longer exists.`);
    await this.app.vault.process(f, fn);
  }
  files(folder: string, extension: string) {
    const root = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(root instanceof TFolder)) return [];
    const found: string[] = [];
    const walk = (f: TFolder) => { for (const c of f.children) { if (c instanceof TFolder) walk(c); else if (c instanceof TFile && c.extension === extension && (extension !== 'md' || isStudyNote(c.path))) found.push(c.path); } };
    walk(root);
    return found.sort();
  }
  masteryFiles() { return studyNotes(this.app).filter(f => this.app.metadataCache.getFileCache(f)?.frontmatter?.['qard-mastery'] !== undefined).map(f => f.path); }
  async remove(path: string) { const f = this.file(path); if (f) await this.app.fileManager.trashFile(f); }
  modified(path: string) { return this.file(path)?.stat.mtime; }
  resolve(link: string, from: string) {
    if (this.file(link)) return link;
    return this.app.metadataCache.getFirstLinkpathDest(link.replace(/\.md$/, ''), from)?.path;
  }
}
