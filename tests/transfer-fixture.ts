import { vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
import { ReviewStore } from '../src/review/review-store';
import { TransferService } from '../src/migration/transfer-service';
import type { TransferInput } from '../src/migration/transfer-types';
export const sample: TransferInput = {
  cards: [
    {
      front: 'TCP?',
      back: '**Reliable**, ordered.',
      deck: 'Networks',
      topic: 'Transport',
      tags: ['networking'],
    },
  ],
  issues: [],
};
export function transferFixture() {
  const texts: Record<string, string> = {},
    binaries: Record<string, ArrayBuffer> = {},
    files = new Map<string, TFile | object>();
  const makeFile = (path: string) => new (TFile as unknown as new (p: string) => TFile)(path);
  const index = new CardIndex();
  index.setLoading(false);
  const refresh = vi.fn(async (file: TFile) => index.update(file.path, texts[file.path]!));
  Object.assign(index, { refresh });
  const create = vi.fn(async (path: string, text: string) => {
    if (files.has(path)) throw new Error('Already exists');
    texts[path] = text;
    const file = makeFile(path);
    files.set(path, file);
    return file;
  });
  const createBinary = vi.fn(async (path: string, bytes: ArrayBuffer) => {
    if (files.has(path)) throw new Error('Already exists');
    binaries[path] = bytes;
    const file = makeFile(path);
    files.set(path, file);
    return file;
  });
  const modify = vi.fn(async (file: TFile, text: string) => {
    texts[file.path] = text;
  });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      getFiles: () => [...files.values()].filter((f): f is TFile => f instanceof TFile),
      getMarkdownFiles: () =>
        [...files.values()].filter((f): f is TFile => f instanceof TFile && f.path.endsWith('.md')),
      read: async (file: TFile) => texts[file.path]!,
      readBinary: async (file: TFile) => binaries[file.path]!,
      create,
      createBinary,
      modify,
      createFolder: async (p: string) => {
        files.set(p, {});
      },
    },
    metadataCache: { getFirstLinkpathDest: vi.fn(() => null) },
  } as unknown as App;
  const persist = vi.fn(async () => {}),
    reviews = new ReviewStore(persist);
  const makeService = () => new TransferService(app, index as VaultIndexer, reviews);
  return {
    app,
    index,
    reviews,
    persist,
    service: makeService(),
    makeService,
    texts,
    binaries,
    files,
    refresh,
    create,
    createBinary,
    modify,
  };
}
