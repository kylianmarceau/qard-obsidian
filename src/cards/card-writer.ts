import { TFile, normalizePath, type App } from 'obsidian';
import type { QardCard } from './card-types';
import type { VaultIndexer } from './indexer';
import {
  deleteCardInSource,
  deleteGroupInSource,
  ensureSiblingGroupsInSource,
  locateCard,
  replaceCardInSource,
  serializeCard,
  placeCardInSource,
} from './source-patch';
import { parseCards } from './parser';
import { readCardLocation, type CardLocation } from './card-location';
import { siblingGroup } from './siblings';
import type { SourceSnapshot } from './source-sync-types';
import { readCardFormat } from './card-format';
export interface CardDraft {
  reverse?: boolean;
  deck: string;
  topic: string;
  front: string;
  back: string;
  sourceFile?: string;
  folder: string;
  generatedFrom?: string[];
  sourceSnapshots?: SourceSnapshot[];
}
export function safeFolder(folder: string): string {
  if (
    /^(?:[\\/]|[A-Za-z]:)/.test(folder) ||
    folder.split(/[\\/]/).some((part) => part === '..' || part.startsWith('.'))
  ) {
    throw new Error('Choose a normal vault folder, without hidden folders or parent paths.');
  }
  return normalizePath(folder.trim()).replace(/^\.$/, '');
}
export class CardWriter {
  trackSources?: (id: string, paths: string[], snapshots?: SourceSnapshot[]) => Promise<void>;
  constructor(
    private app: App,
    private index: VaultIndexer,
  ) {}
  private file(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error('The source note no longer exists. Reopen the card from the library.');
    }
    return file;
  }
  private unique(card: QardCard) {
    if (
      card.duplicateId ||
      (card.stable && this.index.getSnapshot().cards.filter((c) => c.id === card.id).length > 1)
    ) {
      throw new Error(
        'This ID is used by more than one card. Open the source and remove the copied ID before reviewing or editing.',
      );
    }
  }
  async ensureStable(cards: QardCard[]): Promise<QardCard[]> {
    const groups = new Map<string, QardCard[]>();
    for (const card of cards) {
      this.unique(card);
      groups.set(card.sourceFile, [...(groups.get(card.sourceFile) || []), card]);
    }
    const resolved = new Map<string, QardCard>();
    for (const [path, group] of groups) {
      const file = this.file(path);
      if (group.every((c) => c.stable && (!siblingGroup(c) || c.siblingGroup))) {
        const current = parseCards(await this.app.vault.read(file), path).cards;
        for (const card of group) {
          const found = current.filter((c) => c.id === card.id);
          if (found.length !== 1) {
            throw new Error('A selected card changed. Rebuild the session from the latest notes.');
          }
          resolved.set(card.id, found[0]!);
        }
      } else {
        await this.app.vault.process(file, (source) => {
          let next = ensureSiblingGroupsInSource(source, path);
          const parsed = parseCards(next, path).cards;
          const assignments = group.map((card) => {
            const current = locateCard(next, card, parsed);
            return {
              original: card.id,
              current,
              id: current.stable ? current.id : crypto.randomUUID(),
            };
          });
          const eol = next.includes('\r\n') ? '\r\n' : '\n';
          for (const entry of [...assignments].sort(
            (a, b) => b.current.sourcePosition.calloutStart - a.current.sourcePosition.calloutStart,
          )) {
            if (!entry.current.stable) {
              const at = entry.current.sourcePosition.calloutStart;
              next = next.slice(0, at) + `<!-- qard-id: ${entry.id} -->${eol}` + next.slice(at);
            }
          }
          const saved = parseCards(next, path).cards;
          for (const entry of assignments) {
            const found = saved.filter((card) => card.id === entry.id);
            if (found.length !== 1) {
              throw new Error('Could not safely assign a selected card ID.');
            }
            resolved.set(entry.original, found[0]!);
          }
          return next;
        });
        await this.index.refresh(file);
      }
    }
    return cards.map((c) => resolved.get(c.id)!);
  }
  async validateSelection(cards: QardCard[]) {
    if (
      !cards.length ||
      cards.length > 10000 ||
      new Set(cards.map((card) => card.id)).size !== cards.length
    ) {
      throw new Error('Select between 1 and 10,000 distinct cards.');
    }
    const sources = new Map<string, { text: string; cards: QardCard[] }>();
    for (const card of cards) {
      this.unique(card);
      if (!sources.has(card.sourceFile)) {
        const text = await this.app.vault.read(this.file(card.sourceFile));
        sources.set(card.sourceFile, { text, cards: parseCards(text, card.sourceFile).cards });
      }
      const source = sources.get(card.sourceFile)!;
      const current = locateCard(source.text, card, source.cards);
      if (current.deck !== card.deck || current.topic !== card.topic) {
        throw new Error('A selected card moved. Select it again from the latest library.');
      }
    }
  }
  /** Each source note is changed atomically, with stable IDs and no cross-file copy/delete step. */
  async move(cards: QardCard[], destination: CardLocation) {
    const location = readCardLocation(destination);
    await this.validateSelection(cards);
    const ready = await this.ensureStable(cards);
    const groups = new Map<string, QardCard[]>();
    for (const card of ready) {
      groups.set(card.sourceFile, [...(groups.get(card.sourceFile) ?? []), card]);
    }
    let completed = 0;
    try {
      for (const [path, group] of groups) {
        const file = this.file(path);
        await this.app.vault.process(file, (source) => {
          let next = source;
          const originals = parseCards(source, path).cards;
          const ordered = group
            .map((card) => locateCard(source, card, originals))
            .sort((a, b) => b.sourcePosition.start - a.sourcePosition.start);
          for (const current of ordered) {
            const card = group.find((entry) => entry.id === current.id)!;
            if (current.deck !== card.deck || current.topic !== card.topic) {
              throw new Error('A selected card moved while saving. Select it again.');
            }
            next = placeCardInSource(next, current, location, originals);
          }
          const parsed = parseCards(next, path).cards;
          if (
            group.some(
              (card) =>
                parsed.filter(
                  (c) => c.id === card.id && c.deck === location.deck && c.topic === location.topic,
                ).length !== 1,
            )
          ) {
            throw new Error('The cards could not be moved safely in this note.');
          }
          return next;
        });
        completed += group.length;
        await this.index.refresh(file);
      }
    } catch (error) {
      throw new Error(
        `${completed} of ${ready.length} cards moved. ${(error as Error).message} Refresh the library and select the remaining cards to continue.`,
      );
    }
    return ready.map((card) => this.index.getSnapshot().cards.find((c) => c.id === card.id)!);
  }
  async edit(card: QardCard, front: string, back: string) {
    this.unique(card);
    if (card.reverseId) {
      const partner = this.index.getSnapshot().cards.find((c) => c.id === card.reverseId);
      if (!partner) {
        throw new Error('The linked reverse card is missing. Restore the pair before editing.');
      }
      this.unique(partner);
    }
    const file = this.file(card.sourceFile),
      id = card.stable ? card.id : crypto.randomUUID();
    await this.app.vault.process(file, (source) =>
      replaceCardInSource(source, card, front, back, id),
    );
    await this.index.refresh(file);
    return this.index.getSnapshot().cards.find((c) => c.id === id)!;
  }
  /** Read the latest note before resuming a save whose index refresh may have failed. */
  async refresh(card: QardCard) {
    this.unique(card);
    await this.index.refresh(this.file(card.sourceFile));
  }
  async delete(card: QardCard) {
    this.unique(card);
    const file = this.file(card.sourceFile);
    await this.app.vault.process(file, (source) => deleteCardInSource(source, card));
    await this.index.refresh(file);
  }
  /** Add split cards beside their original in one note write. Stable IDs make retries safe. */
  async insertSplit(card: QardCard, additions: { id: string; front: string; back: string }[]) {
    this.unique(card);
    if (
      additions.length < 2 ||
      new Set(additions.map((c) => c.id)).size !== additions.length ||
      additions.some((c) => c.id === card.id)
    ) {
      throw new Error('Choose distinct new identities for split cards.');
    }
    additions.forEach((c) => serializeCard(c.id, c.front, c.back));
    for (const addition of additions) {
      const elsewhere = this.index.getSnapshot().cards.filter((c) => c.id === addition.id);
      if (elsewhere.some((c) => c.sourceFile !== card.sourceFile || c.duplicateId)) {
        throw new Error('A split card ID is already in use.');
      }
    }
    const file = this.file(card.sourceFile);
    await this.app.vault.process(file, (source) => {
      const current = locateCard(source, card);
      if (current.deck !== card.deck || current.topic !== card.topic) {
        throw new Error('This card moved to another deck or topic. Prepare a new improvement.');
      }
      const parsed = parseCards(source, file.path).cards;
      const pending = additions.filter((addition) => {
        const found = parsed.filter((c) => c.id === addition.id);
        if (
          found.length > 1 ||
          found.some(
            (c) =>
              c.frontMarkdown !== addition.front ||
              c.backMarkdown !== addition.back ||
              c.deck !== card.deck ||
              c.topic !== card.topic,
          )
        ) {
          throw new Error('A split card was edited elsewhere. Check the note before retrying.');
        }
        return !found.length;
      });
      if (!pending.length) {
        return source;
      }
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      const inserted = pending
        .map((c) => serializeCard(c.id, c.front, c.back, eol, undefined, current.location))
        .join(eol);
      const end = current.sourcePosition.end;
      const next = source.slice(0, end) + eol + inserted + eol + source.slice(end);
      const verified = parseCards(next, file.path).cards;
      if (
        additions.some(
          (c) =>
            verified.filter((v) => v.id === c.id && v.deck === card.deck && v.topic === card.topic)
              .length !== 1,
        )
      ) {
        throw new Error('Split cards could not be added safely to this note.');
      }
      return next;
    });
    await this.index.refresh(file);
    return additions.map((c) => this.index.getSnapshot().cards.find((v) => v.id === c.id)!);
  }
  /** Use the full index, even when the library has a search filter. Each note is patched atomically. */
  async deleteGroup(deck: string, topic?: string) {
    const paths = [
      ...new Set(
        this.index
          .getSnapshot()
          .cards.filter((c) => c.deck === deck && (topic === undefined || c.topic === topic))
          .map((c) => c.sourceFile),
      ),
    ];
    for (const path of paths) {
      const file = this.file(path);
      await this.app.vault.process(file, (source) =>
        deleteGroupInSource(source, path, deck, topic),
      );
      await this.index.refresh(file);
    }
  }
  /** One atomic note write per generated batch. Stable IDs make retries safe after a save or index failure. */
  async createBatch(
    target: {
      deck: string;
      topic: string;
      folder: string;
      batchId: string;
      label?: 'cloze' | 'occlusion';
      siblingGroup?: string;
    },
    cards: {
      id: string;
      front: string;
      back: string;
      topic?: string;
      source?: string;
      sourceSnapshots?: SourceSnapshot[];
    }[],
  ): Promise<QardCard[]> {
    const deck = target.deck.trim(),
      topic = target.topic.trim() || 'General',
      folder = safeFolder(target.folder);
    if (!deck || /[\r\n]/.test(deck + topic)) {
      throw new Error('Deck and topic names must be nonempty single lines.');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(target.batchId)) {
      throw new Error('Invalid batch ID.');
    }
    if (!cards.length || new Set(cards.map((c) => c.id)).size !== cards.length) {
      throw new Error('Choose distinct cards to add.');
    }
    // Validate the whole batch before making any changes.
    const topicOf = (card: (typeof cards)[number]) =>
      card.topic === undefined ? topic : card.topic.trim();
    cards.forEach((c) => {
      const name = topicOf(c);
      if (!name || name.length > 200 || /[\r\n]/.test(name)) {
        throw new Error('Card topics must be nonempty single lines, up to 200 characters each.');
      }
      serializeCard(c.id, c.front, c.back, '\n', target.siblingGroup);
    });
    const slug =
      deck
        .replace(/[\\/:*?"<>|#^[\]]/g, '-')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 80) || 'Cards';
    const path = [folder, `${slug} ${target.label || 'generated'} ${target.batchId}.md`]
      .filter(Boolean)
      .join('/');
    for (const card of cards) {
      if (card.source) {
        await this.trackSources?.(card.id, [card.source], card.sourceSnapshots);
      }
    }
    const append = (source: string) => {
      const existing = parseCards(source, path).cards;
      for (const card of cards) {
        const matches = existing.filter((c) => c.id === card.id);
        if (
          matches.length > 1 ||
          matches.some(
            (c) =>
              c.deck !== deck ||
              c.topic !== topicOf(card) ||
              (target.siblingGroup !== undefined && c.siblingGroup !== target.siblingGroup),
          )
        ) {
          throw new Error(
            'A saved card changed its deck, topic or ID. Check the generated note before retrying.',
          );
        }
      }
      const pending = cards.filter((c) => !existing.some((old) => old.id === c.id));
      if (!pending.length) {
        return source;
      }
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      const groups = new Map<string, typeof cards>();
      for (const card of pending) {
        const name = topicOf(card);
        groups.set(name, [...(groups.get(name) ?? []), card]);
      }
      const next =
        source +
        eol +
        [...groups]
          .map(
            ([name, group]) =>
              `# ${name}${eol}${eol}` +
              group
                .map((c) => serializeCard(c.id, c.front, c.back, eol, target.siblingGroup))
                .join(eol),
          )
          .join(eol);
      const parsed = parseCards(next, path).cards;
      if (
        cards.some(
          (c) =>
            parsed.filter((p) => p.id === c.id && p.deck === deck && p.topic === topicOf(c))
              .length !== 1,
        )
      ) {
        throw new Error(
          'The generated note changed or has an unfinished Markdown block. Reopen its source before adding cards.',
        );
      }
      return next;
    };
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file && !(file instanceof TFile)) {
      throw new Error('A folder is using the generated note path.');
    }
    if (file instanceof TFile) {
      await this.app.vault.process(file, append);
    } else {
      const source = append(`---\nqard-deck: ${JSON.stringify(deck)}\n---\n`);
      let built = '';
      for (const part of folder.split('/').filter(Boolean)) {
        built = built ? `${built}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(built)) {
          await this.app.vault.createFolder(built);
        }
      }
      file = await this.app.vault.create(path, source);
    }
    if (!(file instanceof TFile)) {
      throw new Error('The generated note could not be created.');
    }
    await this.index.refresh(file);
    const parsed = parseCards(await this.app.vault.read(file), path).cards;
    return cards.map((c) => {
      const found = parsed.find((p) => p.id === c.id);
      if (!found) {
        throw new Error('A saved card could not be read back. Check the generated note.');
      }
      return found;
    });
  }
  async create(draft: CardDraft): Promise<QardCard> {
    const deck = draft.deck.trim(),
      topic = draft.topic.trim() || 'General';
    if (!deck || /[\r\n]/.test(deck + topic)) {
      throw new Error('Deck and topic names must be nonempty single lines.');
    }
    const id = crypto.randomUUID();
    const reverseId = draft.reverse ? crypto.randomUUID() : undefined;
    const group = reverseId ? crypto.randomUUID() : undefined;
    if (
      reverseId &&
      (readCardFormat(draft.front).kind !== 'basic' || readCardFormat(draft.back).kind !== 'basic')
    ) {
      throw new Error('Only basic cards can test the reverse.');
    }
    const content = (eol = '\n') =>
      serializeCard(id, draft.front, draft.back, eol, group, undefined, reverseId) +
      (reverseId
        ? eol + serializeCard(reverseId, draft.back, draft.front, eol, group, undefined, id)
        : '');
    // Validate before creating directories or notes.
    serializeCard(id, draft.front, draft.back);
    content();
    if (draft.generatedFrom?.length) {
      await this.trackSources?.(id, draft.generatedFrom, draft.sourceSnapshots);
      if (reverseId) {
        await this.trackSources?.(reverseId, draft.generatedFrom, draft.sourceSnapshots);
      }
    }
    let file: TFile | undefined;
    if (draft.sourceFile) {
      const existing = this.file(draft.sourceFile);
      const source = await this.app.vault.read(existing);
      const cards = parseCards(source, existing.path).cards;
      const cacheDeck: unknown =
        this.app.metadataCache.getFileCache(existing)?.frontmatter?.['qard-deck'];
      const existingDeck =
        typeof cacheDeck === 'string' ? cacheDeck.trim() : cards[0]?.deck || existing.basename;
      if (existingDeck === deck) {
        file = existing;
      }
    }
    if (file) {
      await this.app.vault.process(file, (source) => {
        const eol = source.includes('\r\n') ? '\r\n' : '\n';
        const override: unknown = this.app.metadataCache.getFileCache(file!)?.frontmatter?.[
          'qard-topic'
        ];
        if (typeof override === 'string' && override.trim() !== topic) {
          throw new Error(
            `This note fixes its topic to “${override}”. Choose that topic or create the card in a new note.`,
          );
        }
        const next =
          source +
          (source.endsWith(eol + eol) ? '' : source.endsWith(eol) ? eol : eol + eol) +
          `# ${topic}${eol}${eol}` +
          content(eol);
        const created = parseCards(next, file!.path).cards.find((c) => c.id === id);
        if (!created || created.deck !== deck || created.topic !== topic) {
          throw new Error(
            'This note changed or has an unfinished Markdown block. Fix its source or choose a new note before adding a card.',
          );
        }
        return next;
      });
    } else {
      // A selection moved to a different deck stays beside its source so relative attachments retain their meaning.
      const folder = safeFolder(
        draft.sourceFile ? draft.sourceFile.split('/').slice(0, -1).join('/') : draft.folder,
      );
      let built = '';
      for (const part of folder.split('/').filter(Boolean)) {
        built = built ? `${built}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(built)) {
          await this.app.vault.createFolder(built);
        }
      }
      const slug =
        deck
          .replace(/[\\/:*?"<>|#^[\]]/g, '-')
          .replace(/^\.+/, '')
          .trim()
          .slice(0, 80) || 'Cards';
      const base = [folder, slug].filter(Boolean).join('/');
      let path = base + '.md',
        n = 2;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = `${base} ${n++}.md`;
      }
      file = await this.app.vault.create(
        path,
        `---\nqard-deck: ${JSON.stringify(deck)}\n---\n\n# ${topic}\n\n${content()}`,
      );
    }
    await this.index.refresh(file);
    const card = this.index.getSnapshot().cards.find((c) => c.id === id);
    if (!card) {
      throw new Error(
        'The note was saved but could not be indexed. Check its frontmatter and callout syntax.',
      );
    }
    return card;
  }
}
