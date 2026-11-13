// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  applyEvidence,
  breakCycles,
  parseMastery,
  readyToLearn,
  setFrontmatter,
  shortLabel,
  writeObjectives,
  newMasteryNote,
  type Objective,
} from '../src/learn/mastery';
import { layoutGraph, layoutTopic, OBJECTIVE, routeTo, topicsOf } from '../src/learn/course-graph';
import { courseUpdateSchema, firstSentences } from '../src/learn/learn-schema';
import { LearnService } from '../src/learn/learn-service';
import { checkPromptFingerprint, stepReviewSchema } from '../src/learn/step-review';
import { insertUnderHeading } from '../src/learn/note-edits';
import { summarise } from '../src/learn/learning-evidence';
import { type LearnStorage } from '../src/learn/learn-contracts';
import {
  figureSchema,
  mapSchema,
  objectivesSchema,
  probeMapSchema,
  probeSchema,
  questionsSchema,
  stepSchema,
  tutorMarkSchema,
  closeSchema,
} from '../src/learn/learn-schema';
import { marksSchema } from '../src/tests/test-schema';
import { readSettings } from '../src/settings/settings';
import type { AgentRole, AgentTask } from '../src/agents/runner';
import { OpenRouterRunner, type Http } from '../src/agents/openrouter-runner';
import type { CardLink } from '../src/review/review-store';
import type { CheckRecord } from '../src/learn/learn-types';
import type { PracticeTest, Question } from '../src/tests/test-types';

beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
  vi.stubGlobal('crypto', webcrypto);
});

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
const obj = (patch: Partial<Objective> = {}): Objective => ({
  id: 'o',
  title: 'O',
  state: 'new',
  notes: [],
  needs: [],
  evidence: [],
  cells: {},
  ...patch,
});
const DAY = '2026-09-29';

describe('the mastery file', () => {
  it('reads objectives, wikilinks, escaped pipes and hand-edited states', () => {
    const m = parseMastery('Notes/DS346/DS346 Mastery.md', MASTERY);
    expect(m.course).toBe('DS346');
    expect(m.objectives.map((o) => [o.id, o.state, o.due])).toEqual([
      ['lda-gen', 'misconception', DAY],
      ['params', 'right once', '2026-10-06'],
      ['odd', 'right once', undefined],
    ]);
    expect(m.objectives[0]!.notes).toEqual(['Topic Models', 'Dirichlet']);
    expect(m.objectives[0]!.evidence).toEqual(['2026-09-29 test q7 0/6 sure']);
  });
  it('rewrites only the table, keeping extra columns, column order and the rest of the note', () => {
    const m = parseMastery('x.md', MASTERY);
    const out = writeObjectives(
      MASTERY,
      m.objectives.map((o) =>
        o.id === 'params'
          ? { ...o, state: 'mastered', evidence: [...o.evidence, 'new | piped'] }
          : o,
      ),
    );
    expect(out).toContain('My own intro stays.');
    expect(out).toContain('## After the table\nAlso stays.');
    expect(out).toContain('| Objective | ID | State | Due | Notes | Evidence | Mine |');
    expect(out).toContain('keep me');
    expect(out).toContain('new \\| piped');
    expect(parseMastery('x.md', out).objectives.find((o) => o.id === 'params')).toMatchObject({
      state: 'mastered',
      evidence: ['2026-09-29 check 3/3', 'new | piped'],
    });
  });
  it('creates a new file with frontmatter Qard can find again', () => {
    const text = newMasteryNote('CS345', [
      obj({ id: 'dfa-min', title: 'Minimise a DFA', notes: ['Notes/DFA.md'] }),
    ]);
    expect(parseMastery('CS345 Mastery.md', text).objectives).toMatchObject([
      { id: 'dfa-min', notes: ['Notes/DFA'] },
    ]);
    expect(text).toMatch(/^---\nqard-mastery: "CS345"\n---/);
  });
});

