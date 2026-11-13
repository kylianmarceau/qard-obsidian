// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { LearnService } from '../src/learn/learn-service';
import { checkPromptFingerprint } from '../src/learn/step-review';
import { type LearnStorage } from '../src/learn/learn-contracts';
import { newMasteryNote } from '../src/learn/mastery';
import { readSettings } from '../src/settings/settings';
import { marksSchema } from '../src/tests/test-schema';
import { CheckView } from '../src/components/learn/CheckView';
import { LessonView } from '../src/components/learn/LessonView';
import { CourseView } from '../src/components/learn/CourseView';
import { TodayRow } from '../src/components/learn/TodayView';
import { LearnBrowser } from '../src/components/learn/LearnBrowser';
import type { LearnNav } from '../src/views/navigation';
import { DeleteLearnItem } from '../src/components/learn/DeleteLearnItem';
import { RunningJobs } from '../src/components/jobs/RunningJobs';
import type { QardServices } from '../src/views/services';
import type { AgentTask } from '../src/agents/runner';
import { CardIndex } from '../src/cards/card-index';
import { serializeCard } from '../src/cards/source-patch';
import type { Lesson } from '../src/learn/learn-types';
import type { CardDraft } from '../src/cards/card-writer';
// A constant snapshot: useSyncExternalStore re-renders forever if each call returns a new object.
const reviewSnapshot = { settings: readSettings({}), study: {} };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MASTERY = 'Notes/DS346/DS346 Mastery.md';
const CHECK = 'Qard/Checks/DS346/2026-09-29 params.json';
const q = (id: string, extra = {}) => ({
  id,
  type: 'short',
  prompt: `Prompt ${id}`,
  marks: 2,
  rubric: [
    { point: 'A', marks: 1 },
    { point: 'B', marks: 1 },
  ],
  model: 'The model answer.',
  ...extra,
});
let host: HTMLElement, root: Root, services: QardServices, files: Map<string, string>;
const nav = {
  library: vi.fn(),
  today: vi.fn(),
  learn: vi.fn(),
  mapCourse: vi.fn(),
  course: vi.fn(),
  check: vi.fn(),
  lesson: vi.fn(),
  studyDue: vi.fn(),
} satisfies LearnNav;
beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  files = new Map([
    [
      MASTERY,
      newMasteryNote('DS346', [
        {
          id: 'params',
          title: 'Parameter counts',
          state: 'taught',
          due: '2000-01-01',
          notes: [],
          needs: [],
          evidence: [],
          cells: {},
        },
      ]),
    ],
    [
      CHECK,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        mastery: MASTERY,
        course: 'DS346',
        objective: 'params',
        title: 'Parameter counts',
        goal: 'explain',
        questionPolicy: 1,
        promptFingerprint: await checkPromptFingerprint(),
        questions: [
          q('c1', {
            type: 'mcq',
            marks: 1,
            rubric: [{ point: 'x', marks: 1 }],
            options: ['VK', 'K+KV'],
            answer: 1,
          }),
          q('c2', { goal: 'explain' }),
        ],
        answers: {},
        marks: {},
        status: 'ready',
      }),
    ],
  ]);
  const storage: LearnStorage = {
    read: async (p) => files.get(p) ?? null,
    write: async (p, t) => {
      files.set(p, t);
    },
    exists: (p) => files.has(p),
    process: async (p, fn) => {
      files.set(p, fn(files.get(p)!));
    },
    files: (folder, ext) =>
      [...files.keys()].filter((p) => p.startsWith(folder + '/') && p.endsWith('.' + ext)),
    remove: async (p) => {
      files.delete(p);
    },
    masteryFiles: () => [MASTERY],
    modified: () => undefined,
    resolve: () => undefined,
  };
  const run = vi.fn(
    async (task: AgentTask): Promise<unknown> =>
      task.schema === marksSchema
        ? {
            questions: [
              {
                id: 'c2',
                score: 2,
                awarded: [true, false],
                annotations: [{ quote: 'grows', kind: 'correct', note: 'Yes.' }],
                mistake: 'incomplete',
                feedback: 'Half there.',
              },
            ],
          }
        : new Promise(() => {}),
  );
  const learn = new LearnService(
    storage,
    () => readSettings({}),
    () => ({ name: 'x', run }),
    { get: () => undefined, set: async () => {} },
    () => 3,
  );
  services = {
    host,
    owner: new Component(),
    learn,
    index: { getSnapshot: () => ({ cards: [] }) },
    reviews: { subscribe: () => () => {}, getSnapshot: () => reviewSnapshot },
    isActive: () => true,
    app: {
      workspace: { on: vi.fn(), offref: vi.fn(), openLinkText: vi.fn() },
      vault: { getMarkdownFiles: () => [] },
    },
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = (text: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes(text));

it('home shows what is due today in one row', async () => {
  await act(async () => {
    root.render(<TodayRow services={services} nav={nav} />);
  });
  await tick();
  await tick();
  expect(host.textContent).toBe('Today1 check · 3 cards');
  await click(host.querySelector('button'));
  expect(nav.today).toHaveBeenCalled();
});

it('a check: answer, "I don\'t know" disables the input, submit marks and moves the objective on', async () => {
  await act(async () => {
    root.render(<CheckView services={services} nav={nav} path={CHECK} />);
  });
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toContain('Retention check');
  });
  expect(host.textContent).toContain('Your result decides what to revisit');
  expect(host.textContent).toContain('Choose an answer');
  expect(host.textContent).toContain('Write an answer');
  expect(host.textContent).not.toContain('Why this format?');
  expect(host.querySelector('.qard-format-help')).toBeNull();
  expect(host.textContent).not.toContain('2 marks');
  const submit = () => buttons('Submit')[0]!;
  expect(submit().disabled).toBe(true);
  await click(buttons('K+KV').find((b) => b.getAttribute('role') === 'radio'));
  await click(buttons("I don't know")[1]);
  expect(host.querySelectorAll('textarea')[0]!.disabled).toBe(true);
  await click(buttons("I don't know")[1]);
  await act(async () => {
    const t = host.querySelector('textarea')!;
    t.value = 'It grows with M';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(buttons('Sure')[1]);
  expect(submit().disabled).toBe(false);
  await click(submit());
  await tick();
  await tick();
  expect(host.querySelector('.qard-review-score')?.textContent).toBe('2/3');
  expect(host.textContent).toContain('Half there.');
  expect(host.querySelector('.qard-state')?.textContent).toBe('Shaky');
  expect(files.get(MASTERY)).toContain('check explain 2/3');
  await click(buttons('Next')[0]);
  expect(nav.today).toHaveBeenCalled();
  expect(nav.studyDue).not.toHaveBeenCalled();
});

it('a lesson plan is shown for approval before teaching starts', async () => {
  const LESSON = 'Qard/Lessons/2026-09-29 LDA.json';
  files.set(
    LESSON,
    JSON.stringify({
      version: 1,
      createdAt: 1,
      topic: 'LDA',
      notes: [],
      steps: [],
      state: [],
      current: 0,
      probe: {
        questions: [],
        answers: {},
        submitted: true,
        marks: {},
        findings:
          'Start from pLSA. You know the $\\theta_i \\sim \\mathrm{Dir}(\\alpha)$ step. Start from pLSA again. And again.',
      },
      map: {
        title: 'The LDA story',
        plan: 'We start from **pLSA**.',
        mermaid: 'graph TD; A-->B',
        steps: [{ title: 'Dirichlet draws', why: 'Needed first.' }],
      },
    }),
  );
  await act(async () => {
    root.render(<LessonView services={services} nav={nav} path={LESSON} />);
  });
  await tick();
  await tick();
  expect(host.querySelector('h1')?.textContent).toBe('The LDA story');
  // The findings sit in the body, cut to two sentences, not under the title.
  expect(host.querySelector('header')!.textContent).not.toContain('pLSA');
  expect(host.querySelector('.qard-probe-results')!.textContent).toBe(
    'What your answers showStart from pLSA. You know the $\\theta_i \\sim \\mathrm{Dir}(\\alpha)$ step.',
  );
  expect(host.textContent).toContain('Dirichlet draws');
  expect(host.textContent).toContain('Finishing records teaching evidence');
  expect(host.textContent).not.toContain('Finishing marks it as taught');
  await click(buttons('Start lesson')[0]);
  await tick();
  expect(host.textContent).toContain('Writing this step…');
});

async function openRecap(
  lesson: Partial<Lesson> = {},
  sources: Record<string, string> = {},
  topics: Record<string, unknown> = {},
) {
  const path = 'Qard/Lessons/2026-09-29 generics.json';
  files.set(
    path,
    JSON.stringify({
      version: 1,
      createdAt: 1,
      topic: 'Generic contracts',
      course: 'Programming',
      notes: Object.keys(sources),
      steps: [],
      state: [],
      current: 0,
      finishedAt: 2,
      map: { title: 'Build generic contracts', plan: '', mermaid: '', steps: [] },
      close: {
        summary: 'Keep the type relationship explicit.',
        cards: [
          { front: 'Why use a type parameter?', back: 'It preserves the type relationship.' },
        ],
        cardState: {},
      },
      ...lesson,
    }),
  );
  const index = new CardIndex();
  for (const [sourcePath, text] of Object.entries(sources)) {
    index.update(sourcePath, text);
  }
  Object.assign(services.index, { getSnapshot: index.getSnapshot });
  Object.assign(services.app, {
    metadataCache: {
      getCache: (sourcePath: string) => ({ frontmatter: { 'qard-topic': topics[sourcePath] } }),
    },
  });
  const create = vi.fn(async (_draft: CardDraft) => ({ id: 'suggested-card' }));
  Object.assign(services, { writer: { create } });
  await act(async () => {
    root.render(<LessonView services={services} nav={nav} path={path} />);
  });
  await tick();
  await tick();
  return { path, create };
}

it.each(['taught', 'right once', 'mastered'] as const)(
  'lesson completion describes the saved %s progress without assuming a first retention check',
  async (state) => {
    files.set(
      MASTERY,
      newMasteryNote('DS346', [
        {
          id: 'params',
          title: 'Parameter counts',
          state,
          due: '2000-01-01',
          notes: [],
          needs: [],
          evidence: ['Earlier retention evidence'],
          cells: {},
        },
      ]),
    );
    const savedMastery = files.get(MASTERY);
    await openRecap({ mastery: MASTERY, objective: 'params' });
    const outcome = host.querySelector('.qard-check-outcome')!;
    expect(outcome.textContent).toContain(
      state === 'right once' ? 'Right once' : state === 'mastered' ? 'Mastered' : 'Taught',
    );
    expect(host.textContent).not.toContain('Lesson finished: taught');
    expect(host.textContent).not.toContain('First retention check');
    expect(outcome.textContent).toContain('Retention check');
    expect(host.textContent).not.toContain('retention still to check');
    expect(files.get(MASTERY)).toBe(savedMastery);
  },
);

it('recap cards use the selected source note fixed topic without changing the shared destination', async () => {
  const selected = 'Notes/Generics.md',
    other = 'Notes/Constraints.md';
  const notes = [other, selected];
  const sourceSnapshots = [{ path: selected, text: 'The historical source version.' }];
  const { path, create } = await openRecap(
    { notes, sourceSnapshots },
    {
      [selected]:
        '---\nqard-deck: Programming\nqard-topic: NET/Generics\n---\n' +
        '<!-- qard-location: {"deck":"Programming","topic":"Moved topic"} -->\n' +
        serializeCard('existing', 'Existing question?', 'Existing answer.'),
      [other]: '---\nqard-deck: Reference\n---\n' + serializeCard('other', 'Other?', 'Answer.'),
    },
    { [selected]: '  NET/Generics  ', [other]: 'NET/Constraints' },
  );
  const record = vi.spyOn(services.learn, 'lessonCard');
  let finish!: (card: { id: string }) => void;
  create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  expect(host.querySelector('h1')?.textContent).toBe('Build generic contracts');
  expect(host.querySelector('.qard-suggestion small')?.textContent).toBe(
    'Programming › NET/Generics',
  );
  await click(buttons('Add')[0]);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      deck: 'Programming',
      topic: 'NET/Generics',
      sourceFile: selected,
      generatedFrom: notes,
      sourceSnapshots,
    }),
  );
  expect(record).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('✓ Added');
  await act(async () => finish({ id: 'suggested-card' }));
  await tick();
  expect(record).toHaveBeenCalledWith(path, 0, 'added', 'suggested-card');
  expect(JSON.parse(files.get(path)!).close.cardState).toEqual({ 0: 'added' });
  expect(host.textContent).toContain('✓ Added');
});

