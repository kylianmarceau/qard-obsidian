import { TFile, type App } from 'obsidian';
import { safeFolder } from '../cards/card-writer';
import { parseCards } from '../cards/parser';
import { serializeCard } from '../cards/source-patch';
import type { VaultIndexer } from '../cards/indexer';
import type { ReviewStore } from '../review/review-store';
import type { ReviewState, ReviewEvent } from '../review/scheduler';
import { studyNotes } from '../vault-access';
import { readAnki } from './anki';
import { validateTransferCard, writeDelimited, type Delimiter, MAX_CARDS } from './tabular';
import type { TransferInput, TransferCard } from './transfer-types';

export interface ImportPlan {
  version: 1;
  id: string;
  folder: string;
  filename: string;
  keepSchedule: boolean;
  skipDuplicates: boolean;
  cards: (TransferCard & { id: string })[];
  media: { key: string; name: string; hash: string; path: string }[];
  duplicates: number;
  complete?: boolean;
}
const cardKey = (c: Pick<TransferCard, 'front' | 'back' | 'deck' | 'topic'>) =>
  JSON.stringify([c.front, c.back, c.deck, c.topic]);
const hashBytes = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const slug = (name: string) =>
  name
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80) || 'Cards';
const mediaName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return slug(name.slice(0, dot)) + name.slice(dot);
};
const baseOf = (plan: Pick<ImportPlan, 'folder' | 'id'>) =>
  [plan.folder, 'Imports', plan.id].filter(Boolean).join('/');
export const journalPath = (plan: ImportPlan) => `${baseOf(plan)}/import.json`;

