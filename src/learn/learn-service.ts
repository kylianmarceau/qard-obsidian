import type { QardSettings } from '../settings/settings';
import { runValidated, type AgentRole, type AgentRunner } from '../agents/runner';
import { marksSchema, readMarks } from '../tests/test-schema';
import { markChoice, markUnknown, questions as testQuestions, type AnswerState, type Attempt, type Confidence, type PracticeTest, type Question, type QuestionMark } from '../tests/test-types';
import { NEEDS_LESSON, PASS, addDays, applyEvidence, breakCycles, goalFor, isDue, isoDay, newMasteryNote, parseMastery, readyToLearn, setFrontmatter, slugId, stamp, writeObjectives, type Evidence, type Mastery, type MasteryState, type Objective } from './mastery';
import { answerSchema, closeSchema, courseUpdateSchema, mapSchema, objectivesSchema, readCourseUpdate, type ObjectiveReply, probeMapSchema, probeSchema, questionsSchema, readAnswer, readClose, readMap, readObjectives, readProbe, readProbeMap, readQuestions, readStep, readTutorMark, stepSchema, tutorMarkSchema } from './learn-schema';
import { askPrompt, checkPrompt, closePrompt, mapCoursePrompt, updateCoursePrompt, markCheckPrompt, probeMapPrompt, probePrompt, reviseMapPrompt, stepPrompt, tutorMarkPrompt } from './learn-prompts';
import type { CardLink } from '../review/review-store';
import type { CheckRecord, Lesson, LessonSummary, StepState, Today, TodayItem } from './learn-types';

/** Vault access for learning files; the Obsidian adapter is vault-learn-storage.ts. */
export interface LearnStorage {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Atomic read-modify-write of an existing note. */
  process(path: string, fn: (text: string) => string): Promise<void>;
  exists(path: string): boolean;
  /** Files with this extension under a folder, recursively. */
  files(folder: string, extension: string): string[];
  /** Notes whose frontmatter has qard-mastery. */
  masteryFiles(): string[];
  modified(path: string): number | undefined;
  /** Resolves a wikilink target to a vault path. */
  resolve(link: string, from: string): string | undefined;
}
export interface CardLinks { get(cardId: string): CardLink | undefined; set(cardId: string, link: CardLink): Promise<void> }
export type LearnJobKind = 'map-course' | 'check-write' | 'check-mark' | 'probe' | 'map' | 'revise' | 'steps' | 'tutor' | 'ask' | 'close';
export interface LearnJob { kind: LearnJobKind; id: string; error?: string }
export interface CourseProposal { folder: string; course: string; objectives: Objective[] }
export interface CourseUpdate { mastery: string; course: string; notes: string[]; added: Objective[]; extended: { id: string; title: string; notes: string[]; needs: string[]; group?: string; label?: string }[]; outdated: { id: string; title: string; reason: string }[] }
export interface LearnSnapshot { revision: number; jobs: Record<string, LearnJob> }

const LESSONS_PER_DAY = 3;
const SOURCE_BUDGET = 60_000;
const key = (target: string, kind: LearnJobKind, id = '') => `${target}|${kind}|${id}`;
const safeName = (text: string) => text.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Lesson';
/** Scores are recomputed from the awarded rubric points, and extra fields (the tutor's reply) are dropped. */
const scoreQuestion = (q: Question, m: QuestionMark): QuestionMark => ({ awarded: m.awarded, annotations: m.annotations, mistake: m.mistake, feedback: m.feedback, score: Math.min(q.marks, q.rubric.reduce((n, r, i) => n + (m.awarded[i] ? r.marks : 0), 0)) });

/**
 * Sums a set of marked questions into one piece of evidence. A sure answer that was wrong (scored nothing,
 * or the marker called it a misconception) counts as sure, which makes a misconception; a sure but merely
 * incomplete answer does not. A pass that relied on a guess counts as a guess; all "I don't know" is unknown.
 */
export function summarise(items: { q: Question; answer?: AnswerState; mark?: QuestionMark }[]): { score: number; marks: number; confidence?: Confidence | 'unknown' } {
  const score = items.reduce((n, i) => n + (i.mark?.score ?? 0), 0), marks = items.reduce((n, i) => n + i.q.marks, 0);
  const pass = marks > 0 && score / marks >= PASS;
  if (items.length && items.every(i => i.answer?.unknown)) return { score, marks, confidence: 'unknown' };
  if (!pass && items.some(i => i.answer?.confidence === 'sure' && ((i.mark?.score ?? 0) === 0 || i.mark?.mistake === 'misconception'))) return { score, marks, confidence: 'sure' };
  if (!pass) return { score, marks, confidence: items.some(i => i.answer?.confidence === 'guess') ? 'guess' : 'unsure' };
  if (pass && items.some(i => i.answer?.confidence === 'guess')) return { score, marks, confidence: 'guess' };
  const confidences = items.map(i => i.answer?.confidence);
  return { score, marks, confidence: confidences.every(c => c === 'sure') ? 'sure' : confidences.includes('unsure') ? 'unsure' : undefined };
}