describe('the course map', () => {
  const TABLE = `---\nqard-mastery: X\nqard-mapped: 2026-09-01T10:00\n---\n\n| Objective | ID | State | Needs |\n| --- | --- | --- | --- |\n| A | a | mastered |  |\n| B | b | taught | a |\n| C | c | new | a, b, ghost |\n| D | d | Not covered yet | c |\n| E | e | gap | a |\n`;
  it('reads prerequisites from the Needs column, ignoring unknown ids, and the mapping time', () => {
    const m = parseMastery('x.md', TABLE);
    expect(m.mapped).toBe('2026-09-01T10:00');
    expect(m.objectives.map((o) => [o.id, o.state, o.needs])).toEqual([
      ['a', 'mastered', []],
      ['b', 'taught', ['a']],
      ['c', 'new', ['a', 'b']],
      ['d', 'planned', ['c']],
      ['e', 'gap', ['a']],
    ]);
    expect(setFrontmatter(TABLE, 'qard-mapped', '2026-10-01T09:00')).toContain(
      'qard-mapped: 2026-10-01T09:00\n---',
    );
    expect(setFrontmatter('# x', 'k', 'v')).toBe('---\nk: v\n---\n\n# x');
  });
  it('knows what is ready to learn: untaught, with every prerequisite taught', () => {
    expect([...readyToLearn(parseMastery('x.md', TABLE))].sort()).toEqual(['c', 'e']);
  });
  it('routes arrows that skip rows through reserved gaps between nodes', () => {
    const chain = [
      obj({ id: 'a' }),
      obj({ id: 'b', needs: ['a'] }),
      obj({ id: 'c', needs: ['b', 'a'] }),
    ];
    const skip = layoutMap(chain).edges.find((e) => e.from === 'a' && e.to === 'c')!;
    // Down through the gap in b's row: two points at the same x, joined by a straight segment.
    expect(skip.d).toMatch(/ L[\d.]+,[\d.]+/);
  });
  it('plans a route: untaught prerequisites in learning order, ending at the goal', () => {
    const m = parseMastery(
      'x.md',
      `| Objective | ID | State | Needs |\n| --- | --- | --- | --- |\n| A | a | mastered |  |\n| B | b | gap | a |\n| C | c | new | a |\n| D | d | taught | c |\n| E | e | misconception | b, d |\n| F | f | new |  |\n`,
    );
    expect(routeTo(m, 'e')).toEqual(['b', 'c', 'e']);
    expect(routeTo(m, 'a')).toEqual([]);
  });
  it('spills end points out of crowded rows', () => {
    const many = [
      obj({ id: 'root' }),
      ...Array.from({ length: 12 }, (_, i) => obj({ id: `leaf${i}`, needs: ['root'] })),
    ];
    const layout = layoutMap(many),
      rows = new Map<number, number>();
    for (const p of layout.nodes.values()) rows.set(p.layer, (rows.get(p.layer) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(5);
    for (const p of layout.nodes.values()) if (p.id !== 'root') expect(p.layer).toBeGreaterThan(0);
  });
  it('breaks cycles by dropping the link that closes each loop, walking from the top of the table', () => {
    const cyclic = [
      obj({ id: 'a', needs: ['c'] }),
      obj({ id: 'b', needs: ['a'] }),
      obj({ id: 'c', needs: ['b'] }),
    ];
    expect(breakCycles(cyclic).map((o) => o.needs)).toEqual([['c'], [], ['b']]);
  });
  const layoutMap = (objectives: Objective[]) => layoutGraph(objectives, OBJECTIVE);
  it('lays out foundations on top, each objective below its deepest prerequisite, without overlaps', () => {
    const layout = layoutMap(parseMastery('x.md', TABLE).objectives);
    const layer = (id: string) => layout.nodes.get(id)!.layer;
    expect(['a', 'b', 'c', 'd', 'e'].map(layer)).toEqual([0, 1, 2, 3, 1]);
    expect(layout.edges).toHaveLength(5);
    const nodes = [...layout.nodes.values()];
    for (const p of nodes)
      for (const q of nodes)
        if (p !== q && p.layer === q.layer)
          expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(OBJECTIVE.w);
  });
  it('uses short labels, falling back to the title without its leading verb', () => {
    expect(
      parseMastery(
        'x.md',
        '| Objective | Label | ID | State |\n| --- | --- | --- | --- |\n| List the LDA generative process | LDA generative story | lda | gap |\n',
      ).objectives[0]!.label,
    ).toBe('LDA generative story');
    expect(shortLabel(obj({ title: 'Explain why the LDA posterior is intractable' }))).toBe(
      'why the LDA posterior is intractable',
    );
    expect(
      shortLabel(
        obj({
          title: 'Explain the reasons why the Latent Dirichlet Allocation posterior is intractable',
        }),
      ),
    ).toBe('the reasons why the Latent Dirichlet…');
    expect(shortLabel(obj({ title: 'Dirichlet draws' }))).toBe('Dirichlet draws');
    expect(shortLabel(obj({ title: 'Explain', label: '  Short  ' }))).toBe('Short');
  });
  const COURSE = parseMastery(
    'x.md',
    `| Objective | ID | Group | State | Needs |\n| --- | --- | --- | --- | --- |\n| Tokens | tok | Text mining | mastered |  |\n| DTM | dtm | text  Mining | taught | tok |\n| Dirichlet | dir | Topic models | new |  |\n| LDA | lda | Topic models | misconception | dtm, dir, tok |\n| Params | par | Topic models | gap | lda |\n| CNNs | cnn | Deep learning | planned |  |\n`,
  );
  it('derives topics from groups: progress, warnings, readiness and weighted dependencies', () => {
    const topics = topicsOf(COURSE);
    expect(
      topics.map((t) => [
        t.key,
        t.name,
        t.ids.length,
        t.learned,
        t.mastered,
        t.warnings,
        t.ready,
        t.planned,
      ]),
    ).toEqual([
      ['text mining', 'Text mining', 2, 2, 1, 0, 0, false],
      ['topic models', 'Topic models', 3, 0, 0, 1, 1, false],
      ['deep learning', 'Deep learning', 1, 0, 0, 0, 0, true],
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
    expect(text.nodes.get('@out:topic models')!.layer).toBeGreaterThan(
      text.nodes.get('dtm')!.layer,
    );
  });
  it('breaks cycles by dropping the link that closes each loop, walking from the top of the table', () => {
    const cyclic = [
      obj({ id: 'a', needs: ['c'] }),
      obj({ id: 'b', needs: ['a'] }),
      obj({ id: 'c', needs: ['b'] }),
    ];
    expect(breakCycles(cyclic).map((o) => o.needs)).toEqual([['c'], [], ['b']]);
  });
});

describe('learning rules', () => {
  const pass = { kind: 'check' as const, day: DAY, score: 3, marks: 3 };
  it('a lesson reaches taught at most, with a check in three days', () => {
    expect(
      applyEvidence(obj({ state: 'misconception' }), { kind: 'lesson', day: DAY }),
    ).toMatchObject({ state: 'taught', due: '2026-10-02' });
    expect(
      applyEvidence(obj({ state: 'right once', due: 'x' }), { kind: 'lesson', day: DAY }),
    ).toMatchObject({ state: 'right once', due: 'x' });
  });
  it('mastery needs two passes at least two days apart', () => {
    const once = applyEvidence(obj({ state: 'taught' }), pass);
    expect(once).toMatchObject({ state: 'right once', due: addDays(DAY, 7) });
    expect(applyEvidence(once, { ...pass, day: addDays(DAY, 1) }).state).toBe('right once');
    expect(applyEvidence(once, { ...pass, day: addDays(DAY, 7) })).toMatchObject({
      state: 'mastered',
      due: addDays(DAY, 52),
    });
  });
  it('confidence changes the outcome', () => {
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, confidence: 'guess' }).state).toBe(
      'shaky',
    );
    expect(
      applyEvidence(obj({ state: 'taught' }), { ...pass, score: 0, confidence: 'sure' }),
    ).toMatchObject({ state: 'misconception', due: DAY });
    expect(
      applyEvidence(obj({ state: 'taught' }), { ...pass, score: 0, confidence: 'unknown' }).state,
    ).toBe('gap');
    expect(applyEvidence(obj({ state: 'taught' }), { ...pass, score: 1.5 }).state).toBe('shaky');
    expect(applyEvidence(obj({ state: 'mastered' }), { ...pass, score: 0 }).state).toBe('slipping');
  });
  it('lapsing cards only affect mastered objectives', () => {
    expect(applyEvidence(obj({ state: 'mastered' }), { kind: 'card', day: DAY }).state).toBe(
      'slipping',
    );
    expect(applyEvidence(obj({ state: 'taught' }), { kind: 'card', day: DAY }).state).toBe(
      'taught',
    );
  });
  it('keeps the evidence column short', () => {
    let o = obj({ state: 'taught' });
    for (let i = 0; i < 9; i++) o = applyEvidence(o, { kind: 'lesson', day: DAY });
    expect(o.evidence).toHaveLength(6);
  });
  it('summarises a set of answers into one piece of evidence', () => {
    const q = (marks: number) =>
      ({ id: 'q', type: 'short', prompt: '', marks, rubric: [], model: '' }) as Question;
    const m = (score: number) => ({
      score,
      awarded: [],
      annotations: [],
      mistake: 'none' as const,
      feedback: '',
    });
    expect(
      summarise([
        { q: q(2), answer: { confidence: 'sure' }, mark: m(0) },
        { q: q(2), answer: { confidence: 'guess' }, mark: m(2) },
      ]),
    ).toEqual({ score: 2, marks: 4, confidence: 'sure' });
    expect(summarise([{ q: q(2), answer: { confidence: 'guess' }, mark: m(2) }])).toMatchObject({
      confidence: 'guess',
    });
    expect(summarise([{ q: q(2), answer: { unknown: true }, mark: m(0) }])).toMatchObject({
      confidence: 'unknown',
    });
    // Sure but only incomplete is not a misconception.
    expect(
      summarise([
        { q: q(3), answer: { confidence: 'sure' }, mark: { ...m(1), mistake: 'incomplete' } },
      ]),
    ).toMatchObject({ confidence: 'unsure' });
    expect(
      summarise([
        { q: q(3), answer: { confidence: 'sure' }, mark: { ...m(1), mistake: 'misconception' } },
      ]),
    ).toMatchObject({ confidence: 'sure' });
  });
  it('adds a suggested paragraph at the end of the right section', () => {
    const note = '# Topic Models\n\nIntro.\n\n## Dirichlet\n\nA prior.\n\n## LDA\n\nText.\n';
    expect(insertUnderHeading(note, 'Dirichlet', 'A draw is a point on the simplex.')).toBe(
      '# Topic Models\n\nIntro.\n\n## Dirichlet\n\nA prior.\n\nA draw is a point on the simplex.\n\n## LDA\n\nText.\n',
    );
    expect(insertUnderHeading(note, '', 'End.')).toBe(note + '\nEnd.\n');
  });
});

// ---- the service, end to end, with a scripted agent ----------------------
const q = (id: string, extra: Partial<Question> = {}): Question => ({
  id,
  type: 'short',
  prompt: `Prompt ${id}`,
  marks: 2,
  rubric: [
    { point: 'A', marks: 1 },
    { point: 'B', marks: 1 },
  ],
  model: 'Model',
  ...extra,
});
const mcq = (id: string): Question =>
  q(id, {
    type: 'mcq',
    marks: 1,
    rubric: [{ point: 'right', marks: 1 }],
    options: ['a', 'b'],
    answer: 1,
  });
const checkRecord = (mastery: string, patch: Partial<CheckRecord> = {}): CheckRecord => ({
  version: 1,
  createdAt: 1,
  mastery,
  course: 'DS346',
  objective: 'params',
  title: 'Parameter counts',
  goal: 'explain',
  questions: [q('old')],
  answers: {},
  marks: {},
  status: 'ready',
  ...patch,
});
const markOf = (id: string, awarded: boolean[]) => ({
  id,
  score: 99,
  awarded,
  annotations: [],
  mistake: 'incomplete',
  feedback: 'ok',
});

function setup(python?: (script: string) => Promise<string>) {
  const files = new Map<string, string>([
    ['Notes/DS346/Topic Models.md', '# Topic Models\n\n## Dirichlet\n\nA prior.\n'],
    ['Notes/DS346/DS346 Hub.md', 'hub'],
  ]);
  const modified = new Map<string, number>();
  const storage: LearnStorage = {
    read: async (p) => files.get(p) ?? null,
    write: async (p, t) => {
      files.set(p, t);
    },
    exists: (p) => files.has(p),
    process: async (p, fn) => {
      const t = files.get(p);
      if (t === undefined) throw new Error('missing');
      files.set(p, fn(t));
    },
    files: (folder, ext) =>
      [...files.keys()].filter((p) => p.startsWith(folder + '/') && p.endsWith('.' + ext)).sort(),
    remove: async (p) => {
      files.delete(p);
    },
    masteryFiles: () =>
      [...files.entries()]
        .filter(([p, t]) => p.endsWith('.md') && /^---\n[\s\S]*?qard-mastery:/.test(t))
        .map(([p]) => p),
    modified: (p) => modified.get(p),
    resolve: (link) => [...files.keys()].find((p) => p === link || p.endsWith('/' + link + '.md')),
  };
  const calls: { role: AgentRole; task: AgentTask }[] = [];
  const replies: { schema: unknown; reply: (task: AgentTask) => unknown }[] = [];
  const reply = (schema: unknown, fn: (task: AgentTask) => unknown) =>
    replies.push({ schema, reply: fn });
  const runner = (role: AgentRole) => ({
    name: 'fake',
    run: async (task: AgentTask) => {
      calls.push({ role, task });
      const found = replies.find((r) => r.schema === task.schema);
      if (!found && task.schema === stepReviewSchema) return { issues: [] };
      if (!found) throw new Error('unexpected task');
      return found.reply(task);
    },
  });
  const links = new Map<string, CardLink>();
  let now = new Date(2026, 8, 29, 10).getTime();
  const settings = readSettings({ learn: { folder: 'Qard' } });
  const notices: string[] = [];
  const make = () =>
    new LearnService(
      storage,
      () => settings,
      runner,
      {
        get: (id) => links.get(id),
        set: async (id, l) => {
          links.set(id, l);
        },
      },
      () => 4,
      () => now,
      (m) => notices.push(m),
      undefined,
      undefined,
      python,
    );
  const learn = make();
  // restart: a fresh service over the same files, as after a reload of Obsidian or the plugin.
  return {
    storage,
    files,
    modified,
    learn,
    calls,
    reply,
    replies,
    links,
    notices,
    restart: make,
    settings,
    advance: (days: number) => {
      now += days * 86_400_000;
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
async function mapped() {
  const t = setup();
  t.reply(objectivesSchema, () => ({
    course: 'DS346',
    objectives: [
      {
        id: 'LDA Generative',
        title: 'LDA generative process',
        notes: ['Notes/DS346/Topic Models.md'],
        needs: [],
        group: 'Topic models',
        label: 'Short name',
        state: 'misconception',
        evidence: 'test 2026-09-29 q7 0/6 sure',
      },
      {
        id: 'params',
        title: 'Parameter counts',
        notes: ['Notes/DS346/Topic Models.md'],
        needs: [],
        group: 'Topic models',
        label: 'Short name',
        state: 'new',
        evidence: '',
      },
    ],
  }));
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
    expect(course.objectives).toMatchObject([
      { id: 'lda-generative', state: 'misconception', due: DAY, notes: ['Topic Models'] },
      { id: 'params', state: 'new' },
    ]);
    const today = await t.learn.todayList();
    expect(today.lessons.map((l) => l.objective)).toEqual(['lda-generative']);
    expect(today.cards).toBe(4);
  });

  it('maps the PDFs in a course folder, and never writes a lesson note edit into a PDF', async () => {
    const t = setup();
    const slides = 'Notes/DS346/Week 1 slides.pdf';
    t.files.set(slides, '[Page 1]\nDirichlet draws.');
    t.files.set('Notes/DS346/.old/draft.pdf', 'hidden');
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'draws',
          title: 'Dirichlet draws',
          notes: [slides],
          needs: [],
          group: 'Priors',
          label: 'Draws',
          state: 'new',
          evidence: '',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    expect(t.calls[0]!.task.prompt).toContain(slides);
    expect(t.calls[0]!.task.prompt).not.toContain('draft.pdf');

    const lesson = 'Qard/Lessons/2026-09-29 Draws.json';
    t.files.set(
      lesson,
      JSON.stringify({
        version: 1,
        createdAt: 0,
        topic: 'Draws',
        notes: [slides],
        steps: [],
        state: [],
        current: 0,
      }),
    );
    await t.learn.loadLesson(lesson);
    t.reply(closeSchema, () => ({
      summary: 'Dirichlet draws.',
      cards: [],
      noteEdit: { path: slides, heading: '', text: 'A paragraph.' },
    }));
    await t.learn.close(lesson);
    expect(t.learn.lessonAt(lesson)!.close!.summary).toBe('Dirichlet draws.');
    expect(t.learn.lessonAt(lesson)!.close!.noteEdit).toBeUndefined();

    // A suggestion that reaches a PDF anyway is refused rather than written into it.
    const older = 'Qard/Lessons/2026-09-28 Draws.json';
    t.files.set(
      older,
      JSON.stringify({
        version: 1,
        createdAt: 0,
        topic: 'Draws',
        notes: [slides],
        steps: [],
        state: [],
        current: 0,
        close: {
          summary: 'Earlier.',
          cards: [],
          cardState: {},
          noteEdit: { path: slides, heading: '', text: 'A paragraph.' },
        },
      }),
    );
    await t.learn.loadLesson(older);
    await expect(t.learn.noteEdit(older, true)).rejects.toThrow(
      'only add paragraphs to Markdown notes',
    );
    expect(t.files.get(slides)).toBe('[Page 1]\nDirichlet draws.');
  });

  it('maps prerequisites and planned topics, and stamps the mapping time', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'Bag Of Words',
          title: 'Bag of words',
          notes: ['Notes/DS346/Topic Models.md'],
          needs: [],
          group: 'Topic models',
          label: 'Short name',
          state: 'new',
          evidence: '',
        },
        {
          id: 'lda',
          title: 'LDA',
          notes: ['Notes/DS346/Topic Models.md'],
          needs: ['Bag Of Words', 'hadoop', 'lda'],
          group: 'Topic models',
          label: 'Short name',
          state: 'new',
          evidence: '',
        },
        {
          id: 'hadoop',
          title: 'Hadoop',
          notes: [],
          needs: ['lda'],
          group: 'Topic models',
          label: 'Short name',
          state: 'planned',
          evidence: '',
        },
        {
          id: 'cloud',
          title: 'Cloud',
          notes: ['Notes/DS346/DS346 Hub.md'],
          needs: [],
          group: 'Topic models',
          label: 'Short name',
          state: 'planned',
          evidence: '',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    const path = await t.learn.acceptCourse('Notes/DS346', [
      'bag-of-words',
      'lda',
      'hadoop',
      'cloud',
    ]);
    const m = await t.learn.course(path);
    // Ids are cleaned, links follow them, the lda <-> hadoop cycle is broken, and a "planned" topic with notes is just new.
    expect(m.objectives.map((o) => [o.id, o.state, o.needs])).toEqual([
      ['bag-of-words', 'new', []],
      ['lda', 'new', ['bag-of-words', 'hadoop']],
      ['hadoop', 'planned', []],
      ['cloud', 'new', []],
    ]);
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
      added: [
        {
          id: 'mapreduce',
          title: 'MapReduce phases',
          notes: ['Notes/DS346/Hadoop.md'],
          needs: ['params', 'nope'],
          group: 'Topic models',
          label: 'Short name',
          state: 'new',
          evidence: '',
        },
        {
          id: 'hdfs',
          title: 'HDFS',
          notes: [],
          needs: [],
          group: 'Topic models',
          label: 'Short name',
          state: 'planned',
          evidence: '',
        },
      ],
      extended: [
        {
          id: 'params',
          notes: ['Notes/DS346/Hadoop.md', 'Notes/DS346/Topic Models.md'],
          needs: ['lda-generative'],
          group: 'Ignored, it has one',
          label: 'Ignored too',
        },
        { id: 'ghost', notes: ['x'], needs: [], group: '', label: '' },
      ],
      outdated: [{ id: 'lda-generative', reason: 'No longer covered' }],
    }));
    await t.learn.updateCourse(t.path);
    const call = t.calls.at(-1)!;
    expect(call.role).toBe('writer');
    expect(call.task.prompt).toContain('- Notes/DS346/Hadoop.md');
    expect(call.task.prompt).toContain(
      'lda-generative | LDA generative process | Short name | Topic models | misconception',
    );
    const update = t.learn.update(t.path)!;
    expect(update.added.map((o) => [o.id, o.needs])).toEqual([
      ['mapreduce', ['params']],
      ['hdfs', []],
    ]);
    expect(update.extended).toEqual([
      {
        id: 'params',
        title: 'Parameter counts',
        notes: ['Hadoop'],
        needs: ['lda-generative'],
        group: undefined,
        label: undefined,
      },
    ]);
    await t.learn.acceptUpdate(t.path, { added: ['mapreduce'], extended: ['params'], remove: [] });
    const after = await t.learn.course(t.path);
    expect(after.objectives.map((o) => o.id)).toEqual(['lda-generative', 'params', 'mapreduce']);
    expect(after.objectives[0]).toMatchObject({
      state: 'misconception',
      evidence: ['test 2026-09-29 q7 0/6 sure'],
    });
    expect(after.objectives[1]).toMatchObject({
      notes: ['Topic Models', 'Hadoop'],
      needs: ['lda-generative'],
    });
    expect(after.mapped).toBe('2026-10-06T10:00');
    expect(t.learn.changedNotes(after)).toEqual([]);
  });

  it('prefers lessons whose prerequisites are already taught', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'base',
          title: 'Base',
          notes: [],
          needs: [],
          group: 'Topic models',
          label: 'Short name',
          state: 'gap',
          evidence: 'x',
        },
        {
          id: 'top',
          title: 'Top',
          notes: [],
          needs: ['base'],
          group: 'Topic models',
          label: 'Short name',
          state: 'gap',
          evidence: 'x',
        },
        {
          id: 'side',
          title: 'Side',
          notes: [],
          needs: [],
          group: 'Topic models',
          label: 'Short name',
          state: 'gap',
          evidence: 'x',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    const path = await t.learn.acceptCourse('Notes/DS346', ['base', 'top', 'side']);
    await t.learn.setState(path, 'side', 'taught', '2026-10-02');
    await t.learn.setState(path, 'top', 'gap', '2026-09-20');
    expect((await t.learn.todayList()).lessons.map((l) => l.objective)).toEqual(['base', 'top']);
  });

  it('keeps a finished mapping for review across a restart, and says so', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'a',
          title: 'A',
          label: 'A',
          notes: [],
          needs: [],
          group: 'G',
          state: 'new',
          evidence: '',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    expect(t.notices).toEqual(['DS346: 1 objectives ready to review in Qard → Learn.']);
    const later = t.restart();
    const pending = await later.pending();
    expect(pending.proposals.map((p) => [p.folder, p.course, p.objectives.length])).toEqual([
      ['Notes/DS346', 'DS346', 1],
    ]);
    await later.acceptCourse('Notes/DS346', ['a']);
    expect([...t.files.keys()].filter((f) => f.includes('Proposals'))).toEqual([]);
    expect((await later.pending()).proposals).toEqual([]);
  });

  it('restarts a course mapping a reload interrupted, and keeps failures visible until retried', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => new Promise(() => {}));
    void t.learn.mapCourse('Notes/DS346', 'Focus on A1');
    await vi.waitFor(() =>
      expect([...t.files.keys()].some((f) => f.startsWith('Qard/Proposals/'))).toBe(true),
    );
    // Qard reloads mid-mapping: the new instance finds the record and starts the mapping again, with the same request.
    t.replies.splice(0);
    t.reply(objectivesSchema, () => {
      throw new Error('Claude Code was not found.');
    });
    const later = t.restart();
    await later.resumeBackground();
    await vi.waitFor(async () =>
      expect((await later.pending()).failed).toMatchObject([
        {
          kind: 'map',
          target: 'Notes/DS346',
          request: 'Focus on A1',
          error: 'Claude Code was not found.',
        },
      ]),
    );
    expect(t.calls.filter((c) => c.task.schema === objectivesSchema).at(-1)!.task.prompt).toContain(
      'Focus on A1',
    );
    // The failure survives another restart, and retrying clears it.
    const again = t.restart();
    expect((await again.pending()).failed).toHaveLength(1);
    t.replies.splice(0);
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'a',
          title: 'A',
          label: 'A',
          notes: [],
          needs: [],
          group: 'G',
          state: 'new',
          evidence: '',
        },
      ],
    }));
    await again.mapCourse('Notes/DS346', 'Focus on A1');
    expect(await again.pending()).toMatchObject({
      failed: [],
      proposals: [{ folder: 'Notes/DS346' }],
    });
  });

  it('writes lesson steps in parallel as soon as the plan exists, and redoes them when the plan changes', async () => {
    const t = await mapped();
    t.reply(probeSchema, () => ({ questions: [], note: 'None needed.' }));
    const plan = (title: string) => ({
      title,
      plan: 'P',
      mermaid: 'graph TD; A-->B',
      steps: [
        { title: `${title} 1`, why: 'w' },
        { title: `${title} 2`, why: 'w' },
        { title: `${title} 3`, why: 'w' },
      ],
    });
    t.reply(probeMapSchema, () => ({ marks: [], findings: 'F', map: plan('First') }));
    let running = 0,
      peak = 0;
    const release: (() => void)[] = [];
    t.reply(
      stepSchema,
      (task) =>
        new Promise((done) => {
          running++;
          peak = Math.max(peak, running);
          release.push(() => {
            running--;
            done({
              title: /"([^"]+)"/.exec(task.prompt)![1],
              explain: 'E',
              connect: 'C',
              checkFirst: false,
              check: q('x'),
              misconceptions: [],
            });
          });
        }),
    );
    const lesson = await t.learn.startLesson({
      topic: 'LDA',
      notes: [],
      mastery: t.path,
      objective: 'lda-generative',
    });
    await vi.waitFor(() => expect(running).toBe(3));
    // Writing started before the plan was accepted, three steps at once.
    expect(t.learn.lessonAt(lesson)!.accepted).toBeUndefined();
    expect(peak).toBe(3);
    // Revising the plan while steps are being written: the old steps are dropped and the new plan's are written.
    t.reply(mapSchema, () => plan('Second'));
    await t.learn.reviseMap(lesson, 'change it');
    release.splice(0).forEach((r) => r());
    await vi.waitFor(() => expect(running).toBe(3));
    release.splice(0).forEach((r) => r());
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)!.steps.every(Boolean)).toBe(true));
    expect(t.learn.lessonAt(lesson)!.steps.map((s) => s!.title)).toEqual([
      'Second 1',
      'Second 2',
      'Second 3',
    ]);
    await t.learn.acceptMap(lesson);
    expect(t.learn.lessonAt(lesson)!.steps.map((s) => s!.title)).toEqual([
      'Second 1',
      'Second 2',
      'Second 3',
    ]);
  });

  it('saves only a repaired lesson step after the marker approves it', async () => {
    const t = setup();
    t.reply(probeSchema, () => ({ questions: [], note: 'None needed.' }));
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'Start here.',
      map: {
        title: 'One step',
        plan: 'Teach one idea.',
        mermaid: 'graph TD; A-->B',
        steps: [{ title: 'One idea', why: 'Needed now.' }],
      },
    }));
    let writes = 0,
      reviews = 0;
    t.reply(stepSchema, () => ({
      title: `Candidate ${++writes}`,
      explain: 'An explanation.',
      connect: 'A connection.',
      checkFirst: false,
      check: q('k1'),
      misconceptions: [],
    }));
    let approve: ((value: { issues: string[] }) => void) | undefined;
    t.reply(stepReviewSchema, (task) => {
      if (!task.prompt.includes('Candidate')) return { issues: [] };
      if (++reviews === 1) return { issues: ['Split the output and explanation.'] };
      return new Promise((resolve) => {
        approve = resolve;
      });
    });

    const path = await t.learn.startLesson({
      topic: 'Review this step',
      notes: ['Notes/DS346/Topic Models.md'],
    });
    await vi.waitFor(() => expect(reviews).toBe(2));
    expect(t.learn.lessonAt(path)!.steps).toEqual([null]);
    expect(JSON.parse(t.files.get(path)!).steps).toEqual([null]);
    expect(
      t.calls.filter(
        (c) => c.task.schema === stepReviewSchema && c.task.prompt.includes('Candidate'),
      ),
    ).toEqual([
      expect.objectContaining({ role: 'marker' }),
      expect.objectContaining({ role: 'marker' }),
    ]);
    expect(
      t.calls.find(
        (c) => c.task.schema === stepReviewSchema && c.task.prompt.includes('Candidate'),
      )!.task,
    ).toMatchObject({
      vault: undefined,
      effort: 'high',
    });
    for (const call of t.calls.filter(
      (c) => c.task.schema === stepReviewSchema && c.task.prompt.includes('Candidate'),
    )) {
      expect(call.task.prompt.split('# Topic Models')).toHaveLength(2);
    }

    approve!({ issues: [] });
    await vi.waitFor(() => expect(t.learn.lessonAt(path)!.steps[0]?.title).toBe('Candidate 2'));
    expect(writes).toBe(2);
  });

  it('cancels a stuck job, which can then be tried again', async () => {
    const t = await mapped();
    let signal: AbortSignal | undefined;
    t.reply(probeSchema, (task) => {
      signal = task.signal;
      return new Promise(() => {});
    });
    const lesson = await t.learn.startLesson({
      topic: 'LDA',
      notes: [],
      mastery: t.path,
      objective: 'lda-generative',
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(t.learn.job(lesson, 'probe')).toMatchObject({ kind: 'probe' });
    t.learn.cancel(lesson, 'probe');
    await vi.waitFor(() => expect(t.learn.job(lesson, 'probe')?.error).toBe('Cancelled.'));
    expect(signal!.aborted).toBe(true);
    t.replies.splice(
      t.replies.findIndex((r) => r.schema === probeSchema),
      1,
    );
    t.reply(probeSchema, () => ({ questions: [], note: 'None needed.' }));
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'F',
      map: { title: 'T', plan: 'P', mermaid: '', steps: [] },
    }));
    await t.learn.probe(lesson);
    expect(t.learn.lessonAt(lesson)!.probe).toBeDefined();
  });

  it('draws figures the writer asks for, runs plot scripts, retries a broken figure, and draws on request', async () => {
    const scripts: string[] = [];
    const svg = (label: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><text x="1" y="5">${label}</text></svg>`;
    const t = setup(async (script) => {
      scripts.push(script);
      if (script.includes('broken')) throw new Error("NameError: name 'betta' is not defined");
      return `<?xml version="1.0"?>\n${svg('plot')}`;
    });
    t.files.set('assets/statistics/beta-shapes.png', '');
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: [
        {
          id: 'beta',
          title: 'Beta shapes',
          notes: ['Notes/DS346/Topic Models.md'],
          needs: [],
          group: 'Priors',
          label: 'Beta',
          state: 'new',
          evidence: '',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    const mastery = await t.learn.acceptCourse('Notes/DS346', ['beta']);
    t.reply(probeSchema, () => ({ questions: [], note: 'None needed.' }));
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'F',
      map: {
        title: 'Beta',
        plan: 'P',
        mermaid: '',
        steps: [
          { title: 'Shapes', why: 'w' },
          { title: 'Plain', why: 'w' },
        ],
      },
    }));
    t.reply(stepSchema, (task) => ({
      title: /Write step 1/.test(task.prompt) ? 'Shapes' : 'Plain',
      explain: 'E',
      connect: 'C',
      checkFirst: false,
      check: q('x'),
      misconceptions: [],
      figure: /Write step 1/.test(task.prompt) ? 'Plot Beta(2,5) and Beta(5,2) densities.' : '',
    }));
    let figureCalls = 0;
    t.reply(figureSchema, (task) => {
      figureCalls++;
      if (task.prompt.includes('Draw this answer'))
        return {
          kind: 'svg',
          code: svg('tree'),
          caption: 'A tree.',
          name: 'Answer Tree',
          domain: 'algorithms',
        };
      return task.prompt.includes('previous figure failed')
        ? {
            kind: 'python',
            code: 'plt.plot(beta)',
            caption: 'Beta(2,5) and Beta(5,2).',
            name: 'Beta Shapes',
            domain: 'Statistics',
          }
        : { kind: 'python', code: 'broken(betta)', caption: 'x', name: 'x', domain: 'statistics' };
    });
    const lesson = await t.learn.startLesson({
      topic: 'Beta',
      notes: [],
      mastery,
      objective: 'beta',
    });
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)!.state[0]?.figure).toBeDefined());
    // The writer was told when to use visuals; only the step with a brief was drawn, by the illustrator, and the first script's error went back.
    expect(t.calls.find((c) => c.task.schema === stepSchema)!.task.prompt).toContain(
      'Mermaid block',
    );
    const drawn = t.calls.filter((c) => c.task.schema === figureSchema);
    expect(drawn.map((c) => c.role)).toEqual(['illustrator', 'illustrator']);
    expect(drawn[0]!.task.prompt).toContain('Plot Beta(2,5) and Beta(5,2) densities.');
    expect(drawn[0]!.task.prompt).toContain('existing: statistics');
    expect(drawn[1]!.task.prompt).toContain("NameError: name 'betta' is not defined");
    expect(scripts).toEqual(['broken(betta)', 'plt.plot(beta)']);
    // A clean SVG, named the vault's way; the existing file name is not overwritten.
    const figure = t.learn.lessonAt(lesson)!.state[0]!.figure!;
    expect(figure).toMatchObject({
      path: 'assets/statistics/beta-shapes.svg',
      caption: 'Beta(2,5) and Beta(5,2).',
    });
    const saved = t.files.get(figure.path)!;
    expect(saved).toContain('<text x="1" y="5">plot</text>');
    expect(saved).not.toMatch(/script|onload/);
    expect(t.learn.lessonAt(lesson)!.state[1]?.figure).toBeUndefined();
    expect(figureCalls).toBe(2);
    // "Draw this" on an answer to a question asked in the step.
    const st = t.learn.lessonAt(lesson)!.state;
    t.files.set(
      lesson,
      JSON.stringify({
        ...t.learn.lessonAt(lesson)!,
        state: st.map((x, i) =>
          i === 1 ? { ...x, asks: [{ q: 'Draw this answer', a: 'A tree.' }] } : x,
        ),
      }),
    );
    const again = t.restart();
    await again.openLesson(lesson);
    await again.illustrate(lesson, 1, 0);
    expect(again.lessonAt(lesson)!.state[1]!.asks[0]!.figure).toMatchObject({
      path: 'assets/algorithms/answer-tree.svg',
    });
  });

  it('picks up unwritten lesson steps when a lesson is reopened after a restart', async () => {
    const t = await mapped();
    t.reply(probeSchema, () => ({ questions: [], note: 'None needed.' }));
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'F',
      map: {
        title: 'T',
        plan: 'P',
        mermaid: '',
        steps: [
          { title: 'One', why: 'w' },
          { title: 'Two', why: 'w' },
        ],
      },
    }));
    t.reply(stepSchema, () => new Promise(() => {}));
    const lesson = await t.learn.startLesson({
      topic: 'LDA',
      notes: [],
      mastery: t.path,
      objective: 'lda-generative',
    });
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)!.stepsFor).toBeDefined());
    await t.learn.flush();
    t.replies.splice(
      t.replies.findIndex((r) => r.schema === stepSchema),
      1,
    );
    t.reply(stepSchema, (task) => ({
      title: /"([^"]+)"/.exec(task.prompt)![1],
      explain: 'E',
      connect: 'C',
      checkFirst: false,
      check: q('x'),
      misconceptions: [],
    }));
    const later = t.restart();
    await later.openLesson(lesson);
    await vi.waitFor(() =>
      expect(later.lessonAt(lesson)!.steps.map((s) => s?.title)).toEqual(['One', 'Two']),
    );
  });

  it('rewrites cached steps when only the plan scope or step rationale changes', async () => {
    const t = setup();
    const path = 'Qard/Lessons/scope.json';
    const map = {
      title: 'Same title',
      plan: 'Explain the prior.',
      mermaid: '',
      steps: [{ title: 'Same step', why: 'Foundation.' }],
    };
    t.files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'Prior',
        notes: [],
        map,
        accepted: true,
        stepsFor: JSON.stringify([
          map.title,
          map.plan,
          map.steps.map((step) => [step.title, step.why]),
        ]),
        steps: [
          {
            title: 'Old step',
            explain: 'Old scope.',
            connect: '',
            checkFirst: false,
            check: q('k1'),
            misconceptions: [],
          },
        ],
        state: [{ asks: [] }],
        current: 0,
      }),
    );
    await t.learn.loadLesson(path);
    let revision = 0;
    t.reply(mapSchema, () => ({
      ...map,
      plan: 'Apply the prior.',
      steps: [
        {
          title: 'Same step',
          why: ++revision === 1 ? 'Foundation.' : 'Use a different condition.',
        },
      ],
    }));
    let writes = 0;
    t.reply(stepSchema, () => ({
      title: `Rewritten ${++writes}`,
      explain: 'New scope.',
      connect: '',
      checkFirst: false,
      check: q('k1'),
      misconceptions: [],
    }));
    await t.learn.reviseMap(path, 'Apply instead.');
    await vi.waitFor(() => expect(t.learn.lessonAt(path)?.steps[0]?.title).toBe('Rewritten 1'));
    await t.learn.reviseMap(path, 'Change only the condition.');
    await vi.waitFor(() => expect(t.learn.lessonAt(path)?.steps[0]?.title).toBe('Rewritten 2'));
    expect(t.learn.lessonAt(path)?.steps[0]?.check.goal).toBe('explain');
  });

  it('migrates legacy plan keys without resetting answered step history on reopen', async () => {
    const t = setup();
    const path = 'Qard/Lessons/legacy-plan.json';
    const map = {
      title: 'Priors',
      plan: 'Explain priors.',
      mermaid: '',
      steps: [
        { title: 'One', why: 'Recall.' },
        { title: 'Two', why: 'Apply.' },
      ],
    };
    const first = {
      title: 'Original',
      explain: 'Keep this.',
      connect: '',
      checkFirst: false,
      check: q('k1'),
      misconceptions: [],
    };
    const state = {
      answer: { text: 'My saved answer' },
      mark: { ...markOf('k1', [true, false]), score: 1 },
      asks: [{ q: 'Why?', a: 'Because.' }],
    };
    t.files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'Priors',
        probe: { questions: [], answers: {}, submitted: true },
        notes: [],
        map,
        accepted: true,
        stepsFor: JSON.stringify([map.title, map.steps.map((step) => step.title)]),
        steps: [first, null],
        state: [state, { asks: [] }],
        current: 1,
      }),
    );
    t.reply(stepSchema, () => ({ ...first, title: 'Second' }));
    await t.learn.openLesson(path);
    await vi.waitFor(() => expect(t.learn.lessonAt(path)?.steps[1]?.title).toBe('Second'));
    expect(t.learn.lessonAt(path)?.steps[0]).toEqual(first);
    expect(t.learn.lessonAt(path)?.state[0]).toEqual(state);
    expect(t.learn.lessonAt(path)?.current).toBe(1);
    expect(t.calls.filter((call) => call.task.schema === stepSchema)).toHaveLength(1);
    expect(JSON.parse(t.files.get(path!)!).state[0]).toEqual(state);
  });

  it('suggests at most three lessons a day, misconceptions first', async () => {
    const t = setup();
    t.reply(objectivesSchema, () => ({
      course: 'DS346',
      objectives: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
        id,
        title: id,
        notes: [],
        needs: [],
        group: 'Topic models',
        label: 'Short name',
        state: i === 4 ? 'misconception' : 'gap',
        evidence: 'x',
      })),
    }));
    await t.learn.mapCourse('Notes/DS346');
    await t.learn.acceptCourse('Notes/DS346', ['a', 'b', 'c', 'd', 'e']);
    const today = await t.learn.todayList();
    expect(today.lessons.map((l) => l.objective)).toEqual(['e', 'a', 'b']);
    expect(today.moreLessons).toBe(2);
  });

  it('writes no checks and resumes no lessons while AI features are off', async () => {
    const t = await mapped();
    await t.learn.setState(t.path, 'params', 'taught', DAY);
    const calls = t.calls.length;
    t.settings.aiEnabled = false;
    expect(await t.learn.ensureCheck(t.path, 'params')).toBeUndefined();
    await t.learn.resumeBackground();
    expect(t.calls).toHaveLength(calls);
    t.settings.aiEnabled = true;
  });

  it('passes scoped saved-format metadata to probes, checks and later parallel step writers', async () => {
    const t = await mapped();
    const historyPath = 'Qard/Lessons/format-history.json';
    const history = JSON.stringify({
      version: 1,
      createdAt: 1,
      topic: 'Earlier',
      notes: [],
      mastery: t.path,
      steps: [
        {
          title: 'Earlier',
          explain: '',
          connect: '',
          checkFirst: false,
          check: { ...q('old'), goal: 'recall', prompt: 'RECORD-ONLY retrieval question' },
          misconceptions: [],
        },
      ],
      state: [{ asks: [] }],
      current: 0,
    });
    t.files.set(historyPath, history);
    t.files.set(
      'Qard/Lessons/other-course.json',
      JSON.stringify({
        version: 1,
        createdAt: 2,
        topic: 'Other',
        notes: [],
        mastery: 'Other/Mastery.md',
        steps: [{ check: q('other', { type: 'calc', goal: 'apply' }) }],
        state: [],
        current: 0,
      }),
    );
    t.files.set(
      'Qard/Lessons/partial-history.json',
      JSON.stringify({
        version: 1,
        createdAt: 2,
        topic: 'Incomplete',
        mastery: t.path,
        probe: { questions: {} },
        state: [],
        current: 0,
      }),
    );
    t.files.set(
      'Qard/Lessons/malformed-history.json',
      JSON.stringify({
        version: 1,
        createdAt: 3,
        topic: 'Malformed',
        mastery: t.path,
        steps: [
          null,
          {},
          { check: null },
          { check: { type: 'HISTORY-INSTRUCTION', goal: 'IGNORE THE TASK' } },
        ],
        state: [],
        current: 0,
      }),
    );
    const deleted = 'Qard/Lessons/deleted-history.json';
    t.files.set(
      deleted,
      JSON.stringify({
        version: 1,
        createdAt: 4,
        topic: 'Deleted',
        mastery: t.path,
        steps: [{ check: q('deleted', { type: 'calc', goal: 'apply' }) }],
        state: [],
        current: 0,
      }),
    );
    const list = t.learn.listLessons.bind(t.learn);
    let removeOnce = true;
    vi.spyOn(t.learn, 'listLessons').mockImplementation(async () => {
      const summaries = await list();
      if (removeOnce) {
        removeOnce = false;
        await t.learn.removeLesson(deleted);
      }
      return summaries;
    });
    t.reply(probeSchema, () => ({ questions: [], note: 'No prerequisite gap.' }));
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'Start here.',
      map: {
        title: 'Format context',
        plan: 'Apply the ideas.',
        mermaid: '',
        steps: Array.from({ length: 4 }, (_, i) => ({
          title: `Step ${i + 1}`,
          why: 'Use the idea.',
        })),
      },
    }));
    const release: (() => void)[] = [];
    let running = 0,
      peak = 0;
    t.reply(
      stepSchema,
      (task) =>
        new Promise((resolve) => {
          const index = Number(/Write step (\d+) of/.exec(task.prompt)![1]) - 1;
          peak = Math.max(peak, ++running);
          release.push(() => {
            running--;
            resolve({
              title: `Step ${index + 1}`,
              explain: 'Explain.',
              connect: '',
              checkFirst: false,
              check: index === 0 ? { ...mcq('x'), goal: 'apply' } : q('x'),
              misconceptions: [],
            });
          });
        }),
    );
    const lesson = await t.learn.startLesson({
      topic: 'Format context',
      notes: [],
      mastery: t.path,
      objective: 'params',
    });
    await vi.waitFor(() => expect(release).toHaveLength(3));
    expect(peak).toBe(3);
    const probe = t.calls.find((call) => call.task.schema === probeSchema)!;
    expect(probe.task.prompt).toContain('short (recall)');
    expect(probe.task.prompt).not.toContain('RECORD-ONLY');
    expect(probe.task.prompt).not.toContain('calc (apply)');
    expect(probe.task.prompt).not.toContain('HISTORY-INSTRUCTION');
    expect(probe.task.prompt).not.toContain('IGNORE THE TASK');
    expect(t.files.has(deleted)).toBe(false);
    release.shift()!();
    await vi.waitFor(() =>
      expect(t.calls.filter((call) => call.task.schema === stepSchema)).toHaveLength(4),
    );
    const fourth = t.calls.filter((call) => call.task.schema === stepSchema)[3]!;
    expect(fourth.task.prompt).toContain('mcq (apply)');
    expect(fourth.task.prompt).toContain('short (recall)');
    expect(fourth.task.prompt).not.toContain('RECORD-ONLY');
    release.splice(0).forEach((done) => done());
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)?.steps.every(Boolean)).toBe(true));
    t.reply(questionsSchema, () => ({ questions: [q('c1')] }));
    await t.learn.ensureCheck(t.path, 'params');
    const check = t.calls.find((call) => call.task.schema === questionsSchema)!;
    expect(check.task.prompt).toContain('short (recall)');
    expect(check.task.prompt).toContain('mcq (apply)');
    expect(check.task.prompt).not.toContain('RECORD-ONLY');
    expect(t.files.get(historyPath)).toBe(history);
  });

  it('shares concurrent check preparation and saves only after a repaired batch is approved', async () => {
    const t = await mapped();
    let writes = 0,
      reviews = 0;
    let approve!: (value: { issues: string[] }) => void;
    t.reply(questionsSchema, () => ({ questions: [q(`candidate${++writes}`)] }));
    t.reply(stepReviewSchema, () => {
      if (++reviews === 1) return { issues: ['Specify the input.'] };
      return new Promise((resolve) => {
        approve = resolve;
      });
    });
    const first = t.learn.ensureCheck(t.path, 'params');
    const second = t.learn.ensureCheck(t.path, 'params');
    expect(second).toBe(first);
    await vi.waitFor(() => expect(reviews).toBe(2));
    expect(t.storage.files('Qard/Checks', 'json')).toEqual([]);
    expect(t.calls.filter((call) => call.task.schema === questionsSchema)).toHaveLength(2);
    expect(
      t.calls
        .filter((call) => call.task.schema === questionsSchema)
        .every((call) => call.task.prompt.split('# Topic Models').length === 2),
    ).toBe(true);
    expect(
      t.calls
        .filter((call) => call.task.schema === stepReviewSchema)
        .every(
          (call) => call.role === 'marker' && call.task.prompt.split('# Topic Models').length === 2,
        ),
    ).toBe(true);
    approve({ issues: [] });
    const path = await first;
    expect(await second).toBe(path);
    expect(t.learn.checkAt(path!)!).toMatchObject({
      questionPolicy: 1,
      promptFingerprint: await checkPromptFingerprint(),
      questions: [{ id: 'candidate2' }],
    });
    expect(JSON.parse(t.files.get(path!)!).questions[0].id).toBe('candidate2');
  });

  it.each([undefined, 'old-prompt-fingerprint'])(
    'refreshes an untouched check with fingerprint %s once, then reuses the saved replacement',
    async (promptFingerprint) => {
      const t = await mapped();
      const path = `Qard/Checks/DS346/${DAY} params.json`;
      t.files.set(
        path,
        JSON.stringify(checkRecord(t.path, { questionPolicy: 1, promptFingerprint })),
      );
      t.reply(questionsSchema, () => ({ questions: [q('reviewed')] }));
      const fresh = await t.learn.loadCheck(path);
      expect(fresh).toMatchObject({
        questionPolicy: 1,
        promptFingerprint: await checkPromptFingerprint(),
        questions: [{ id: 'reviewed' }],
      });
      const saved = t.files.get(path);
      const calls = t.calls.length;
      expect(await t.restart().loadCheck(path)).toEqual(fresh);
      expect(t.files.get(path)).toBe(saved);
      expect(t.calls).toHaveLength(calls);
    },
  );

  it('refreshes the same saved check when the prompt fingerprint changes without changing its policy number', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    const original = checkRecord(t.path, {
      questionPolicy: 1,
      promptFingerprint: await checkPromptFingerprint(),
    });
    t.files.set(path, JSON.stringify(original));
    expect(await t.learn.loadCheck(path)).toEqual(original);
    const calls = t.calls.length;
    const fingerprint = vi
      .spyOn(await import('../src/learn/step-review'), 'checkPromptFingerprint')
      .mockResolvedValue('changed-prompt-fingerprint');
    try {
      t.reply(questionsSchema, () => ({ questions: [q('new-prompt')] }));
      const fresh = await t.restart().loadCheck(path);
      expect(fresh).toMatchObject({
        questionPolicy: 1,
        promptFingerprint: 'changed-prompt-fingerprint',
        questions: [{ id: 'new-prompt' }],
      });
      expect(t.calls).toHaveLength(calls + 2);
      const saved = t.files.get(path);
      expect(await t.restart().loadCheck(path)).toEqual(fresh);
      expect(t.files.get(path)).toBe(saved);
      expect(t.calls).toHaveLength(calls + 2);
    } finally {
      fingerprint.mockRestore();
    }
  });

  it('reuses a matching prompt despite legacy policy numbers and changes to recent format history', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    const promptFingerprint = await checkPromptFingerprint();
    const calls = t.calls.length;
    for (const questionPolicy of [undefined, 1, 2]) {
      const original = JSON.stringify(checkRecord(t.path, { questionPolicy, promptFingerprint }));
      t.files.set(path, original);
      t.files.set(
        `Qard/Checks/DS346/history-${questionPolicy}.json`,
        JSON.stringify(
          checkRecord(t.path, {
            objective: 'lda-generative',
            createdAt: 10 + (questionPolicy ?? 0),
            questions: [mcq('history')],
            answers: { history: { choice: 1 } },
            finishedAt: 2,
          }),
        ),
      );
      expect(await t.restart().loadCheck(path)).toEqual(JSON.parse(original));
      expect(t.files.get(path)).toBe(original);
    }
    expect(t.calls).toHaveLength(calls);
  });

  it('automatically detects changes to the generation and review response contracts', async () => {
    const original = await checkPromptFingerprint();
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    for (const schema of [questionsSchema, stepReviewSchema]) {
      const description = schema.description;
      try {
        schema.description = 'A changed response contract.';
        expect(await checkPromptFingerprint()).not.toBe(original);
      } finally {
        if (description === undefined) delete schema.description;
        else schema.description = description;
      }
      expect(await checkPromptFingerprint()).toBe(original);
    }
  });

  it('preserves any started or completed check byte-for-byte despite a missing or outdated prompt fingerprint', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    const calls = t.calls.length;
    for (const patch of [
      { answers: { old: { text: 'Started' } } },
      { answers: { old: { flagged: true } } },
      {
        marks: {
          old: { ...markOf('old', [true, false]), score: 1, mistake: 'incomplete' as const },
        },
      },
      { finishedAt: 0 },
    ]) {
      for (const promptFingerprint of [undefined, 'old-prompt-fingerprint']) {
        const original = JSON.stringify(
          checkRecord(t.path, { questionPolicy: 2, promptFingerprint, ...patch }),
        );
        t.files.set(path, original);
        const restarted = t.restart();
        expect(await restarted.loadCheck(path)).toEqual(JSON.parse(original));
        expect(t.files.get(path)).toBe(original);
      }
    }
    expect(t.calls).toHaveLength(calls);
  });

  it.each([true, false])(
    'preserves an answer entered during fingerprint calculation when the saved fingerprint matches: %s',
    async (matches) => {
      const t = await mapped();
      const path = `Qard/Checks/DS346/${DAY} params.json`;
      const current = await checkPromptFingerprint();
      const saved = matches ? current : 'old-prompt';
      t.files.set(path, JSON.stringify(checkRecord(t.path, { promptFingerprint: saved })));
      let calculated!: (value: string) => void;
      const fingerprint = vi
        .spyOn(await import('../src/learn/step-review'), 'checkPromptFingerprint')
        .mockResolvedValue(current)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              calculated = resolve;
            }),
        );
      try {
        const calls = t.calls.length;
        const loading = t.learn.loadCheck(path);
        await vi.waitFor(() => expect(calculated).toBeDefined());
        t.learn.answerCheck(path, 'old', { text: 'My original answer' });
        calculated(current);
        expect(await loading).toMatchObject({
          promptFingerprint: saved,
          questions: [{ id: 'old' }],
          answers: { old: { text: 'My original answer' } },
        });
        await t.learn.flush();
        expect(JSON.parse(t.files.get(path!)!).answers.old.text).toBe('My original answer');
        expect(t.calls).toHaveLength(calls);
      } finally {
        fingerprint.mockRestore();
      }
    },
  );

  it.each([true, false])(
    'rejects a check deleted during fingerprint calculation when the saved fingerprint matches: %s',
    async (matches) => {
      const t = await mapped();
      const path = `Qard/Checks/DS346/${DAY} params.json`;
      const current = await checkPromptFingerprint();
      t.files.set(
        path,
        JSON.stringify(
          checkRecord(t.path, { promptFingerprint: matches ? current : 'old-prompt' }),
        ),
      );
      let calculated!: (value: string) => void;
      const fingerprint = vi
        .spyOn(await import('../src/learn/step-review'), 'checkPromptFingerprint')
        .mockResolvedValue(current)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              calculated = resolve;
            }),
        );
      try {
        const calls = t.calls.length;
        const loading = t.learn.loadCheck(path);
        const rejected = expect(loading).rejects.toThrow(/deleted/);
        await vi.waitFor(() => expect(calculated).toBeDefined());
        await t.learn.removeCheck(path);
        calculated(current);
        await rejected;
        await t.learn.flush();
        expect(t.files.has(path)).toBe(false);
        expect(t.learn.checkAt(path)).toBeUndefined();
        expect(t.calls).toHaveLength(calls);
      } finally {
        fingerprint.mockRestore();
      }
    },
  );

  it('opens answered history without requiring the original course file', async () => {
    const t = setup();
    const path = 'Qard/Checks/Archived/answered.json';
    const record = {
      version: 1,
      createdAt: 1,
      mastery: 'Missing Mastery.md',
      course: 'Archived',
      objective: 'archived',
      title: 'Saved attempt',
      goal: 'explain',
      questions: [q('c1')],
      answers: { c1: { text: 'My original answer' } },
      marks: {},
      status: 'marked',
      finishedAt: 2,
    };
    const saved = JSON.stringify(record);
    t.files.set(path, saved);
    expect(await t.learn.loadCheck(path)).toEqual(record);
    expect(t.files.get(path)).toBe(saved);
    expect(t.calls).toHaveLength(0);
  });

  it('fails visibly after three failed reviews and keeps the old check unchanged', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    const original = JSON.stringify(checkRecord(t.path));
    t.files.set(path, original);
    t.reply(questionsSchema, () => ({ questions: [q('rejected')] }));
    t.reply(stepReviewSchema, () => ({ issues: ['The question gives away the answer.'] }));
    await expect(t.learn.loadCheck(path)).rejects.toThrow(/after three attempts/);
    expect(t.learn.job(`${t.path}#params`, 'check-write')?.error).toMatch(/gives away/);
    expect(t.files.get(path)).toBe(original);
    expect(t.learn.checkAt(path)).toEqual(JSON.parse(original));
    expect(t.calls.filter((call) => call.task.schema === questionsSchema)).toHaveLength(3);
  });

  it('does not replace answers entered while a new check is being reviewed', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    t.files.set(path, JSON.stringify(checkRecord(t.path)));
    let approve!: (value: { issues: string[] }) => void;
    t.reply(questionsSchema, () => ({ questions: [q('replacement')] }));
    t.reply(
      stepReviewSchema,
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const loading = t.learn.loadCheck(path);
    await vi.waitFor(() => expect(approve).toBeDefined());
    t.learn.answerCheck(path, 'old', { text: 'My own answer' });
    approve({ issues: [] });
    expect(await loading).toMatchObject({
      questions: [{ id: 'old' }],
      answers: { old: { text: 'My own answer' } },
    });
    await t.learn.flush();
    expect(JSON.parse(t.files.get(path!)!).answers.old.text).toBe('My own answer');
  });

  it('deletes an old check during review without waiting or resurrecting it after a late reply', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    t.files.set(path, JSON.stringify(checkRecord(t.path)));
    let approve!: (value: { issues: string[] }) => void;
    t.reply(questionsSchema, () => ({ questions: [q('late')] }));
    t.reply(
      stepReviewSchema,
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const loading = t.learn.loadCheck(path);
    const rejected = expect(loading).rejects.toThrow(/deleted/);
    await vi.waitFor(() => expect(approve).toBeDefined());
    await t.learn.removeCheck(path);
    await rejected;
    expect(t.files.has(path)).toBe(false);
    approve({ issues: [] });
    await settle();
    await t.learn.flush();
    expect(t.files.has(path)).toBe(false);
    expect(t.learn.checkAt(path)).toBeUndefined();
  });

  it('keeps answered same-day check files when preparing the next check', async () => {
    const t = await mapped();
    const path = `Qard/Checks/DS346/${DAY} params.json`;
    const original = JSON.stringify(
      checkRecord(t.path, { answers: { old: { text: 'Saved answer' } }, finishedAt: 5 }),
    );
    t.files.set(path, original);
    t.reply(questionsSchema, () => ({ questions: [q('next')] }));
    const next = await t.learn.ensureCheck(t.path, 'params');
    expect(next).toBe(`Qard/Checks/DS346/${DAY} params 2.json`);
    expect(t.files.get(path)).toBe(original);
    expect(t.learn.checkAt(next!)?.questions[0]?.id).toBe('next');
  });

  it('reviews probes before display, preserves their note, and reports rejected probes', async () => {
    const t = setup();
    let writes = 0;
    t.reply(probeSchema, () => ({
      questions: [mcq(`p${++writes}`)],
      note: 'Recall the prerequisites.',
    }));
    let reviews = 0;
    t.reply(stepReviewSchema, () => ({
      issues: ++reviews === 1 ? ['Remove the answer clue.'] : [],
    }));
    const path = await t.learn.startLesson({
      topic: 'Priors',
      notes: ['Notes/DS346/Topic Models.md'],
    });
    await vi.waitFor(() => expect(t.learn.lessonAt(path)?.probe).toBeDefined());
    expect(t.learn.lessonAt(path)?.probe).toMatchObject({
      questions: [{ id: 'p2', goal: 'explain' }],
      note: 'Recall the prerequisites.',
    });
    expect(JSON.parse(t.files.get(path!)!).probe.note).toBe('Recall the prerequisites.');
    expect(
      t.calls
        .filter((call) => call.task.schema === probeSchema)
        .every((call) => call.role === 'writer'),
    ).toBe(true);
    const attempts = t.calls.filter(
      (call) => call.task.schema === probeSchema || call.task.schema === stepReviewSchema,
    );
    expect(attempts).toHaveLength(4);
    for (const call of attempts) {
      expect(call.task.prompt.split('# Topic Models')).toHaveLength(2);
    }
    t.replies.length = 0;
    t.reply(probeSchema, () => ({ questions: [mcq('bad')], note: 'Rejected.' }));
    t.reply(stepReviewSchema, () => ({ issues: ['Still reveals the answer.'] }));
    const failed = await t.learn.startLesson({ topic: 'Rejected probe', notes: [] });
    await vi.waitFor(() =>
      expect(t.learn.job(failed, 'probe')?.error).toMatch(/after three attempts/),
    );
    expect(t.learn.lessonAt(failed)?.probe).toBeUndefined();
    expect(JSON.parse(t.files.get(failed!)!).probe).toBeUndefined();
  });

  it('runs a check: written ahead by the writer, marked by the tutor, recorded as evidence', async () => {
    const t = await mapped();
    await t.learn.setState(t.path, 'params', 'taught', DAY);
    t.reply(questionsSchema, () => ({ questions: [mcq('c1'), q('c2')] }));
    const check = (await t.learn.ensureCheck(t.path, 'params'))!;
    expect(check).toBe(`Qard/Checks/DS346/${DAY} params.json`);
    expect(t.calls.at(-1)).toMatchObject({ role: 'marker' });
    expect(
      [...t.calls].reverse().find((c) => c.task.schema === questionsSchema)!.task.prompt,
    ).toContain('Goal: explain');
    // A second request reuses the waiting check.
    expect(await t.learn.ensureCheck(t.path, 'params')).toBe(check);
    expect((await t.learn.todayList()).checks).toMatchObject([{ objective: 'params', check }]);

    t.learn.answerCheck(check, 'c1', { choice: 1, confidence: 'sure' });
    t.learn.answerCheck(check, 'c2', { text: 'A and B', confidence: 'sure' });
    t.reply(marksSchema, () => ({ questions: [markOf('c2', [true, true])] }));
    await t.learn.submitCheck(check);
    const marking = t.calls.find((c) => c.task.schema === marksSchema)!;
    expect(marking.role).toBe('tutor');
    expect(marking.task).toMatchObject({ vault: false, effort: 'low' });
    expect(marking.task.prompt).not.toContain('c1');
    const record = t.learn.checkAt(check)!;
    expect(record.marks.c2!.score).toBe(2);
    expect(record.finishedAt).toBeDefined();
    const params = (await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')!;
    expect(params).toMatchObject({ state: 'right once', due: addDays(DAY, 7) });
    expect(params.evidence.at(-1)).toBe('2026-09-29 check explain 3/3 sure');
    // The next check is written straight away, at a harder goal.
    await vi.waitFor(() =>
      expect(
        t.calls.filter((c) => c.task.schema === questionsSchema).at(-1)!.task.prompt,
      ).toContain('Goal: apply'),
    );
  });

  it('rewrites an unanswered check when its notes change', async () => {
    const t = await mapped();
    await t.learn.setState(t.path, 'params', 'taught', DAY);
    t.reply(questionsSchema, () => ({ questions: [q('c1')] }));
    await t.learn.ensureCheck(t.path, 'params');
    t.modified.set('Notes/DS346/Topic Models.md', Date.now() + 10 ** 12);
    await t.learn.ensureCheck(t.path, 'params');
    expect(t.calls.filter((c) => c.task.schema === questionsSchema)).toHaveLength(2);
  });

  it('teaches a lesson: probe, plan, steps, live marking, close', async () => {
    const t = await mapped();
    t.reply(probeSchema, () => ({
      questions: [mcq('p1'), q('p2', { objective: 'params' })],
      note: 'Checks the prerequisites.',
    }));
    const lesson = await t.learn.startLesson({
      topic: 'LDA generative process',
      notes: [],
      mastery: t.path,
      objective: 'lda-generative',
    });
    await settle();
    await settle();
    // The objective's notes are inlined for both generation and review.
    expect(t.calls.at(-1)).toMatchObject({ role: 'marker', task: { vault: undefined } });
    expect(t.calls.at(-1)!.task.prompt).toContain(
      '<note path="Notes/DS346/Topic Models.md">\n# Topic Models',
    );
    expect(t.learn.lessonAt(lesson)!.notes).toEqual(['Notes/DS346/Topic Models.md']);

    t.learn.answerProbe(lesson, 'p1', { choice: 0 });
    t.learn.answerProbe(lesson, 'p2', { unknown: true });
    t.reply(probeMapSchema, () => ({
      marks: [],
      findings: 'Dirichlet is the missing foundation.',
      map: {
        title: 'The LDA story',
        plan: 'Start from pLSA.',
        mermaid: 'graph TD; A-->B',
        steps: [
          { title: 'Dirichlet draws', why: 'Needed next.' },
          { title: 'The full story', why: 'The goal.' },
        ],
      },
    }));
    t.reply(stepSchema, (task) => ({
      title: task.prompt.includes('step 1 of') ? 'Dirichlet draws' : 'The full story',
      explain: 'A draw is a point on the simplex.',
      connect: 'Links.',
      checkFirst: true,
      check: q('x'),
      misconceptions: [{ signs: 'Thinks a draw is a number', reteach: 'It is a whole vector.' }],
    }));
    await t.learn.submitProbe(lesson);
    let l = t.learn.lessonAt(lesson)!;
    expect(l.probe!.marks).toMatchObject({ p1: { score: 0 }, p2: { mistake: 'unknown' } });
    expect(l.map!.steps).toHaveLength(2);
    // The "I don't know" probe on a known objective is evidence.
    expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')!.state).toBe(
      'gap',
    );

    await t.learn.acceptMap(lesson);
    await vi.waitFor(() => expect(t.learn.lessonAt(lesson)!.steps.every(Boolean)).toBe(true));
    expect(
      t.calls.filter((c) => c.task.schema === stepSchema).every((c) => c.role === 'writer'),
    ).toBe(true);
    l = t.learn.lessonAt(lesson)!;
    expect(l.steps[0]!.check).toMatchObject({ id: 'k1', objective: 'lda-generative' });

    t.learn.answerStep(lesson, { text: 'A number', confidence: 'sure' });
    t.reply(tutorMarkSchema, () => ({
      score: 2,
      awarded: [false, false],
      annotations: [],
      mistake: 'misconception',
      feedback: 'Not quite.',
      reply: 'A draw is not one number.',
      misconception: 0,
    }));
    await t.learn.checkStep(lesson);
    l = t.learn.lessonAt(lesson)!;
    expect(l.state[0]).toMatchObject({
      mark: { score: 0 },
      reply: 'A draw is not one number.',
      reteach: 'It is a whole vector.',
    });
    expect(t.calls.at(-1)).toMatchObject({ role: 'tutor', task: { vault: false } });

    await t.learn.go(lesson, 1);
    t.learn.answerStep(lesson, { unknown: true });
    await t.learn.checkStep(lesson);
    expect(t.learn.lessonAt(lesson)!.state[1]!.mark!.mistake).toBe('unknown');

    t.reply(closeSchema, () => ({
      summary: 'We built LDA from Dirichlet draws.',
      cards: [{ front: 'What is a Dirichlet draw?', back: 'A point on the simplex.' }],
      noteEdit: {
        path: 'Notes/DS346/Topic Models.md',
        heading: 'Dirichlet',
        text: 'A draw is a point on the simplex.',
      },
    }));
    t.reply(questionsSchema, () => ({ questions: [q('c1')] }));
    await t.learn.finishLesson(lesson);
    l = t.learn.lessonAt(lesson)!;
    expect(l.close).toMatchObject({
      summary: 'We built LDA from Dirichlet draws.',
      nextCheck: '2026-10-02',
    });
    expect((await t.learn.course(t.path)).objectives[0]).toMatchObject({
      state: 'taught',
      evidence: ['test 2026-09-29 q7 0/6 sure', '2026-09-29 lesson 0/2 checks'],
    });
    expect(t.files.get(lesson.replace('.json', '.md'))).toContain(
      '## Summary\n\nWe built LDA from Dirichlet draws.',
    );
    expect(await t.learn.pendingCheck(t.path, 'lda-generative')).toBeDefined();

    await t.learn.lessonCard(lesson, 0, 'added', 'card-1');
    expect(t.links.get('card-1')).toEqual({
      mastery: t.path,
      objective: 'lda-generative',
      lapses: 0,
    });
    await t.learn.noteEdit(lesson, true);
    expect(t.files.get('Notes/DS346/Topic Models.md')).toBe(
      '# Topic Models\n\n## Dirichlet\n\nA prior.\n\nA draw is a point on the simplex.\n',
    );
  });

  it('records tagged test questions and slips mastered objectives when cards lapse', async () => {
    const t = await mapped();
    const test = {
      version: 1,
      title: 'T',
      createdAt: 0,
      mastery: t.path,
      sections: [
        {
          id: 's1',
          title: 'S',
          questions: [q('q1', { objective: 'params' }), q('q2', { objective: 'params' }), q('q3')],
        },
      ],
    } as PracticeTest;
    const mark = (score: number) => ({
      score,
      awarded: [],
      annotations: [],
      mistake: 'none' as const,
      feedback: '',
    });
    await t.learn.recordTest(test, {
      version: 1,
      startedAt: 0,
      answers: {},
      sections: {},
      review: {},
      marks: { q1: mark(2), q2: mark(1), q3: mark(0) },
    });
    expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')).toMatchObject({
      state: 'right once',
      evidence: ['2026-09-29 test q1+q2 3/4'],
    });

    await t.learn.setState(t.path, 'params', 'mastered', '2026-12-01');
    await t.learn.linkCard('card-9', t.path, 'params');
    await t.learn.cardLapse('card-9');
    expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')!.state).toBe(
      'mastered',
    );
    await t.learn.cardLapse('card-9');
    expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')).toMatchObject({
      state: 'slipping',
      due: DAY,
    });
  });
});