/** All changes stay in ordinary vault files. The approval journal makes interrupted imports resumable. */
export class TransferService {
  private busy = false;
  constructor(
    private app: App,
    private index: VaultIndexer,
    private reviews: ReviewStore,
  ) {}
  async currentCards() {
    const cards = [];
    for (const file of studyNotes(this.app)) {
      cards.push(...parseCards(await this.app.vault.read(file), file.path).cards);
    }
    return cards;
  }
  async prepare(
    input: TransferInput,
    folder: string,
    filename: string,
    skipDuplicates = true,
    keepSchedule = true,
  ): Promise<ImportPlan> {
    folder = safeFolder(folder);
    if (!input.cards.length || input.cards.length > MAX_CARDS) {
      throw new Error('Choose between 1 and 10,000 valid cards.');
    }
    input.cards.forEach(validateTransferCard);
    const media: ImportPlan['media'] = [];
    for (const item of input.media ?? []) {
      const hash = await hashBytes(item.bytes);
      media.push({
        key: item.key,
        name: item.name,
        hash,
        path: [folder, 'Imported media', `${hash.slice(0, 20)}-${mediaName(item.name)}`]
          .filter(Boolean)
          .join('/'),
      });
    }
    const resolve = (text: string) => {
      for (const item of media) {
        text = text.split(`![[qard-media/${item.key}]]`).join(`![[${item.path}]]`);
      }
      return text;
    };
    const known = new Set(
      (await this.currentCards()).map((c) =>
        cardKey({ front: c.frontMarkdown, back: c.backMarkdown, deck: c.deck, topic: c.topic }),
      ),
    );
    const id = crypto.randomUUID(),
      groups = new Map<string, string>();
    let duplicates = 0;
    const cards: ImportPlan['cards'] = [];
    for (const item of input.cards) {
      const card = { ...item, front: resolve(item.front), back: resolve(item.back) };
      const key = cardKey(card);
      if (skipDuplicates && known.has(key)) {
        duplicates++;
        continue;
      }
      known.add(key);
      if (card.group) {
        if (!groups.has(card.group)) {
          groups.set(card.group, `${id}-g${groups.size}`);
        }
        card.group = groups.get(card.group)!;
      }
      cards.push({ ...card, id: `${id}-c${cards.length}` });
    }
    return {
      version: 1,
      id,
      folder,
      filename,
      keepSchedule,
      skipDuplicates,
      cards,
      media,
      duplicates,
    };
  }
  private async folder(path: string) {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  private async immutable(path: string, text: string) {
    await this.folder(path.split('/').slice(0, -1).join('/'));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      if (!(file instanceof TFile) || (await this.app.vault.read(file)) !== text) {
        throw new Error(`The saved import file changed: ${path}. Restore it before resuming.`);
      }
      return file;
    }
    return this.app.vault.create(path, text);
  }
  private async binary(path: string, bytes: Uint8Array) {
    await this.folder(path.split('/').slice(0, -1).join('/'));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      if (
        !(file instanceof TFile) ||
        (await hashBytes(new Uint8Array(await this.app.vault.readBinary(file)))) !==
          (await hashBytes(bytes))
      ) {
        throw new Error(`An imported attachment changed: ${path}. Restore it before resuming.`);
      }
    } else {
      await this.app.vault.createBinary(path, bytes.slice().buffer);
    }
  }
  private validate(plan: ImportPlan) {
    if (
      plan.version !== 1 ||
      !/^[A-Za-z0-9_-]+$/.test(plan.id) ||
      typeof plan.folder !== 'string' ||
      safeFolder(plan.folder) !== plan.folder ||
      !Array.isArray(plan.cards) ||
      !plan.cards.length ||
      plan.cards.length > MAX_CARDS ||
      typeof plan.keepSchedule !== 'boolean' ||
      typeof plan.skipDuplicates !== 'boolean' ||
      !Array.isArray(plan.media)
    ) {
      throw new Error('Invalid saved import.');
    }
    const ids = new Set<string>();
    for (const card of plan.cards) {
      validateTransferCard(card);
      if (
        typeof card.id !== 'string' ||
        !card.id.startsWith(`${plan.id}-c`) ||
        !/^[A-Za-z0-9_-]+$/.test(card.id) ||
        ids.has(card.id) ||
        (card.group &&
          (!card.group.startsWith(`${plan.id}-g`) || !/^[A-Za-z0-9_-]+$/.test(card.group)))
      ) {
        throw new Error('Invalid imported card identity.');
      }
      ids.add(card.id);
      if (
        card.state &&
        (!Number.isFinite(card.state.interval) ||
          card.state.interval < 0 ||
          !Number.isFinite(card.state.ease) ||
          card.state.ease <= 0 ||
          !Number.isSafeInteger(card.state.reviewCount) ||
          card.state.reviewCount < 0 ||
          !Number.isSafeInteger(card.state.lapses) ||
          card.state.lapses < 0 ||
          [card.state.due, card.state.lastReviewed].some(
            (date) => date !== undefined && !Number.isFinite(new Date(date).getTime()),
          ))
      ) {
        throw new Error('Invalid imported schedule.');
      }
      if (
        card.history &&
        (!Array.isArray(card.history) ||
          card.history.length > 500000 ||
          card.history.some(
            (e) => ![1, 2, 3, 4].includes(e.rating) || !Number.isFinite(new Date(e.at).getTime()),
          ))
      ) {
        throw new Error('Invalid imported review history.');
      }
    }
    for (const item of plan.media) {
      if (
        !/^\d+$/.test(item.key) ||
        !/^[a-f0-9]{64}$/.test(item.hash) ||
        typeof item.name !== 'string' ||
        item.path !==
          [plan.folder, 'Imported media', `${item.hash.slice(0, 20)}-${mediaName(item.name)}`]
            .filter(Boolean)
            .join('/')
      ) {
        throw new Error('Invalid saved media path.');
      }
    }
  }
  async pending() {
    const result: ImportPlan[] = [];
    for (const file of this.app.vault
      .getFiles()
      .filter(
        (f) =>
          /(?:^|\/)Imports\/[A-Za-z0-9_-]+\/import\.json$/.test(f.path) &&
          !f.path.split('/').some((s) => s.startsWith('.')),
      )) {
      const plan = JSON.parse(await this.app.vault.read(file)) as ImportPlan;
      this.validate(plan);
      if (journalPath(plan) !== file.path) {
        throw new Error('The saved import moved. Restore its original folder before resuming.');
      }
      if (!plan.complete) {
        result.push(plan);
      }
    }
    return result;
  }
  async apply(plan: ImportPlan, input?: TransferInput) {
    if (this.busy) {
      throw new Error('Another import is saving. Wait for it to finish.');
    }
    this.validate(plan);
    this.busy = true;
    try {
      const plannedIds = new Set(plan.cards.map((card) => card.id));
      if (
        (await this.currentCards()).some(
          (card) => plannedIds.has(card.id) && !card.sourceFile.startsWith(baseOf(plan) + '/'),
        )
      ) {
        throw new Error(
          'An imported card ID also exists outside its import folder. Resolve that duplicate before resuming.',
        );
      }
      const journal = journalPath(plan),
        saved = this.app.vault.getAbstractFileByPath(journal);
      if (!saved) {
        if (plan.skipDuplicates) {
          const current = new Set(
            (await this.currentCards()).map((c) =>
              cardKey({
                front: c.frontMarkdown,
                back: c.backMarkdown,
                deck: c.deck,
                topic: c.topic,
              }),
            ),
          );
          if (plan.cards.some((c) => current.has(cardKey(c)))) {
            throw new Error(
              'The vault changed after the preview. Refresh the preview before importing.',
            );
          }
        }
        if (plan.media.length) {
          if (!input?.packageBytes) {
            throw new Error('Choose the original Anki package to save its media.');
          }
          await this.binary(`${baseOf(plan)}/source.apkg`, input.packageBytes);
        }
        await this.immutable(journal, JSON.stringify(plan));
      }
      let media = input?.media;
      if (plan.media.length && !media) {
        const file = this.app.vault.getAbstractFileByPath(`${baseOf(plan)}/source.apkg`);
        if (!(file instanceof TFile)) {
          throw new Error('Restore the original package in the import folder to resume.');
        }
        media = (await readAnki(new Uint8Array(await this.app.vault.readBinary(file)))).media;
      }
      for (const item of plan.media) {
        const content = media?.find((m) => m.key === item.key && m.name === item.name)?.bytes;
        if (!content || (await hashBytes(content)) !== item.hash) {
          throw new Error('The saved package no longer matches its approved media.');
        }
        await this.binary(item.path, content);
      }
      const groups = new Map<string, ImportPlan['cards']>();
      for (const card of plan.cards) {
        const key = JSON.stringify([card.deck, card.topic, [...card.tags].sort()]);
        groups.set(key, [...(groups.get(key) ?? []), card]);
      }
      let number = 0;
      for (const cards of groups.values()) {
        const deck = cards[0]!.deck,
          topics = new Map<string, ImportPlan['cards']>();
        for (const c of cards) {
          topics.set(c.topic, [...(topics.get(c.topic) ?? []), c]);
        }
        const path = `${baseOf(plan)}/${++number}-${slug(deck)}.md`;
        const text =
          `---\nqard-deck: ${JSON.stringify(deck)}\nqard-topic: ${JSON.stringify(cards[0]!.topic)}\ntags: ${JSON.stringify(cards[0]!.tags)}\n---\n\n` +
          [...topics]
            .map(
              ([topic, cards]) =>
                `# ${topic}\n\n` +
                cards.map((c) => serializeCard(c.id, c.front, c.back, '\n', c.group)).join('\n'),
            )
            .join('\n');
        const parsed = parseCards(text, path);
        if (
          parsed.issues.length ||
          parsed.cards.length !== cards.length ||
          parsed.cards.some(
            (c) =>
              !cards.some(
                (p) =>
                  p.id === c.id &&
                  p.front === c.frontMarkdown &&
                  p.back === c.backMarkdown &&
                  p.deck === c.deck &&
                  p.topic === c.topic,
              ),
          )
        ) {
          throw new Error('These cards could not be represented safely in Markdown.');
        }
        const file = await this.immutable(path, text);
        await this.index.refresh(file);
      }
      const states: ReviewState[] = [],
        events: ReviewEvent[] = [];
      if (plan.keepSchedule) {
        for (const card of plan.cards) {
          if (card.state) {
            states.push({ ...card.state, cardId: card.id });
            events.push(...(card.history ?? []).map((e) => ({ ...e, cardId: card.id })));
          }
        }
      }
      await this.reviews.importStates(states, events);
      const file = this.app.vault.getAbstractFileByPath(journal);
      if (!(file instanceof TFile)) {
        throw new Error('The import record is missing. Restore it to finish saving.');
      }
      await this.app.vault.modify(file, JSON.stringify({ ...plan, complete: true }));
      return { cards: plan.cards.length, folder: baseOf(plan), reviews: events.length };
    } finally {
      this.busy = false;
    }
  }
  async export(folder: string, delimiter: Delimiter, deck?: string) {
    folder = safeFolder(folder);
    const cards = (await this.currentCards()).filter((c) => !deck || c.deck === deck);
    if (!cards.length) {
      throw new Error('There are no cards to export.');
    }
    // Relative attachment and note links must still resolve after importing into another folder.
    const canonical = (text: string, path: string) =>
      text
        .replace(
          /(!?\[\[)([^\]\n]+)(\]\])/g,
          (all, open: string, target: string, close: string) => {
            const [link, alias] = target.split('|'),
              [name, ...heading] = link!.split('#');
            const file = this.app.metadataCache.getFirstLinkpathDest(name!, path);
            return file
              ? open +
                  file.path +
                  (heading.length ? '#' + heading.join('#') : '') +
                  (alias === undefined ? '' : '|' + alias) +
                  close
              : all;
          },
        )
        .replace(
          /(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,
          (all, open: string, href: string, close: string) => {
            if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
              return all;
            }
            let name = href;
            try {
              name = decodeURIComponent(href);
            } catch {
              /* use original */
            }
            const file = this.app.metadataCache.getFirstLinkpathDest(name, path);
            return file
              ? open + encodeURI(file.path).replace(/[()]/g, (s) => encodeURIComponent(s)) + close
              : all;
          },
        );
    const content = writeDelimited(
      cards.map((c) => ({
        ...c,
        frontMarkdown: canonical(c.frontMarkdown, c.sourceFile),
        backMarkdown: canonical(c.backMarkdown, c.sourceFile),
      })),
      delimiter,
    );
    const path = [
      folder,
      `${slug(deck || 'Qard')}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${delimiter === ',' ? 'csv' : 'tsv'}`,
    ]
      .filter(Boolean)
      .join('/');
    await this.immutable(path, content);
    return { path, cards: cards.length };
  }
}
