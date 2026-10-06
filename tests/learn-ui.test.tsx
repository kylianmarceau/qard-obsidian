// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { LearnService, type LearnStorage } from '../src/learn/learn-service';
import { newMasteryNote } from '../src/learn/mastery';
import { readSettings } from '../src/settings/settings';
import { marksSchema } from '../src/tests/test-schema';
import { CheckView } from '../src/components/learn/CheckView';
import { LessonView } from '../src/components/learn/LessonView';
import { CourseView, TodayRow, LearnBrowser } from '../src/components/learn/LearnScreens';
import type { LearnNav } from '../src/components/learn/common';
import { DeleteLearnItem } from '../src/components/learn/DeleteLearnItem';
import { RunningJobs } from '../src/components/jobs/RunningJobs';
import type { QardServices } from '../src/views/services';
import type { AgentTask } from '../src/agents/runner';
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
beforeEach(() => {
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
        questions: [
          q('c1', {
            type: 'mcq',
            marks: 1,
            rubric: [{ point: 'x', marks: 1 }],
            options: ['VK', 'K+KV'],
            answer: 1,
          }),
          q('c2'),
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
    reviews: { getSnapshot: () => ({ settings: readSettings({}) }) },
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
  await tick();
  await tick();
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
        findings: 'Start from pLSA.',
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
  expect(host.textContent).toContain('Start from pLSA.');
  expect(host.textContent).toContain('Dirichlet draws');
  await click(buttons('Start lesson')[0]);
  await tick();
  expect(host.textContent).toContain('Writing this step…');
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
