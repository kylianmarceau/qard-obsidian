/**
 * The per-course mastery file: a Markdown note with one table row per objective.
 * The student may edit it freely, so parsing is tolerant and writing keeps everything outside the table,
 * any extra columns, and the column order.
 */
import type { Confidence } from '../tests/test-types';

export type MasteryState =
  | 'planned'
  | 'new'
  | 'gap'
  | 'misconception'
  | 'taught'
  | 'shaky'
  | 'right once'
  | 'mastered'
  | 'slipping';
export const STATES: MasteryState[] = [
  'planned',
  'new',
  'gap',
  'misconception',
  'taught',
  'shaky',
  'right once',
  'mastered',
  'slipping',
];
/** States that need teaching rather than checking. */
export const NEEDS_LESSON: MasteryState[] = ['new', 'gap', 'misconception'];
/** needs: ids of prerequisite objectives, the edges of the course map. group: its topic on the map. label: a short name for the map. */
export interface Objective {
  id: string;
  title: string;
  label?: string;
  group?: string;
  state: MasteryState;
  due?: string;
  notes: string[];
  needs: string[];
  evidence: string[];
  cells: Record<string, string>;
}
/** mapped: when the Writer last read the course notes (YYYY-MM-DDTHH:MM), to spot notes added since. */
export interface Mastery {
  path: string;
  course: string;
  mapped?: string;
  objectives: Objective[];
}

const COLUMNS = [
  'Objective',
  'Label',
  'ID',
  'Group',
  'State',
  'Due',
  'Needs',
  'Notes',
  'Evidence',
] as const;
const KEEP_EVIDENCE = 6;
export const PASS = 0.7;

// ---- dates -------------------------------------------------------------
export const isoDay = (t: number | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(y!, m! - 1, d! + n));
};
const daysBetween = (a: string, b: string) => {
  const [ya, ma, da] = a.split('-').map(Number),
    [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb!, mb! - 1, db) - Date.UTC(ya!, ma! - 1, da)) / 86_400_000);
};
export const slugId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'objective';

// ---- table parsing -----------------------------------------------------
/** Splits a table row on pipes that are not escaped (wikilink aliases inside tables are written [[a\|b]]). */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (inner[i] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += inner[i];
  }
  cells.push(current.trim());
  return cells;
}
const escapeCell = (text: string) => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

interface TableBlock {
  start: number;
  end: number;
  header: string[];
}
function findTable(lines: string[]): TableBlock | undefined {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isRow(lines[i]!) || !isDivider(lines[i + 1]!)) {
      continue;
    }
    const header = cellsOf(lines[i]!),
      lower = header.map((h) => h.toLowerCase());
    if (!lower.includes('id') || !lower.includes('state')) {
      continue;
    }
    let end = i + 2;
    while (end < lines.length && isRow(lines[end]!)) {
      end++;
    }
    return { start: i, end, header };
  }
  return undefined;
}
const column = (header: string[], name: string) =>
  header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
const splitList = (text: string, pattern: RegExp) =>
  text
    .split(pattern)
    .map((x) => x.trim())
    .filter(Boolean);
/** "[[Topic Models]], [[Dirichlet]]" → ["Topic Models", "Dirichlet"]; plain paths are kept as written. */
export function noteLinks(cell: string): string[] {
  const links = [...cell.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) =>
    m[1]!.trim(),
  );
  return links.length ? links : splitList(cell, /,/);
}
function frontmatterValue(text: string, key: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  const value =
    fm &&
    new RegExp(`^${key}:\\s*(.*)$`, 'm')
      .exec(fm)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
  return value || undefined;
}
/** Sets or adds one frontmatter key, leaving the rest of the note alone. */
export function setFrontmatter(text: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n',
    m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) {
    return `---${eol}${key}: ${value}${eol}---${eol}${eol}${text}`;
  }
  const lines = m[1]!.split(/\r?\n/),
    at = lines.findIndex((l) => l.startsWith(key + ':'));
  if (at >= 0) {
    lines[at] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  return `---${eol}${lines.join(eol)}${eol}---` + text.slice(m[0].length);
}
function frontmatterCourse(text: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  const value =
    fm &&
    /^qard-mastery:\s*(.*)$/m
      .exec(fm)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
  return value || undefined;
}
export const isMasteryText = (text: string) => frontmatterCourse(text) !== undefined;