describe('OpenRouter', () => {
  const vault = { paths: () => ['Notes/A.md'], read: async () => 'Alpha note.' };
  const ok = (message: unknown) => ({
    status: 200,
    json: { choices: [{ message, finish_reason: 'stop' }] },
  });
  it('runs the note tools and returns validated JSON', async () => {
    const http = vi
      .fn<Http>()
      .mockResolvedValueOnce(
        ok({
          content: null,
          tool_calls: [
            {
              id: 't1',
              type: 'function',
              function: { name: 'read_note', arguments: '{"path":"Notes/A.md"}' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ content: '{"answer":"Alpha"}' }));
    const runner = new OpenRouterRunner(vault, () => 'key', 'anthropic/claude-haiku-4.5', [], http);
    expect(
      await runner.run({
        prompt: 'Read A',
        schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      }),
    ).toEqual({ answer: 'Alpha' });
    const second = JSON.parse(http.mock.calls[1]![1].body!) as {
      messages: { role: string; content: string }[];
      response_format: unknown;
      model: string;
    };
    expect(second.model).toBe('anthropic/claude-haiku-4.5');
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', content: 'Alpha note.' });
    expect(second.response_format).toBeDefined();
    expect(http.mock.calls[0]![1].headers.Authorization).toBe('Bearer key');
  });
  it('stops waiting for a request that never replies, or once cancelled', async () => {
    vi.useFakeTimers();
    try {
      const hung = vi.fn<Http>().mockReturnValue(new Promise(() => {}));
      const run = new OpenRouterRunner(vault, () => 'key', 'm', [], hung).run({
        prompt: 'x',
        schema: { type: 'string' },
      });
      const failed = expect(run).rejects.toThrow(/OpenRouter didn't reply within 5 minutes/);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await failed;
      const controller = new AbortController();
      const cancelled = expect(
        new OpenRouterRunner(vault, () => 'key', 'm', [], hung).run({
          prompt: 'x',
          schema: { type: 'string' },
          signal: controller.signal,
        }),
      ).rejects.toThrow('Cancelled.');
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      await cancelled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops structured output when a provider rejects it, and explains auth failures', async () => {
    const http = vi
      .fn<Http>()
      .mockResolvedValueOnce({ status: 400, json: {} })
      .mockResolvedValueOnce(ok({ content: '{"a":1}' }));
    const runner = new OpenRouterRunner(vault, () => 'key', 'm', [], http);
    expect(
      await runner.run({
        prompt: 'x',
        schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        vault: false,
      }),
    ).toEqual({ a: 1 });
    const retry = JSON.parse(http.mock.calls[1]![1].body!) as Record<string, unknown>;
    expect(retry.response_format).toBeUndefined();
    expect(retry.tools).toBeUndefined();
    await expect(
      new OpenRouterRunner(
        vault,
        () => 'bad',
        'm',
        [],
        vi.fn<Http>().mockResolvedValue({ status: 401, json: {} }),
      ).run({ prompt: 'x', schema: { type: 'string' } }),
    ).rejects.toThrow(/key was rejected/);
    await expect(
      new OpenRouterRunner(vault, () => null, 'm', []).run({
        prompt: 'x',
        schema: { type: 'string' },
      }),
    ).rejects.toThrow(/Add an OpenRouter API key/);
  });
});

it('keeps short agent fields short, without splitting maths', () => {
  expect(firstSentences('One. Two has $p = 0.5. q$ inside. Three.')).toBe(
    'One. Two has $p = 0.5. q$ inside.',
  );
  expect(firstSentences('No full stop at all')).toBe('No full stop at all');
  expect(firstSentences(Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ') + '.')).toBe(
    Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') + '…',
  );
});

describe('deleting learning material', () => {
  it('removes a course and only its own generated lessons/checks, preserving notes and other courses', async () => {
    const t = await mapped();
    const lesson = 'Qard/Lessons/delete.json',
      other = 'Qard/Lessons/other.json',
      check = 'Qard/Checks/DS346/delete.json';
    const record = {
      version: 1,
      createdAt: 1,
      topic: 'LDA',
      mastery: t.path,
      notes: [],
      steps: [],
      state: [],
      current: 0,
    };
    t.files.set(lesson, JSON.stringify(record));
    t.files.set(lesson.replace('.json', '.md'), '---\nqard-lesson: true\n---\nSummary.');
    t.files.set(other, JSON.stringify({ ...record, mastery: 'Other/Mastery.md' }));
    t.files.set(
      check,
      JSON.stringify({
        version: 1,
        mastery: t.path,
        objective: 'params',
        questionPolicy: 1,
        promptFingerprint: await checkPromptFingerprint(),
        answers: {},
        marks: {},
        questions: [],
      }),
    );
    t.files.set('Qard/Tests/keep/test.json', 'keep');
    await t.learn.loadLesson(lesson);
    await t.learn.loadCheck(check);
    t.learn.answerCheck(check, 'c1', { text: 'Latest answer' });
    await t.learn.removeCourse(t.path);
    await t.learn.flush();
    expect(t.files.has(t.path)).toBe(false);
    expect(t.files.has(lesson)).toBe(false);
    expect(t.files.has(check)).toBe(false);
    expect(t.files.has(lesson.replace('.json', '.md'))).toBe(false);
    expect(t.files.has(other)).toBe(true);
    expect(t.files.has('Notes/DS346/Topic Models.md')).toBe(true);
    expect(t.files.has('Qard/Tests/keep/test.json')).toBe(true);
    expect(await t.learn.courses()).toEqual([]);
    expect(t.learn.lessonAt(lesson)).toBeUndefined();
    expect(t.learn.checkAt(check)).toBeUndefined();
    expect(await t.restart().listLessons()).toHaveLength(1);
    await t.learn.record(t.path, 'params', { kind: 'card', day: DAY, label: 'late lapse' });
    expect(t.files.has(t.path)).toBe(false);
  });
  it('deletes a mapping immediately and a late AI reply cannot recreate it, including after reload', async () => {
    const t = setup();
    let finish!: (value: unknown) => void;
    t.reply(
      objectivesSchema,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = t.learn.mapCourse('Notes/DS346');
    await settle();
    await t.learn.removeMapping('Notes/DS346');
    expect(Object.keys(t.learn.getSnapshot().jobs)).toHaveLength(0);
    finish({ course: 'DS346', objectives: [] });
    await running;
    await settle();
    expect(t.learn.proposal('Notes/DS346')).toBeUndefined();
    expect([...t.files.keys()].some((p) => p.includes('/Proposals/'))).toBe(false);
    const pending = await t.restart().pending();
    expect(pending.mapping).toEqual([]);
    expect(pending.failed).toEqual([]);
    expect(pending.proposals).toEqual([]);
    t.replies.length = 0;
    t.reply(objectivesSchema, () => ({
      course: 'New course',
      objectives: [
        {
          id: 'new',
          title: 'New objective',
          notes: [],
          needs: [],
          group: '',
          label: '',
          state: 'new',
          evidence: '',
        },
      ],
    }));
    await t.learn.mapCourse('Notes/DS346');
    expect(t.learn.proposal('Notes/DS346')?.course).toBe('New course');
  });
  it('cancels course check generation and late replies cannot recreate files', async () => {
    const t = await mapped();
    let finish!: (value: unknown) => void;
    t.reply(
      questionsSchema,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = t.learn.ensureCheck(t.path, 'params');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await t.learn.removeCourse(t.path);
    finish({ questions: [q('c1')] });
    await running;
    await settle();
    expect([...t.files.keys()].some((p) => p.includes('/Checks/'))).toBe(false);
    expect(Object.keys(t.learn.getSnapshot().jobs)).toHaveLength(0);
  });
  it('deletes an individual lesson, cancels its probe, and preserves the course', async () => {
    const t = await mapped();
    let finish!: (value: unknown) => void;
    t.reply(
      probeSchema,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const path = await t.learn.startLesson({ topic: 'LDA', notes: [], mastery: t.path });
    await settle();
    await t.learn.removeLesson(path);
    finish({ questions: [] });
    await settle();
    await t.learn.flush();
    expect(t.files.has(path)).toBe(false);
    expect(t.learn.lessonAt(path)).toBeUndefined();
    expect(t.files.has(t.path)).toBe(true);
    expect(await t.learn.listLessons()).toEqual([]);
    expect(Object.keys(t.learn.getSnapshot().jobs)).toHaveLength(0);
  });
  it('drains an in-flight save before trashing a lesson', async () => {
    const t = setup();
    const path = 'Qard/Lessons/slow.json';
    let release!: () => void;
    const original = t.storage.write;
    const events: string[] = [];
    vi.spyOn(t.storage, 'write').mockImplementation(async (p, text) => {
      if (p === path) {
        await new Promise<void>((r) => {
          release = r;
        });
        events.push('save');
      }
      await original(p, text);
    });
    t.files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'slow',
        notes: [],
        steps: [],
        state: [],
        current: 0,
      }),
    );
    await t.learn.loadLesson(path);
    t.learn.lessonAt(path)!.steps = [
      {
        title: 'Step',
        explain: '',
        connect: '',
        checkFirst: false,
        check: q('c1'),
        misconceptions: [],
      },
    ];
    const pending = t.learn.go(path, 0);
    await settle();
    const remove = t.storage.remove;
    vi.spyOn(t.storage, 'remove').mockImplementation(async (p) => {
      events.push('trash');
      await remove(p);
    });
    const deleting = t.learn.removeLesson(path);
    await settle();
    expect(events).toEqual([]);
    release();
    await pending;
    await deleting;
    expect(events).toEqual(['save', 'trash']);
    expect(t.files.has(path)).toBe(false);
  });
  it('keeps a lesson accessible if moving to trash fails, and refuses to delete source notes', async () => {
    const t = setup(),
      path = 'Qard/Lessons/keep.json';
    t.files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'keep',
        notes: [],
        steps: [],
        state: [],
        current: 0,
      }),
    );
    vi.spyOn(t.storage, 'remove').mockRejectedValueOnce(new Error('Trash unavailable'));
    await expect(t.learn.removeLesson(path)).rejects.toThrow('Trash unavailable');
    expect((await t.learn.loadLesson(path)).topic).toBe('keep');
    await expect(t.learn.removeCourse('Notes/DS346/Topic Models.md')).rejects.toThrow('mastery');
    await expect(t.learn.removeLesson('Notes/DS346/Topic Models.md')).rejects.toThrow(
      'Qard learning',
    );
    expect(t.files.has('Notes/DS346/Topic Models.md')).toBe(true);
    await t.learn.removeLesson(path);
    expect(t.files.has(path)).toBe(false);
  });
});

it('undo restores card lapse counts and the objective changed by a second lapse', async () => {
  const t = await mapped();
  await t.learn.setState(t.path, 'params', 'mastered', '2026-12-01');
  await t.learn.linkCard('undo-card', t.path, 'params');
  const before = (await t.learn.course(t.path)).objectives.find((o) => o.id === 'params');
  const undoFirst = await t.learn.cardLapse('undo-card');
  expect(t.links.get('undo-card')!.lapses).toBe(1);
  await undoFirst?.();
  expect(t.links.get('undo-card')!.lapses).toBe(0);
  await t.learn.cardLapse('undo-card');
  const undoSecond = await t.learn.cardLapse('undo-card');
  expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')!.state).toBe(
    'slipping',
  );
  await undoSecond?.();
  expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')).toEqual(before);
  expect(t.links.get('undo-card')!.lapses).toBe(1);
});

it('undo of a lapse preserves later objective edits and relinked cards', async () => {
  const t = await mapped();
  await t.learn.setState(t.path, 'params', 'mastered', '2026-12-01');
  await t.learn.linkCard('undo-card', t.path, 'params');
  await t.learn.cardLapse('undo-card');
  const undo = await t.learn.cardLapse('undo-card');
  await t.learn.setState(t.path, 'params', 'right once', '2027-01-01');
  await t.learn.linkCard('undo-card', t.path, 'lda-generative');
  await undo?.();
  expect((await t.learn.course(t.path)).objectives.find((o) => o.id === 'params')).toMatchObject({
    state: 'right once',
    due: '2027-01-01',
  });
  expect(t.links.get('undo-card')!.objective).toBe('lda-generative');
});
