import { unzipSync } from 'fflate';
import { Decompress } from 'fzstd';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { loadSqlite } from './sqlite';
import { protoFields, protoNumber, protoText } from './protobuf';
import { ankiMarkdown, renderTemplate } from './anki-content';
import { clozeFront, clozeGroups, FORMAT_BACK } from '../cards/card-format';
import { DAY, type Rating } from '../review/scheduler';
import { MAX_CARDS, validateTransferCard } from './tabular';
import type { TransferCard, TransferInput } from './transfer-types';

export const MAX_PACKAGE = 100 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const decoder = new TextDecoder();
export function zstd(bytes: Uint8Array, limit = MAX_EXPANDED) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  const take = (length: number) => {
    if (cursor + length > bytes.length) {
      throw new Error('Incomplete Zstandard frame.');
    }
    const at = cursor;
    cursor += length;
    return at;
  };
  while (cursor < bytes.length) {
    const magic = view.getUint32(take(4), true);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      const length = view.getUint32(take(4), true);
      take(length);
      continue;
    }
    if (magic !== 0xfd2fb528) {
      throw new Error('Invalid Zstandard frame.');
    }
    const descriptor = bytes[take(1)]!;
    const single = !!(descriptor & 32);
    const window = single ? 0 : bytes[take(1)]!;
    const dict = descriptor & 3;
    take(dict === 3 ? 4 : dict);
    const flag = descriptor >>> 6;
    const sizeBytes = flag ? 2 ** flag : single ? 1 : 0;
    const start = take(sizeBytes);
    let declared = flag === 1 ? 256 : 0;
    for (let i = 0; i < sizeBytes; i++) {
      declared += bytes[start + i]! * 2 ** (8 * i);
    }
    const base = 2 ** (10 + (window >>> 3));
    const windowSize = single ? declared : base + (base / 8) * (window & 7);
    if (declared > limit || windowSize > Math.max(limit, 8 * 1024 * 1024)) {
      throw new Error('The expanded Anki package is too large. Export a smaller deck.');
    }
    let last = false;
    while (!last) {
      const block = take(3);
      const header = bytes[block]! + bytes[block + 1]! * 256 + bytes[block + 2]! * 65536;
      last = !!(header & 1);
      const type = (header >>> 1) & 3;
      if (type === 3) {
        throw new Error('Invalid Zstandard block.');
      }
      take(type === 1 ? 1 : header >>> 3);
    }
    if (descriptor & 4) {
      take(4);
    }
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream = new Decompress((chunk) => {
    size += chunk.length;
    if (size > limit) {
      throw new Error('The expanded Anki package is too large. Export a smaller deck.');
    }
    chunks.push(chunk);
  });
  stream.push(bytes, true);
  const output = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}
