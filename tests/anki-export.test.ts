// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { TFile } from 'obsidian';
import { buildAnkiPackage } from '../src/migration/anki-export';
import { ankiHtml } from '../src/migration/anki-html';
import { readAnki } from '../src/migration/anki';
import { loadSqlite } from '../src/migration/sqlite';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { clozeFront, FORMAT_BACK, occlusionFront, readCardFormat } from '../src/cards/card-format';
import { reviewWithFsrs } from '../src/review/fsrs-scheduler';
import { DAY, type ReviewEvent, type ReviewState } from '../src/review/scheduler';
import { transferFixture } from './transfer-fixture';

const note = (deck: string, body: string) =>
  `---\nqard-deck: ${JSON.stringify(deck)}\n---\n\n${body}`;
const basic = parseCards(
  note(
    'Networks::Transport',
    '# Reliability\n\n' +
      serializeCard('tcp', 'What does **TCP** provide?', '**Reliable**, ordered delivery.') +
      '\n# General\n\n' +
      serializeCard('udp', 'Is UDP reliable?', 'No.'),
  ),
  'Networks.md',
).cards;
async function tables(bytes: Uint8Array) {
  const archive = unzipSync(bytes),
    sql = await loadSqlite(),
    db = new sql.Database(archive['collection.anki2']!);
  const all = (query: string) => {
    const stmt = db.prepare(query),
      out: Record<string, unknown>[] = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject());
    }
    stmt.free();
    return out;
  };
  const result = {
    archive,
    notes: all('SELECT * FROM notes ORDER BY id'),
    cards: all('SELECT * FROM cards ORDER BY id'),
    revlog: all('SELECT * FROM revlog ORDER BY id'),
    col: all('SELECT * FROM col')[0]!,
  };
  db.close();
  return result;
}

it('converts Obsidian Markdown, math, highlights, links and attachments to Anki HTML', () => {
  const media = (link: string) => (link.includes('missing') ? undefined : link.split('/').pop());
  expect(ankiHtml('**Bold** and `a $x$ b`')).toBe('<strong>Bold</strong> and <code>a $x$ b</code>');
  expect(ankiHtml('Energy $E = mc^2$ costs $5.')).toBe('Energy \\(E = mc^2\\) costs $5.');
  expect(ankiHtml('$$\na < b\n$$')).toBe('\\[a &lt; b\\]');
  expect(ankiHtml('See [[Notes/TCP|the note]] and ==this==')).toBe(
    'See the note and <mark>this</mark>',
  );
  expect(ankiHtml('![[Attachments/net.svg|400]]', media)).toBe('<img src="net.svg" width="400">');
  expect(ankiHtml('![d](../img/a%20b.png) ![[voice.mp3]]', media)).toBe(
    '<img src="a b.png"> [sound:voice.mp3]',
  );
  expect(ankiHtml('![[missing.png]]', media)).toBe('missing.png');
  expect(ankiHtml('One\ntwo <!-- qard-cloze: 1 -->')).toBe('One<br>two');
  expect(ankiHtml('A\n\n- x\n- y')).toContain('<li>x</li>');
});

it('writes a legacy package that Qard reads back with decks, topics as subdecks, and tags', async () => {
  const tagged = basic.map((card) => ({ ...card, tags: ['#net work'] }));
  const result = await buildAnkiPackage({ cards: tagged });
  expect(result).toMatchObject({ cards: 2, notes: 2, skipped: 0, media: 0 });
  const back = await readAnki(result.bytes);
  expect(back.issues).toEqual([]);
  expect(back.cards.map((c) => [c.front, c.back, c.deck, c.tags])).toEqual(
    expect.arrayContaining([
      [
        'What does **TCP** provide?',
        '**Reliable**, ordered delivery.',
        'Networks::Transport::Reliability',
        ['net_work'],
      ],
      ['Is UDP reliable?', 'No.', 'Networks::Transport', ['net_work']],
    ]),
  );
  const { col, notes } = await tables(result.bytes);
  expect(col.ver).toBe(11);
  const decks = Object.values(JSON.parse(String(col.decks)) as Record<string, { name: string }>);
  // Anki needs every ancestor deck to show the nesting.
  expect(decks.map((d) => d.name).sort()).toEqual([
    'Default',
    'Networks',
    'Networks::Transport',
    'Networks::Transport::Reliability',
  ]);
  expect(notes.every((n) => String(n.guid).startsWith('qard-') && Number(n.csum) > 0)).toBe(true);
});

