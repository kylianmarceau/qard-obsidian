import { parseDocument } from 'yaml';
import { parseCards, sourceLines } from '../cards/parser';
import { serializeCard } from '../cards/source-patch';
import { DAY, type ReviewState } from '../review/scheduler';

/** The subset of Spaced Repetition plugin settings that decides what counts as a card. */
export interface SrSettings {
  tags: string[];
  ignoreTags: string[];
  foldersToDecks: boolean;
  singleLine: string;
  singleLineReversed: string;
  multiline: string;
  multilineReversed: string;
  endMarker: string;
  clozeHighlight: boolean;
  clozeBold: boolean;
  clozeCurly: boolean;
}
export const DEFAULT_SR_SETTINGS: SrSettings = {
  tags: ['flashcards'],
  ignoreTags: [],
  foldersToDecks: false,
  singleLine: '::',
  singleLineReversed: ':::',
  multiline: '?',
  multilineReversed: '??',
  endMarker: '',
  clozeHighlight: true,
  clozeBold: false,
  clozeCurly: false,
};
/** Reads the plugin's data.json; unknown or missing values fall back to its defaults. */
export function readSrSettings(raw: unknown): SrSettings {
  const outer = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const s =
    outer.settings && typeof outer.settings === 'object'
      ? (outer.settings as Record<string, unknown>)
      : outer;
  const text = (key: string, fallback: string) => (typeof s[key] === 'string' ? s[key] : fallback);
  const flag = (key: string, fallback: boolean) =>
    typeof s[key] === 'boolean' ? s[key] : fallback;
  const tags = (key: string, fallback: string[]) =>
    Array.isArray(s[key])
      ? (s[key] as unknown[])
          .filter((t): t is string => typeof t === 'string' && !!t.trim())
          .map((t) => t.trim().replace(/^#/, ''))
      : fallback;
  const d = DEFAULT_SR_SETTINGS;
  return {
    tags: tags('flashcardTags', d.tags),
    ignoreTags: tags('flashcardTagsToIgnore', d.ignoreTags),
    foldersToDecks: flag('convertFoldersToDecks', d.foldersToDecks),
    singleLine: text('singleLineCardSeparator', d.singleLine),
    singleLineReversed: text('singleLineReversedCardSeparator', d.singleLineReversed),
    multiline: text('multilineCardSeparator', d.multiline),
    multilineReversed: text('multilineReversedCardSeparator', d.multilineReversed),
    endMarker: text('multilineCardEndMarker', d.endMarker),
    clozeHighlight: flag('convertHighlightsToClozes', d.clozeHighlight),
    clozeBold: flag('convertBoldTextToClozes', d.clozeBold),
    clozeCurly: flag('convertCurlyBracketsToClozes', d.clozeCurly),
  };
}

export interface SrSchedule {
  due: number;
  interval: number;
  ease: number;
}
export interface SrCard {
  reversed: boolean;
  front: string;
  back: string;
  line: number;
  start: number;
  end: number;
  schedules: (SrSchedule | undefined)[];
}
export interface SrSkip {
  line: number;
  reason: string;
}
export interface SrNote {
  path: string;
  deck?: string;
  cards: SrCard[];
  skipped: SrSkip[];
}
export interface SrConversion {
  source: string;
  states: ReviewState[];
  converted: number;
  skipped: SrSkip[];
}

const scheduleComment = /^\s*<!--SR:(.*?)-->\s*$/;
const trailingSchedule = /\s*<!--SR:(.*?)-->\s*$/;
const fenceStart = /^ {0,3}(`{3,}|~{3,})/;
const closesFence = (line: string, fence: string) => {
  const m = line.match(/^ {0,3}(`+|~+)\s*$/);
  return !!m && m[1]![0] === fence[0] && m[1]!.length >= fence.length;
};
const tagPattern = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;

