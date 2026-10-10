import { zipSync, strToU8 } from 'fflate';
import { loadSqlite } from '../src/migration/sqlite';
export const proto = (entries: [number, number | Uint8Array | string][]) => {
  const bytes: number[] = [];
  const integer = (n: number) => {
    while (n > 127) {
      bytes.push((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    bytes.push(n);
  };
  for (const [key, value] of entries) {
    integer(key * 8 + (typeof value === 'number' ? 0 : 2));
    if (typeof value === 'number') integer(value);
    else {
      const data = typeof value === 'string' ? strToU8(value) : value;
      integer(data.length);
      bytes.push(...data);
    }
  }
  return new Uint8Array(bytes);
};
export function rawZstd(bytes: Uint8Array) {
  const out = [0x28, 0xb5, 0x2f, 0xfd, 0xa0];
  const n = bytes.length;
  out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  for (let at = 0; at < Math.max(1, n); at += 65536) {
    const part = bytes.subarray(at, at + 65536),
      header = part.length * 8 + (at + part.length === n ? 1 : 0);
    out.push(header & 255, (header >>> 8) & 255, (header >>> 16) & 255, ...part);
  }
  return new Uint8Array(out);
}
export async function ankiFixture(
  options: {
    modern?: boolean;
    kind?: number;
    templates?: { front: string; back: string }[];
    fields?: string[];
    queue?: number;
    media?: Record<string, Uint8Array>;
    stock?: number;
  } = {},
) {
  const sql = await loadSqlite(),
    db = new sql.Database(),
    kind = options.kind ?? 0;
  const templates = options.templates ?? [
    {
      front: kind ? '{{cloze:Text}}' : '{{Front}}',
      back: kind ? '{{cloze:Text}}<br>{{Back Extra}}' : '{{FrontSide}}<hr id="answer">{{Back}}',
    },
  ];
  const fieldNames = kind ? ['Text', 'Back Extra'] : ['Front', 'Back'];
  const fields =
    options.fields ??
    (kind
      ? ['{{c1::TCP}} provides {{c2::reliable}} delivery.', '<b>Transport protocol.</b>']
      : ['What does <b>TCP</b> provide?', '<b>Reliable</b>, ordered delivery.']);
  db.run(
    'CREATE TABLE col (crt INTEGER, ver INTEGER, models TEXT, decks TEXT); CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, odid INTEGER, odue INTEGER); CREATE TABLE revlog (id INTEGER, cid INTEGER, ease INTEGER, type INTEGER);',
  );
  const model = {
    '1': {
      name: kind ? 'Cloze' : 'Basic',
      type: kind,
      flds: fieldNames.map((name, ord) => ({ name, ord })),
      tmpls: templates.map((t, ord) => ({ name: `Card ${ord}`, ord, qfmt: t.front, afmt: t.back })),
    },
  };
  db.run('INSERT INTO col VALUES (?, ?, ?, ?)', [
    new Date(2025, 0, 1).getTime() / 1000,
    options.modern ? 18 : 11,
    JSON.stringify(model),
    JSON.stringify({ '1': { name: 'Networks::Transport' } }),
  ]);
  db.run('INSERT INTO notes VALUES (1, 1, ?, ?)', [fields.join('\x1f'), ' networking TCP ']);
  const count = kind ? 2 : templates.length;
  for (let ord = 0; ord < count; ord++) {
    const id = 100 + ord;
    db.run('INSERT INTO cards VALUES (?, 1, 1, ?, 2, ?, 500, 10, 2500, 2, 1, 0, 0)', [
      id,
      ord,
      options.queue ?? 2,
    ]);
    db.run('INSERT INTO revlog VALUES (?, ?, 3, 1)', [new Date(2026, 0, 1).getTime() + ord, id]);
    db.run('INSERT INTO revlog VALUES (?, ?, 4, 1)', [new Date(2026, 0, 10).getTime() + ord, id]);
  }
  if (options.modern) {
    db.run(
      'CREATE TABLE notetypes (id INTEGER, name TEXT, config BLOB); CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT); CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, config BLOB); CREATE TABLE decks (id INTEGER, name TEXT);',
    );
    db.run('INSERT INTO notetypes VALUES (1, ?, ?)', [
      kind ? 'Cloze' : 'Basic',
      proto([
        [1, kind],
        [9, options.stock ?? (kind ? 5 : 1)],
      ]),
    ]);
    fieldNames.forEach((name, ord) => db.run('INSERT INTO fields VALUES (1, ?, ?)', [ord, name]));
    templates.forEach((t, ord) =>
      db.run('INSERT INTO templates VALUES (1, ?, ?, ?)', [
        ord,
        `Card ${ord}`,
        proto([
          [1, t.front],
          [2, t.back],
        ]),
      ]),
    );
    db.run('INSERT INTO decks VALUES (1, ?)', ['Networks\x1fTransport']);
  }
  const media = options.media ?? {},
    archive: Record<string, Uint8Array> = {};
  const map: Record<string, string> = {};
  Object.entries(media).forEach(([name, bytes], i) => {
    map[String(i)] = name;
    archive[String(i)] = options.modern ? rawZstd(bytes) : bytes;
  });
  const data = db.export();
  db.close();
  if (options.modern) {
    archive.meta = proto([[1, 3]]);
    archive['collection.anki21b'] = rawZstd(data);
    archive.media = rawZstd(
      proto(
        Object.entries(media).map(([name, bytes]) => [
          1,
          proto([
            [1, name],
            [2, bytes.length],
          ]),
        ]),
      ),
    );
    // Modern packages may contain a legacy placeholder; it must not be mistaken for the real collection.
    archive['collection.anki2'] = strToU8('placeholder');
  } else {
    archive['collection.anki2'] = data;
    archive.media = strToU8(JSON.stringify(map));
  }
  return zipSync(archive);
}