export class LearnService {
  private listeners = new Set<() => void>();
  private snapshot: LearnSnapshot = { revision: 0, jobs: {} };
  private checks = new Map<string, CheckRecord>();
  private lessons = new Map<string, Lesson>();
  private proposals = new Map<string, CourseProposal>();
  private updates = new Map<string, CourseUpdate>();
  private writes = new Map<string, Promise<void>>();
  private timers = new Map<string, number>();
  private disposed = false;
  constructor(private storage: LearnStorage, private settings: () => QardSettings, private runner: (role: AgentRole) => AgentRunner, private links: CardLinks, private dueCards: () => number = () => 0, private now = () => Date.now()) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(jobs = this.snapshot.jobs) { this.snapshot = { revision: this.snapshot.revision + 1, jobs }; this.listeners.forEach(l => l()); }
  job(target: string, kind: LearnJobKind, id = '') { return this.snapshot.jobs[key(target, kind, id)]; }
  dismiss(target: string, kind: LearnJobKind, id = '') { const jobs = { ...this.snapshot.jobs }; delete jobs[key(target, kind, id)]; this.publish(jobs); }
  private async track<T>(target: string, kind: LearnJobKind, id: string, work: () => Promise<T>): Promise<T | undefined> {
    const k = key(target, kind, id);
    if (this.snapshot.jobs[k] && !this.snapshot.jobs[k].error) return undefined;
    this.publish({ ...this.snapshot.jobs, [k]: { kind, id } });
    try {
      const result = await work();
      const jobs = { ...this.snapshot.jobs }; delete jobs[k]; if (!this.disposed) this.publish(jobs);
      return result;
    } catch (error) {
      if (!this.disposed) this.publish({ ...this.snapshot.jobs, [k]: { kind, id, error: (error as Error).message || 'Something went wrong.' } });
      return undefined;
    }
  }
  private today() { return isoDay(this.now()); }
  private root() { return this.settings().learn.folder.replace(/\/+$/, ''); }
  private async profile() { const t = this.settings().tests; return t.useProfile ? (await this.storage.read(`${t.folder.replace(/\/+$/, '')}/_profile.md`)) ?? undefined : undefined; }
  private save(path: string, value: unknown) {
    const previous = this.writes.get(path) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.storage.write(path, JSON.stringify(value, null, 2) + '\n'));
    this.writes.set(path, next); return next;
  }
  private later(path: string, value: () => unknown) {
    window.clearTimeout(this.timers.get(path));
    this.timers.set(path, window.setTimeout(() => { this.timers.delete(path); void this.save(path, value()); }, 600));
  }

  // ---- courses -------------------------------------------------------
  async courses(): Promise<Mastery[]> {
    const result: Mastery[] = [];
    for (const path of this.storage.masteryFiles()) { const text = await this.storage.read(path); if (text !== null) result.push(parseMastery(path, text)); }
    return result.sort((a, b) => a.course.localeCompare(b.course));
  }
  async course(path: string): Promise<Mastery> {
    const text = await this.storage.read(path);
    if (text === null) throw new Error('This mastery file no longer exists.');
    return parseMastery(path, text);
  }
  /** The course whose folder holds most of these notes. */
  async courseFor(paths: string[]): Promise<Mastery | undefined> {
    let best: Mastery | undefined, count = 0;
    for (const m of await this.courses()) {
      const folder = m.path.split('/').slice(0, -1).join('/');
      const n = paths.filter(p => !folder || p.startsWith(folder + '/')).length;
      if (n > count) { best = m; count = n; }
    }
    return best;
  }
  proposal(folder: string) { return this.proposals.get(folder); }
  /** Turns the Writer's objectives into rows: clean unique ids, prerequisites remapped to them, no cycles. */
  private toObjectives(replies: ObjectiveReply[], taken: Set<string>): Objective[] {
    const renamed = new Map<string, string>(), day = this.today();
    const rows = replies.map(o => {
      let id = slugId(o.id || o.title); while (taken.has(id)) id += '-2'; taken.add(id); renamed.set(o.id, id);
      const notes = o.notes.map(n => n.replace(/\.md$/, '').split('/').pop()!).filter(Boolean);
      const state: MasteryState = o.state === 'planned' && notes.length ? 'new' : o.state;
      const weak = ['gap', 'misconception', 'shaky'].includes(state);
      return { id, title: o.title, label: o.label.trim() || undefined, group: o.group.trim() || undefined, state, due: weak ? day : undefined, notes, needs: o.needs, evidence: o.evidence.trim() ? [o.evidence.trim()] : [], cells: {} } satisfies Objective;
    });
    return rows.map(o => ({ ...o, needs: [...new Set(o.needs.map(n => renamed.get(n) ?? slugId(n)).filter(n => taken.has(n) && n !== o.id))] }));
  }
  /** The writer proposes objectives for a course folder; nothing is written until the student accepts. */
  mapCourse(folder: string, request = '') {
    const clean = folder.replace(/\/+$/, '');
    return this.track(clean, 'map-course', '', async () => {
      const notes = this.storage.files(clean, 'md');
      const result = await runValidated(this.runner('writer'), { prompt: mapCoursePrompt(clean, notes, request, await this.profile()), schema: objectivesSchema, effort: 'high' }, readObjectives);
      const objectives = breakCycles(this.toObjectives(result.objectives, new Set()));
      this.proposals.set(clean, { folder: clean, course: result.course.trim() || clean.split('/').pop()!, objectives }); this.publish();
    });
  }
  async acceptCourse(folder: string, keep: string[]): Promise<string> {
    const proposal = this.proposals.get(folder);
    if (!proposal) throw new Error('There is no proposal for this folder.');
    const path = `${folder ? folder + '/' : ''}${safeName(proposal.course)} Mastery.md`;
    if (this.storage.exists(path)) throw new Error(`${path} already exists. Open it instead, or delete it first.`);
    const kept = proposal.objectives.filter(o => keep.includes(o.id)).map(o => ({ ...o, needs: o.needs.filter(n => keep.includes(n)) }));
    await this.storage.write(path, newMasteryNote(proposal.course, kept, stamp(this.now())));
    this.proposals.delete(folder); this.publish();
    return path;
  }
  discardProposal(folder: string) { this.proposals.delete(folder); this.updates.delete(folder); this.publish(); }

  // ---- a growing course ---------------------------------------------
  private folderOf(mastery: string) { return mastery.split('/').slice(0, -1).join('/'); }
  /** Course notes created or edited since the course was last mapped. Without a date, nothing counts as changed. */
  changedNotes(m: Mastery): string[] {
    const since = m.mapped ? Date.parse(m.mapped.length === 10 ? `${m.mapped}T23:59` : m.mapped) : NaN;
    if (Number.isNaN(since)) return [];
    const root = this.root() + '/';
    return this.storage.files(this.folderOf(m.path), 'md').filter(p => p !== m.path && !p.startsWith(root) && (this.storage.modified(p) ?? 0) > since + 60_000);
  }
  update(mastery: string) { return this.updates.get(mastery); }
  /** The writer proposes additions from new or changed notes. Existing rows are never renamed or rewritten. */
  updateCourse(mastery: string, request = '') {
    return this.track(mastery, 'map-course', '', async () => {
      const m = await this.course(mastery), changed = this.changedNotes(m);
      const notes = changed.length ? changed : this.storage.files(this.folderOf(mastery), 'md').filter(p => p !== mastery);
      const result = await runValidated(this.runner('writer'), { prompt: updateCoursePrompt(m, notes, request), schema: courseUpdateSchema, effort: 'high' }, readCourseUpdate);
      const existing = new Map(m.objectives.map(o => [o.id, o])), taken = new Set(existing.keys());
      const added = this.toObjectives(result.added, taken);
      const valid = new Set([...existing.keys(), ...added.map(o => o.id)]);
      const extended = result.extended.filter(e => existing.has(e.id)).map(e => {
        const o = existing.get(e.id)!;
        const notesToAdd = e.notes.map(n => n.replace(/\.md$/, '').split('/').pop()!).filter(n => n && !o.notes.includes(n));
        const group = !o.group && e.group.trim() ? e.group.trim() : undefined, label = !o.label && e.label.trim() ? e.label.trim() : undefined;
        return { id: e.id, title: o.title, notes: [...new Set(notesToAdd)], needs: [...new Set(e.needs.filter(n => valid.has(n) && n !== e.id && !o.needs.includes(n)))], group, label };
      }).filter(e => e.notes.length || e.needs.length || e.group || e.label);
      const outdated = result.outdated.filter(x => existing.has(x.id)).map(x => ({ id: x.id, title: existing.get(x.id)!.title, reason: x.reason }));
      this.updates.set(mastery, { mastery, course: m.course, notes, added, extended, outdated }); this.publish();
    });
  }
  /** Applies the ticked parts of an update and records the new mapping time. */
  async acceptUpdate(mastery: string, choice: { added: string[]; extended: string[]; remove: string[] }) {
    const update = this.updates.get(mastery); if (!update) throw new Error('There is no update to apply.');
    const added = update.added.filter(o => choice.added.includes(o.id)), extended = new Map(update.extended.filter(e => choice.extended.includes(e.id)).map(e => [e.id, e]));
    await this.storage.process(mastery, text => {
      const m = parseMastery(mastery, text);
      const rows = m.objectives.filter(o => !choice.remove.includes(o.id)).map(o => {
        const e = extended.get(o.id); if (!e) return o;
        const notes = [...o.notes, ...e.notes];
        return { ...o, notes, needs: [...o.needs, ...e.needs], group: o.group ?? e.group, label: o.label ?? e.label, state: o.state === 'planned' && notes.length ? 'new' as const : o.state };
      });
      const ids = new Set([...rows.map(o => o.id), ...added.map(o => o.id)]);
      const all = breakCycles([...rows, ...added].map(o => ({ ...o, needs: o.needs.filter(n => ids.has(n)) })));
      return setFrontmatter(writeObjectives(text, all), 'qard-mapped', stamp(this.now()));
    });
    this.updates.delete(mastery); this.publish();
  }
  discardUpdate(mastery: string) { this.updates.delete(mastery); this.publish(); }

  // ---- evidence ------------------------------------------------------
  /** Applies evidence to one objective, rewriting only the table, then prepares its next check. */
  async record(mastery: string, objective: string, evidence: Evidence): Promise<Objective | undefined> {
    let updated: Objective | undefined;
    await this.storage.process(mastery, text => {
      const m = parseMastery(mastery, text), o = m.objectives.find(x => x.id === objective);
      if (!o) return text;
      updated = applyEvidence(o, evidence);
      return writeObjectives(text, m.objectives.map(x => x.id === objective ? updated! : x));
    });
    this.publish();
    if (updated && !NEEDS_LESSON.includes(updated.state) && updated.due && updated.due <= addDays(this.today(), 14)) void this.ensureCheck(mastery, objective);
    return updated;
  }
  async setState(mastery: string, objective: string, state: MasteryState, due?: string) {
    await this.storage.process(mastery, text => { const m = parseMastery(mastery, text); return writeObjectives(text, m.objectives.map(o => o.id === objective ? { ...o, state, due } : o)); });
    this.publish();
  }
  /** Test questions tagged with objectives feed the mastery file once the test is marked. */
  async recordTest(test: PracticeTest, attempt: Attempt) {
    if (!test.mastery) return;
    const byObjective = new Map<string, { q: Question; answer?: AnswerState; mark?: QuestionMark }[]>();
    for (const q of testQuestions(test)) if (q.objective && attempt.marks[q.id]) byObjective.set(q.objective, [...(byObjective.get(q.objective) ?? []), { q, answer: attempt.answers[q.id], mark: attempt.marks[q.id] }]);
    const day = this.today();
    for (const [objective, items] of byObjective) await this.record(test.mastery, objective, { kind: 'test', day, label: items.map(i => i.q.id).join('+'), ...summarise(items) });
  }
  async cardLapse(cardId: string) {
    const link = this.links.get(cardId); if (!link) return;
    const lapses = link.lapses + 1;
    if (lapses >= 2) { await this.links.set(cardId, { ...link, lapses: 0 }); await this.record(link.mastery, link.objective, { kind: 'card', day: this.today(), label: 'lapsed twice' }); }
    else await this.links.set(cardId, { ...link, lapses });
  }
  linkCard(cardId: string, mastery: string, objective: string) { return this.links.set(cardId, { mastery, objective, lapses: 0 }); }

  // ---- checks --------------------------------------------------------
  private async loadChecks(): Promise<CheckRecord[]> {
    const paths = this.storage.files(`${this.root()}/Checks`, 'json');
    for (const path of paths) if (!this.checks.has(path)) {
      try { const text = await this.storage.read(path); if (text) this.checks.set(path, JSON.parse(text) as CheckRecord); } catch { /* a broken file is skipped */ }
    }
    return paths.map(p => this.checks.get(p)).filter((c): c is CheckRecord => !!c);
  }
  checkAt(path: string) { return this.checks.get(path); }
  async loadCheck(path: string) {
    if (!this.checks.has(path)) { const text = await this.storage.read(path); if (!text) throw new Error('This check no longer exists.'); this.checks.set(path, JSON.parse(text) as CheckRecord); this.publish(); }
    return this.checks.get(path)!;
  }
  private pathOf(record: CheckRecord) { return [...this.checks.entries()].find(([, c]) => c === record)?.[0]; }
  async pendingCheck(mastery: string, objective: string): Promise<string | undefined> {
    const found = (await this.loadChecks()).filter(c => c.mastery === mastery && c.objective === objective && !c.finishedAt).sort((a, b) => b.createdAt - a.createdAt)[0];
    return found && this.pathOf(found);
  }
  /** A check written before its notes changed is rewritten, as long as nothing has been answered. */
  private stale(record: CheckRecord, o: Objective) {
    if (Object.keys(record.answers).length) return false;
    return o.notes.some(n => { const path = this.storage.resolve(n, record.mastery); const t = path && this.storage.modified(path); return !!t && t > record.createdAt; });
  }
  /** Writes the next check for an objective ahead of time, unless one is already waiting. */
  ensureCheck(mastery: string, objective: string): Promise<string | undefined> {
    return this.track(`${mastery}#${objective}`, 'check-write', '', async () => {
      const m = await this.course(mastery), o = m.objectives.find(x => x.id === objective);
      if (!o) throw new Error(`No objective "${objective}" in ${m.course}.`);
      const existing = await this.pendingCheck(mastery, objective);
      if (existing && !this.stale(this.checks.get(existing)!, o)) return existing;
      const goal = goalFor(o.state), previous = (await this.loadChecks()).filter(c => c.mastery === mastery && c.objective === objective && c.finishedAt);
      const written = await runValidated(this.runner('writer'), { prompt: checkPrompt(m, o, goal, previous), schema: questionsSchema }, readQuestions);
      const record: CheckRecord = { version: 1, createdAt: this.now(), mastery, course: m.course, objective, title: o.title, goal, questions: written.slice(0, 3).map(q => ({ ...q, objective, goal: q.goal ?? goal })), answers: {}, marks: {}, status: 'ready' };
      const path = existing ?? `${this.root()}/Checks/${safeName(m.course)}/${this.today()} ${objective}.json`;
      this.checks.set(path, record); await this.save(path, record); this.publish();
      return path;
    });
  }
  answerCheck(path: string, id: string, patch: Partial<AnswerState>) {
    const record = this.checks.get(path); if (!record || record.finishedAt) return;
    const next = { ...record, answers: { ...record.answers, [id]: { ...record.answers[id], ...patch } } };
    this.checks.set(path, next); this.publish(); this.later(path, () => this.checks.get(path));
  }
  /** Multiple choice and "I don't know" are marked locally; the tutor marks typed answers. */
  submitCheck(path: string) {
    return this.track(path, 'check-mark', '', async () => {
      window.clearTimeout(this.timers.get(path));
      let record = this.checks.get(path); if (!record || record.finishedAt) return;
      const marks: Record<string, QuestionMark> = {};
      for (const q of record.questions) { const a = record.answers[q.id]; if (a?.unknown) marks[q.id] = markUnknown(q); else if (q.type === 'mcq') marks[q.id] = markChoice(q, a); }
      const typed = record.questions.filter(q => !marks[q.id]);
      record = { ...record, marks, status: typed.length ? 'marking' : 'marked' }; this.checks.set(path, record); this.publish();
      try {
        if (typed.length) {
          const result = await runValidated(this.runner('tutor'), { prompt: markCheckPrompt(record, typed.map(q => q.id)), schema: marksSchema, vault: false, effort: 'low' }, v => readMarks(v, typed.map(q => ({ id: q.id, rubric: q.rubric.length }))));
          for (const q of typed) marks[q.id] = scoreQuestion(q, result[q.id]!);
        }
      } catch (error) { record = { ...record, status: 'error', error: (error as Error).message }; this.checks.set(path, record); await this.save(path, record); throw error; }
      record = { ...record, marks, status: 'marked', error: undefined, finishedAt: this.now() };
      this.checks.set(path, record); await this.save(path, record); this.publish();
      await this.record(record.mastery, record.objective, { kind: 'check', day: this.today(), label: record.goal, ...summarise(record.questions.map(q => ({ q, answer: record.answers[q.id], mark: marks[q.id] }))) });
    });
  }

  // ---- today ---------------------------------------------------------
  async todayList(): Promise<Today> {
    const day = this.today(), checks: TodayItem[] = [], lessons: TodayItem[] = [], ready = new Set<string>();
    await this.loadChecks();
    for (const m of await this.courses()) {
      for (const id of readyToLearn(m)) ready.add(`${m.path}#${id}`);
      for (const o of m.objectives) {
        if (!isDue(o, day)) continue;
        const item: TodayItem = { mastery: m.path, course: m.course, objective: o.id, title: o.title, state: o.state, due: o.due! };
        if (NEEDS_LESSON.includes(o.state)) lessons.push(item);
        else checks.push({ ...item, check: await this.pendingCheck(m.path, o.id) });
      }
    }
    // Suggest only a few lessons: misconceptions first, then objectives whose prerequisites are already taught.
    const rank = (i: TodayItem) => i.state === 'misconception' ? 0 : ready.has(`${i.mastery}#${i.objective}`) ? 1 : 2;
    lessons.sort((a, b) => rank(a) - rank(b) || a.due.localeCompare(b.due));
    return { checks, lessons: lessons.slice(0, LESSONS_PER_DAY), moreLessons: Math.max(0, lessons.length - LESSONS_PER_DAY), cards: this.dueCards() };
  }
  /** Writes checks that are due but missing (for example after a hand edit). */
  prepare(today: Today) { for (const c of today.checks) if (!c.check) void this.ensureCheck(c.mastery, c.objective); }

  // ---- lessons -------------------------------------------------------
  lessonAt(path: string) { return this.lessons.get(path); }
  async loadLesson(path: string) {
    if (!this.lessons.has(path)) { const text = await this.storage.read(path); if (!text) throw new Error('This lesson no longer exists.'); this.lessons.set(path, JSON.parse(text) as Lesson); this.publish(); }
    return this.lessons.get(path)!;
  }
  async listLessons(): Promise<LessonSummary[]> {
    const result: LessonSummary[] = [];
    for (const path of this.storage.files(`${this.root()}/Lessons`, 'json')) {
      try { const l = await this.loadLesson(path); result.push({ path, title: l.map?.title ?? l.topic, created: l.createdAt, finished: !!l.finishedAt, objective: l.objective }); } catch { /* skipped */ }
    }
    return result.sort((a, b) => b.created - a.created);
  }
  private setLesson(path: string, lesson: Lesson, immediate = true) {
    this.lessons.set(path, lesson); this.publish();
    if (immediate) { window.clearTimeout(this.timers.get(path)); return this.save(path, lesson); }
    this.later(path, () => this.lessons.get(path)); return Promise.resolve();
  }
  private lesson(path: string) { const l = this.lessons.get(path); if (!l) throw new Error('This lesson is not loaded.'); return l; }
  private async context(lesson: Lesson) {
    const m = lesson.mastery ? await this.course(lesson.mastery).catch(() => undefined) : undefined;
    return { m, o: m?.objectives.find(x => x.id === lesson.objective), sources: await this.sources(lesson.notes) };
  }
  /** The text of the lesson's notes, capped, so tutor calls need no tools. Undefined when there are none to read. */
  private async sources(notes: string[]) {
    let budget = SOURCE_BUDGET; const parts: string[] = [];
    for (const path of notes.slice(0, 4)) {
      const text = await this.storage.read(path); if (!text || budget <= 0) continue;
      const part = text.length > budget ? text.slice(0, budget) + '\n[Truncated.]' : text;
      parts.push(`<note path="${path}">\n${part}\n</note>`); budget -= part.length;
    }
    return parts.length ? parts.join('\n') : undefined;
  }
  /** Starts from an objective, a note or a topic. Returns the lesson path at once; the probe arrives later. */
  async startLesson(input: { topic: string; notes: string[]; mastery?: string; objective?: string }): Promise<string> {
    let { mastery, objective, notes } = input;
    if (!mastery && notes.length) mastery = (await this.courseFor(notes))?.path;
    const m = mastery ? await this.course(mastery) : undefined, o = m?.objectives.find(x => x.id === objective);
    if (o) notes = [...new Set([...notes, ...o.notes.map(n => this.storage.resolve(n, m!.path) ?? n)])];
    const lesson: Lesson = { version: 1, createdAt: this.now(), topic: input.topic, notes, mastery, course: m?.course, objective: o?.id, steps: [], state: [], current: 0 };
    const base = `${this.root()}/Lessons/${this.today()} ${safeName(input.topic)}`;
    let path = `${base}.json`, n = 2; while (this.storage.exists(path) || this.lessons.has(path)) path = `${base} ${n++}.json`;
    await this.setLesson(path, lesson);
    void this.probe(path);
    return path;
  }
  probe(path: string) {
    return this.track(path, 'probe', '', async () => {
      const lesson = this.lesson(path), { m, o, sources } = await this.context(lesson);
      const result = await runValidated(this.runner('tutor'), { prompt: probePrompt(lesson, m, o, sources), schema: probeSchema, effort: 'low', vault: !sources }, readProbe);
      const questions = result.questions.slice(0, 4).map(q => ({ ...q, objective: m?.objectives.some(x => x.id === q.objective) ? q.objective : undefined }));
      await this.setLesson(path, { ...this.lesson(path), probe: { questions, answers: {} } });
      if (!questions.length) void this.submitProbe(path);
    });
  }
  answerProbe(path: string, id: string, patch: Partial<AnswerState>) {
    const lesson = this.lesson(path); if (!lesson.probe || lesson.probe.submitted) return;
    void this.setLesson(path, { ...lesson, probe: { ...lesson.probe, answers: { ...lesson.probe.answers, [id]: { ...lesson.probe.answers[id], ...patch } } } }, false);
  }
  /** One tutor call marks the probe and plans the lesson, to keep the wait short. */
  submitProbe(path: string) {
    return this.track(path, 'map', '', async () => {
      let lesson = this.lesson(path);
      const probe = lesson.probe ?? { questions: [], answers: {} };
      const marks: Record<string, QuestionMark> = {};
      for (const q of probe.questions) { const a = probe.answers[q.id]; if (a?.unknown) marks[q.id] = markUnknown(q); else if (q.type === 'mcq') marks[q.id] = markChoice(q, a); }
      lesson = { ...lesson, probe: { ...probe, submitted: true, marks } }; await this.setLesson(path, lesson);
      const { m, o, sources } = await this.context(lesson);
      const typed = probe.questions.filter(q => !marks[q.id]);
      const result = await runValidated(this.runner('tutor'), { prompt: probeMapPrompt(lesson, m, o, sources), schema: probeMapSchema, effort: 'low', vault: !sources }, v => readProbeMap(v, typed.map(q => ({ id: q.id, rubric: q.rubric.length }))));
      for (const q of typed) { const found = result.marks.find(x => x.id === q.id)!; marks[q.id] = scoreQuestion(q, found); }
      const objective = lesson.objective ?? (m?.objectives.some(x => x.id === result.map.objective) ? result.map.objective : undefined);
      await this.setLesson(path, { ...this.lesson(path), objective, probe: { ...probe, submitted: true, marks, findings: result.findings }, map: result.map });
      // Probe answers on known objectives are evidence too.
      if (lesson.mastery) {
        const day = this.today();
        for (const q of probe.questions) if (q.objective) await this.record(lesson.mastery, q.objective, { kind: 'probe', day, label: q.id, ...summarise([{ q, answer: probe.answers[q.id], mark: marks[q.id] }]) });
      }
    });
  }
  reviseMap(path: string, change: string) {
    return this.track(path, 'revise', '', async () => {
      const map = await runValidated(this.runner('tutor'), { prompt: reviseMapPrompt(this.lesson(path), change), schema: mapSchema, vault: false, effort: 'low' }, readMap);
      await this.setLesson(path, { ...this.lesson(path), map });
    });
  }
  async acceptMap(path: string) {
    const lesson = this.lesson(path); if (!lesson.map) return;
    const count = lesson.map.steps.length;
    await this.setLesson(path, { ...lesson, accepted: true, steps: Array<null>(count).fill(null), state: Array.from({ length: count }, () => ({ asks: [] })), current: 0 });
    void this.writeSteps(path);
  }
  /** The writer prepares steps one at a time, so the first is ready quickly and the rest arrive while the student works. */
  writeSteps(path: string) {
    return this.track(path, 'steps', '', async () => {
      for (;;) {
        const lesson = this.lesson(path), index = lesson.steps.findIndex(s => !s);
        if (index < 0 || !lesson.map || this.disposed) return;
        const step = await runValidated(this.runner('writer'), { prompt: stepPrompt(lesson, lesson.map, index), schema: stepSchema }, readStep);
        const latest = this.lesson(path);
        await this.setLesson(path, { ...latest, steps: latest.steps.map((s, i) => i === index ? { ...step, check: { ...step.check, id: `k${index + 1}`, objective: latest.objective } } : s) });
      }
    });
  }
  private patchStep(path: string, index: number, patch: Partial<StepState>, immediate = true) {
    const lesson = this.lesson(path);
    return this.setLesson(path, { ...lesson, state: lesson.state.map((s, i) => i === index ? { ...s, ...patch } : s) }, immediate);
  }
  answerStep(path: string, patch: Partial<AnswerState>) {
    const lesson = this.lesson(path), st = lesson.state[lesson.current];
    if (!st || st.mark) return;
    void this.patchStep(path, lesson.current, { answer: { ...st.answer, ...patch } }, false);
  }
  /** "I don't know" and right multiple-choice answers need no call; everything else goes to the tutor. */
  checkStep(path: string) {
    const lesson = this.lesson(path), index = lesson.current, step = lesson.steps[index], st = lesson.state[index];
    if (!step || !st) return Promise.resolve(undefined);
    return this.track(path, 'tutor', String(index), async () => {
      const q = step.check, a = st.answer;
      if (a?.unknown) return this.patchStep(path, index, { mark: markUnknown(q), reply: 'No problem. Read the explanation, then look at the model answer.' });
      if (q.type === 'mcq' && a?.choice === q.answer) return this.patchStep(path, index, { mark: markChoice(q, a), reply: 'Right.' });
      const result = await runValidated(this.runner('tutor'), { prompt: tutorMarkPrompt(lesson, step, a), schema: tutorMarkSchema, vault: false, effort: 'low' }, v => readTutorMark(v, q.rubric.length));
      await this.patchStep(path, index, { mark: scoreQuestion(q, result), reply: result.reply, reteach: step.misconceptions[result.misconception]?.reteach });
    });
  }
  retryStep(path: string, text: string) {
    const lesson = this.lesson(path), index = lesson.current, step = lesson.steps[index], st = lesson.state[index];
    if (!step || !st?.mark || st.retry) return Promise.resolve(undefined);
    return this.track(path, 'tutor', `${index}-retry`, async () => {
      const result = await runValidated(this.runner('tutor'), { prompt: tutorMarkPrompt(lesson, step, { ...st.answer, text, unknown: false }, st), schema: tutorMarkSchema, vault: false, effort: 'low' }, v => readTutorMark(v, step.check.rubric.length));
      await this.patchStep(path, index, { retry: { text, mark: scoreQuestion(step.check, result), reply: result.reply } });
    });
  }
  ask(path: string, question: string) {
    const lesson = this.lesson(path), index = lesson.current;
    return this.track(path, 'ask', String(index), async () => {
      const st = lesson.state[index], sources = await this.sources(lesson.notes);
      const { answer } = await runValidated(this.runner('tutor'), { prompt: askPrompt(lesson, lesson.steps[index] ?? undefined, st?.asks ?? [], question, sources), schema: answerSchema, effort: 'low', vault: !sources }, readAnswer);
      const latest = this.lesson(path).state[index];
      if (latest) await this.patchStep(path, index, { asks: [...latest.asks, { q: question, a: answer }] });
    });
  }
  async go(path: string, index: number) {
    const lesson = this.lesson(path);
    if (index >= 0 && index < lesson.steps.length && lesson.steps[index]) await this.setLesson(path, { ...lesson, current: index });
  }
  /** Records the lesson (at most "taught"), then the writer suggests cards and a note edit, and the next check is written. */
  async finishLesson(path: string) {
    let lesson = this.lesson(path);
    if (!lesson.finishedAt) {
      lesson = { ...lesson, finishedAt: this.now() }; await this.setLesson(path, lesson);
      if (lesson.mastery && lesson.objective) {
        const marked = lesson.steps.map((s, i) => s && lesson.state[i]?.mark ? { q: s.check, mark: lesson.state[i].mark } : undefined).filter(Boolean) as { q: Question; mark: QuestionMark }[];
        await this.record(lesson.mastery, lesson.objective, { kind: 'lesson', day: this.today(), label: `${marked.filter(x => x.mark.score >= x.q.marks * PASS).length}/${lesson.steps.length} checks` });
      }
    }
    return this.close(path);
  }
  close(path: string) {
    return this.track(path, 'close', '', async () => {
      const lesson = this.lesson(path);
      const result = await runValidated(this.runner('writer'), { prompt: closePrompt(lesson), schema: closeSchema }, readClose);
      const note = await this.writeLessonNote(path, lesson, result.summary);
      let nextCheck: string | undefined;
      if (lesson.mastery && lesson.objective) {
        await this.ensureCheck(lesson.mastery, lesson.objective);
        nextCheck = (await this.course(lesson.mastery)).objectives.find(o => o.id === lesson.objective)?.due;
      }
      await this.setLesson(path, { ...this.lesson(path), close: { summary: result.summary, cards: result.cards.slice(0, 4), noteEdit: result.noteEdit?.text.trim() ? result.noteEdit : undefined, cardState: {}, note, nextCheck } });
    });
  }
  private async writeLessonNote(path: string, lesson: Lesson, summary: string) {
    const notePath = path.replace(/\.json$/, '.md'), day = isoDay(lesson.createdAt);
    const steps = lesson.steps.map((s, i) => {
      if (!s) return '';
      const st = lesson.state[i], a = st?.answer;
      const answer = a?.unknown ? "_I didn't know._" : s.check.type === 'mcq' ? s.check.options?.[a?.choice ?? -1] ?? '_No answer._' : a?.text?.trim() || '_No answer._';
      return `### ${i + 1}. ${s.title}\n\n${s.explain}\n\n${s.connect}\n\n**Check:** ${s.check.prompt}\n\n**My answer${st?.mark ? ` (${st.mark.score}/${s.check.marks})` : ''}:** ${answer}\n\n**Model answer:** ${s.check.model}${st?.asks.length ? '\n\n' + st.asks.map(x => `> **Q:** ${x.q}\n> ${x.a.replace(/\n/g, '\n> ')}`).join('\n\n') : ''}`;
    }).filter(Boolean).join('\n\n');
    const mastery = lesson.mastery ? ` · [[${lesson.mastery.replace(/\.md$/, '')}|${lesson.course ?? 'Mastery'}]]${lesson.objective ? ` · \`${lesson.objective}\`` : ''}` : '';
    const body = `---\nqard-lesson: true\n${lesson.objective ? `qard-objective: ${lesson.objective}\n` : ''}---\n\n# ${lesson.map?.title ?? lesson.topic}\n\n${day}${mastery}\n\n## Summary\n\n${summary.trim()}\n\n## Plan\n\n${lesson.map?.plan ?? ''}\n\n\`\`\`mermaid\n${lesson.map?.mermaid ?? ''}\n\`\`\`\n\n## Steps\n\n${steps}\n`;
    await this.storage.write(notePath, body);
    return notePath;
  }
  async lessonCard(path: string, index: number, state: 'added' | 'skipped' | undefined, cardId?: string) {
    const lesson = this.lesson(path); if (!lesson.close) return;
    const cardState = { ...lesson.close.cardState }; if (state) cardState[index] = state; else delete cardState[index];
    await this.setLesson(path, { ...lesson, close: { ...lesson.close, cardState } });
    if (cardId && lesson.mastery && lesson.objective) await this.linkCard(cardId, lesson.mastery, lesson.objective);
  }
  /** Adds the suggested paragraph at the end of its heading's section, or the end of the note. */
  async noteEdit(path: string, accept: boolean) {
    const lesson = this.lesson(path), edit = lesson.close?.noteEdit; if (!lesson.close || !edit) return;
    if (accept) {
      const target = this.storage.exists(edit.path) ? edit.path : this.storage.resolve(edit.path.replace(/\.md$/, ''), path);
      if (!target) throw new Error(`Could not find ${edit.path}.`);
      await this.storage.process(target, text => insertUnderHeading(text, edit.heading, edit.text));
    }
    await this.setLesson(path, { ...lesson, close: { ...lesson.close, noteState: accept ? 'accepted' : 'skipped' } });
  }

  async flush() { this.timers.forEach((timer, path) => { window.clearTimeout(timer); void this.save(path, this.checks.get(path) ?? this.lessons.get(path)); }); this.timers.clear(); await Promise.all(this.writes.values()); }
  dispose() { this.disposed = true; void this.flush(); this.listeners.clear(); }
}

export function insertUnderHeading(text: string, heading: string, addition: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.replace(/\s*$/, '').split(/\r?\n/), block = addition.trim().split(/\r?\n/);
  const wanted = heading.trim().replace(/^#+\s*/, '').toLowerCase();
  const at = wanted ? lines.findIndex(l => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)?.[2]?.toLowerCase() === wanted) : -1;
  if (at < 0) return [...lines, '', ...block, ''].join(eol);
  const level = /^#+/.exec(lines[at]!)![0].length;
  let end = lines.findIndex((l, i) => i > at && (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 7) <= level);
  if (end < 0) end = lines.length;
  let insert = end; while (insert > at + 1 && !lines[insert - 1]!.trim()) insert--;
  const after = lines.slice(end);
  return [...lines.slice(0, insert), '', ...block, '', ...after, ...(after.length ? [''] : [])].join(eol).replace(/(\r?\n)+$/, eol);
}