it.each([undefined, '   ', 42])(
  'recap cards keep the lesson title when the source has no valid fixed topic (%s)',
  async (fixedTopic) => {
    const source = 'Notes/Generics.md';
    const { create } = await openRecap(
      {},
      { [source]: '---\nqard-deck: Programming\n---\n' + serializeCard('old', 'Old?', 'Answer.') },
      { [source]: fixedTopic },
    );
    await click(buttons('Add')[0]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        deck: 'Programming',
        topic: 'Build generic contracts',
        sourceFile: source,
      }),
    );
  },
);

it.each(['Programming', undefined])(
  'recap without indexed source cards keeps its course or lesson deck (%s)',
  async (course) => {
    const { create } = await openRecap(
      { notes: ['Notes/Generics.md'], course },
      {},
      { 'Notes/Generics.md': 'NET/Generics' },
    );
    await click(buttons('Add')[0]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        deck: course ?? 'Generic contracts',
        topic: 'Build generic contracts',
      }),
    );
    expect(create.mock.calls[0]![0]).not.toHaveProperty('sourceFile');
  },
);

it('recap without a lesson map uses the lesson topic', async () => {
  const { create } = await openRecap({ map: undefined });
  await click(buttons('Add')[0]);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Generic contracts' }));
});

it('recap leaves a suggested card unadded when its writer rejects the save', async () => {
  const { path, create } = await openRecap();
  create.mockRejectedValueOnce(new Error('The source note changed.'));
  const record = vi.spyOn(services.learn, 'lessonCard');
  await click(buttons('Add')[0]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('The source note changed.');
  expect(record).not.toHaveBeenCalled();
  expect(JSON.parse(files.get(path)!).close.cardState).toEqual({});
  expect(host.textContent).not.toContain('✓ Added');
});

it('the course map opens on topics, drills into one, and routes across topics', async () => {
  files.set(
    MASTERY,
    `---\nqard-mastery: DS346\nqard-mapped: 2026-09-01T10:00\n---\n\n| Objective | Label | ID | Group | State | Due | Needs |\n| --- | --- | --- | --- | --- | --- | --- |\n| Bag of words | Bag of words | bow | Text mining | mastered |  |  |\n| Parameter counts | Parameters | params | Topic models | taught | 2000-01-01 | bow |\n| List the LDA generative process | LDA story | lda | Topic models | misconception |  | bow, params |\n| Hadoop | Hadoop | hadoop | Big data | planned |  |  |\n`,
  );
  await act(async () => {
    root.render(<CourseView services={services} nav={nav} path={MASTERY} />);
  });
  await tick();
  await tick();
  const topic = (name: string) => host.querySelector(`.qard-topic-node[aria-label^="${name}"]`)!;
  expect(
    [...host.querySelectorAll('.qard-topic-node')].map((t) => t.getAttribute('aria-label')),
  ).toEqual([
    'Text mining: 1 of 1 learned, 1 mastered',
    'Topic models: 1 of 2 learned, 0 mastered, 1 to fix, 1 ready to learn',
    'Big data: 0 of 1 learned, 0 mastered',
  ]);
  expect(topic('Topic models').textContent).toContain('⚠ 1');
  expect(topic('Big data').textContent).toContain('Not covered yet');
  expect(host.querySelectorAll('.qard-map-edge')).toHaveLength(1);
  // Filtering by state dims topics with nothing in that state.
  await click(buttons('1 mastered')[0]);
  expect(topic('Topic models').classList.contains('is-dim')).toBe(true);
  await click(buttons('Show all')[0]);

  await click(topic('Topic models'));
  expect(host.querySelector('.qard-map-crumb')?.textContent).toBe('Topic models');
  expect(
    [...host.querySelectorAll('.qard-map-node:not(.qard-map-stub) .qard-map-title')].map(
      (t) => t.textContent,
    ),
  ).toEqual(['Parameters', 'LDA story']);
  expect(host.querySelector('.qard-map-stub')?.getAttribute('aria-label')).toBe(
    'Builds on Text mining',
  );
  await click(host.querySelector('.qard-map-node[aria-label^="List the LDA"]'));
  const panel = host.querySelector('.qard-map-panel')!;
  expect(panel.querySelector('h3')?.textContent).toBe('List the LDA generative process');
  expect(panel.textContent).toContain('Builds on');
  expect(host.querySelector('.qard-map-frame')?.classList.contains('is-panel-open')).toBe(true);
  await click(buttons('Route here')[0]);
  expect([...host.querySelectorAll('.qard-map-route button')].map((b) => b.textContent)).toEqual([
    '1List the LDA generative process',
  ]);
  // A prerequisite in another topic opens that topic.
  await click(
    [...panel.querySelectorAll('.qard-map-link')].find((b) =>
      b.textContent?.startsWith('Bag of words'),
    ),
  );
  expect(host.querySelector('.qard-map-crumb')?.textContent).toBe('Text mining');
  await click(buttons('Topics')[0]);
  expect(host.querySelectorAll('.qard-topic-node')).toHaveLength(3);
  expect(host.querySelector('.qard-map-frame')?.classList.contains('is-panel-open')).toBe(false);
  await click(buttons('List')[0]);
  expect(host.querySelectorAll('.qard-objective')).toHaveLength(4);
});

it('a lesson links to its place on the map, and the map continues it rather than starting another', async () => {
  files.set(
    MASTERY,
    `---\nqard-mastery: DS346\n---\n\n| Objective | Label | ID | Group | State | Needs |\n| --- | --- | --- | --- | --- | --- |\n| Bag of words | Bag of words | bow | Text mining | mastered |  |\n| List the LDA generative process | LDA story | lda | Topic models | gap | bow |\n`,
  );
  const LESSON = 'Qard/Lessons/2026-09-30 LDA.json';
  files.set(
    LESSON,
    JSON.stringify({
      version: 1,
      createdAt: 1,
      topic: 'LDA',
      notes: [],
      mastery: MASTERY,
      course: 'DS346',
      objective: 'lda',
      steps: [],
      state: [],
      current: 0,
      probe: { questions: [], answers: {}, submitted: true, marks: {}, findings: 'F' },
      map: { title: 'The LDA story', plan: 'P', mermaid: '', steps: [{ title: 'One', why: 'w' }] },
    }),
  );
  await act(async () => {
    root.render(<LessonView services={services} nav={nav} path={LESSON} />);
  });
  await tick();
  await tick();
  const trail = host.querySelector('.qard-lesson-trail')!;
  expect(trail.textContent).toContain('DS346›Topic models›LDA story');
  await click(buttons('Show on map')[0]);
  expect(nav.course).toHaveBeenCalledWith(MASTERY, 'lda');

  await act(async () => {
    root.render(<CourseView services={services} nav={nav} path={MASTERY} objective="lda" />);
  });
  await tick();
  await tick();
  expect(host.querySelector('.qard-map-crumb')?.textContent).toBe('Topic models');
  expect(
    host.querySelector('.qard-map-node[aria-label^="List the LDA"]')?.getAttribute('aria-label'),
  ).toBe('List the LDA generative process: Gap, ready to learn, lesson in progress');
  expect(host.querySelector('.qard-map-panel h3')?.textContent).toBe(
    'List the LDA generative process',
  );
  await click(buttons('Continue lesson')[0]);
  expect(nav.lesson).toHaveBeenCalledWith(LESSON);
});

it('the header shows background jobs and jumps to them', async () => {
  const testNav = {
    library: vi.fn(),
    tests: vi.fn(),
    newTest: vi.fn(),
    plan: vi.fn(),
    take: vi.fn(),
    results: vi.fn(),
    review: vi.fn(),
    cards: vi.fn(),
  };
  const idle = { revision: 0, jobs: {} };
  services.tests = {
    subscribe: () => () => {},
    getSnapshot: () => idle,
    get: () => undefined,
  } as unknown as QardServices['tests'];
  await act(async () => {
    root.render(<RunningJobs services={services} nav={testNav} learnNav={nav} />);
  });
  expect(host.textContent).toBe('');
  void services.learn.mapCourse('Notes/DS346');
  await tick();
  expect(host.querySelector('.qard-jobs-button')?.textContent).toBe('1 running');
  await click(host.querySelector('.qard-jobs-button'));
  expect(host.querySelector('.qard-jobs-item')?.textContent).toContain('Mapping courseDS346');
  await click(host.querySelector('.qard-jobs-item'));
  expect(nav.mapCourse).toHaveBeenCalledWith('Notes/DS346');
});

it('offers course deletion in Learn and removes it without opening the course', async () => {
  const testNav = {
    library: vi.fn(),
    tests: vi.fn(),
    newTest: vi.fn(),
    plan: vi.fn(),
    take: vi.fn(),
    results: vi.fn(),
    review: vi.fn(),
    cards: vi.fn(),
  };
  // Reflect file deletion in the vault's frontmatter index.
  const courses = services.learn.courses.bind(services.learn);
  vi.spyOn(services.learn, 'courses').mockImplementation(async () =>
    files.has(MASTERY) ? courses() : [],
  );
  await act(async () =>
    root.render(<LearnBrowser services={services} nav={nav} testNav={testNav} />),
  );
  await tick();
  await tick();
  await click(host.querySelector('[aria-label="Delete course"]'));
  expect(files.has(MASTERY)).toBe(true);
  await click(buttons('Delete').find((b) => b.textContent === 'Delete'));
  await tick();
  expect(files.has(MASTERY)).toBe(false);
  expect(files.has(CHECK)).toBe(false);
  expect(host.textContent).toContain('No courses yet.');
});
it('selected check deletion returns to Learn', async () => {
  const deleted = vi.fn();
  await act(async () =>
    root.render(
      <DeleteLearnItem services={services} kind="check" path={CHECK} deleted={deleted} />,
    ),
  );
  await click(host.querySelector('[aria-label="Delete check"]'));
  await click(buttons('Delete').find((b) => b.textContent === 'Delete'));
  expect(files.has(CHECK)).toBe(false);
  expect(files.has(MASTERY)).toBe(true);
  expect(deleted).toHaveBeenCalledOnce();
});

it('explains diagnostic consequences and renders the persisted note before answering', async () => {
  const path = 'Qard/Lessons/diagnostic.json';
  files.set(
    path,
    JSON.stringify({
      version: 1,
      createdAt: 1,
      topic: 'Recall',
      notes: [],
      current: 0,
      steps: [],
      state: [],
      probe: {
        questions: [q('p1')],
        answers: {},
        note: 'These questions check **prerequisite recall**.',
      },
    }),
  );
  await act(async () => root.render(<LessonView services={services} nav={nav} path={path} />));
  await tick();
  await tick();
  expect(host.textContent).toContain('Diagnostic');
  expect(host.textContent).toContain('update evidence about prerequisites');
  expect(host.textContent).toContain('prerequisite recall');
  expect(host.textContent).toContain('do not establish mastery');
  expect(host.textContent).not.toContain('2 marks');
  expect(host.querySelector('.qard-rubric-row')).toBeNull();
});

it.each([true, false])(
  'distinguishes a prediction from an immediate check (checkFirst=%s)',
  async (checkFirst) => {
    const path = 'Qard/Lessons/step.json';
    files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'Recall',
        notes: [],
        current: 0,
        accepted: true,
        map: {
          title: 'Recall',
          plan: '',
          mermaid: '',
          steps: [{ title: 'One', why: 'Learn the idea.' }],
        },
        steps: [
          {
            title: 'One',
            explain: 'The explanation is here.',
            connect: 'Connection.',
            checkFirst,
            check: q('s1', { source: { path: 'Notes/Recall.md', heading: 'Retrieval' } }),
            misconceptions: [],
          },
        ],
        state: [{ asks: [] }],
      }),
    );
    await act(async () => root.render(<LessonView services={services} nav={nav} path={path} />));
    await tick();
    await tick();
    expect(host.textContent).toContain(
      checkFirst ? 'Prediction before the explanation' : 'Check after the explanation',
    );
    expect(host.textContent).toContain('guides feedback');
    expect(host.textContent).toContain('Finishing records teaching evidence');
    expect(host.textContent).not.toContain('Finishing the lesson marks it as taught');
    expect(host.textContent?.includes('The explanation is here.')).toBe(!checkFirst);
    expect(host.textContent).not.toContain('2 marks');
    expect(host.querySelector('.qard-rubric-row')).toBeNull();
    if (!checkFirst) {
      await click(buttons('Read source: Recall')[0]);
      expect(services.app.workspace.openLinkText).toHaveBeenCalledWith(
        'Notes/Recall.md#Retrieval',
        path,
        false,
      );
    } else {
      expect(buttons('Read source: Recall')).toHaveLength(0);
    }
  },
);

