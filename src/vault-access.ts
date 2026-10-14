import type { App, TFile } from 'obsidian';

const hidden = (path: string) => path.split('/').some((part) => !part || part.startsWith('.'));
const inExcluded = (path: string, excluded: readonly string[]) =>
  excluded.some((folder) => {
    const root = folder.replace(/^\/+|\/+$/g, '');
    return !!root && (path === root || path.startsWith(root + '/'));
  });

/** Discovery needs Markdown paths, never attachments or hidden configuration files. */
export function isStudyNote(path: string, excluded: readonly string[] = []): boolean {
  return path.endsWith('.md') && !hidden(path) && !inExcluded(path, excluded);
}

export const isPdf = (path: string) => /\.pdf$/i.test(path);

/** AI sources: study notes and PDFs. Cards are only ever indexed from notes. */
export function isStudySource(path: string, excluded: readonly string[] = []): boolean {
  return (
    isStudyNote(path, excluded) || (isPdf(path) && !hidden(path) && !inExcluded(path, excluded))
  );
}

/** Vault enumeration is intentional: cards and source pickers work across ordinary notes. */
export function studyNotes(app: App, excluded: readonly string[] = []): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => isStudyNote(file.path, excluded));
}

export function studyPdfs(app: App, excluded: readonly string[] = []): TFile[] {
  return app.vault
    .getFiles()
    .filter((file) => isPdf(file.path) && isStudySource(file.path, excluded));
}

/** Notes, then PDFs, for source pickers and the AI's note tools. */
export function studySources(app: App, excluded: readonly string[] = []): TFile[] {
  return [...studyNotes(app, excluded), ...studyPdfs(app, excluded)];
}
