import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, applyEvidence, breakCycles, parseMastery, readyToLearn, setFrontmatter, shortLabel, writeObjectives, newMasteryNote, type Objective } from '../src/learn/mastery';
import { layoutGraph, layoutTopic, OBJECTIVE, routeTo, topicsOf } from '../src/components/learn/CourseMap';
import { courseUpdateSchema } from '../src/learn/learn-schema';
import { LearnService, insertUnderHeading, summarise, type LearnStorage } from '../src/learn/learn-service';
import { objectivesSchema, probeMapSchema, probeSchema, questionsSchema, stepSchema, tutorMarkSchema, closeSchema } from '../src/learn/learn-schema';
import { marksSchema } from '../src/tests/test-schema';
import { readSettings } from '../src/settings/settings';
import type { AgentRole, AgentTask } from '../src/agents/runner';
import { OpenRouterRunner, type Http } from '../src/agents/openrouter-runner';
import type { CardLink } from '../src/review/review-store';
import type { PracticeTest, Question } from '../src/tests/test-types';

beforeAll(() => { (globalThis as { window?: unknown }).window ??= globalThis; });

const MASTERY = `---
qard-mastery: DS346
---

# DS346 mastery

My own intro stays.

| Objective | ID | State | Due | Notes | Evidence | Mine |
| --- | --- | --- | --- | --- | --- | --- |
| LDA generative process | lda-gen | misconception | 2026-09-29 | [[Topic Models]], [[Dirichlet\\|Dir]] | 2026-09-29 test q7 0/6 sure | keep me |
| Parameter counts | params | right once | 2026-10-06 | [[Topic Models]] | 2026-09-29 check 3/3 | |
| Oddly edited | odd | Right-Once |  |  |  | |

## After the table
Also stays.
`;
const obj = (patch: Partial<Objective> = {}): Objective => ({ id: 'o', title: 'O', state: 'new', notes: [], needs: [], evidence: [], cells: {}, ...patch });
const DAY = '2026-09-29';

describe('the mastery file', () => {
  it('reads objectives, wikilinks, escaped pipes and hand-edited states', () => {
    const m = parseMastery('Notes/DS346/DS346 Mastery.md', MASTERY);
    expect(m.course).toBe('DS346');
    expect(m.objectives.map(o => [o.id, o.state, o.due])).toEqual([['lda-gen', 'misconception', DAY], ['params', 'right once', '2026-10-06'], ['odd', 'right once', undefined]]);
    expect(m.objectives[0]!.notes).toEqual(['Topic Models', 'Dirichlet']);
    expect(m.objectives[0]!.evidence).toEqual(['2026-09-29 test q7 0/6 sure']);
  });
  it('rewrites only the table, keeping extra columns, column order and the rest of the note', () => {
    const m = parseMastery('x.md', MASTERY);
    const out = writeObjectives(MASTERY, m.objectives.map(o => o.id === 'params' ? { ...o, state: 'mastered', evidence: [...o.evidence, 'new | piped'] } : o));
    expect(out).toContain('My own intro stays.');
    expect(out).toContain('## After the table\nAlso stays.');
    expect(out).toContain('| Objective | ID | State | Due | Notes | Evidence | Mine |');
    expect(out).toContain('keep me');
    expect(out).toContain('new \\| piped');
    expect(parseMastery('x.md', out).objectives.find(o => o.id === 'params')).toMatchObject({ state: 'mastered', evidence: ['2026-09-29 check 3/3', 'new | piped'] });
  });
  it('creates a new file with frontmatter Qard can find again', () => {
    const text = newMasteryNote('CS345', [obj({ id: 'dfa-min', title: 'Minimise a DFA', notes: ['Notes/DFA.md'] })]);
    expect(parseMastery('CS345 Mastery.md', text).objectives).toMatchObject([{ id: 'dfa-min', notes: ['Notes/DFA'] }]);
    expect(text).toMatch(/^---\nqard-mastery: "CS345"\n---/);
  });
});