/** `!2026-08-25,3,250` entries; SR stores one per sibling (forward/reverse, or each cloze). */
export function parseSchedules(body: string): (SrSchedule | undefined)[] {
  return body
    .split('!')
    .filter(Boolean)
    .map((entry) => {
      const m = entry.trim().match(/^(\d{4})-(\d{2})-(\d{2}),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
      if (!m) return undefined;
      // SR schedules by calendar day, so the card is due from local midnight.
      const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      return Number.isFinite(due)
        ? { due, interval: Number(m[4]), ease: Number(m[5]) / 100 }
        : undefined;
    });
}
const matchesTag = (tag: string, roots: string[]) =>
  roots.find(
    (root) =>
      tag.toLowerCase() === root.toLowerCase() ||
      tag.toLowerCase().startsWith(root.toLowerCase() + '/'),
  );

/** Mirrors the SR plugin's note detection and card syntax. Returns undefined for notes SR would not treat as flashcards. */
export function scanSrNote(
  source: string,
  path: string,
  settings: SrSettings = DEFAULT_SR_SETTINGS,
): SrNote | undefined {
  const lines = sourceLines(source);
  let start = 0,
    metadata: Record<string, unknown> = {};
  if (lines[0]?.text.replace(/^\uFEFF/, '') === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line.text));
    if (end < 0) return undefined;
    const doc = parseDocument(
      lines
        .slice(1, end)
        .map((l) => l.text)
        .join('\n'),
    );
    const value: unknown = doc.errors.length ? undefined : doc.toJS({ maxAliasCount: 20 });
    if (doc.errors.length)
      return settings.tags.some((tag) => source.includes(tag))
        ? {
            path,
            cards: [],
            skipped: [
              { line: 0, reason: 'Invalid frontmatter. Fix it before importing this note.' },
            ],
          }
        : undefined;
    if (value && typeof value === 'object' && !Array.isArray(value))
      metadata = value as Record<string, unknown>;
    start = end + 1;
  }
  const rawTags = Array.isArray(metadata.tags)
    ? metadata.tags
    : typeof metadata.tags === 'string'
      ? metadata.tags.split(/[,\s]+/)
      : [];
  const tags = rawTags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^#/, ''));

  // Existing Qard callouts are opaque, which also makes a second import a no-op.
  const opaque = new Set<number>();
  for (const card of parseCards(source, path).cards)
    lines.forEach((line, i) => {
      if (line.start >= card.sourcePosition.start && line.start < card.sourcePosition.end)
        opaque.add(i);
    });
  const singles = [
    [settings.singleLineReversed, true],
    [settings.singleLine, false],
  ]
    .filter(([sep]) => sep)
    .sort((a, b) => String(b[0]).length - String(a[0]).length) as [string, boolean][];
  const isTagLine = (text: string) =>
    text
      .trim()
      .split(/\s+/)
      .every((word) => /^#[\p{L}\p{N}_/-]+$/u.test(word));

  const note: SrNote = { path, cards: [], skipped: [] };
  let block: number[] = [],
    separator = -1,
    reversed = false,
    fence = '',
    comment = false;
  let lastCard: { card: SrCard; line: number } | undefined;
  const text = (from: number, to: number) =>
    block
      .slice(from, to)
      .map((i) => lines[i]!.text)
      .join('\n')
      .trim();
  const flush = (): SrCard | undefined => {
    let card: SrCard | undefined;
    if (separator >= 0) {
      let last = block.length,
        schedules: (SrSchedule | undefined)[] = [];
      const markerAt = settings.endMarker
        ? block.findIndex((i, n) => n > separator && lines[i]!.text.trim() === settings.endMarker)
        : -1;
      const tail = lines[block[last - 1]!]!.text.match(scheduleComment);
      if (tail) {
        schedules = parseSchedules(tail[1]!);
        last--;
      }
      const answerEnd = markerAt >= 0 ? markerAt : last;
      const front = text(0, separator);
      let back = text(separator + 1, answerEnd);
      const inline = !tail && back.match(trailingSchedule);
      if (inline) {
        schedules = parseSchedules(inline[1]!);
        back = back.slice(0, inline.index).trim();
      }
      const first = lines[block[0]!]!,
        final = lines[block[block.length - 1]!]!;
      if (front && back)
        note.cards.push(
          (card = {
            reversed,
            front,
            back,
            line: block[0]!,
            start: first.start,
            end: final.start + final.text.length,
            schedules,
          }),
        );
      else
        note.skipped.push({
          line: block[0]!,
          reason: front ? 'Card has no answer.' : 'Card has no question.',
        });
    } else if (block.length) {
      const body = text(0, block.length);
      if (
        (settings.clozeHighlight && /==[^=\n]+==/.test(body)) ||
        (settings.clozeBold && /\*\*[^*\n]+\*\*/.test(body)) ||
        (settings.clozeCurly && /\{\{[^}\n]+\}\}/.test(body))
      )
        note.skipped.push({
          line: block[0]!,
          reason: 'Cloze card. Qard has no cloze cards, so this text is left as it is.',
        });
    }
    block = [];
    separator = -1;
    reversed = false;
    return card;
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!.text,
      trimmed = line.trim();
    if (!fence && !comment) for (const m of line.matchAll(tagPattern)) tags.push(m[1]!);
    if (opaque.has(i)) {
      flush();
      lastCard = undefined;
      continue;
    }
    if (fence) {
      block.push(i);
      if (closesFence(line, fence)) fence = '';
      continue;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    const schedule = line.match(scheduleComment);
    if (schedule) {
      if (separator >= 0) {
        block.push(i);
        flush();
      } else if (lastCard?.line === i - 1) {
        lastCard.card.schedules = parseSchedules(schedule[1]!);
        lastCard.card.end = lines[i]!.start + line.length;
      }
      lastCard = undefined;
      continue;
    }
    lastCard = undefined;
    const open = line.match(fenceStart);
    if (open) {
      fence = open[1]!;
      block.push(i);
      continue;
    }
    if (!trimmed) {
      if (!(settings.endMarker && separator >= 0)) flush();
      else block.push(i);
      continue;
    }
    if (settings.endMarker && separator >= 0 && trimmed === settings.endMarker) {
      block.push(i);
      const card = flush();
      lastCard = card && { card, line: i };
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      flush();
      if (!line.includes('-->')) comment = true;
      continue;
    }
    if (
      /^ {0,3}#{1,6}[ \t]/.test(line) ||
      /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
      isTagLine(line)
    ) {
      flush();
      continue;
    }
    if (separator < 0) {
      if (settings.multilineReversed && trimmed === settings.multilineReversed) {
        separator = block.length;
        reversed = true;
        block.push(i);
        continue;
      }
      if (settings.multiline && trimmed === settings.multiline) {
        separator = block.length;
        reversed = false;
        block.push(i);
        continue;
      }
      const single = singles.find(([sep]) => line.includes(sep));
      if (single) {
        // SR treats the separator line alone as the card; preceding lines are context.
        block = [];
        const [sep, rev] = single,
          at = line.indexOf(sep),
          inline = line.match(trailingSchedule);
        const front = line.slice(0, at).trim(),
          back = (inline ? line.slice(0, inline.index) : line).slice(at + sep.length).trim();
        const card: SrCard = {
          reversed: rev,
          front,
          back,
          line: i,
          start: lines[i]!.start,
          end: lines[i]!.start + line.length,
          schedules: inline ? parseSchedules(inline[1]!) : [],
        };
        if (front && back) {
          note.cards.push(card);
          lastCard = { card, line: i };
        } else
          note.skipped.push({
            line: i,
            reason: front ? 'Card has no answer.' : 'Card has no question.',
          });
        continue;
      }
    }
    block.push(i);
  }
  flush();

  if (tags.some((t) => matchesTag(t, settings.ignoreTags))) return undefined;
  const deckTag = tags.find((t) => matchesTag(t, settings.tags));
  if (!deckTag) return undefined;
  const root = matchesTag(deckTag, settings.tags)!;
  const folder = path.split('/').slice(0, -1).join('/');
  const deck = settings.foldersToDecks ? folder : deckTag.slice(root.length + 1);
  if (deck && typeof metadata['qard-deck'] !== 'string') note.deck = deck;
  return note;
}