it('keeps the same Anki identities across exports so a second import updates cards', async () => {
  const a = await tables((await buildAnkiPackage({ cards: basic, now: 1_800_000_000_000 })).bytes),
    b = await tables(
      (await buildAnkiPackage({ cards: [...basic].reverse(), now: 1_800_000_500_000 })).bytes,
    );
  expect(b.notes.map((n) => [n.id, n.guid])).toEqual(a.notes.map((n) => [n.id, n.guid]));
  expect(b.cards.map((c) => c.id)).toEqual(a.cards.map((c) => c.id));
  expect(new Set(a.cards.map((c) => c.id)).size).toBe(2);
});

it('exports reverse pairs and cloze variants as single notes with one card per direction or blank', async () => {
  const text = '{{c1::TCP::protocol}} provides {{c2::reliable}} delivery.';
  const cards = parseCards(
    note(
      'Mixed',
      serializeCard('f', 'Capital of France?', 'Paris', '\n', 'pair', undefined, 'r') +
        '\n' +
        serializeCard('r', 'Paris', 'Capital of France?', '\n', 'pair', undefined, 'f') +
        '\n' +
        serializeCard('c1', clozeFront(text, 1), FORMAT_BACK, '\n', 'cz') +
        '\n' +
        serializeCard('c2', clozeFront(text, 2), FORMAT_BACK, '\n', 'cz'),
    ),
    'Mixed.md',
  ).cards;
  expect(cards).toHaveLength(4);
  const result = await buildAnkiPackage({ cards });
  expect(result).toMatchObject({ cards: 4, notes: 2 });
  const { notes, cards: rows } = await tables(result.bytes);
  expect(notes.map((n) => String(n.flds).split('\x1f'))).toEqual(
    expect.arrayContaining([
      ['Capital of France?', 'Paris'],
      [text, ''],
    ]),
  );
  expect(rows.map((c) => c.ord).sort()).toEqual([0, 0, 1, 1]);
  const back = await readAnki(result.bytes);
  expect(back.issues).toEqual([]);
  expect(back.cards.map((c) => c.front)).toEqual(
    expect.arrayContaining(['Capital of France?', 'Paris']),
  );
  const clozes = back.cards.filter((c) => readCardFormat(c.front).kind === 'cloze');
  expect(clozes.map((c) => readCardFormat(c.front))).toMatchObject([
    { kind: 'cloze', target: 1, text },
    { kind: 'cloze', target: 2, text },
  ]);
  expect(clozes[0]!.group).toBe(clozes[1]!.group);
});

