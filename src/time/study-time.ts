/** What you are doing in Qard, for study time. */
export type Activity = 'cards' | 'lessons' | 'checks' | 'tests' | 'planning' | 'browsing';
export const ACTIVITIES: { id: Activity; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'checks', label: 'Checks' },
  { id: 'tests', label: 'Practice tests' },
  { id: 'planning', label: 'Course maps' },
  { id: 'browsing', label: 'Library' },
];
/** course is a course name, or a deck for card reviews (grouped under a course when the report is built). */
export interface StudyContext {
  activity: Activity;
  course?: string;
}
/** Seconds of active study, per day ("2026-10-01") and "activity|course". */
export type StudyLog = Record<string, Record<string, number>>;

/** Time counts while you are using Qard: no input for this long, and the clock pauses (reading a lesson takes a while). */
export const IDLE_MS = 2 * 60_000;
/** A tick never adds more than this, so a sleeping computer or a stalled timer can't add hours. */
const MAX_STEP_MS = 15_000;
const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const studyKey = (c: StudyContext) => `${c.activity}|${c.course ?? ''}`;

/**
 * Counts active time per day, activity and course. Each Qard view sets its context as you move between screens;
 * ticks add the time since the last tick to the focused view's context, while you've been active within IDLE_MS.
 * Counted time is flushed to plugin data now and then, and when Qard closes.
 */
export class StudyClock {
  private contexts = new Map<object, StudyContext>();
  private lastTick?: number;
  private lastInput = -Infinity;
  private pending: StudyLog = {};
  /** focused: the Qard view in front, when Obsidian has focus; undefined otherwise. */
  constructor(
    private now: () => number,
    private focused: () => object | undefined,
    private save: (log: StudyLog) => Promise<void>,
  ) {}
  /** A view's current screen; undefined when it closes. */
  set(view: object, context: StudyContext | undefined) {
    this.tick();
    if (context) {
      this.contexts.set(view, context);
    } else {
      this.contexts.delete(view);
    }
  }
  /** Any keyboard, mouse or scroll input in Obsidian. Pointer moves arrive constantly, so at most once a second. */
  input() {
    if (this.now() - this.lastInput < 1000) {
      return;
    }
    this.tick();
    this.lastInput = this.now();
  }
  tick() {
    const t = this.now(),
      last = this.lastTick;
    this.lastTick = t;
    const view = this.focused(),
      context = view && this.contexts.get(view);
    if (last === undefined || !context) {
      return;
    }
    // Only the part of the interval before you went idle counts.
    const until = Math.min(t, this.lastInput + IDLE_MS),
      seconds = Math.min(until - last, MAX_STEP_MS) / 1000;
    if (seconds <= 0) {
      return;
    }
    const d = day(last),
      k = studyKey(context);
    this.pending[d] = { ...this.pending[d], [k]: (this.pending[d]?.[k] ?? 0) + seconds };
  }
  async flush() {
    this.tick();
    const log = this.pending;
    this.pending = {};
    if (Object.keys(log).length) {
      await this.save(log);
    }
  }
}

/** Adds counted time to the log, keeping a year. */
export function addStudy(log: StudyLog, add: StudyLog, today: string): StudyLog {
  const next: StudyLog = { ...log };
  for (const [d, entries] of Object.entries(add)) {
    const merged = { ...next[d] };
    for (const [k, s] of Object.entries(entries)) {
      merged[k] = Math.round(((merged[k] ?? 0) + s) * 10) / 10;
    }
    next[d] = merged;
  }
  const oldest = day(new Date(`${today}T12:00:00`).getTime() - 365 * 86_400_000);
  for (const d of Object.keys(next)) {
    if (d < oldest) {
      delete next[d];
    }
  }
  return next;
}

/** The course a deck belongs to: a known course its name starts with ("DS346 A1" → "DS346"), or the deck itself. */
export function courseOf(label: string, courses: string[]): string {
  const match = [...courses]
    .sort((a, b) => b.length - a.length)
    .find(
      (c) =>
        label === c ||
        label.startsWith(`${c} `) ||
        label.startsWith(`${c}/`) ||
        label.startsWith(`${c}::`),
    );
  return match ?? label;
}

export interface StudyRow {
  label: string;
  total: number;
  byActivity: Partial<Record<Activity, number>>;
}
export interface StudyReport {
  total: number;
  daily: { day: string; total: number; byActivity: Partial<Record<Activity, number>> }[];
  byActivity: StudyRow[];
  byCourse: StudyRow[];
}
const isActivity = (a: string): a is Activity => ACTIVITIES.some((x) => x.id === a);

/** Totals since a day (inclusive), by day, by activity and by course. Time with no course is "No course". */
export function studyReport(
  log: StudyLog,
  since: string | undefined,
  courses: string[],
): StudyReport {
  const daily = new Map<string, StudyReport['daily'][number]>(),
    activities = new Map<Activity, StudyRow>(),
    byCourse = new Map<string, StudyRow>();
  let total = 0;
  const add = (row: StudyRow, activity: Activity, s: number) => {
    row.total += s;
    row.byActivity[activity] = (row.byActivity[activity] ?? 0) + s;
  };
  for (const [d, entries] of Object.entries(log)) {
    if (since && d < since) {
      continue;
    }
    for (const [k, s] of Object.entries(entries)) {
      const [a = '', course = ''] = k.split('|'),
        activity = isActivity(a) ? a : 'browsing';
      total += s;
      const dayRow = daily.get(d) ?? { day: d, total: 0, byActivity: {} };
      daily.set(d, dayRow);
      dayRow.total += s;
      dayRow.byActivity[activity] = (dayRow.byActivity[activity] ?? 0) + s;
      const aRow = activities.get(activity) ?? {
        label: ACTIVITIES.find((x) => x.id === activity)!.label,
        total: 0,
        byActivity: {},
      };
      activities.set(activity, aRow);
      add(aRow, activity, s);
      const name = course ? courseOf(course, courses) : 'No course';
      const cRow = byCourse.get(name) ?? { label: name, total: 0, byActivity: {} };
      byCourse.set(name, cRow);
      add(cRow, activity, s);
    }
  }
  const sorted = (m: Map<unknown, StudyRow>) => [...m.values()].sort((a, b) => b.total - a.total);
  return {
    total,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byActivity: sorted(activities),
    byCourse: sorted(byCourse),
  };
}

/** 95 → "2 min", 4000 → "1 h 7 min", 20 → "under a minute". */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return seconds > 0 ? 'under a minute' : '0 min';
  }
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