it('hides cached questions while preparing a check and offers retry after a failed review', async () => {
  await services.learn.loadCheck(CHECK);
  const cached = services.learn.checkAt(CHECK)!;
  cached.promptFingerprint = undefined;
  let reject!: (error: Error) => void;
  const load = vi.spyOn(services.learn, 'loadCheck').mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => root.render(<CheckView services={services} nav={nav} path={CHECK} />));
  await tick();
  expect(host.textContent).toContain('Preparing check');
  expect(host.textContent).not.toContain('Prompt c2');
  expect(host.querySelector('textarea')).toBeNull();
  await act(async () => {
    reject(new Error('Review unavailable'));
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Review unavailable');
  expect(host.textContent).not.toContain('Prompt c2');
  load.mockImplementationOnce(async () => {
    cached.questions = [
      q('reviewed', {
        prompt: 'Reviewed replacement question',
      }) as (typeof cached.questions)[number],
    ];
    cached.promptFingerprint = await checkPromptFingerprint();
    return cached;
  });
  await click(buttons('Retry check')[0]);
  await tick();
  await tick();
  expect(load).toHaveBeenCalledTimes(2);
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toContain('Reviewed replacement question');
  });
  expect(host.textContent).not.toContain('Prompt c2');
  load.mockRestore();
});
