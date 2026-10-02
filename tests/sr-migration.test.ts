import { describe, it, expect } from 'vitest';
import { parseCards } from '../src/cards/parser';
import { DEFAULT_SR_SETTINGS, convertSrNote, parseSchedules, readSrSettings, scanSrNote } from '../src/migration/sr-parser';
import { ReviewStore } from '../src/review/review-store';
import { DAY } from '../src/review/scheduler';

const ids = () => { let n = 0; return () => `id-${++n}`; };
const convert = (source: string, path = 'a.md', settings = DEFAULT_SR_SETTINGS) => convertSrNote(source, scanSrNote(source, path, settings)!, ids());
const note = (body: string, tag = 'flashcards/cs/hmm') => `---\ntags: [${tag}]\n---\n\n# HMMs\n\n${body}`;

describe('Spaced Repetition migration', () => {
  it('ignores notes without a flashcard tag, and honours ignored tags', () => {
    expect(scanSrNote('Q::A\n', 'a.md')).toBeUndefined();
    expect(scanSrNote('#flashcards\n\nQ::A\n', 'a.md')?.cards).toHaveLength(1);
    expect(scanSrNote('#flashcards #private\n\nQ::A\n', 'a.md', { ...DEFAULT_SR_SETTINGS, ignoreTags: ['private'] })).toBeUndefined();
  });

  it('converts single-line and multiline cards in place, keeping headings and prose', () => {
    const source = note('Intro prose stays.\n\n## Structure\n\nWhat is $A$?::Transition matrix.\n\nName the three problems\n?\n1. Likelihood\n2. Decoding\n\nOutro.\n');
    const result = convert(source);
    expect(result.converted).toBe(2);
    const cards = parseCards(result.source, 'a.md').cards;
    expect(cards.map(c => [c.deck, c.topic, c.frontMarkdown, c.backMarkdown])).toEqual([
      ['cs/hmm', 'Structure', 'What is $A$?', 'Transition matrix.'],
      ['cs/hmm', 'Structure', 'Name the three problems', '1. Likelihood\n2. Decoding']
    ]);
    expect(result.source).toContain('Intro prose stays.\n\n## Structure\n\n<!-- qard-id: id-1 -->\n> [!qard]- What is $A$?\n> Transition matrix.\n\n');
    expect(result.source).toContain('\n\nOutro.\n');
    expect(result.source).not.toMatch(/::|^\?$/m);
  });

  it('keeps multiline questions with images and rich answers', () => {
    const source = note('![[australia.png]]\nWhich country is this?\n?\nAustralia\n\n```py\nx = 1\n\ny = 2\n```\n?\nTwo assignments.\n');
    const cards = parseCards(convert(source).source, 'a.md').cards;
    expect(cards[0]?.frontMarkdown).toBe('![[australia.png]]\nWhich country is this?');
    expect(cards[1]?.frontMarkdown).toBe('```py\nx = 1\n\ny = 2\n```');
  });

  it('carries SR schedules on the next line or the same line', () => {
    const source = note('Q1::A1\n<!--SR:!2026-08-25,3,230-->\n\nQ2::A2 <!--SR:!2026-09-01,10,270-->\n\nQ3\n?\nA3\n<!--SR:!2026-08-26,1,250-->\n');
    const result = convert(source);
    expect(result.source).not.toContain('<!--SR:');
    const due = new Date(2026, 7, 25).getTime();
    expect(result.states[0]).toMatchObject({ cardId: 'id-1', due, interval: 3, ease: 2.3, reviewCount: 1, lastReviewed: due - 3 * DAY });
    expect(result.states.map(s => s.cardId)).toEqual(['id-1', 'id-2', 'id-3']);
    expect(parseCards(result.source, 'a.md').cards.map(c => c.backMarkdown)).toEqual(['A1', 'A2', 'A3']);
  });

  it('splits reversed cards into both directions with their own schedules', () => {
    const result = convert(note('Spatial locality:::Temporal locality\n<!--SR:!2026-08-25,3,230!2026-08-27,5,250-->\n'));
    expect(parseCards(result.source, 'a.md').cards.map(c => [c.frontMarkdown, c.backMarkdown])).toEqual([['Spatial locality', 'Temporal locality'], ['Temporal locality', 'Spatial locality']]);
    expect(result.states.map(s => [s.cardId, s.interval])).toEqual([['id-1', 3], ['id-2', 5]]);
  });

  it('leaves cloze paragraphs, code and existing Qard cards untouched and reports clozes', () => {
    const qard = '<!-- qard-id: keep -->\n> [!qard]- Existing::card?\n> Yes.\n';
    const source = note('The capital is ==Paris==.\n\n```cpp\nstd::vector<int> v;\n```\n\n' + qard);
    const scanned = scanSrNote(source, 'a.md')!;
    expect(scanned.cards).toHaveLength(0);
    expect(scanned.skipped[0]?.reason).toMatch(/cloze/i);
    expect(scanSrNote(convert(note('Q::A\n')).source, 'a.md')?.cards).toHaveLength(0);
  });

  it('adds qard-deck from the SR tag without disturbing other frontmatter', () => {
    const result = convert('---\ncreated: 2026-05-20\ntags: [flashcards/geo/bollards]\n---\n\nQ::A\n');
    expect(result.source.startsWith('---\ncreated: 2026-05-20\ntags: [flashcards/geo/bollards]\nqard-deck: "geo/bollards"\n---\n')).toBe(true);
    expect(convert('#flashcards/geo\n\nQ::A\n').source.startsWith('---\nqard-deck: "geo"\n---\n#flashcards/geo')).toBe(true);
    expect(convert('#flashcards\n\nQ::A\n').source.startsWith('#flashcards')).toBe(true);
    expect(convert('---\nqard-deck: Mine\ntags: [flashcards/x]\n---\nQ::A\n').source).not.toContain('"x"');
  });

  it('separates adjacent cards so a callout never swallows the next line', () => {
    const cards = parseCards(convert(note('Q1::A1\nQ2::A2\nTrailing prose\n')).source, 'a.md').cards;
    expect(cards.map(c => c.backMarkdown)).toEqual(['A1', 'A2']);
  });

  it('preserves CRLF line endings', () => {
    const source = note('Q::A\n\nQ2\n?\nA2\n').replace(/\n/g, '\r\n');
    const result = convert(source);
    expect(result.source.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parseCards(result.source, 'a.md').cards).toHaveLength(2);
  });

  it('skips cards that cannot be represented and keeps their source', () => {
    const source = note('Q::\n\nBad\n?\n```\nunclosed\n');
    const result = convert(source);
    expect(result.converted).toBe(0);
    expect(result.source).toBe(source);
    expect(result.skipped.map(s => s.reason)).toEqual([expect.stringMatching(/no answer/), expect.stringMatching(/fence/)]);
  });

  it('honours custom SR settings and folder decks', () => {
    const settings = readSrSettings({ settings: { flashcardTags: ['#cards'], singleLineCardSeparator: '=>', multilineCardSeparator: '---?', multilineCardEndMarker: '+++', convertFoldersToDecks: true } });
    const result = convert('#cards\n\nQ => A\n\nQ2\n---?\nA2\n\nstill A2\n+++\n<!--SR:!2026-08-25,3,230-->\n', 'Bio/Cells/a.md', settings);
    expect(parseCards(result.source, 'Bio/Cells/a.md').cards.map(c => [c.deck, c.backMarkdown])).toEqual([['Bio/Cells', 'A'], ['Bio/Cells', 'A2\n\nstill A2']]);
    expect(result.states).toHaveLength(1);
    expect(result.source).not.toContain('+++');
  });

  it('parses legacy and malformed schedule entries safely', () => {
    expect(parseSchedules('2021-08-11,4,270')[0]?.interval).toBe(4);
    expect(parseSchedules('!nonsense!2026-01-01,1,250')).toEqual([undefined, expect.objectContaining({ interval: 1 })]);
  });

  it('imports states without overwriting existing Qard history', async () => {
    const store = new ReviewStore(async () => {});
    await store.review('id-1', 3, 1000);
    await store.importStates([{ cardId: 'id-1', interval: 99, ease: 2.5, reviewCount: 1, lapses: 0 }, { cardId: 'id-2', interval: 4, ease: 2.3, reviewCount: 1, lapses: 0 }]);
    expect(store.getSnapshot().states['id-1']?.interval).not.toBe(99);
    expect(store.getSnapshot().states['id-2']?.interval).toBe(4);
  });
});