function rows(db: Database, query: string, params?: SqlValue[]) {
  const stmt = db.prepare(query, params),
    output: Record<string, SqlValue>[] = [];
  try {
    while (stmt.step()) {
      output.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return output;
}
interface Model {
  name: string;
  kind: number;
  stock: number;
  fields: string[];
  templates: { name: string; front: string; back: string }[];
}
function models(db: Database, modern: boolean): Map<number, Model> {
  const result = new Map<number, Model>();
  if (modern) {
    for (const row of rows(db, 'SELECT id, name, config FROM notetypes')) {
      const config = protoFields(row.config as Uint8Array);
      result.set(Number(row.id), {
        name: String(row.name),
        kind: protoNumber(config, 1),
        stock: protoNumber(config, 9),
        fields: rows(db, 'SELECT name FROM fields WHERE ntid = ? ORDER BY ord', [row.id!]).map(
          (f) => String(f.name),
        ),
        templates: rows(db, 'SELECT name, config FROM templates WHERE ntid = ? ORDER BY ord', [
          row.id!,
        ]).map((t) => {
          const fields = protoFields(t.config as Uint8Array);
          return { name: String(t.name), front: protoText(fields, 1), back: protoText(fields, 2) };
        }),
      });
    }
  } else {
    const col = rows(db, 'SELECT models FROM col')[0];
    const parsed = JSON.parse(String(col?.models)) as Record<
      string,
      {
        name: string;
        type: number;
        flds: { name: string; ord: number }[];
        tmpls: { name: string; ord: number; qfmt: string; afmt: string }[];
      }
    >;
    for (const [id, m] of Object.entries(parsed)) {
      result.set(Number(id), {
        name: m.name,
        kind: m.type,
        stock: 0,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: [...m.tmpls]
          .sort((a, b) => a.ord - b.ord)
          .map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt })),
      });
    }
  }
  return result;
}
const safeMediaName = (name: string) =>
  !!name &&
  name.length < 200 &&
  !/[\\/<>:"|?*[\]\r\n\0]/.test(name) &&
  !name.startsWith('.') &&
  /\.(?:png|jpe?g|gif|webp|svg|avif|mp3|wav|ogg|m4a|mp4|webm|pdf)$/i.test(name);

/** Decode package/database metadata only. Anki templates are never executed. */
export async function readAnki(bytes: Uint8Array, sql?: SqlJsStatic): Promise<TransferInput> {
  if (bytes.length > MAX_PACKAGE) {
    throw new Error('Choose an Anki package smaller than 100 MB.');
  }
  let expanded = 0,
    entries = 0;
  const archive = unzipSync(bytes, {
    filter: (entry) => {
      expanded += entry.originalSize;
      entries++;
      if (expanded > MAX_EXPANDED || entries > 20000) {
        throw new Error('The expanded Anki package is too large. Export a smaller deck.');
      }
      return /^(?:collection\.anki(?:2|21|21b)|media|meta|\d+)$/.test(entry.name);
    },
  });
  const version = archive.meta
    ? protoNumber(protoFields(archive.meta), 1)
    : archive['collection.anki21']
      ? 2
      : 1;
  if (![1, 2, 3].includes(version)) {
    throw new Error(
      'This Anki package version is not supported. Export in compatibility mode from Anki.',
    );
  }
  const modern = version === 3,
    filename = modern
      ? 'collection.anki21b'
      : version === 2
        ? 'collection.anki21'
        : 'collection.anki2';
  const raw = archive[filename];
  if (!raw) {
    throw new Error('No Anki collection was found in this package.');
  }
  const collection = modern ? zstd(raw, 128 * 1024 * 1024) : raw;
  const sqlite = sql ?? (await loadSqlite());
  const db = new sqlite.Database(collection);
  try {
    const col = rows(db, 'SELECT crt, ver FROM col')[0];
    if (!col || ![11, 14, 15, 16, 17, 18].includes(Number(col.ver))) {
      throw new Error('Unsupported Anki database version. Export in compatibility mode from Anki.');
    }
    const media: NonNullable<TransferInput['media']> = [],
      paths = new Map<string, string>();
    let mediaMap: { key: string; name: string }[] = [];
    if (archive.media) {
      if (modern) {
        mediaMap = (protoFields(zstd(archive.media, 4 * 1024 * 1024)).get(1) ?? []).map(
          (entry, i) => {
            if (!(entry instanceof Uint8Array)) {
              throw new Error('Invalid Anki media map.');
            }
            return { key: String(i), name: protoText(protoFields(entry), 1) };
          },
        );
      } else {
        mediaMap = Object.entries(
          JSON.parse(decoder.decode(archive.media)) as Record<string, string>,
        ).map(([key, name]) => ({ key, name }));
      }
    }
    let mediaSize = 0;
    for (const { key, name } of mediaMap) {
      if (typeof name !== 'string' || !/^\d+$/.test(key)) {
        throw new Error('Invalid Anki media map.');
      }
      if (!safeMediaName(name)) {
        continue;
      }
      if (paths.has(name)) {
        throw new Error('Duplicate filenames in the Anki media map.');
      }
      const packed = archive[key];
      if (!packed) {
        continue;
      }
      const content = modern ? zstd(packed, 64 * 1024 * 1024) : packed;
      mediaSize += content.length;
      if (mediaSize > 128 * 1024 * 1024) {
        throw new Error('Anki media exceeds 128 MB. Export a smaller deck.');
      }
      paths.set(name, `qard-media/${key}`);
      media.push({ key, name, bytes: content });
    }
    const nts = models(db, Number(col.ver) >= 15);
    const decks =
      Number(col.ver) >= 15
        ? new Map(
            rows(db, 'SELECT id, name FROM decks').map((d) => [
              Number(d.id),
              String(d.name).split('\x1f').join('::'),
            ]),
          )
        : new Map(
            Object.entries(
              JSON.parse(String(rows(db, 'SELECT decks FROM col')[0]?.decks)) as Record<
                string,
                { name: string }
              >,
            ).map(([id, d]) => [Number(id), d.name]),
          );
    const history = new Map<number, NonNullable<TransferCard['history']>>();
    const log = rows(db, 'SELECT cid, id, ease, type FROM revlog ORDER BY id LIMIT 500001');
    if (log.length > 500000) {
      throw new Error('This review history is too large.');
    }
    for (const e of log) {
      const at = Number(e.id),
        rating = Number(e.ease);
      if (
        [1, 2, 3, 4].includes(rating) &&
        Number(e.type) >= 0 &&
        Number(e.type) <= 3 &&
        at > 0 &&
        Number.isFinite(new Date(at).getTime())
      ) {
        const id = Number(e.cid);
        const events = history.get(id) ?? [];
        events.push({ at, rating: rating as Rating, scheduled: true });
        history.set(id, events);
      }
    }
    const cards: TransferCard[] = [],
      issues: TransferInput['issues'] = [];
    const data = rows(
      db,
      'SELECT c.*, n.mid, n.flds, n.tags FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.id LIMIT 10001',
    );
    if (data.length > MAX_CARDS) {
      throw new Error('Import up to 10,000 cards at a time. Export a smaller Anki deck.');
    }
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      try {
        const nt = nts.get(Number(c.mid));
        if (!nt) {
          throw new Error('The note type is missing.');
        }
        if (nt.stock === 6 || /image occlusion/i.test(nt.name)) {
          throw new Error(
            'Anki image-occlusion templates need manual conversion; masks were not imported.',
          );
        }
        const template = nt.templates[nt.kind === 1 ? 0 : Number(c.ord)];
        if (!template) {
          throw new Error('The card template is missing.');
        }
        if (/<script\b|on\w+\s*=|javascript:/i.test(template.front + template.back)) {
          throw new Error('This custom template uses JavaScript and needs manual conversion.');
        }
        const deck = decks.get(Number(c.odid) || Number(c.did)) || 'Imported';
        const fields = Object.fromEntries(
          nt.fields.map((name, n) => [name, String(c.flds).split('\x1f')[n] ?? '']),
        );
        Object.assign(fields, {
          Deck: deck,
          Subdeck: deck.split('::').pop()!,
          Tags: String(c.tags),
          Card: template.name,
          Type: nt.name,
        });
        const question = ankiMarkdown(renderTemplate(template.front, fields, 'front'), paths);
        // Anki's answer divider separates repeated front content from the actual answer.
        const answerHtml = renderTemplate(
          template.back,
          fields,
          'back',
          nt.kind === 1 ? 'omit' : 'keep',
        )
          .split(/<hr\b[^>]*\bid\s*=\s*["']?answer["']?[^>]*>/i)
          .pop()!;
        const target = Number(c.ord) + 1;
        if (nt.kind === 1 && !clozeGroups(question).includes(target)) {
          throw new Error('Unsupported or missing Anki cloze blank.');
        }
        const card: TransferCard = {
          front: nt.kind === 1 ? clozeFront(question, target) : question,
          back: ankiMarkdown(answerHtml, paths) || (nt.kind === 1 ? FORMAT_BACK : ''),
          deck,
          topic: 'General',
          tags: String(c.tags).trim().split(/\s+/).filter(Boolean),
          group: `anki-note-${Number(c.nid)}`,
        };
        const events = history.get(Number(c.id)) ?? [];
        let due: number | undefined;
        const type = Number(c.type),
          rawDue = Number(c.odid) ? Number(c.odue) : Number(c.due);
        if (type > 0 && !(type !== 2 && rawDue >= 1000000000)) {
          const date = new Date(Number(col.crt) * 1000);
          date.setHours(0, 0, 0, 0);
          date.setDate(date.getDate() + rawDue);
          due = date.getTime();
        } else if (type > 0) {
          due = rawDue * 1000;
        }
        const interval = Number(c.ivl) < 0 ? -Number(c.ivl) / 86400 : Number(c.ivl);
        if (due !== undefined && !Number.isFinite(new Date(due).getTime())) {
          throw new Error('The Anki due date is invalid.');
        }
        card.state = {
          interval: Math.max(0, interval),
          ease: Math.max(1.3, Math.min(3.2, Number(c.factor) / 1000 || 2.5)),
          reviewCount: Math.max(0, Number(c.reps)),
          lapses: Math.max(0, Number(c.lapses)),
          ...(due === undefined ? {} : { due }),
          ...(events.length
            ? { lastReviewed: events[events.length - 1]!.at }
            : type === 2 && due
              ? { lastReviewed: due - interval * DAY }
              : {}),
          ...(Number(c.queue) === -1 ? { paused: true } : {}),
        };
        card.history = events;
        if (
          !Number.isFinite(card.state.interval) ||
          !Number.isSafeInteger(card.state.reviewCount) ||
          !Number.isSafeInteger(card.state.lapses)
        ) {
          throw new Error('The Anki schedule is invalid.');
        }
        validateTransferCard(card);
        cards.push(card);
      } catch (e) {
        issues.push({ row: i + 1, message: `Anki card ${Number(c.id)}: ${(e as Error).message}` });
      }
    }
    return { cards, issues, media, packageBytes: bytes };
  } finally {
    db.close();
  }
}
