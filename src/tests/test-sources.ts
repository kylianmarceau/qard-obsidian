/** Shared folder expansion for the composer. Match path boundaries, not similar folder names. */
export function testNotePaths(paths: string[], testsFolder: string): string[] {
  const excluded = testsFolder.replace(/\/+$/, '');
  return [...new Set(paths.filter(p => p.endsWith('.md') && !p.split('/').some(part => part.startsWith('.')) && p !== excluded && !p.startsWith(excluded + '/')))];
}

export function testFolders(paths: string[]): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const path of new Set(paths)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));
}

export function folderNotes(paths: string[], folders: string[]): string[] {
  return [...new Set(paths.filter(p => folders.some(f => !!f && p.startsWith(f + '/'))))].sort((a, b) => a.localeCompare(b));
}

/** Folder contents are a snapshot of the vault at Start; persisted requests retain those exact sources. */
export function resolveTestNotes(paths: string[], notes: string[], folders: string[]): string[] {
  const available = new Set(paths);
  return [...new Set([...notes.filter(p => available.has(p)), ...folderNotes(paths, folders)])];
}