describe('the course map', () => {
  const TABLE = `---\nqard-mastery: X\nqard-mapped: 2026-09-01T10:00\n---\n\n| Objective | ID | State | Needs |\n| --- | --- | --- | --- |\n| A | a | mastered |  |\n| B | b | taught | a |\n| C | c | new | a, b, ghost |\n| D | d | Not covered yet | c |\n| E | e | gap | a |\n`;
  it('reads prerequisites from the Needs column, ignoring unknown ids, and the mapping time', () => {
    const m = parseMastery('x.md', TABLE);
    expect(m.mapped).toBe('2026-09-01T10:00');
    expect(m.objectives.map(o => [o.id, o.state, o.needs])).toEqual([['a', 'mastered', []], ['b', 'taught', ['a']], ['c', 'new', ['a', 'b']], ['d', 'planned', ['c']], ['e', 'gap', ['a']]]);
    expect(setFrontmatter(TABLE, 'qard-mapped', '2026-10-01T09:00')).toContain('qard-mapped: 2026-10-01T09:00\n---');
    expect(setFrontmatter('# x', 'k', 'v')).toBe('---\nk: v\n---\n\n# x');
  });
  it('knows what is ready to learn: untaught, with every prerequisite taught', () => {
    expect([...readyToLearn(parseMastery('x.md', TABLE))].sort()).toEqual(['c', 'e']);
  });
  it('routes arrows that skip rows through reserved gaps between nodes', () => {
    const chain = [obj({ id: 'a' }), obj({ id: 'b', needs: ['a'] }), obj({ id: 'c', needs: ['b', 'a'] })];
    const skip = layoutMap(chain).edges.find(e => e.from === 'a' && e.to === 'c')!;
    // Down through the gap in b's row: two points at the same x, joined by a straight segment.
    expect(skip.d).toMatch(/ L[\d.]+,[\d.]+/);
  });
  it('plans a route: untaught prerequisites in learning order, ending at the goal', () => {
    const m = parseMastery('x.md', `| Objective | ID | State | Needs |\n| --- | --- | --- | --- |\n| A | a | mastered |  |\n| B | b | gap | a |\n| C | c | new | a |\n| D | d | taught | c |\n| E | e | misconception | b, d |\n| F | f | new |  |\n`);
    expect(routeTo(m, 'e')).toEqual(['b', 'c', 'e']);
    expect(routeTo(m, 'a')).toEqual([]);
  });
  it('spills end points out of crowded rows', () => {
    const many = [obj({ id: 'root' }), ...Array.from({ length: 12 }, (_, i) => obj({ id: `leaf${i}`, needs: ['root'] }))];
    const layout = layoutMap(many), rows = new Map<number, number>();
    for (const p of layout.nodes.values()) rows.set(p.layer, (rows.get(p.layer) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(5);
    for (const p of layout.nodes.values()) if (p.id !== 'root') expect(p.layer).toBeGreaterThan(0);
  });
  it('breaks cycles by dropping the link that closes each loop, walking from the top of the table', () => {
    const cyclic = [obj({ id: 'a', needs: ['c'] }), obj({ id: 'b', needs: ['a'] }), obj({ id: 'c', needs: ['b'] })];
    expect(breakCycles(cyclic).map(o => o.needs)).toEqual([['c'], [], ['b']]);
  });
  const layoutMap = (objectives: Objective[]) => layoutGraph(objectives, OBJECTIVE);
  it('lays out foundations on top, each objective below its deepest prerequisite, without overlaps', () => {
    const layout = layoutMap(parseMastery('x.md', TABLE).objectives);
    const layer = (id: string) => layout.nodes.get(id)!.layer;
    expect(['a', 'b', 'c', 'd', 'e'].map(layer)).toEqual([0, 1, 2, 3, 1]);
    expect(layout.edges).toHaveLength(5);
    const nodes = [...layout.nodes.values()];
    for (const p of nodes) for (const q of nodes) if (p !== q && p.layer === q.layer) expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(OBJECTIVE.w);
  });
  it('uses short labels, falling back to the title without its leading verb', () => {
    expect(parseMastery('x.md', '| Objective | Label | ID | State |\n| --- | --- | --- | --- |\n| List the LDA generative process | LDA generative story | lda | gap |\n').objectives[0]!.label).toBe('LDA generative story');
    expect(shortLabel(obj({ title: 'Explain why the LDA posterior is intractable' }))).toBe('why the LDA posterior is intractable');
    expect(shortLabel(obj({ title: 'Explain the reasons why the Latent Dirichlet Allocation posterior is intractable' }))).toBe('the reasons why the Latent Dirichlet…');
    expect(shortLabel(obj({ title: 'Dirichlet draws' }))).toBe('Dirichlet draws');
    expect(shortLabel(obj({ title: 'Explain', label: '  Short  ' }))).toBe('Short');
  });
  const COURSE = parseMastery('x.md', `| Objective | ID | Group | State | Needs |\n| --- | --- | --- | --- | --- |\n| Tokens | tok | Text mining | mastered |  |\n| DTM | dtm | text  Mining | taught | tok |\n| Dirichlet | dir | Topic models | new |  |\n| LDA | lda | Topic models | misconception | dtm, dir, tok |\n| Params | par | Topic models | gap | lda |\n| CNNs | cnn | Deep learning | planned |  |\n`);
  it('derives topics from groups: progress, warnings, readiness and weighted dependencies', () => {
    const topics = topicsOf(COURSE);
    expect(topics.map(t => [t.key, t.name, t.ids.length, t.learned, t.mastered, t.warnings, t.ready, t.planned])).toEqual([
      ['text mining', 'Text mining', 2, 2, 1, 0, 0, false], ['topic models', 'Topic models', 3, 0, 0, 1, 1, false], ['deep learning', 'Deep learning', 1, 0, 0, 0, 0, true]
    ]);
    const models = topics[1]!;
    expect(models.needs).toEqual(['text mining']);
    expect(models.weight.get('text mining')).toBe(2);
  });
  it('opens a topic with links to the topics it builds on (top row) and unlocks (bottom)', () => {
    const models = layoutTopic(COURSE, 'topic models');
    expect([...models.nodes.keys()].sort()).toEqual(['@in:text mining', 'dir', 'lda', 'par']);
    expect(models.nodes.get('@in:text mining')!.layer).toBe(0);
    const text = layoutTopic(COURSE, 'text mining');
    expect([...text.nodes.keys()].sort()).toEqual(['@out:topic models', 'dtm', 'tok']);
    expect(text.nodes.get('@out:topic models')!.layer).toBeGreaterThan(text.nodes.get('dtm')!.layer);
  });
  it('breaks cycles by dropping the link that closes each loop, walking from the top of the table', () => {
    const cyclic = [obj({ id: 'a', needs: ['c'] }), obj({ id: 'b', needs: ['a'] }), obj({ id: 'c', needs: ['b'] })];
    expect(breakCycles(cyclic).map(o => o.needs)).toEqual([['c'], [], ['b']]);
  });
});

describe('learning rules', () => {
  const pass = { kind: 'check' as const, day: DAY, score: 3, marks: 3 };
  it('a lesson reaches taught at most, with a check in three days', () => {
    expect(applyEvidence(obj({ state: 'misconception' }), { kind: 'lesson', day: DAY })).toMatchObject({ state: 'taught', due: '2026-10-02' });
    expect(applyEvidence(obj({ state: 'right once', due: 'x' }), { kind: 'lesson', day: DAY })).toMatchObject({ state: 'right once', due: 'x' });
  });
  it('mastery needs two passes at least two days apart', () => {
    const once = applyEvidence(obj({ state: 'taught' }), pass);
    expect(once).toMatchObject({ state: 'right once', due: addDays(DAY, 7) });
    expect(applyEvidence(once, { ...pass, day: addDays(DAY, 1) }).state).toBe('right once');
    expect(applyEvidence(once, { ...pass, day: addDays(DAY, 7) })).toMatchObject({ state: 'mastered', due: addDays(DAY, 52) });
  });
  it('confidence changes the outcome', () => {
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, confidence: 'guess' }).state).toBe('shaky');
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, score: 0, confidence: 'sure' })).toMatchObject({ state: 'misconception', due: DAY });
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, score: 0, confidence: 'unknown' }).state).toBe('gap');
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, score: 1.5 }).state).toBe('shaky');
    expect(applyEvidence(obj({ state: 'mastered' }), { ...pass, score: 0 }).state).toBe('slipping');
  });
  it('lapsing cards only affect mastered objectives', () => {
    expect(applyEvidence(obj({ state: 'mastered' }), { kind: 'card', day: DAY }).state).toBe('slipping');
    expect(applyEvidence(obj({ state: 'taught' }), { kind: 'card', day: DAY }).state).toBe('taught');
  });
  it('keeps the evidence column short', () => {
    let o = obj({ state: 'taught' });
    for (let i = 0; i < 9; i++) o = applyEvidence(o, { kind: 'lesson', day: DAY });
    expect(o.evidence).toHaveLength(6);
  });
  it('summarises a set of answers into one piece of evidence', () => {
    const q = (marks: number) => ({ id: 'q', type: 'short', prompt: '', marks, rubric: [], model: '' }) as Question;
    const m = (score: number) => ({ score, awarded: [], annotations: [], mistake: 'none' as const, feedback: '' });
    expect(summarise([{ q: q(2), answer: { confidence: 'sure' }, mark: m(0) }, { q: q(2), answer: { confidence: 'guess' }, mark: m(2) }])).toEqual({ score: 2, marks: 4, confidence: 'sure' });
    expect(summarise([{ q: q(2), answer: { confidence: 'guess' }, mark: m(2) }])).toMatchObject({ confidence: 'guess' });
    expect(summarise([{ q: q(2), answer: { unknown: true }, mark: m(0) }])).toMatchObject({ confidence: 'unknown' });
    // Sure but only incomplete is not a misconception.
    expect(summarise([{ q: q(3), answer: { confidence: 'sure' }, mark: { ...m(1), mistake: 'incomplete' } }])).toMatchObject({ confidence: 'unsure' });
    expect(summarise([{ q: q(3), answer: { confidence: 'sure' }, mark: { ...m(1), mistake: 'misconception' } }])).toMatchObject({ confidence: 'sure' });
  });
  it('adds a suggested paragraph at the end of the right section', () => {
    const note = '# Topic Models\n\nIntro.\n\n## Dirichlet\n\nA prior.\n\n## LDA\n\nText.\n';
    expect(insertUnderHeading(note, 'Dirichlet', 'A draw is a point on the simplex.')).toBe('# Topic Models\n\nIntro.\n\n## Dirichlet\n\nA prior.\n\nA draw is a point on the simplex.\n\n## LDA\n\nText.\n');
    expect(insertUnderHeading(note, '', 'End.')).toBe(note + '\nEnd.\n');
  });
});

