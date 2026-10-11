import { expect, it } from 'vitest';
import { guessColumns, mapRows, readDelimited, writeDelimited } from '../src/migration/tabular';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { clozeFront, FORMAT_BACK, occlusionFront } from '../src/cards/card-format';
import { sample, transferFixture } from './transfer-fixture';
import { journalPath } from '../src/migration/transfer-service';

it('reads escaped quotes, UTF-8 BOM, CRLF and multiline CSV/TSV fields', () => {
  expect(
    readDelimited('\uFEFFQuestion,Answer\r\n"Which, one?","Line 1\r\n""quoted"""\r\n', ','),
  ).toEqual([
    ['Question', 'Answer'],
    ['Which, one?', 'Line 1\n"quoted"'],
  ]);
  expect(readDelimited('A\tB\n"a\tb"\t"c\nd"\n', '\t')).toEqual([
    ['A', 'B'],
    ['a\tb', 'c\nd'],
  ]);
  expect(() => readDelimited('A,"unfinished', ',')).toThrow('unfinished');
  expect(() => readDelimited('"A"garbage,B', ',')).toThrow('closing quote');
});
it('recognizes column names or maps headerless files, defaults, tags and invalid rows', () => {
  const rows = readDelimited(
    'Back,Front,Deck,Topic,Tags\nA,Q,Bio,Cells,one two\nOnly answer,,,,\n',
    ',',
  );
  const { header, columns } = guessColumns(rows[0]!);
  const input = mapRows(rows, columns, header, 'Imported', 'General');
  expect(input.cards[0]).toMatchObject({
    front: 'Q',
    back: 'A',
    deck: 'Bio',
    topic: 'Cells',
    tags: ['one', 'two'],
  });
  expect(input.issues[0]?.row).toBe(3);
  const plain = guessColumns(['Q', 'A']);
  expect(plain.header).toBe(false);
  expect(mapRows([['Q', 'A']], plain.columns, false, 'Default', 'Topic').cards[0]?.deck).toBe(
    'Default',
  );
  expect(() => mapRows(rows, { ...columns, back: columns.front }, true, '', '')).toThrow(
    'different columns',
  );
});
it('round-trips basic, cloze and image cards with Markdown, math, quotes, tags and sibling groups', () => {
  const fronts = [
    'Which "matrix"?\n```js\n1 + 1\n```',
    clozeFront('{{c1::TCP}} is reliable.', 1),
    occlusionFront('What is masked?', {
      image: 'diagram.png',
      masks: [{ id: 'a', x: 0, y: 0, width: 0.1, height: 0.1 }],
    }),
  ];
  const source =
    '---\nqard-deck: "Networks"\ntags: [tag]\n---\n# Topic\n' +
    fronts
      .map((front, i) =>
        serializeCard(
          `id-${i}`,
          front,
          i ? FORMAT_BACK : '$A$, first\n\n| X | Y |\n| - | - |\n| 1 | 2 |',
          '\n',
          'siblings',
        ),
      )
      .join('\n');
  const cards = parseCards(source, 'original.md').cards;
  for (const delimiter of [',', '\t'] as const) {
    const rows = readDelimited(writeDelimited(cards, delimiter), delimiter),
      guess = guessColumns(rows[0]!);
    const input = mapRows(rows, guess.columns, guess.header, '', '');
    expect(input.issues).toEqual([]);
    expect(input.cards.map((c) => [c.front, c.back, c.deck, c.topic, c.tags, c.group])).toEqual(
      cards.map((c) => [c.frontMarkdown, c.backMarkdown, c.deck, c.topic, c.tags, c.siblingGroup]),
    );
  }
});
it('previews without writes and imports into new notes, preserving metadata and existing notes', async () => {
  const f = transferFixture();
  await f.create('Existing.md', '# Notes\nKeep this.');
  const plan = await f.service.prepare(sample, 'Qard', 'cards.csv');
  expect(f.create).toHaveBeenCalledOnce();
  const result = await f.service.apply(plan);
  expect(result.cards).toBe(1);
  expect(f.index.getSnapshot().cards[0]).toMatchObject({
    deck: 'Networks',
    topic: 'Transport',
    tags: ['networking'],
  });
  expect(f.texts['Existing.md']).toBe('# Notes\nKeep this.');
  expect(f.reviews.getSnapshot().history).toEqual([]);
  expect(await f.service.pending()).toEqual([]);
});
it('skips duplicates in the file and vault but allows an explicit duplicate import', async () => {
  const f = transferFixture();
  await f.service.apply(await f.service.prepare(sample, 'Qard', 'first.csv'));
  const duplicate = await f.service.prepare(
    { ...sample, cards: [...sample.cards, ...sample.cards] },
    'Qard',
    'second.csv',
  );
  expect(duplicate.cards).toHaveLength(0);
  expect(duplicate.duplicates).toBe(2);
  const allow = await f.service.prepare(sample, 'Qard', 'second.csv', false);
  await f.service.apply(allow);
  expect(f.index.getSnapshot().cards).toHaveLength(2);
});
it('refuses a stale preview rather than creating a duplicate added in another window', async () => {
  const f = transferFixture(),
    plan = await f.service.prepare(sample, 'Qard', 'first.csv');
  await f.service.apply(await f.service.prepare(sample, 'Qard', 'other.csv'));
  await expect(f.service.apply(plan)).rejects.toThrow('Refresh the preview');
});
it('resumes after a note write or metadata failure, with stable IDs and no duplicate histories', async () => {
  const f = transferFixture(),
    input = {
      ...sample,
      cards: [
        {
          ...sample.cards[0]!,
          state: {
            interval: 10,
            ease: 2.5,
            reviewCount: 1,
            lapses: 0,
            due: 2000000000000,
            lastReviewed: 1900000000000,
          },
          history: [{ at: 1900000000000, rating: 3 as const, scheduled: true }],
        },
      ],
    };
  const plan = await f.service.prepare(input, 'Qard', 'anki.apkg');
  f.refresh.mockRejectedValueOnce(new Error('Index failed'));
  await expect(f.service.apply(plan)).rejects.toThrow('Index failed');
  const restarted = f.makeService(),
    [pending] = await restarted.pending();
  f.persist.mockRejectedValueOnce(new Error('Metadata failed'));
  await expect(restarted.apply(pending!)).rejects.toThrow('Metadata failed');
  await restarted.apply(pending!);
  expect(f.index.getSnapshot().cards).toHaveLength(1);
  expect(f.reviews.getSnapshot().history).toHaveLength(1);
  expect(f.reviews.getSnapshot().states[plan.cards[0]!.id]?.due).toBe(2000000000000);
  expect(f.reviews.getSnapshot().statistics.cards[plan.cards[0]!.id]).toEqual([0, 0, 1, 0]);
  await restarted.apply(pending!);
  expect(f.reviews.getSnapshot().history).toHaveLength(1);
});
it('never overwrites edited imported notes on a retry and blocks hidden/parent destinations', async () => {
  const f = transferFixture(),
    plan = await f.service.prepare(sample, 'Qard', 'first.csv');
  f.persist.mockRejectedValueOnce(new Error('Save failed'));
  // A schedule triggers metadata persistence.
  plan.cards[0]!.state = { interval: 1, ease: 2.5, reviewCount: 1, lapses: 0 };
  await expect(f.service.apply(plan)).rejects.toThrow('Save failed');
  const path = f.index.getSnapshot().cards[0]!.sourceFile;
  f.texts[path] += '\nMy edits.';
  await expect(f.service.apply(plan)).rejects.toThrow('file changed');
  expect(f.texts[path]).toContain('My edits.');
  await expect(f.service.prepare(sample, '../outside', 'file.csv')).rejects.toThrow(
    'normal vault folder',
  );
  await expect(f.service.export('.obsidian', ',')).rejects.toThrow('normal vault folder');
  expect(JSON.parse(f.texts[journalPath(plan)]!).complete).not.toBe(true);
});
it('exports a selected deck into a fresh file and starts imported cards as new when requested', async () => {
  const f = transferFixture(),
    input = {
      ...sample,
      cards: [
        {
          ...sample.cards[0]!,
          state: { interval: 4, ease: 2.5, reviewCount: 5, lapses: 1, paused: true },
        },
      ],
    };
  const plan = await f.service.prepare(input, 'Qard', 'anki.apkg', true, false);
  await f.service.apply(plan);
  expect(f.reviews.getSnapshot().states[plan.cards[0]!.id]).toBeUndefined();
  const a = await f.service.export('Exports', '\t', 'Networks'),
    b = await f.service.export('Exports', '\t', 'Networks');
  expect(a.path).not.toBe(b.path);
  expect(readDelimited(f.texts[a.path]!, '\t')[1]?.slice(0, 4)).toEqual([
    'TCP?',
    '**Reliable**, ordered.',
    'Networks',
    'Transport',
  ]);
});