describe('Spaced Repetition vault import', async () => {
  // The same module Vitest aliases `obsidian` to, typed with its test constructor.
  const { TFile } = await import('./obsidian-mock');
  const { scanVault, importNotes } = await import('../src/migration/sr-importer');
  function vault(files: Record<string, string>, onProcess?: (path: string) => void) {
    const tfiles = Object.keys(files).map(path => new TFile(path));
    const app = { vault: {
      configDir: '.obsidian', adapter: { exists: async () => false },
      getMarkdownFiles: () => tfiles, getAbstractFileByPath: (p: string) => tfiles.find(f => f.path === p) ?? null,
      cachedRead: async (f: InstanceType<typeof TFile>) => files[f.path]!, read: async (f: InstanceType<typeof TFile>) => files[f.path]!,
      process: async (f: InstanceType<typeof TFile>, fn: (s: string) => string) => { onProcess?.(f.path); files[f.path] = fn(files[f.path]!); }
    } };
    return { app: app as never, files, index: { refresh: async () => {} } as never };
  }
  it('flags archived copies and converts only the chosen notes', async () => {
    const card = '---\ntags: [flashcards/ms312]\n---\nQ::A\n<!--SR:!2026-08-25,3,230-->\n';
    const { app, files, index } = vault({ 'Archive/MS312.md': card, 'Notes/MS312.md': card, 'Notes/plain.md': 'Q::A\n' });
    const notes = await scanVault(app, DEFAULT_SR_SETTINGS);
    expect(notes.map(n => [n.path, n.copyOf, n.scheduled])).toEqual([['Archive/MS312.md', undefined, 1], ['Notes/MS312.md', 'Archive/MS312.md', 1]]);
    const reviews = new ReviewStore(async () => {});
    const result = await importNotes(app, index, reviews, ['Notes/MS312.md'], DEFAULT_SR_SETTINGS, true);
    expect(result).toMatchObject({ notes: 1, cards: 1, schedules: 1, failures: [] });
    expect(files['Archive/MS312.md']).toBe(card);
    const [converted] = parseCards(files['Notes/MS312.md']!, 'Notes/MS312.md').cards;
    expect(reviews.getSnapshot().states[converted!.id]?.interval).toBe(3);
  });
  it('refuses to overwrite a note edited during the import', async () => {
    const { app, files, index } = vault({ 'a.md': '#flashcards\n\nQ::A\n' }, path => { files[path] += 'New line\n'; });
    const result = await importNotes(app, index, new ReviewStore(async () => {}), ['a.md'], DEFAULT_SR_SETTINGS, false);
    expect(result.failures[0]?.message).toMatch(/changed/);
    expect(files['a.md']).toBe('#flashcards\n\nQ::A\nNew line\n');
  });
});
