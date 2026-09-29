import { TFile, normalizePath, type App } from 'obsidian';
import type { QardCard } from './card-types';
import type { VaultIndexer } from './indexer';
import { deleteCardInSource, ensureIdInSource, replaceCardInSource, serializeCard } from './source-patch';
import { parseCards } from './parser';
export interface CardDraft { deck: string; topic: string; front: string; back: string; sourceFile?: string; folder: string }
export function safeFolder(folder: string): string {
  if (/^(?:[\\/]|[A-Za-z]:)/.test(folder) || folder.split(/[\\/]/).some(part => part === '..' || part.startsWith('.'))) throw new Error('Choose a normal vault folder, without hidden folders or parent paths.');
  return normalizePath(folder.trim()).replace(/^\.$/, '');
}
export class CardWriter {
  constructor(private app: App, private index: VaultIndexer) {}
  private file(path: string) { const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new Error('The source note no longer exists. Reopen the card from the library.'); return file; }
  private unique(card: QardCard) {
    if (card.duplicateId || (card.stable && this.index.getSnapshot().cards.filter(c => c.id === card.id).length > 1)) throw new Error('This ID is used by more than one card. Open the source and remove the copied ID before reviewing or editing.');
  }
  async ensureStable(cards: QardCard[]): Promise<QardCard[]> {
    const groups = new Map<string, QardCard[]>();
    for (const card of cards) { this.unique(card); groups.set(card.sourceFile, [...(groups.get(card.sourceFile) || []), card]); }
    const resolved = new Map<string, QardCard>();
    for (const [path, group] of groups) {
      const file = this.file(path);
      if (group.every(c => c.stable)) {
        const current = parseCards(await this.app.vault.read(file), path).cards;
        for (const card of group) { const found = current.filter(c => c.id === card.id); if (found.length !== 1) throw new Error('A selected card changed. Rebuild the session from the latest notes.'); resolved.set(card.id, found[0]!); }
      } else {
        await this.app.vault.process(file, source => {
          let next = source;
          for (const card of group) { const result = ensureIdInSource(next, card, crypto.randomUUID()); next = result.source; resolved.set(card.id, result.card); }
          return next;
        });
        await this.index.refresh(file);
      }
    }
    return cards.map(c => resolved.get(c.id)!);
  }
  async edit(card: QardCard, front: string, back: string) {
    this.unique(card); const file = this.file(card.sourceFile), id = card.stable ? card.id : crypto.randomUUID();
    await this.app.vault.process(file, source => replaceCardInSource(source, card, front, back, id));
    await this.index.refresh(file);
    return this.index.getSnapshot().cards.find(c => c.id === id)!;
  }
  async delete(card: QardCard) {
    this.unique(card); const file = this.file(card.sourceFile);
    await this.app.vault.process(file, source => deleteCardInSource(source, card));
    await this.index.refresh(file);
  }
  async create(draft: CardDraft): Promise<QardCard> {
    const deck = draft.deck.trim(), topic = draft.topic.trim() || 'General';
    if (!deck || /[\r\n]/.test(deck + topic)) throw new Error('Deck and topic names must be nonempty single lines.');
    const id = crypto.randomUUID();
    // Validate before creating directories or notes.
    serializeCard(id, draft.front, draft.back);
    let file: TFile | undefined;
    if (draft.sourceFile) {
      const existing = this.file(draft.sourceFile);
      const source = await this.app.vault.read(existing);
      const cards = parseCards(source, existing.path).cards;
      const cacheDeck: unknown = this.app.metadataCache.getFileCache(existing)?.frontmatter?.['qard-deck'];
      const existingDeck = typeof cacheDeck === 'string' ? cacheDeck.trim() : cards[0]?.deck || existing.basename;
      if (existingDeck === deck) file = existing;
    }
    if (file) {
      await this.app.vault.process(file, source => {
        const eol = source.includes('\r\n') ? '\r\n' : '\n';
        const override: unknown = this.app.metadataCache.getFileCache(file!)?.frontmatter?.['qard-topic'];
        if (typeof override === 'string' && override.trim() !== topic) throw new Error(`This note fixes its topic to “${override}”. Choose that topic or create the card in a new note.`);
        const next = source + (source.endsWith(eol + eol) ? '' : source.endsWith(eol) ? eol : eol + eol) + `# ${topic}${eol}${eol}` + serializeCard(id, draft.front, draft.back, eol);
        const created = parseCards(next, file!.path).cards.find(c => c.id === id);
        if (!created || created.deck !== deck || created.topic !== topic) throw new Error('This note changed or has an unfinished Markdown block. Fix its source or choose a new note before adding a card.');
        return next;
      });
    } else {
      // A selection moved to a different deck stays beside its source so relative attachments retain their meaning.
      const folder = safeFolder(draft.sourceFile ? draft.sourceFile.split('/').slice(0, -1).join('/') : draft.folder);
      let built = '';
      for (const part of folder.split('/').filter(Boolean)) { built = built ? `${built}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(built)) await this.app.vault.createFolder(built); }
      const slug = deck.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/^\.+/, '').trim().slice(0, 80) || 'Cards';
      const base = [folder, slug].filter(Boolean).join('/');
      let path = base + '.md', n = 2;
      while (this.app.vault.getAbstractFileByPath(path)) path = `${base} ${n++}.md`;
      file = await this.app.vault.create(path, `---\nqard-deck: ${JSON.stringify(deck)}\n---\n\n# ${topic}\n\n${serializeCard(id, draft.front, draft.back)}`);
    }
    await this.index.refresh(file);
    const card = this.index.getSnapshot().cards.find(c => c.id === id);
    if (!card) throw new Error('The note was saved but could not be indexed. Check its frontmatter and callout syntax.');
    return card;
  }
}
