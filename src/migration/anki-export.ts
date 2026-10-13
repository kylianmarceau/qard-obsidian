import { strToU8, zipSync } from 'fflate';
import type { SqlJsStatic } from 'sql.js';
import { State } from 'ts-fsrs';
import { FORMAT_BACK, readCardFormat } from '../cards/card-format';
import type { QardCard } from '../cards/card-types';
import { validFsrs } from '../review/fsrs-scheduler';
import { DAY, type ReviewEvent, type ReviewState } from '../review/scheduler';
import { ankiHtml, plainText } from './anki-html';
import { loadSqlite } from './sqlite';

export const MAX_EXPORT_MEDIA = 128 * 1024 * 1024;
export interface AnkiExportOptions {
  cards: QardCard[];
  /** Review progress is written only when states are supplied. */
  states?: Record<string, ReviewState>;
  history?: ReviewEvent[];
  desiredRetention?: number;
  /** Vault path of a linked attachment, or undefined when the link is not a vault file. */
  resolveMedia?: (link: string, sourceFile: string) => string | undefined;
  readMedia?: (path: string) => Promise<Uint8Array>;
  now?: number;
}
export interface AnkiExportResult {
  bytes: Uint8Array;
  cards: number;
  notes: number;
  media: number;
  /** Image-occlusion cards have no portable Anki equivalent yet. */
  skipped: number;
}

// Fixed note-type IDs: a second export updates the same note types instead of adding copies.
const BASIC = 1760000000001,
  REVERSED = 1760000000002,
  CLOZE = 1760000000003;
const CSS =
  '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.cloze { font-weight: bold; color: blue; }';