// ---- the service, end to end, with a scripted agent ----------------------
const q = (id: string, extra: Partial<Question> = {}): Question => ({ id, type: 'short', prompt: `Prompt ${id}`, marks: 2, rubric: [{ point: 'A', marks: 1 }, { point: 'B', marks: 1 }], model: 'Model', ...extra });
const mcq = (id: string): Question => q(id, { type: 'mcq', marks: 1, rubric: [{ point: 'right', marks: 1 }], options: ['a', 'b'], answer: 1 });
const markOf = (id: string, awarded: boolean[]) => ({ id, score: 99, awarded, annotations: [], mistake: 'incomplete', feedback: 'ok' });

function setup() {
  const files = new Map<string, string>([['Notes/DS346/Topic Models.md', '# Topic Models\n\n## Dirichlet\n\nA prior.\n'], ['Notes/DS346/DS346 Hub.md', 'hub']]);
  const modified = new Map<string, number>();
  const storage: LearnStorage = {
    read: async p => files.get(p) ?? null, write: async (p, t) => { files.set(p, t); }, exists: p => files.has(p),
    process: async (p, fn) => { const t = files.get(p); if (t === undefined) throw new Error('missing'); files.set(p, fn(t)); },
    files: (folder, ext) => [...files.keys()].filter(p => p.startsWith(folder + '/') && p.endsWith('.' + ext)).sort(),
    masteryFiles: () => [...files.entries()].filter(([p, t]) => p.endsWith('.md') && /^---\n[\s\S]*?qard-mastery:/.test(t)).map(([p]) => p),
    modified: p => modified.get(p), resolve: link => [...files.keys()].find(p => p === link || p.endsWith('/' + link + '.md'))
  };
  const calls: { role: AgentRole; task: AgentTask }[] = [];
  const replies: { schema: unknown; reply: (task: AgentTask) => unknown }[] = [];
  const reply = (schema: unknown, fn: (task: AgentTask) => unknown) => replies.push({ schema, reply: fn });
  const runner = (role: AgentRole) => ({ name: 'fake', run: async (task: AgentTask) => {
    calls.push({ role, task });
    const found = replies.find(r => r.schema === task.schema);
    if (!found) throw new Error('unexpected task');
    return found.reply(task);
  } });
  const links = new Map<string, CardLink>();
  let now = new Date(2026, 8, 29, 10).getTime();
  const settings = readSettings({ learn: { folder: 'Qard' } });
  const learn = new LearnService(storage, () => settings, runner, { get: id => links.get(id), set: async (id, l) => { links.set(id, l); } }, () => 4, () => now);
  return { files, modified, learn, calls, reply, links, advance: (days: number) => { now += days * 86_400_000; } };
}
const settle = () => new Promise(r => setTimeout(r, 0));
async function mapped() {
  const t = setup();
  t.reply(objectivesSchema, () => ({ course: 'DS346', objectives: [
    { id: 'LDA Generative', title: 'LDA generative process', notes: ['Notes/DS346/Topic Models.md'], needs: [], group: 'Topic models', label: 'Short name', state: 'misconception', evidence: 'test 2026-09-29 q7 0/6 sure' },
    { id: 'params', title: 'Parameter counts', notes: ['Notes/DS346/Topic Models.md'], needs: [], group: 'Topic models', label: 'Short name', state: 'new', evidence: '' }
  ] }));
  await t.learn.mapCourse('Notes/DS346');
  const path = await t.learn.acceptCourse('Notes/DS346', ['lda-generative', 'params']);
  return { ...t, path };
}

