import type { TestSettings } from '../settings/settings';
import { debug } from '../debug/debug-log';
import { CANCELLED, runValidated, type AgentRole, type AgentRunner } from '../agents/runner';
import { askPrompt, disputePrompt, generatePrompt, markPrompt, planPrompt, retryPrompt, revisePrompt, wrapupPrompt, type TestDefaults } from './test-prompts';
import { askSchema, disputeSchema, marksSchema, planSchema, readAsk, readDispute, readMarks, readPlan, readRetry, readTest, readWrapup, retrySchema, testSchema, wrapupSchema } from './test-schema';
import { emptyAttempt, markChoice, markUnknown, questions, scoreOf, type AnswerState, type Attempt, type PracticeTest, type TestFolder, type TestPlan, type TestRequest } from './test-types';

/** File access for test folders; the Obsidian adapter lives in vault-storage.ts. */
export interface TestStorage {
  folders(root: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): boolean;
  trash(folder: string): Promise<void>;
}
export type JobKind = 'plan' | 'generate' | 'mark' | 'wrapup' | 'retry' | 'ask' | 'dispute';
/** startedAt lets the UI show elapsed time and how long is left. */
export interface Job { kind: JobKind; id: string; startedAt?: number; error?: string }
export interface TestSummary { folder: string; title: string; created: number; status: 'planning' | 'plan' | 'writing' | 'ready' | 'in-progress' | 'marked' | 'failed'; score?: number; marks?: number }
export interface ServiceSnapshot { revision: number; jobs: Record<string, Job> }
/** The link to course mastery files: objectives for writing, evidence after marking. */
export interface TestLearning {
  objectives(paths: string[]): Promise<{ mastery: string; lines: string } | undefined>;
  record(test: PracticeTest, attempt: Attempt): Promise<void>;
}

