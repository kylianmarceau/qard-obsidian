import { expect, it, vi } from 'vitest';
vi.mock('obsidian', async importOriginal => {
  const base = await importOriginal<typeof import('obsidian')>();
  return { ...base, TFolder: class { constructor(public path: string, public children: unknown[] = []) {} } };
});
import { TFile, TFolder, type App } from 'obsidian';
import { VaultTestStorage } from '../src/tests/vault-storage';
const file = (path: string) => Object.assign(new (TFile as unknown as new (p: string) => TFile)(path), { name: path.split('/').pop()! });
const folder = (path: string, children: TFile[]) => new (TFolder as unknown as new (p: string, c: TFile[]) => TFolder)(path, children);
it('uses Obsidian file-manager trash for the selected test folder', async () => {
  const selected = folder('Qard/Tests/t', [file('Qard/Tests/t/test.json'), file('Qard/Tests/t/attempt.json')]);
  const trashFile = vi.fn().mockResolvedValue(undefined);
  const storage = new VaultTestStorage({ vault: { getAbstractFileByPath: () => selected }, fileManager: { trashFile } } as unknown as App);
  await storage.trash('Qard/Tests/t'); expect(trashFile).toHaveBeenCalledExactlyOnceWith(selected);
});
it('refuses to trash a source note or a folder without test files', async () => {
  const trashFile = vi.fn(), targets = [file('Notes/HMM.md'), folder('Notes', [file('Notes/HMM.md')])];
  const storage = new VaultTestStorage({ vault: { getAbstractFileByPath: () => targets.shift() }, fileManager: { trashFile } } as unknown as App);
  await expect(storage.trash('Notes/HMM.md')).rejects.toThrow('no test files');
  await expect(storage.trash('Notes')).rejects.toThrow('no test files'); expect(trashFile).not.toHaveBeenCalled();
});
