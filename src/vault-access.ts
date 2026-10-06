import type { App, TFile } from 'obsidian';

/** Discovery needs Markdown paths, never attachments or hidden configuration files. */
export function isStudyNote(path: string, excluded: readonly string[] = []): boolean {
  if (!path.endsWith('.md') || path.split('/').some((part) => !part || part.startsWith('.')))
    return false;
  return !excluded.some((folder) => {
    const root = folder.replace(/^\/+|\/+$/g, '');
    return !!root && (path === root || path.startsWith(root + '/'));
  });
}

/** Vault enumeration is intentional: cards and source pickers work across ordinary notes. */
export function studyNotes(app: App, excluded: readonly string[] = []): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => isStudyNote(file.path, excluded));
}