const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`;

/** Deterministic 53-bit hash (cyrb53): the same Qard card always becomes the same Anki ID. */
function hash(text: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** Anki reads IDs as creation timestamps in milliseconds, so they stay within plausible past dates. */
const ankiId = (text: string, seed = 0) => 1_200_000_000_000 + (hash(text, seed) % 500_000_000_000);
const identity = (card: QardCard) =>
  card.stable && !card.duplicateId ? card.id : `${card.sourceFile}\n${card.frontMarkdown}`;
async function checksum(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', strToU8(text).slice().buffer));
  return parseInt(
    Array.from(digest.subarray(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    16,
  );
}
const field = (name: string, ord: number) => ({
  name,
  ord,
  font: 'Arial',
  media: [],
  rtl: false,
  size: 20,
  sticky: false,
});
const template = (name: string, ord: number, qfmt: string, afmt: string) => ({
  name,
  ord,
  qfmt,
  afmt,
  bqfmt: '',
  bafmt: '',
  did: null,
});
function noteTypes(mod: number) {
  const base = {
    css: CSS,
    did: 1,
    latexPre:
      '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    mod,
    sortf: 0,
    tags: [],
    usn: -1,
    vers: [],
  };
  const answer = '{{FrontSide}}<hr id="answer">';
  return {
    [BASIC]: {
      ...base,
      id: BASIC,
      name: 'Qard Basic',
      type: 0,
      flds: [field('Front', 0), field('Back', 1)],
      tmpls: [template('Card 1', 0, '{{Front}}', `${answer}{{Back}}`)],
      req: [[0, 'any', [0]]],
    },
    [REVERSED]: {
      ...base,
      id: REVERSED,
      name: 'Qard Basic (and reversed card)',
      type: 0,
      flds: [field('Front', 0), field('Back', 1)],
      tmpls: [
        template('Card 1', 0, '{{Front}}', `${answer}{{Back}}`),
        template('Card 2', 1, '{{Back}}', `${answer}{{Front}}`),
      ],
      req: [
        [0, 'any', [0]],
        [1, 'any', [1]],
      ],
    },
    [CLOZE]: {
      ...base,
      id: CLOZE,
      name: 'Qard Cloze',
      type: 1,
      flds: [field('Text', 0), field('Back Extra', 1)],
      tmpls: [template('Cloze', 0, '{{cloze:Text}}', '{{cloze:Text}}<br>{{Back Extra}}')],
      req: [[0, 'any', [0]]],
    },
  };
}
const DECK_CONFIG = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    autoplay: true,
    dyn: false,
    maxTaken: 60,
    replayq: true,
    timer: 0,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true,
    },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
  },
};
const COLLECTION_CONFIG = {
  activeDecks: [1],
  addToCur: true,
  collapseTime: 1200,
  curDeck: 1,
  curModel: String(BASIC),
  dueCounts: true,
  estTimes: true,
  newBury: true,
  newSpread: 0,
  nextPos: 1,
  sortBackwards: false,
  sortType: 'noteFld',
  timeLim: 0,
};

interface Note {
  key: string;
  model: number;
  fields: [string, string];
  /** One entry per Anki template or cloze number. */
  cards: { ord: number; card: QardCard }[];
}
/** Reverse pairs and cloze variants are single Anki notes with several cards. */
function groupNotes(cards: QardCard[], html: (text: string, card: QardCard) => string) {
  const notes: Note[] = [],
    byId = new Map(cards.map((card) => [card.id, card])),
    used = new Set<string>(),
    clozes = new Map<string, Note>();
  let skipped = 0;
  for (const card of cards) {
    if (used.has(card.id)) {
      continue;
    }
    used.add(card.id);
    let format: ReturnType<typeof readCardFormat>;
    try {
      format = readCardFormat(card.frontMarkdown);
    } catch {
      skipped++;
      continue;
    }
    if (format.kind === 'occlusion') {
      skipped++;
      continue;
    }
    if (format.kind === 'cloze') {
      const key = JSON.stringify([card.sourceFile, card.deck, card.topic, format.text]);
      let note = clozes.get(key);
      if (!note) {
        note = {
          key: `cloze:${identity(card)}`,
          model: CLOZE,
          fields: [
            html(format.text, card),
            card.backMarkdown.trim() === FORMAT_BACK ? '' : html(card.backMarkdown, card),
          ],
          cards: [],
        };
        clozes.set(key, note);
        notes.push(note);
      }
      if (!note.cards.some((c) => c.ord === format.target - 1)) {
        note.cards.push({ ord: format.target - 1, card });
      }
      continue;
    }
    const fields: [string, string] = [
      html(card.frontMarkdown, card),
      html(card.backMarkdown, card),
    ];
    const partner = card.reverseId ? byId.get(card.reverseId) : undefined;
    if (partner && partner.reverseId === card.id && !used.has(partner.id)) {
      used.add(partner.id);
      notes.push({
        key: `pair:${identity(card)}`,
        model: REVERSED,
        fields,
        cards: [
          { ord: 0, card },
          { ord: 1, card: partner },
        ],
      });
    } else {
      notes.push({ key: identity(card), model: BASIC, fields, cards: [{ ord: 0, card }] });
    }
  }
  return { notes, skipped };
}
/** Anki counts days from the collection's creation day, rolling over at 04:00 local time. */
function dayNumber(at: number, base: number) {
  const day = new Date(at - 4 * 3_600_000);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - base) / DAY);
}
function schedule(
  state: ReviewState | undefined,
  position: number,
  base: number,
  retention: number,
) {
  const fresh = {
    type: 0,
    queue: 0,
    due: position,
    ivl: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    data: '',
  };
  if (!state?.reviewCount || state.due === undefined) {
    return state?.paused ? { ...fresh, queue: -1 } : fresh;
  }
  const memory = validFsrs(state.fsrs) ? state.fsrs : undefined;
  const learning = memory ? memory.state !== State.Review : state.interval < 1;
  const relearning = memory?.state === State.Relearning;
  const result = learning
    ? {
        type: relearning ? 3 : 1,
        queue: 1,
        due: Math.round(state.due / 1000),
        ivl: relearning ? Math.max(1, Math.round(state.interval)) : 0,
        left: 1001,
      }
    : {
        type: 2,
        queue: 2,
        due: dayNumber(state.due, base),
        ivl: Math.max(1, Math.round(state.interval)),
        left: 0,
      };
  return {
    ...result,
    queue: state.paused ? -1 : result.queue,
    // With FSRS, Anki shows difficulty through the ease column; otherwise it is the classic ease factor.
    factor: memory
      ? Math.round(((memory.difficulty - 1) / 9) * 1000 + 100)
      : Math.round(state.ease * 1000),
    reps: state.reviewCount,
    lapses: state.lapses,
    data: memory
      ? JSON.stringify({
          s: Number(memory.stability.toFixed(4)),
          d: Number(memory.difficulty.toFixed(3)),
          dr: retention,
        })
      : '',
  };
}

/** Builds a legacy (schema 11) package, the format every Anki version can import. */
export async function buildAnkiPackage(
  options: AnkiExportOptions,
  sql?: SqlJsStatic,
): Promise<AnkiExportResult> {
  const now = options.now ?? Date.now(),
    seconds = Math.floor(now / 1000),
    retention = options.desiredRetention ?? 0.9;
  const mediaNames = new Map<string, string>(),
    taken = new Set<string>();
  const html = (text: string, card: QardCard) =>
    ankiHtml(text, (link) => {
      const path = options.resolveMedia?.(link, card.sourceFile);
      if (!path) {
        return undefined;
      }
      let name = mediaNames.get(path);
      if (!name) {
        const base = path
          .split('/')
          .pop()!
          .replace(/["[\]]/g, '_');
        name = taken.has(base.toLowerCase()) ? `${hash(path).toString(36)}-${base}` : base;
        taken.add(name.toLowerCase());
        mediaNames.set(path, name);
      }
      return name;
    });
  const { notes, skipped } = groupNotes(options.cards, html);
  if (!notes.length) {
    throw new Error(
      skipped
        ? 'Only image-occlusion cards were selected; they cannot be exported to Anki yet.'
        : 'There are no cards to export.',
    );
  }
  const states = options.states,
    events = new Map<string, ReviewEvent[]>();
  for (const event of states ? (options.history ?? []) : []) {
    events.set(event.cardId, [...(events.get(event.cardId) ?? []), event]);
  }
  const dated = notes.flatMap((n) => n.cards.map((c) => states?.[c.card.id]?.due ?? now));
  const first = new Date(Math.min(now, ...dated) - DAY);
  first.setHours(0, 0, 0, 0);
  const base = first.getTime();

  const decks = new Map<string, number>([['Default', 1]]);
  const deckId = (card: QardCard) => {
    const name = card.topic && card.topic !== 'General' ? `${card.deck}::${card.topic}` : card.deck;
    // Every ancestor must exist for Anki to show the nesting.
    const parts = name
      .split('::')
      .map((s) => s.trim())
      .filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('::');
      if (!decks.has(path)) {
        decks.set(path, ankiId(`deck:${path}`));
      }
    }
    return decks.get(parts.join('::')) ?? 1;
  };

  const sqlite = sql ?? (await loadSqlite());
  const db = new sqlite.Database();
  let cardCount = 0;
  try {
    db.run(SCHEMA);
    const noteIds = new Set<number>(),
      cardIds = new Set<number>(),
      logIds = new Set<number>();
    const unique = (ids: Set<number>, id: number) => {
      while (ids.has(id)) {
        id++;
      }
      ids.add(id);
      return id;
    };
    for (const note of notes) {
      const nid = unique(noteIds, ankiId(note.key, 1));
      const tags = [...new Set(note.cards.flatMap((c) => c.card.tags))]
        .map((tag) => tag.replace(/^#/, '').replace(/\s+/g, '_'))
        .filter(Boolean);
      const sort = plainText(note.fields[0]);
      db.run('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)', [
        nid,
        `qard-${hash(note.key).toString(36)}`,
        note.model,
        seconds,
        tags.length ? ` ${tags.join(' ')} ` : '',
        note.fields.join('\x1f'),
        sort,
        await checksum(sort),
        '',
      ]);
      for (const { ord, card } of note.cards) {
        const cid = unique(cardIds, ankiId(identity(card), 2));
        const s = schedule(states?.[card.id], cardCount, base, retention);
        cardCount++;
        db.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)', [
          cid,
          nid,
          deckId(card),
          ord,
          seconds,
          s.type,
          s.queue,
          s.due,
          s.ivl,
          s.factor,
          s.reps,
          s.lapses,
          s.left,
          s.data,
        ]);
        const log = (events.get(card.id) ?? []).sort((a, b) => a.at - b.at);
        log.forEach((event, i) =>
          db.run('INSERT INTO revlog VALUES (?, ?, -1, ?, 0, 0, 0, 0, ?)', [
            unique(logIds, Math.round(event.at)),
            cid,
            event.rating,
            i ? 1 : 0,
          ]),
        );
      }
    }
    db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      Math.floor(base / 1000) + 4 * 3600,
      now,
      now,
      JSON.stringify(COLLECTION_CONFIG),
      JSON.stringify(noteTypes(seconds)),
      JSON.stringify(
        Object.fromEntries(
          [...decks].map(([name, id]) => [
            id,
            {
              id,
              name,
              mod: seconds,
              usn: -1,
              collapsed: false,
              conf: 1,
              desc: '',
              dyn: 0,
              extendNew: 0,
              extendRev: 50,
              lrnToday: [0, 0],
              newToday: [0, 0],
              revToday: [0, 0],
              timeToday: [0, 0],
            },
          ]),
        ),
      ),
      JSON.stringify(DECK_CONFIG),
      '{}',
    ]);
    const archive: Record<string, Uint8Array> = { 'collection.anki2': db.export() };
    const map: Record<string, string> = {};
    let size = 0,
      index = 0;
    for (const [path, name] of mediaNames) {
      const bytes = await options.readMedia?.(path);
      if (!bytes) {
        continue;
      }
      size += bytes.length;
      if (size > MAX_EXPORT_MEDIA) {
        throw new Error(
          'These cards link more than 128 MB of attachments. Export one deck at a time.',
        );
      }
      map[String(index)] = name;
      archive[String(index++)] = bytes;
    }
    archive.media = strToU8(JSON.stringify(map));
    return {
      bytes: zipSync(archive, { level: 6 }),
      cards: cardCount,
      notes: notes.length,
      media: index,
      skipped,
    };
  } finally {
    db.close();
  }
}