describe('learning service', () => {
  it('maps a course folder into a mastery file only after the student accepts', async () => {
    const t = await mapped();
    expect(t.path).toBe('Notes/DS346/DS346 Mastery.md');
    expect(t.calls[0]!.role).toBe('writer');
    expect(t.calls[0]!.task.prompt).toContain('Notes/DS346/Topic Models.md');
    const course = (await t.learn.courses())[0]!;
    expect(course.objectives).toMatchObject([{ id: 'lda-generative', state: 'misconception', due: DAY, notes: ['Topic Models'] }, { id: 'params', state: 'new' }]);
    const today = await t.learn.todayList();
    expect(today.lessons.map(l => l.objective)).toEqual(['lda-generative']);
    expect(today.cards).toBe(4);
  });

  it('maps prerequisites and planned topics, and stamps the mapping time', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({ course: 'DS346', objectives: [
      { id: 'Bag Of Words', title: 'Bag of words', notes: ['Notes/DS346/Topic Models.md'], needs: [], group: 'Topic models', label: 'Short name', state: 'new', evidence: '' },
      { id: 'lda', title: 'LDA', notes: ['Notes/DS346/Topic Models.md'], needs: ['Bag Of Words', 'hadoop', 'lda'], group: 'Topic models', label: 'Short name', state: 'new', evidence: '' },
      { id: 'hadoop', title: 'Hadoop', notes: [], needs: ['lda'], group: 'Topic models', label: 'Short name', state: 'planned', evidence: '' },
      { id: 'cloud', title: 'Cloud', notes: ['Notes/DS346/DS346 Hub.md'], needs: [], group: 'Topic models', label: 'Short name', state: 'planned', evidence: '' }
    ] }));
    await t.learn.mapCourse('Notes/DS346');
    const path = await t.learn.acceptCourse('Notes/DS346', ['bag-of-words', 'lda', 'hadoop', 'cloud']);
    const m = await t.learn.course(path);
    // Ids are cleaned, links follow them, the lda <-> hadoop cycle is broken, and a "planned" topic with notes is just new.
    expect(m.objectives.map(o => [o.id, o.state, o.needs])).toEqual([['bag-of-words', 'new', []], ['lda', 'new', ['bag-of-words', 'hadoop']], ['hadoop', 'planned', []], ['cloud', 'new', []]]);
    expect(m.mapped).toBe('2026-09-29T10:00');
  });

  it('grows with the course: finds changed notes and applies only the ticked additions', async () => {
    const t = await mapped();
    const before = await t.learn.course(t.path);
    expect(t.learn.changedNotes(before)).toEqual([]);
    t.files.set('Notes/DS346/Hadoop.md', '# Hadoop');
    t.modified.set('Notes/DS346/Hadoop.md', new Date(2026, 9, 6).getTime());
    t.modified.set('Notes/DS346/DS346 Mastery.md', new Date(2026, 9, 6).getTime());
    expect(t.learn.changedNotes(before)).toEqual(['Notes/DS346/Hadoop.md']);
    t.advance(7);
    t.reply(courseUpdateSchema, () => ({
      added: [{ id: 'mapreduce', title: 'MapReduce phases', notes: ['Notes/DS346/Hadoop.md'], needs: ['params', 'nope'], group: 'Topic models', label: 'Short name', state: 'new', evidence: '' }, { id: 'hdfs', title: 'HDFS', notes: [], needs: [], group: 'Topic models', label: 'Short name', state: 'planned', evidence: '' }],
      extended: [{ id: 'params', notes: ['Notes/DS346/Hadoop.md', 'Notes/DS346/Topic Models.md'], needs: ['lda-generative'], group: 'Ignored, it has one', label: 'Ignored too' }, { id: 'ghost', notes: ['x'], needs: [], group: '', label: '' }],
      outdated: [{ id: 'lda-generative', reason: 'No longer covered' }]
    }));
    await t.learn.updateCourse(t.path);
    const call = t.calls.at(-1)!;
    expect(call.role).toBe('writer');
    expect(call.task.prompt).toContain('- Notes/DS346/Hadoop.md');
    expect(call.task.prompt).toContain('lda-generative | LDA generative process | Short name | Topic models | misconception');
    const update = t.learn.update(t.path)!;
    expect(update.added.map(o => [o.id, o.needs])).toEqual([['mapreduce', ['params']], ['hdfs', []]]);
    expect(update.extended).toEqual([{ id: 'params', title: 'Parameter counts', notes: ['Hadoop'], needs: ['lda-generative'], group: undefined, label: undefined }]);
    await t.learn.acceptUpdate(t.path, { added: ['mapreduce'], extended: ['params'], remove: [] });
    const after = await t.learn.course(t.path);
    expect(after.objectives.map(o => o.id)).toEqual(['lda-generative', 'params', 'mapreduce']);
    expect(after.objectives[0]).toMatchObject({ state: 'misconception', evidence: ['test 2026-09-29 q7 0/6 sure'] });
    expect(after.objectives[1]).toMatchObject({ notes: ['Topic Models', 'Hadoop'], needs: ['lda-generative'] });
    expect(after.mapped).toBe('2026-10-06T10:00');
    expect(t.learn.changedNotes(after)).toEqual([]);
  });

  it('prefers lessons whose prerequisites are already taught', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({ course: 'DS346', objectives: [
      { id: 'base', title: 'Base', notes: [], needs: [], group: 'Topic models', label: 'Short name', state: 'gap', evidence: 'x' },
      { id: 'top', title: 'Top', notes: [], needs: ['base'], group: 'Topic models', label: 'Short name', state: 'gap', evidence: 'x' },
      { id: 'side', title: 'Side', notes: [], needs: [], group: 'Topic models', label: 'Short name', state: 'gap', evidence: 'x' }
    ] }));
    await t.learn.mapCourse('Notes/DS346');
    const path = await t.learn.acceptCourse('Notes/DS346', ['base', 'top', 'side']);
    await t.learn.setState(path, 'side', 'taught', '2026-10-02');
    await t.learn.setState(path, 'top', 'gap', '2026-09-20');
    expect((await t.learn.todayList()).lessons.map(l => l.objective)).toEqual(['base', 'top']);
  });

  it('suggests at most three lessons a day, misconceptions first', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({ course: 'DS346', objectives: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, title: id, notes: [], needs: [], group: 'Topic models', label: 'Short name', state: i === 4 ? 'misconception' : 'gap', evidence: 'x' })) }));
    await t.learn.mapCourse('Notes/DS346');
    await t.learn.acceptCourse('Notes/DS346', ['a', 'b', 'c', 'd', 'e']);
    const today = await t.learn.todayList();
    expect(today.lessons.map(l => l.objective)).toEqual(['e', 'a', 'b']);
    expect(today.moreLessons).toBe(2);
  });

  it('runs a check: written ahead by the writer, marked by the tutor, recorded as evidence', async () => {
    const t = await mapped();
    await t.learn.setState(t.path, 'params', 'taught', DAY);
    t.reply(questionsSchema, () => ({ questions: [mcq('c1'), q('c2')] }));
    const check = (await t.learn.ensureCheck(t.path, 'params'))!;
    expect(check).toBe(`Qard/Checks/DS346/${DAY} params.json`);
    expect(t.calls.at(-1)).toMatchObject({ role: 'writer' });
    expect(t.calls.at(-1)!.task.prompt).toContain('Goal: explain');
    // A second request reuses the waiting check.
    expect(await t.learn.ensureCheck(t.path, 'params')).toBe(check);
    expect((await t.learn.todayList()).checks).toMatchObject([{ objective: 'params', check }]);

    t.learn.answerCheck(check, 'c1', { choice: 1, confidence: 'sure' });
    t.learn.answerCheck(check, 'c2', { text: 'A and B', confidence: 'sure' });
    t.reply(marksSchema, () => ({ questions: [markOf('c2', [true, true])] }));
    await t.learn.submitCheck(check);
    const marking = t.calls.find(c => c.task.schema === marksSchema)!;
    expect(marking.role).toBe('tutor');
    expect(marking.task).toMatchObject({ vault: false, effort: 'low' });
    expect(marking.task.prompt).not.toContain('c1');
    const record = t.learn.checkAt(check)!;
    expect(record.marks.c2!.score).toBe(2);
    expect(record.finishedAt).toBeDefined();
    const params = (await t.learn.course(t.path)).objectives.find(o => o.id === 'params')!;
    expect(params).toMatchObject({ state: 'right once', due: addDays(DAY, 7) });
    expect(params.evidence.at(-1)).toBe('2026-09-29 check explain 3/3 sure');
    await settle();
    // The next check is written straight away, at a harder goal.
    expect(t.calls.filter(c => c.task.schema === questionsSchema).at(-1)!.task.prompt).toContain('Goal: apply');
  });

  it('rewrites an unanswered check when its notes change', async () => {
    const t = await mapped();
    await t.learn.setState(t.path, 'params', 'taught', DAY);
    t.reply(questionsSchema, () => ({ questions: [q('c1')] }));
    await t.learn.ensureCheck(t.path, 'params');
    t.modified.set('Notes/DS346/Topic Models.md', Date.now() + 10 ** 12);
    await t.learn.ensureCheck(t.path, 'params');
    expect(t.calls.filter(c => c.task.schema === questionsSchema)).toHaveLength(2);
  });

  it('teaches a lesson: probe, plan, steps, live marking, close', async () => {
    const t = await mapped();
    t.reply(probeSchema, () => ({ questions: [mcq('p1'), q('p2', { objective: 'params' })], note: 'Checks the prerequisites.' }));
    const lesson = await t.learn.startLesson({ topic: 'LDA generative process', notes: [], mastery: t.path, objective: 'lda-generative' });
    await settle(); await settle();
    // The objective's notes are inlined, so the live tutor needs no tools.
    expect(t.calls.at(-1)).toMatchObject({ role: 'tutor', task: { vault: false } });
    expect(t.calls.at(-1)!.task.prompt).toContain('<note path="Notes/DS346/Topic Models.md">\n# Topic Models');
    expect(t.learn.lessonAt(lesson)!.notes).toEqual(['Notes/DS346/Topic Models.md']);

    t.learn.answerProbe(lesson, 'p1', { choice: 0 });
    t.learn.answerProbe(lesson, 'p2', { unknown: true });
    t.reply(probeMapSchema, () => ({ marks: [], findings: 'Dirichlet is the missing foundation.', map: { title: 'The LDA story', plan: 'Start from pLSA.', mermaid: 'graph TD; A-->B', steps: [{ title: 'Dirichlet draws', why: 'Needed next.' }, { title: 'The full story', why: 'The goal.' }] } }));
    await t.learn.submitProbe(lesson);
    let l = t.learn.lessonAt(lesson)!;
    expect(l.probe!.marks).toMatchObject({ p1: { score: 0 }, p2: { mistake: 'unknown' } });
    expect(l.map!.steps).toHaveLength(2);
    // The "I don't know" probe on a known objective is evidence.
    expect((await t.learn.course(t.path)).objectives.find(o => o.id === 'params')!.state).toBe('gap');

    t.reply(stepSchema, task => ({ title: task.prompt.includes('step 1 of') ? 'Dirichlet draws' : 'The full story', explain: 'A draw is a point on the simplex.', connect: 'Links.', checkFirst: true, check: q('x'), misconceptions: [{ signs: 'Thinks a draw is a number', reteach: 'It is a whole vector.' }] }));
    await t.learn.acceptMap(lesson);
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)!.steps.every(Boolean)).toBe(true));
    expect(t.calls.filter(c => c.task.schema === stepSchema).every(c => c.role === 'writer')).toBe(true);
    l = t.learn.lessonAt(lesson)!;
    expect(l.steps[0]!.check).toMatchObject({ id: 'k1', objective: 'lda-generative' });

    t.learn.answerStep(lesson, { text: 'A number', confidence: 'sure' });
    t.reply(tutorMarkSchema, () => ({ score: 2, awarded: [false, false], annotations: [], mistake: 'misconception', feedback: 'Not quite.', reply: 'A draw is not one number.', misconception: 0 }));
    await t.learn.checkStep(lesson);
    l = t.learn.lessonAt(lesson)!;
    expect(l.state[0]).toMatchObject({ mark: { score: 0 }, reply: 'A draw is not one number.', reteach: 'It is a whole vector.' });
    expect(t.calls.at(-1)).toMatchObject({ role: 'tutor', task: { vault: false } });

    await t.learn.go(lesson, 1);
    t.learn.answerStep(lesson, { unknown: true });
    await t.learn.checkStep(lesson);
    expect(t.learn.lessonAt(lesson)!.state[1]!.mark!.mistake).toBe('unknown');

    t.reply(closeSchema, () => ({ summary: 'We built LDA from Dirichlet draws.', cards: [{ front: 'What is a Dirichlet draw?', back: 'A point on the simplex.' }], noteEdit: { path: 'Notes/DS346/Topic Models.md', heading: 'Dirichlet', text: 'A draw is a point on the simplex.' } }));
    t.reply(questionsSchema, () => ({ questions: [q('c1')] }));
    await t.learn.finishLesson(lesson);
    l = t.learn.lessonAt(lesson)!;
    expect(l.close).toMatchObject({ summary: 'We built LDA from Dirichlet draws.', nextCheck: '2026-10-02' });
    expect((await t.learn.course(t.path)).objectives[0]).toMatchObject({ state: 'taught', evidence: ['test 2026-09-29 q7 0/6 sure', '2026-09-29 lesson 0/2 checks'] });
    expect(t.files.get(lesson.replace('.json', '.md'))).toContain('## Summary\n\nWe built LDA from Dirichlet draws.');
    expect(await t.learn.pendingCheck(t.path, 'lda-generative')).toBeDefined();

    await t.learn.lessonCard(lesson, 0, 'added', 'card-1');
    expect(t.links.get('card-1')).toEqual({ mastery: t.path, objective: 'lda-generative', lapses: 0 });
    await t.learn.noteEdit(lesson, true);
    expect(t.files.get('Notes/DS346/Topic Models.md')).toBe('# Topic Models\n\n## Dirichlet\n\nA prior.\n\nA draw is a point on the simplex.\n');
  });

  it('records tagged test questions and slips mastered objectives when cards lapse', async () => {
    const t = await mapped();
    const test = { version: 1, title: 'T', createdAt: 0, mastery: t.path, sections: [{ id: 's1', title: 'S', questions: [q('q1', { objective: 'params' }), q('q2', { objective: 'params' }), q('q3')] }] } as PracticeTest;
    const mark = (score: number) => ({ score, awarded: [], annotations: [], mistake: 'none' as const, feedback: '' });
    await t.learn.recordTest(test, { version: 1, startedAt: 0, answers: {}, sections: {}, review: {}, marks: { q1: mark(2), q2: mark(1), q3: mark(0) } });
    expect((await t.learn.course(t.path)).objectives.find(o => o.id === 'params')).toMatchObject({ state: 'right once', evidence: ['2026-09-29 test q1+q2 3/4'] });

    await t.learn.setState(t.path, 'params', 'mastered', '2026-12-01');
    await t.learn.linkCard('card-9', t.path, 'params');
    await t.learn.cardLapse('card-9');
    expect((await t.learn.course(t.path)).objectives.find(o => o.id === 'params')!.state).toBe('mastered');
    await t.learn.cardLapse('card-9');
    expect((await t.learn.course(t.path)).objectives.find(o => o.id === 'params')).toMatchObject({ state: 'slipping', due: DAY });
  });
});