export function parseMastery(path: string, text: string): Mastery {
  const course =
    frontmatterCourse(text) ??
    path
      .split('/')
      .pop()!
      .replace(/\.md$/, '')
      .replace(/\s*mastery$/i, '');
  const mappedValue = frontmatterValue(text, 'qard-mapped'),
    mapped =
      mappedValue && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(mappedValue)
        ? mappedValue
        : undefined;
  const lines = text.split(/\r?\n/),
    table = findTable(lines);
  if (!table) {
    return { path, course, mapped, objectives: [] };
  }
  const at = (name: string) => column(table.header, name),
    seen = new Set<string>();
  const objectives: Objective[] = [];
  for (const line of lines.slice(table.start + 2, table.end)) {
    const cells = cellsOf(line),
      get = (name: string) => {
        const i = at(name);
        return i >= 0 ? (cells[i] ?? '') : '';
      };
    const title = get('Objective'),
      id = get('ID').replace(/`/g, '') || slugId(title);
    if ((!title && !get('ID')) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const rawState = get('State').toLowerCase().replace(/[-_]/g, ' ').trim();
    const state =
      STATES.find((s) => s === rawState) ??
      (rawState === 'right-once'
        ? 'right once'
        : rawState === 'not covered' || rawState === 'not covered yet'
          ? 'planned'
          : 'new');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(get('Due')) ? get('Due') : undefined;
    objectives.push({
      id,
      title: title || id,
      label: get('Label') || undefined,
      group: get('Group') || undefined,
      state,
      due,
      notes: noteLinks(get('Notes')),
      needs: splitList(get('Needs').replace(/`/g, ''), /[,\s]+/),
      evidence: splitList(get('Evidence'), /;\s*/),
      cells: Object.fromEntries(table.header.map((h, i) => [h, cells[i] ?? ''])),
    });
  }
  // Unknown prerequisites (a deleted or mistyped id) are ignored rather than breaking the map.
  const ids = new Set(objectives.map((o) => o.id));
  for (const o of objectives) {
    o.needs = o.needs.filter((n) => ids.has(n) && n !== o.id);
  }
  return { path, course, mapped, objectives };
}