it('skips image occlusion and reports it, and refuses an export with nothing portable', async () => {
  const masked = parseCards(
    note(
      'Anatomy',
      serializeCard(
        'io',
        occlusionFront('Name it.', {
          image: 'heart.png',
          masks: [{ id: 'm1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
          target: 'm1',
        }),
        FORMAT_BACK,
      ),
    ),
    'Anatomy.md',
  ).cards;
  const result = await buildAnkiPackage({ cards: [...basic, ...masked] });
  expect(result).toMatchObject({ cards: 2, skipped: 1 });
  await expect(buildAnkiPackage({ cards: masked })).rejects.toThrow('image-occlusion');
});

it('exports schedules, FSRS memory, pauses and rating history only when progress is included', async () => {
  const start = new Date(2026, 0, 5, 10).getTime(),
    now = new Date(2026, 1, 1, 10).getTime();
  const history: ReviewEvent[] = [];
  let tcp: ReviewState | undefined;
  for (const [at, rating] of [
    [start, 3],
    [start + 600_000, 3],
    [start + 3 * DAY, 4],
  ] as const) {
    tcp = reviewWithFsrs('tcp', tcp, rating, at, 0.9);
    history.push({ cardId: 'tcp', at, rating, scheduled: true, scheduler: 'fsrs' });
  }
  const learning = reviewWithFsrs('udp', undefined, 1, now - 30_000, 0.9);
  history.push({ cardId: 'udp', at: now - 30_000, rating: 1, scheduled: true, scheduler: 'fsrs' });
  const states = { tcp: tcp!, udp: { ...learning, paused: true } };
  const result = await buildAnkiPackage({ cards: basic, states, history, now });
  const { cards, revlog } = await tables(result.bytes);
  const review = cards.find((c) => c.type === 2)!,
    step = cards.find((c) => c.type === 1)!;
  expect(review).toMatchObject({ queue: 2, reps: 3, lapses: 0 });
  expect(JSON.parse(String(review.data))).toMatchObject({ dr: 0.9 });
  expect(Number(review.ivl)).toBe(Math.max(1, Math.round(tcp!.interval)));
  expect(step).toMatchObject({ queue: -1, due: Math.round(learning.due! / 1000), lapses: 1 });
  expect(revlog.map((r) => [r.ease, r.type])).toEqual([
    [3, 0],
    [3, 1],
    [4, 1],
    [1, 0],
  ]);

  const back = await readAnki(result.bytes);
  const read = back.cards.find((c) => c.front.includes('TCP'))!;
  const due = new Date(tcp!.due! - 4 * 3_600_000);
  due.setHours(0, 0, 0, 0);
  expect(read.state).toMatchObject({ reviewCount: 3, lapses: 0, due: due.getTime() });
  expect(read.history?.map((e) => e.rating)).toEqual([3, 3, 4]);
  expect(back.cards.find((c) => c.front.includes('UDP'))?.state?.paused).toBe(true);

  const shared = await tables((await buildAnkiPackage({ cards: basic, now })).bytes);
  expect(shared.revlog).toEqual([]);
  expect(shared.cards.every((c) => c.type === 0 && c.queue === 0 && c.reps === 0)).toBe(true);
});

it('packs linked attachments once under flat names and limits their total size', async () => {
  const cards = parseCards(
    note(
      'Media',
      serializeCard('a', 'Identify ![[img/net.png]]', '![[other/net.png]] and ![[img/net.png]]'),
    ),
    'Media.md',
  ).cards;
  const files: Record<string, Uint8Array> = {
    'img/net.png': new Uint8Array([1, 2, 3]),
    'other/net.png': new Uint8Array([4]),
  };
  const result = await buildAnkiPackage({
    cards,
    resolveMedia: (link) => (files[link] ? link : undefined),
    readMedia: async (path) => files[path]!,
  });
  expect(result.media).toBe(2);
  const { archive, notes } = await tables(result.bytes);
  const map = JSON.parse(strFromU8(archive.media!)) as Record<string, string>;
  expect(Object.values(map)[0]).toBe('net.png');
  expect(Object.values(map)[1]).toMatch(/^[a-z0-9]+-net\.png$/);
  expect(Array.from(archive['0']!)).toEqual([1, 2, 3]);
  expect(String(notes[0]!.flds)).toContain('<img src="net.png">');
  const back = await readAnki(result.bytes);
  expect(back.media).toHaveLength(2);
  await expect(
    buildAnkiPackage({
      cards,
      resolveMedia: (link) => link,
      readMedia: async () => ({ length: 200 * 1024 * 1024 }) as Uint8Array,
    }),
  ).rejects.toThrow('128 MB');
});

it('saves the package into the chosen vault folder with progress from the review store', async () => {
  const f = transferFixture();
  const path = 'Networks.md',
    file = new (TFile as unknown as new (p: string) => TFile)(path);
  f.texts[path] = note('Networks', serializeCard('tcp', 'TCP?', 'Reliable.'));
  f.files.set(path, file);
  await f.reviews.review('tcp', 3, new Date(2026, 0, 5).getTime());
  const saved = await f.service.exportAnki('Exports', 'Networks');
  expect(saved).toMatchObject({ cards: 1, skipped: 0 });
  expect(saved.path).toMatch(/^Exports\/Networks-\d+-[a-f0-9]{8}\.apkg$/);
  const { cards, revlog } = await tables(new Uint8Array(f.binaries[saved.path]!));
  expect(cards[0]).toMatchObject({ reps: 1 });
  expect(revlog).toHaveLength(1);
  const plain = await f.service.exportAnki('Exports', undefined, false);
  expect((await tables(new Uint8Array(f.binaries[plain.path]!))).revlog).toEqual([]);
  await expect(f.service.exportAnki('Exports', 'Missing')).rejects.toThrow('no cards');
  await expect(f.service.exportAnki('.obsidian')).rejects.toThrow('normal vault folder');
});