/** Rewrites every SR card in place as Qard callouts. Anything that cannot convert is left untouched and reported. */
export function convertSrNote(
  source: string,
  note: SrNote,
  newId: () => string,
  now = Date.now(),
): SrConversion {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const states: ReviewState[] = [],
    skipped = [...note.skipped],
    ids: string[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  for (const card of note.cards) {
    const sides = card.reversed
      ? [
          [card.front, card.back],
          [card.back, card.front],
        ]
      : [[card.front, card.back]];
    try {
      const pending = sides.map(([front, back], n) => {
        const id = newId();
        return { id, text: serializeCard(id, front!, back!, eol), schedule: card.schedules[n] };
      });
      let text = pending
        .map((p) => p.text)
        .join('')
        .slice(0, -eol.length);
      // Keep the callout from absorbing a following paragraph as a lazy continuation.
      const next = source.slice(card.end).replace(/^\r?\n/, '');
      if (
        source.slice(card.end, card.end + 1).match(/[\r\n]/) &&
        next &&
        !/^[ \t]*(\r?\n|$)/.test(next)
      )
        text += eol;
      edits.push({ start: card.start, end: card.end, text });
      for (const p of pending) {
        ids.push(p.id);
        if (p.schedule)
          states.push({
            cardId: p.id,
            due: p.schedule.due,
            interval: p.schedule.interval,
            ease: Math.max(1.3, Math.min(3.2, p.schedule.ease)),
            reviewCount: 1,
            lapses: 0,
            lastReviewed: Math.min(now, p.schedule.due - p.schedule.interval * DAY),
          });
      }
    } catch (e) {
      skipped.push({ line: card.line, reason: (e as Error).message });
    }
  }
  let next = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (note.deck && edits.length) {
    const line = `qard-deck: ${JSON.stringify(note.deck)}`;
    const lines = sourceLines(next);
    if (lines[0]?.text.replace(/^\uFEFF/, '') === '---') {
      const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l.text));
      next = next.slice(0, lines[close]!.start) + line + eol + next.slice(lines[close]!.start);
    } else next = `---${eol}${line}${eol}---${eol}` + next;
  }
  const found = new Set(
    parseCards(next, note.path)
      .cards.filter((c) => c.stable)
      .map((c) => c.id),
  );
  if (!ids.every((id) => found.has(id)))
    throw new Error('The converted note did not index cleanly, so it was not changed.');
  skipped.sort((a, b) => a.line - b.line);
  return { source: next, states, converted: ids.length, skipped };
}