describe('OpenRouter', () => {
  const vault = { paths: () => ['Notes/A.md'], read: async () => 'Alpha note.' };
  const ok = (message: unknown) => ({ status: 200, json: { choices: [{ message, finish_reason: 'stop' }] } });
  it('runs the note tools and returns validated JSON', async () => {
    const http = vi.fn<Http>()
      .mockResolvedValueOnce(ok({ content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_note', arguments: '{"path":"Notes/A.md"}' } }] }))
      .mockResolvedValueOnce(ok({ content: '{"answer":"Alpha"}' }));
    const runner = new OpenRouterRunner(vault, () => 'key', 'anthropic/claude-haiku-4.5', [], http);
    expect(await runner.run({ prompt: 'Read A', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } })).toEqual({ answer: 'Alpha' });
    const second = JSON.parse(http.mock.calls[1]![1].body!) as { messages: { role: string; content: string }[]; response_format: unknown; model: string };
    expect(second.model).toBe('anthropic/claude-haiku-4.5');
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', content: 'Alpha note.' });
    expect(second.response_format).toBeDefined();
    expect(http.mock.calls[0]![1].headers.Authorization).toBe('Bearer key');
  });
  it('drops structured output when a provider rejects it, and explains auth failures', async () => {
    const http = vi.fn<Http>().mockResolvedValueOnce({ status: 400, json: {} }).mockResolvedValueOnce(ok({ content: '{"a":1}' }));
    const runner = new OpenRouterRunner(vault, () => 'key', 'm', [], http);
    expect(await runner.run({ prompt: 'x', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, vault: false })).toEqual({ a: 1 });
    const retry = JSON.parse(http.mock.calls[1]![1].body!) as Record<string, unknown>;
    expect(retry.response_format).toBeUndefined();
    expect(retry.tools).toBeUndefined();
    await expect(new OpenRouterRunner(vault, () => 'bad', 'm', [], vi.fn<Http>().mockResolvedValue({ status: 401, json: {} })).run({ prompt: 'x', schema: { type: 'string' } })).rejects.toThrow(/key was rejected/);
    await expect(new OpenRouterRunner(vault, () => null, 'm', []).run({ prompt: 'x', schema: { type: 'string' } })).rejects.toThrow(/Add an OpenRouter API key/);
  });
});
