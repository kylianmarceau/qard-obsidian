import { vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { CardImprovementService } from '../src/cards/improvement-service';
import { SourceSyncService } from '../src/cards/source-sync-service';
import { CardWriter } from '../src/cards/card-writer';
import { CardIndex } from '../src/cards/card-index';
import type { VaultIndexer } from '../src/cards/indexer';
import type { AgentRunner } from '../src/agents/runner';
import { ReviewStore } from '../src/review/review-store';
import { serializeCard } from '../src/cards/source-patch';

export const improvement = {
  reason: 'A clearer question and focused answer.',
  cards: [{ front: 'What delivery does TCP provide?', back: 'Reliable, ordered delivery.' }],
};
export const splitImprovement = {
  reason: 'Separate reliability from ordering.',
  cards: [
    {
      front: 'Does TCP guarantee delivery?',
      back: 'It retransmits lost data for reliable delivery.',
    },
    { front: 'How does TCP order data?', back: 'It delivers data in order.' },
  ],
};
export function improvementFixture(
  run = vi.fn<AgentRunner['run']>().mockResolvedValue(improvement),
) {
  const files: Record<string, string> = {
    'Cards.md':
      '---\nqard-deck: Networks\n---\n# Transport\n\nKeep this introduction.\n\n' +
      serializeCard('original', 'What does TCP do?', 'TCP provides reliable, ordered delivery.') +
      '\nKeep this conclusion.\n\n# Other topic\n' +
      serializeCard('other', 'UDP?', 'Datagrams.'),
    'Notes/TCP.md': 'TCP provides reliable, ordered delivery.',
  };
  const index = new CardIndex();
  index.setLoading(false);
  const refresh = vi.fn(async (file: TFile) => {
    index.update(file.path, files[file.path]!);
  });
  Object.assign(index, { refresh });
  const persist = vi.fn(async () => {});
  const reviews = new ReviewStore(persist);
  const process = vi.fn(async (file: TFile, patch: (text: string) => string) => {
    files[file.path] = patch(files[file.path]!);
  });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) =>
        files[p] === undefined ? null : new (TFile as unknown as new (p: string) => TFile)(p),
      read: async (file: TFile) => files[file.path]!,
      process,
    },
    workspace: { on: vi.fn(), offref: vi.fn() },
  } as unknown as App;
  const writer = new CardWriter(app, index as VaultIndexer);
  const write = vi.fn(async (path: string, text: string) => {
    files[path] = text;
  });
  const storage = { read: async (path: string) => files[path] ?? null, write };
  const sources = new SourceSyncService(
    storage,
    'Qard/Source links.json',
    () => index.getSnapshot().cards,
    writer,
    (id) => reviews.requireContentCheck(id),
    () => ({ name: 'Writer', run }),
  );
  const makeService = () =>
    new CardImprovementService(
      storage,
      () => index.getSnapshot().cards,
      writer,
      reviews,
      sources,
      () => ({ name: 'Writer', run }),
    );
  index.update('Cards.md', files['Cards.md']!);
  const card = () => index.getSnapshot().cards.find((c) => c.id === 'original')!;
  return {
    service: makeService(),
    makeService,
    files,
    index,
    writer,
    reviews,
    run,
    persist,
    write,
    process,
    refresh,
    sources,
    app,
    card,
  };
}
