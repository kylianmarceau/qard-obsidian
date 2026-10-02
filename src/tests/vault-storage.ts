import { TFile, TFolder, normalizePath, type App } from 'obsidian';
import type { TestStorage } from './test-service';

/** Test folders through the Vault API, so sync and file explorers see every change. */
export class VaultTestStorage implements TestStorage {
  constructor(private app: App) {}
  async folders(root: string) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(root));
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((c): c is TFolder => c instanceof TFolder && c.children.some(f => f instanceof TFile && ['test.json', 'plan.json', 'request.json'].includes(f.name))).map(f => f.path);
  }
  async read(path: string) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.read(file) : null;
  }
  exists(path: string) { return !!this.app.vault.getAbstractFileByPath(normalizePath(path)); }
  async trash(path: string) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(folder instanceof TFolder) || !folder.children.some(f => f instanceof TFile && ['test.json', 'plan.json', 'request.json'].includes(f.name))) throw new Error('The test folder no longer exists or contains no test files.');
    await this.app.fileManager.trashFile(folder);
  }
  async write(path: string, text: string) {
    const target = normalizePath(path), parts = target.split('/');
    let built = '';
    for (const part of parts.slice(0, -1)) { built = built ? `${built}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(built)) await this.app.vault.createFolder(built); }
    const file = this.app.vault.getAbstractFileByPath(target);
    if (file instanceof TFile) await this.app.vault.modify(file, text); else await this.app.vault.create(target, text);
  }
}