const FILES = { request: 'request.json', plan: 'plan.json', test: 'test.json', attempt: 'attempt.json' };
const key = (folder: string, kind: JobKind, id = '') => `${folder}|${kind}|${id}`;
const slug = (text: string) => text.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 60) || 'Practice test';
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export class TestService {
  private cache = new Map<string, TestFolder>();
  private listeners = new Set<() => void>();
  private snapshot: ServiceSnapshot = { revision: 0, jobs: {} };
  private writes = new Map<string, Promise<void>>();
  private timers = new Map<string, number>();
  private controllers = new Map<string, AbortController>();
  private removed = new Set<string>();
  private removals = new Map<string, Promise<void>>();
  private disposed = false;
  /** notify tells the student when background work finishes, wherever they are in Obsidian; timing learns how long jobs take. */
  constructor(private storage: TestStorage, private settings: () => TestSettings, private runner: (role: AgentRole) => AgentRunner, private now = () => Date.now(), private learning?: TestLearning, private notify: (message: string) => void = () => {}, private timing: (kind: string, ms: number) => void = () => {}) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(jobs = this.snapshot.jobs) { this.snapshot = { revision: this.snapshot.revision + 1, jobs }; this.listeners.forEach(l => l()); }
  job(folder: string, kind: JobKind, id = '') { return this.snapshot.jobs[key(folder, kind, id)]; }
  jobsFor(folder: string) { return Object.entries(this.snapshot.jobs).filter(([k]) => k.startsWith(folder + '|')).map(([, j]) => j); }
  get(folder: string) { return this.cache.get(folder); }
  dismiss(folder: string, kind: JobKind, id = '') { const jobs = { ...this.snapshot.jobs }; delete jobs[key(folder, kind, id)]; this.publish(jobs); }

  /** Runs one agent job; errors stay on the job until dismissed or retried. */
  /** Stops a running job; it shows as cancelled, with the usual Try again. */
  cancel(folder: string, kind: JobKind, id = '') { this.controllers.get(key(folder, kind, id))?.abort(); }
  /** Prevent late replies from a cancelled provider from being written back. */
  private activeRunner(role: AgentRole, signal: AbortSignal): AgentRunner {
    const runner = this.runner(role);
    return { name: runner.name, run: async task => {
      if (signal.aborted) throw new Error(CANCELLED);
      const result = await runner.run(task);
      if (signal.aborted) throw new Error(CANCELLED);
      return result;
    } };
  }
  /** Recoverable deletion of one test, including its plan and attempts, through Obsidian's trash. */
  remove(folder: string): Promise<void> {
    const pending = this.removals.get(folder); if (pending) return pending;
    const root = this.settings().folder.replace(/\/+$/, ''), child = folder.slice(root.length + 1);
    if (!root || /^(?:[\\/]|[A-Za-z]:)/.test(root) || root.split(/[\\/]/).some(p => !p || p === '.' || p === '..') || !folder.startsWith(root + '/') || !child || child.includes('/') || child.includes('\\') || child === '.' || child === '..') return Promise.reject(new Error('Only a specific test folder can be deleted.'));
    this.removed.add(folder);
    window.clearTimeout(this.timers.get(folder)); this.timers.delete(folder);
    const priorJobs = Object.fromEntries(Object.entries(this.snapshot.jobs).filter(([k]) => k.startsWith(folder + '|')));
    for (const [k, controller] of this.controllers) if (k.startsWith(folder + '|')) controller.abort();
    this.publish(Object.fromEntries(Object.entries(this.snapshot.jobs).filter(([k]) => !k.startsWith(folder + '|'))));
    const work = (async () => {
      try {
        // Finish any in-flight file write before moving its folder to trash.
        await this.writes.get(folder)?.catch(() => {});
        await this.storage.trash(folder);
        this.cache.delete(folder); this.writes.delete(folder); this.publish();
        this.notify('Test moved to trash.');
      } catch (error) {
        this.removed.delete(folder);
        this.publish({ ...this.snapshot.jobs, ...Object.fromEntries(Object.entries(priorJobs).map(([k, job]) => [k, { ...job, error: job.error ?? CANCELLED }])) });
        // Preserve the latest answers if deletion failed while an autosave was queued.
        const attempt = this.cache.get(folder)?.attempt;
        if (attempt && this.storage.exists(folder)) await this.save(folder, 'attempt', attempt).catch(() => {});
        throw error;
      } finally { this.removals.delete(folder); }
    })();
    this.removals.set(folder, work); return work;
  }
  private async track<T>(folder: string, kind: JobKind, id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.removed.has(folder)) return undefined;
    const k = key(folder, kind, id);
    if (this.snapshot.jobs[k] && !this.snapshot.jobs[k].error) { debug.log('job', 'already running, not started again', { key: k }); return undefined; }
    const startedAt = this.now(), controller = new AbortController(), span = debug.span('job', kind, { key: k });
    controller.signal.addEventListener('abort', () => span.fail('cancelled'));
    this.controllers.set(k, controller);
    this.publish({ ...this.snapshot.jobs, [k]: { kind, id, startedAt } });
    // Cancelling settles the job straight away, even if the request underneath can't be interrupted.
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(CANCELLED)))), running = work(controller.signal);
    cancelled.catch(() => {}); running.catch(() => {});
    try {
      const result = await Promise.race([running, cancelled]);
      const jobs = { ...this.snapshot.jobs }; delete jobs[k]; if (!this.disposed && !this.removed.has(folder)) this.publish(jobs);
      if (!this.removed.has(folder)) this.timing(kind, this.now() - startedAt);
      return result;
    } catch (error) {
      span.fail(error);
      if (!this.disposed && !this.removed.has(folder)) this.publish({ ...this.snapshot.jobs, [k]: { kind, id, startedAt, error: controller.signal.aborted ? CANCELLED : (error as Error).message || 'Something went wrong.' } });
      return undefined;
    } finally { if (this.controllers.get(k) === controller) this.controllers.delete(k); }
  }
  private defaults(profile?: string, objectives?: string): TestDefaults { const s = this.settings(); return { questions: s.questions, marking: s.marking, profile, objectives }; }
  private async course(paths: string[]) { return paths.length ? await this.learning?.objectives(paths).catch(() => undefined) : undefined; }
  private profilePath() { return `${this.settings().folder.replace(/\/+$/, '')}/_profile.md`; }
  private async profile() { return this.settings().useProfile ? (await this.storage.read(this.profilePath())) ?? undefined : undefined; }

  private async save(folder: string, file: keyof typeof FILES, value: unknown) {
    if (this.removed.has(folder)) return;
    const previous = this.writes.get(folder) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.removed.has(folder) ? undefined : this.storage.write(`${folder}/${FILES[file]}`, JSON.stringify(value, null, 2) + '\n'));
    this.writes.set(folder, next); return next;
  }
  private update(folder: string, patch: Partial<TestFolder>) {
    if (this.removed.has(folder)) return;
    const current = this.cache.get(folder) ?? { folder };
    this.cache.set(folder, { ...current, ...patch }); this.publish();
  }
  private attemptOf(folder: string): { test: PracticeTest; attempt: Attempt } {
    if (this.removed.has(folder)) throw new Error('This test has been deleted.');
    const entry = this.cache.get(folder);
    if (!entry?.test) throw new Error('This test has not been written yet.');
    return { test: entry.test, attempt: entry.attempt ?? emptyAttempt(entry.test, this.now()) };
  }
  private setAttempt(folder: string, attempt: Attempt, immediate = true) {
    if (this.removed.has(folder)) return Promise.resolve();
    this.update(folder, { attempt });
    window.clearTimeout(this.timers.get(folder));
    if (immediate) return this.save(folder, 'attempt', attempt);
    this.timers.set(folder, window.setTimeout(() => { this.timers.delete(folder); void this.save(folder, 'attempt', this.cache.get(folder)?.attempt); }, 600));
    return Promise.resolve();
  }

  async list(): Promise<TestSummary[]> {
    const root = this.settings().folder.replace(/\/+$/, '');
    const result: TestSummary[] = [];
    for (const folder of await this.storage.folders(root)) {
      if (this.removed.has(folder)) continue;
      let entry: TestFolder;
      try { entry = await this.load(folder); } catch { result.push({ folder, title: folder.split('/').pop()!, created: 0, status: 'failed' }); continue; }
      const running = this.jobsFor(folder);
      const title = entry.test?.title || entry.plan?.title || folder.split('/').pop()!;
      const created = entry.test?.createdAt ?? entry.attempt?.startedAt ?? 0;
      if (entry.test) {
        const { score, marks, marked } = scoreOf(entry.test, entry.attempt);
        result.push({ folder, title, created, status: marked && entry.attempt?.finishedAt ? 'marked' : entry.attempt && Object.keys(entry.attempt.answers).length ? 'in-progress' : 'ready', score, marks });
      } else if (running.some(j => j.kind === 'generate' && !j.error)) result.push({ folder, title, created, status: 'writing' });
      else if (running.some(j => j.kind === 'plan' && !j.error)) result.push({ folder, title, created, status: 'planning' });
      else if (entry.plan) result.push({ folder, title, created, status: 'plan' });
      else if (entry.request) result.push({ folder, title, created, status: 'failed' });
    }
    return result.filter(t => !this.removed.has(t.folder)).sort((a, b) => b.created - a.created || b.folder.localeCompare(a.folder));
  }

  async load(folder: string): Promise<TestFolder> {
    if (this.removed.has(folder)) throw new Error('This test has been deleted.');
    const cached = this.cache.get(folder);
    if (cached) return cached;
    const json = async (file: keyof typeof FILES) => { const text = await this.storage.read(`${folder}/${FILES[file]}`); return text === null ? undefined : JSON.parse(text) as unknown; };
    const [request, plan, test, attempt] = await Promise.all([json('request'), json('plan'), json('test'), json('attempt')]);
    if (this.removed.has(folder)) throw new Error('This test has been deleted.');
    const entry: TestFolder = { folder, request: request as TestRequest | undefined, plan: plan ? readPlan(plan) : undefined };
    // Tests may be written outside Qard, so validate them the same way as agent output.
    if (test) { const valid = readTest(test); const t = test as Partial<PracticeTest>; entry.test = { version: 1, createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0, ...valid }; }
    if (attempt && entry.test) entry.attempt = attempt as Attempt;
    // A concurrent load may have filled the cache first; keep that entry.
    if (!this.cache.has(folder)) { this.cache.set(folder, entry); this.publish(); }
    return this.cache.get(folder)!;
  }
  private async newFolder(request: TestRequest) {
    const root = this.settings().folder.replace(/\/+$/, ''), base = `${root}/${day(this.now())} ${slug(request.prompt || request.decks[0] || 'Practice test')}`;
    let folder = base, n = 2;
    while (this.storage.exists(folder) || this.cache.has(folder) || this.removed.has(folder)) folder = `${base} ${n++}`;
    this.cache.set(folder, { folder, request });
    await this.save(folder, 'request', request);
    return folder;
  }

  /** Default path: draft a plan for the user to check. Returns the folder at once; the plan arrives later. */
  async plan(request: TestRequest): Promise<string> {
    const folder = await this.newFolder(request);
    void this.track(folder, 'plan', '', async signal => {
      const profile = await this.profile(), course = await this.course(request.sources);
      const plan = await runValidated(this.activeRunner('writer', signal), { signal, prompt: planPrompt(request, this.defaults(profile, course?.lines)), schema: planSchema }, readPlan);
      await this.save(folder, 'plan', plan); this.update(folder, { plan });
    });
    return folder;
  }
  revise(folder: string, change: string) {
    return this.track(folder, 'plan', '', async signal => {
      const current = this.cache.get(folder)?.plan; if (!current) throw new Error('There is no plan to revise.');
      const plan = await runValidated(this.activeRunner('writer', signal), { signal, prompt: revisePrompt(current, change, this.defaults(await this.profile())), schema: planSchema }, readPlan);
      await this.save(folder, 'plan', plan); this.update(folder, { plan });
    });
  }
  async removeSource(folder: string, path: string) {
    const plan = this.cache.get(folder)?.plan; if (!plan) return;
    const next: TestPlan = { ...plan, sources: plan.sources.filter(s => s.path !== path) };
    this.update(folder, { plan: next }); await this.save(folder, 'plan', next);
  }
  /** Writes the test from the plan, or straight from the request when planning was skipped. */
  async generate(input: { folder: string } | { request: TestRequest }): Promise<string> {
    const folder = 'folder' in input ? input.folder : await this.newFolder(input.request);
    const entry = this.cache.get(folder);
    const request = entry?.request ?? { prompt: '', decks: [], notes: [], sources: [] };
    void this.track(folder, 'generate', '', async signal => {
      await this.save(folder, 'request', { ...request, writing: this.now() });
      const course = await this.course([...new Set([...request.sources, ...(entry?.plan?.sources.map(s => s.path) ?? [])])]);
      const written = await runValidated(this.activeRunner('writer', signal), { signal, prompt: generatePrompt({ request, plan: entry?.plan }, this.defaults(await this.profile(), course?.lines)), schema: testSchema }, readTest);
      const test: PracticeTest = { version: 1, createdAt: this.now(), ...written, ...(course ? { mastery: course.mastery } : {}) };
      const attempt = emptyAttempt(test, this.now());
      await this.save(folder, 'test', test); await this.save(folder, 'attempt', attempt);
      const { writing: _done, ...finished } = request; void _done;
      await this.save(folder, 'request', finished);
      this.update(folder, { test, attempt, request: finished });
      if (!this.removed.has(folder) && !signal.aborted) this.notify(`Practice test ready: ${test.title}`);
    });
    return folder;
  }

  answer(folder: string, id: string, patch: Partial<AnswerState>) {
    if (this.removed.has(folder)) return;
    const { attempt } = this.attemptOf(folder);
    void this.setAttempt(folder, { ...attempt, answers: { ...attempt.answers, [id]: { ...attempt.answers[id], ...patch } } }, false);
  }
  /** Multiple choice is marked locally; the rest waits for the agent (now, or at the end). */
  async submit(folder: string, sectionId: string) {
    const { test, attempt } = this.attemptOf(folder);
    const section = test.sections.find(s => s.id === sectionId); if (!section) return;
    const marks = { ...attempt.marks };
    for (const q of section.questions) if (attempt.answers[q.id]?.unknown) marks[q.id] = markUnknown(q); else if (q.type === 'mcq') marks[q.id] = markChoice(q, attempt.answers[q.id]);
    const needsAgent = section.questions.some(q => !marks[q.id]);
    await this.setAttempt(folder, { ...attempt, marks, sections: { ...attempt.sections, [sectionId]: { status: needsAgent ? 'submitted' : 'marked' } } });
    if (needsAgent && this.settings().marking === 'section') void this.mark(folder, [sectionId]);
  }
  async finish(folder: string) {
    const { test, attempt } = this.attemptOf(folder);
    for (const s of test.sections) if (attempt.sections[s.id]?.status === 'open') await this.submit(folder, s.id);
    const latest = this.attemptOf(folder).attempt;
    await this.setAttempt(folder, { ...latest, finishedAt: latest.finishedAt ?? this.now() });
    const pending = test.sections.filter(s => ['submitted', 'error'].includes(latest.sections[s.id]?.status ?? 'open')).map(s => s.id);
    if (pending.length) await this.mark(folder, pending); else void this.wrapup(folder);
  }
  mark(folder: string, sectionIds: string[]) {
    return this.track(folder, 'mark', sectionIds.join(','), async signal => {
      const { test } = this.attemptOf(folder);
      const setStatus = (status: 'marking' | 'marked' | 'error', error?: string) => {
        const a = this.attemptOf(folder).attempt;
        return this.setAttempt(folder, { ...a, sections: { ...a.sections, ...Object.fromEntries(sectionIds.map(id => [id, error ? { status, error } : { status }])) } });
      };
      await setStatus('marking');
      // Multiple choice and "I don't know" were marked on submit.
      const answers = this.attemptOf(folder).attempt.answers;
      const targets = test.sections.filter(s => sectionIds.includes(s.id)).flatMap(s => s.questions).filter(q => q.type !== 'mcq' && !answers[q.id]?.unknown);
      try {
        const marks = targets.length ? await runValidated(this.activeRunner('marker', signal), { signal, prompt: markPrompt(test, this.attemptOf(folder).attempt, targets.map(q => q.id)), schema: marksSchema }, v => readMarks(v, targets.map(q => ({ id: q.id, rubric: q.rubric.length })))) : {};
        for (const q of targets) { const m = marks[q.id]!; m.score = Math.min(q.marks, q.rubric.reduce((n, r, i) => n + (m.awarded[i] ? r.marks : 0), 0)); }
        const a = this.attemptOf(folder).attempt;
        await this.setAttempt(folder, { ...a, marks: { ...a.marks, ...marks }, sections: { ...a.sections, ...Object.fromEntries(sectionIds.map(id => [id, { status: 'marked' as const }])) } });
      } catch (error) { await setStatus('error', (error as Error).message); throw error; }
      const done = this.attemptOf(folder).attempt;
      if (done.finishedAt && test.sections.every(s => done.sections[s.id]?.status === 'marked')) void this.wrapup(folder);
    });
  }
  wrapup(folder: string) {
    return this.track(folder, 'wrapup', '', async signal => {
      const { test, attempt } = this.attemptOf(folder);
      const profile = await this.profile();
      if (test.mastery && !test.recorded && this.learning) {
        await this.learning.record(test, attempt);
        const recorded = { ...test, recorded: true }; await this.save(folder, 'test', recorded); this.update(folder, { test: recorded });
      }
      const result = await runValidated(this.activeRunner('writer', signal), { signal, prompt: wrapupPrompt(test, attempt, profile, day(this.now())), schema: wrapupSchema }, readWrapup);
      const ids = new Set(questions(test).map(q => q.id));
      const latest = this.attemptOf(folder).attempt;
      await this.setAttempt(folder, { ...latest, wrapup: { fixes: result.fixes.filter(f => ids.has(f.questionId)).slice(0, 3), cards: result.cards.filter(c => ids.has(c.questionId)).slice(0, 6) } });
      if (!signal.aborted && !this.removed.has(folder) && this.settings().useProfile && result.profile.trim()) await this.storage.write(this.profilePath(), result.profile.trim() + '\n');
      const { score, marks } = scoreOf(test, this.attemptOf(folder).attempt);
      this.notify(`${test.title} is marked: ${score} / ${marks}`);
    });
  }
  retry(folder: string, id: string, text: string) {
    return this.track(folder, 'retry', id, async signal => {
      const { test, attempt } = this.attemptOf(folder), q = questions(test).find(x => x.id === id)!;
      const result = await runValidated(this.activeRunner('tutor', signal), { signal, prompt: retryPrompt(q, attempt, text), schema: retrySchema }, readRetry);
      const a = this.attemptOf(folder).attempt;
      await this.setAttempt(folder, { ...a, review: { ...a.review, [id]: { ...a.review[id], retry: { text, feedback: result.feedback, score: Math.min(q.marks, result.score) } } } });
    });
  }
  ask(folder: string, id: string, question: string) {
    return this.track(folder, 'ask', id, async signal => {
      const { test, attempt } = this.attemptOf(folder), q = questions(test).find(x => x.id === id)!;
      const result = await runValidated(this.activeRunner('tutor', signal), { signal, prompt: askPrompt(q, attempt, question), schema: askSchema }, readAsk);
      const a = this.attemptOf(folder).attempt, prior = a.review[id]?.followups ?? [];
      await this.setAttempt(folder, { ...a, review: { ...a.review, [id]: { ...a.review[id], followups: [...prior, { q: question, a: result.answer }] } } });
    });
  }
  dispute(folder: string, id: string, argument: string) {
    return this.track(folder, 'dispute', id, async signal => {
      const { test, attempt } = this.attemptOf(folder), q = questions(test).find(x => x.id === id)!;
      const { reply, ...mark } = await runValidated(this.activeRunner('marker', signal), { signal, prompt: disputePrompt(test, attempt, q, argument), schema: disputeSchema }, v => readDispute(v, q.rubric.length));
      mark.score = Math.min(q.marks, q.rubric.reduce((n, r, i) => n + (mark.awarded[i] ? r.marks : 0), 0));
      const a = this.attemptOf(folder).attempt;
      await this.setAttempt(folder, { ...a, marks: { ...a.marks, [id]: mark }, review: { ...a.review, [id]: { ...a.review[id], dispute: { text: argument, reply } } } });
    });
  }
  /** Manual override from a dispute: set the awarded points yourself. */
  async override(folder: string, id: string, awarded: boolean[]) {
    const { test, attempt } = this.attemptOf(folder), q = questions(test).find(x => x.id === id)!, m = attempt.marks[id];
    if (!m) return;
    await this.setAttempt(folder, { ...attempt, marks: { ...attempt.marks, [id]: { ...m, awarded, score: q.rubric.reduce((n, r, i) => n + (awarded[i] ? r.marks : 0), 0) } } });
  }
  async cardState(folder: string, target: { question: string } | { suggestion: number }, state: 'added' | 'skipped' | undefined) {
    const { attempt } = this.attemptOf(folder);
    if ('question' in target) await this.setAttempt(folder, { ...attempt, review: { ...attempt.review, [target.question]: { ...attempt.review[target.question], card: state === 'added' ? 'added' : undefined } } });
    else { const cards = { ...attempt.cards }; if (state) cards[target.suggestion] = state; else delete cards[target.suggestion]; await this.setAttempt(folder, { ...attempt, cards }); }
  }
  /**
   * After Obsidian or Qard starts: restart what a reload interrupted in the last day. Tests being written are written
   * again, sections left marking are marked, and finished tests without a summary get one.
   */
  async resume() {
    const root = this.settings().folder.replace(/\/+$/, ''), recent = (t?: number) => !!t && this.now() - t < 86_400_000;
    for (const folder of await this.storage.folders(root)) {
      const entry = await this.load(folder).catch(() => undefined);
      if (!entry) continue;
      if (!entry.test) { if (recent(entry.request?.writing)) void this.generate({ folder }); continue; }
      const attempt = entry.attempt; if (!attempt || !recent(attempt.finishedAt ?? attempt.startedAt)) continue;
      const pending = entry.test.sections.filter(s => { const st = attempt.sections[s.id]?.status; return st === 'marking' || (st === 'submitted' && (this.settings().marking === 'section' || !!attempt.finishedAt)); }).map(s => s.id);
      if (pending.length) void this.mark(folder, pending);
      else if (attempt.finishedAt && scoreOf(entry.test, attempt).marked && !attempt.wrapup) void this.wrapup(folder);
    }
  }
  async flush() { this.timers.forEach((timer, folder) => { window.clearTimeout(timer); void this.save(folder, 'attempt', this.cache.get(folder)?.attempt); }); this.timers.clear(); await Promise.all(this.writes.values()); }
  dispose() { this.disposed = true; void this.flush(); this.listeners.clear(); }
}