const notesCell = (notes: string[]) => notes.map((n) => `[[${n.replace(/\.md$/, '')}]]`).join(', ');
function rowFor(header: string[], o: Objective): string {
  const known: Record<string, string> = {
    objective: o.title,
    label: o.label ?? '',
    id: o.id,
    group: o.group ?? '',
    state: o.state,
    due: o.due ?? '',
    needs: o.needs.join(', '),
    notes: notesCell(o.notes),
    evidence: o.evidence.join('; '),
  };
  return (
    '| ' +
    header.map((h) => escapeCell(known[h.toLowerCase()] ?? o.cells[h] ?? '')).join(' | ') +
    ' |'
  );
}
function tableFor(header: string[], objectives: Objective[]) {
  return [
    '| ' + header.join(' | ') + ' |',
    '| ' + header.map(() => '---').join(' | ') + ' |',
    ...objectives.map((o) => rowFor(header, o)),
  ];
}
/** Replaces only the objectives table, keeping the rest of the note and any columns the student added. */
export function writeObjectives(text: string, objectives: Objective[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n',
    lines = text.split(/\r?\n/),
    table = findTable(lines);
  if (!table) {
    return (
      text.replace(/\s*$/, '') + eol + eol + tableFor([...COLUMNS], objectives).join(eol) + eol
    );
  }
  const header = [...table.header];
  for (const name of COLUMNS) {
    if (column(header, name) < 0) {
      header.push(name);
    }
  }
  return [
    ...lines.slice(0, table.start),
    ...tableFor(header, objectives),
    ...lines.slice(table.end),
  ].join(eol);
}
export function newMasteryNote(course: string, objectives: Objective[], mapped?: string): string {
  return `---\nqard-mastery: ${JSON.stringify(course)}\n${mapped ? `qard-mapped: ${mapped}\n` : ''}---\n\n# ${course} mastery\n\nQard reads this table before writing lessons, checks and tests, and adds evidence after each one. Edit anything: change a state or due date, add or remove objectives, or add your own columns.\n\nStates: new → gap or misconception (needs teaching) → taught → right once → mastered. Shaky means right but unsure; slipping means a mastered objective whose cards are lapsing; planned means the course outline lists it but no notes cover it yet. Needs lists the objectives that come first, which draws the course map; Group names the topic it is drawn in, and Label is its short name on the map.\n\n${tableFor([...COLUMNS], objectives).join('\n')}\n`;
}

// ---- evidence and state ------------------------------------------------
export type EvidenceKind = 'probe' | 'lesson' | 'check' | 'test' | 'card';
export interface Evidence {
  kind: EvidenceKind;
  day: string;
  label?: string;
  score?: number;
  marks?: number;
  confidence?: Confidence | 'unknown';
}
export function evidenceText(e: Evidence) {
  const score = e.marks !== undefined ? ` ${Math.round((e.score ?? 0) * 10) / 10}/${e.marks}` : '';
  return `${e.day} ${e.kind}${e.label ? ` ${e.label}` : ''}${score}${e.confidence ? ` ${e.confidence === 'unknown' ? "didn't know" : e.confidence}` : ''}`
    .replace(/\s+/g, ' ')
    .trim();
}
/** The day of the most recent passing check, test or probe, read back from the evidence column. */
function lastPass(evidence: string[]): string | undefined {
  for (const entry of [...evidence].reverse()) {
    const m = /^(\d{4}-\d{2}-\d{2}) (probe|check|test)\b.*?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/.exec(
      entry,
    );
    if (m && Number(m[4]) > 0 && Number(m[3]) / Number(m[4]) >= PASS) {
      return m[1];
    }
  }
  return undefined;
}

/**
 * The learning rules, in one place:
 * - Correct answers straight after teaching do not count: a lesson moves an objective to taught, never further.
 * - Mastery needs two passes at least two days apart (the second in a harder form).
 * - Confidence changes the state: wrong while sure is a misconception; right while guessing is shaky.
 * - Card reviews never promote an objective; lapsing cards only mark a mastered one as slipping.
 */
export function applyEvidence(o: Objective, e: Evidence): Objective {
  const evidence = [...o.evidence, evidenceText(e)].slice(-KEEP_EVIDENCE),
    day = e.day;
  const next = (state: MasteryState, due: string | undefined): Objective => ({
    ...o,
    state,
    due,
    evidence,
  });
  if (e.kind === 'card') {
    return o.state === 'mastered' ? next('slipping', day) : { ...o, evidence };
  }
  if (e.kind === 'lesson') {
    return ['right once', 'mastered'].includes(o.state)
      ? { ...o, evidence }
      : next('taught', addDays(day, 3));
  }
  if (e.confidence === 'unknown') {
    return next(o.state === 'mastered' ? 'slipping' : 'gap', day);
  }
  const ratio = e.marks ? (e.score ?? 0) / e.marks : 0;
  if (ratio >= PASS) {
    if (o.state === 'mastered') {
      return next('mastered', addDays(day, 45));
    }
    if (e.confidence === 'guess') {
      return next('shaky', addDays(day, 3));
    }
    if (o.state === 'right once') {
      const previous = lastPass(o.evidence);
      return previous && daysBetween(previous, day) >= 2
        ? next('mastered', addDays(day, 45))
        : { ...o, evidence };
    }
    return next('right once', addDays(day, 7));
  }
  if (o.state === 'mastered' || o.state === 'slipping') {
    return next('slipping', day);
  }
  if (e.confidence === 'sure') {
    return next('misconception', day);
  }
  return ratio >= 0.4 ? next('shaky', addDays(day, 2)) : next('gap', day);
}

export const isDue = (o: Objective, today: string) =>
  o.state !== 'new' && o.state !== 'planned' && !!o.due && o.due <= today;
/** Harder goals as the objective improves, so the second pass is never the same question reworded. */
export function goalFor(state: MasteryState): 'recognise' | 'recall' | 'explain' | 'apply' {
  if (state === 'right once' || state === 'mastered') {
    return 'apply';
  }
  if (state === 'taught' || state === 'shaky' || state === 'misconception') {
    return 'explain';
  }
  return 'recall';
}
/** One line per objective for prompts. */
export const objectiveLines = (m: Mastery) =>
  m.objectives
    .map(
      (o) =>
        `${o.id} | ${o.title} | ${o.state}${o.due ? ` (due ${o.due})` : ''} | needs: ${o.needs.join(', ') || '-'} | ${o.evidence.slice(-3).join('; ') || 'no evidence'}`,
    )
    .join('\n');

/** At least taught: good enough to build the next objective on. */
const FOUNDATION: MasteryState[] = ['taught', 'shaky', 'right once', 'mastered', 'slipping'];
/** Ready to learn: not yet taught, with every prerequisite already taught or better. The frontier of the course map. */
export function readyToLearn(m: Mastery): Set<string> {
  const byId = new Map(m.objectives.map((o) => [o.id, o]));
  return new Set(
    m.objectives
      .filter(
        (o) =>
          ['new', 'gap', 'misconception'].includes(o.state) &&
          o.needs.every((n) => FOUNDATION.includes(byId.get(n)?.state ?? 'new')),
      )
      .map((o) => o.id),
  );
}
export const stamp = (t: number) => {
  const d = new Date(t);
  return `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** The map must be a DAG: walking from the top of the table, drop each prerequisite link that would close a loop. */
export function breakCycles(objectives: Objective[]): Objective[] {
  const byId = new Map(objectives.map((o) => [o.id, o])),
    state = new Map<string, 'visiting' | 'done'>(),
    keep = new Map<string, string[]>();
  const visit = (o: Objective) => {
    state.set(o.id, 'visiting');
    const needs: string[] = [];
    for (const n of o.needs) {
      const target = byId.get(n);
      if (!target || state.get(n) === 'visiting') {
        continue;
      }
      if (!state.has(n)) {
        visit(target);
      }
      needs.push(n);
    }
    keep.set(o.id, needs);
    state.set(o.id, 'done');
  };
  for (const o of objectives) {
    if (!state.has(o.id)) {
      visit(o);
    }
  }
  return objectives.map((o) => ({ ...o, needs: keep.get(o.id) ?? [] }));
}

/** The short name shown on the map: the Label column, or the first few words of the title. */
export function shortLabel(o: Objective, max = 40): string {
  if (o.label?.trim()) {
    return o.label.trim();
  }
  // Titles start with a verb ("Explain the LDA posterior"); the map reads better without it.
  const words = o.title.trim().split(/\s+/),
    verbs =
      /^(explain|describe|list|state|name|compare|contrast|count|use|build|fit|write|choose|compute|derive|define|distinguish|identify|apply|interpret|justify|outline|show|prove|calculate|classify|handle|score|scrape|chain|clean|reshape|parallelise|parallelize|tokenise|tokenize|train|understand|know|recognise|recognize)$/i;
  let out = '';
  for (const w of words.length > 1 && verbs.test(words[0]!) ? words.slice(1) : words) {
    if (out && `${out} ${w}`.length > max) {
      return `${out}…`;
    }
    out = out ? `${out} ${w}` : w;
  }
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}
/** Topics are matched ignoring case and spacing, so a typo in capitalisation doesn't split one. */
export const topicKey = (group?: string) => (group ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
