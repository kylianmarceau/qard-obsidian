// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { LearnService } from '../src/learn/learn-service';
import { type LearnStorage } from '../src/learn/learn-contracts';
import { newMasteryNote, parseMastery } from '../src/learn/mastery';
import { readSettings } from '../src/settings/settings';
import { marksSchema } from '../src/tests/test-schema';
import { CheckView } from '../src/components/learn/CheckView';
import { LessonView } from '../src/components/learn/LessonView';
import { CourseView } from '../src/components/learn/CourseView';
import { CourseMap } from '../src/components/learn/CourseMap';
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
  await tick();
  await tick();
  const submit = () => buttons('Submit')[0]!;
  expect(
    [...host.querySelectorAll('.qard-q-meta > span:last-child')].map((el) => el.textContent),
  ).toEqual(['1 mark', '2 marks']);
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
  await click(buttons('Start')[0]);
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
  expect(host.querySelector('.qard-suggestion-body')?.firstElementChild?.tagName).toBe('SMALL');
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
    `---\nqard-mastery: DS346\nqard-mapped: 2026-09-01T10:00\n---\n\n| Objective | Label | ID | Group | State | Due | Needs | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| Bag of words | Bag of words | bow | Text mining | mastered |  |  |\n| Parameter counts | Parameters | params | Topic models | taught | 2000-01-01 | bow | Practice check: one of two answers correct. |\n| List the LDA generative process | LDA story | lda | Topic models | misconception |  | bow, params |\n| Hadoop | Hadoop | hadoop | Big data | planned |  |  |\n`,
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
  await click(buttons('1 Mastered')[0]);
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
  expect(host.querySelector('.qard-map-layout')?.classList.contains('is-panel-open')).toBe(true);
  const canvas = host.querySelector<HTMLElement>('.qard-map-frame')!;
  const graph = canvas.querySelector<SVGGElement>('.qard-map > g')!;
  const transform = graph.style.transform;
  const panelWheel = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
  await act(async () => {
    panel.dispatchEvent(panelWheel);
  });
  expect(panelWheel.defaultPrevented).toBe(false);
  expect(graph.style.transform).toBe(transform);
  const canvasWheel = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
  await act(async () => {
    canvas.dispatchEvent(canvasWheel);
  });
  expect(canvasWheel.defaultPrevented).toBe(true);
  expect(graph.style.transform).not.toBe(transform);
  await click(buttons('Route here')[0]);
  expect([...host.querySelectorAll('.qard-map-route button')].map((b) => b.textContent)).toEqual([
    '1List the LDA generative process',
  ]);
  // A prerequisite in another topic opens that topic.
  await click(
    [...panel.querySelectorAll('.qard-map-link')].find((b) =>
      b.querySelector(':scope > span')?.textContent?.startsWith('Bag of words'),
    ),
  );
  expect(host.querySelector('.qard-map-crumb')?.textContent).toBe('Text mining');
  await click(buttons('Topics')[0]);
  expect(host.querySelectorAll('.qard-topic-node')).toHaveLength(3);
  expect(host.querySelector('.qard-map-layout')?.classList.contains('is-panel-open')).toBe(false);
  await click(buttons('List')[0]);
  expect(host.querySelectorAll('.qard-objective')).toHaveLength(4);
  const evidence = host.querySelector<HTMLButtonElement>(
    '[aria-label="Evidence for Parameter counts"]',
  )!;
  expect(evidence.title).toBe('Practice check: one of two answers correct.');
  expect(evidence.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.qard-objective-evidence-details')).toBeNull();
  await click(evidence);
  expect(evidence.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(evidence.getAttribute('aria-controls')!)?.textContent).toBe(
    'Practice check: one of two answers correct.',
  );
  await click(evidence);
  expect(evidence.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.qard-objective-evidence-details')).toBeNull();
});

it('keeps an active objective after following a cross-topic stub with an old selection', async () => {
  files.set(
    MASTERY,
    `---\nqard-mastery: DS346\n---\n\n| Objective | ID | Group | State | Needs |\n| --- | --- | --- | --- | --- |\n| Bag of words | bow | Text mining | mastered | |\n| Parameter counts | params | Topic models | taught | bow |\n`,
  );
  await act(async () => root.render(<CourseView services={services} nav={nav} path={MASTERY} />));
  await tick();
  await click(host.querySelector('.qard-topic-node[aria-label^="Topic models"]'));
  await click(host.querySelector('.qard-map-node[aria-label^="Parameter counts"]'));
  expect(host.querySelector('.qard-map-node.is-selected')).not.toBeNull();
  await click(host.querySelector('.qard-map-stub[aria-label="Builds on Text mining"]'));
  const active = host.querySelectorAll('.qard-map-node:not(.qard-map-stub)[tabindex="0"]');
  expect(active).toHaveLength(1);
  expect(active[0]!.getAttribute('aria-label')).toContain('Bag of words');
});

it('releases fullscreen inertness when a mounted map becomes empty and stays collapsed on refill', async () => {
  const course = parseMastery(MASTERY, files.get(MASTERY)!);
  const actions = { teach: vi.fn(), openNote: vi.fn() };
  const alreadyInert = document.createElement('div');
  alreadyInert.setAttribute('inert', 'existing');
  const outside = document.createElement('button');
  document.body.append(alreadyInert, outside);
  try {
    await act(async () => root.render(<CourseMap course={course} actions={actions} />));
    await click(host.querySelector('[aria-label="Full screen"]'));
    expect(host.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.qard-map-overlay')).not.toBeNull();
    await act(async () =>
      root.render(<CourseMap course={{ ...course, objectives: [] }} actions={actions} />),
    );
    expect(document.querySelector('.qard-map-overlay')).toBeNull();
    expect(host.hasAttribute('inert')).toBe(false);
    expect(alreadyInert.getAttribute('inert')).toBe('existing');
    outside.focus();
    expect(document.activeElement).toBe(outside);
    await act(async () => root.render(<CourseMap course={course} actions={actions} />));
    expect(document.querySelector('.qard-map-overlay')).toBeNull();
    expect(host.querySelector('[aria-label="Full screen"]')).not.toBeNull();
    await click(host.querySelector('[aria-label="Full screen"]'));
    expect(document.querySelector('.qard-map-overlay')).not.toBeNull();
    await click(document.querySelector('[aria-label="Exit full screen"]'));
    expect(host.hasAttribute('inert')).toBe(false);
  } finally {
    alreadyInert.remove();
    outside.remove();
  }
});

it('continues node navigation from a search result instead of the previously focused objective', async () => {
  const course = parseMastery(
    MASTERY,
    `---\nqard-mastery: DS346\n---\n\n| Objective | ID | State | Needs |\n| --- | --- | --- | --- |\n| Alpha | a | mastered | |\n| Beta | b | taught | a |\n| Gamma | c | taught | b |\n`,
  );
  await act(async () =>
    root.render(<CourseMap course={course} actions={{ teach: vi.fn(), openNote: vi.fn() }} />),
  );
  const key = async (element: Element, value: string) => {
    await act(async () => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
      );
    });
  };
  const alpha = host.querySelector<HTMLElement>('.qard-map-node[aria-label^="Alpha"]')!;
  await act(async () => alpha.focus());
  const search = host.querySelector<HTMLInputElement>('[aria-label="Find an objective"]')!;
  await act(async () => {
    search.focus();
    search.value = 'Beta';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await key(search, 'Enter');
  expect(host.querySelector('.qard-map-panel h3')?.textContent).toBe('Beta');
  await key(search, 'Escape');
  expect(document.activeElement).toBe(host.querySelector('.qard-map-frame'));
  await key(document.activeElement!, 'ArrowDown');
  expect(host.querySelector('.qard-map-panel h3')?.textContent).toBe('Gamma');
  expect(document.activeElement?.getAttribute('aria-label')).toContain('Gamma');
});

it('reveals a resumed lesson step and bottom navigation without moving the page or undoing manual strip scrolling', async () => {
  const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    if (this.matches('.qard-test-steps')) return new DOMRect(100, 0, 300, 34);
    if (this.matches('.qard-test-steps > button')) {
      const strip = this.parentElement!;
      const index = [...strip.querySelectorAll('button')].indexOf(this as HTMLButtonElement);
      return new DOMRect(100 + index * 150 - strip.scrollLeft, 0, 150, 34);
    }
    return new DOMRect();
  });
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches('.qard-test-steps') ? 300 : 0;
  });
  try {
    const path = 'Qard/Lessons/scrolling.json';
    const steps = Array.from({ length: 8 }, (_, i) => ({
      title: `Transport topic ${i + 1}`,
      explain: 'Explanation.',
      connect: 'Connection.',
      checkFirst: false,
      check: q(`step-${i}`),
      misconceptions: [],
    }));
    files.set(
      path,
      JSON.stringify({
        version: 1,
        createdAt: 1,
        topic: 'Transport',
        notes: [],
        accepted: true,
        current: 5,
        map: {
          title: 'Transport',
          plan: '',
          mermaid: '',
          steps: steps.map((s) => ({ title: s.title, why: 'Apply it.' })),
        },
        steps,
        state: steps.map(() => ({ asks: [] })),
      }),
    );
    host.scrollTop = 70;
    await act(async () => root.render(<LessonView services={services} nav={nav} path={path} />));
    await tick();
    await tick();
    const strip = host.querySelector<HTMLDivElement>('.qard-test-steps')!;
    expect(strip.querySelector('[aria-current="step"]')?.textContent).toContain(
      '6. Transport topic 6',
    );
    expect(strip.scrollLeft).toBe(600);
    expect(host.scrollTop).toBe(70);
    strip.scrollLeft = 75;
    await act(async () => root.render(<LessonView services={services} nav={nav} path={path} />));
    await tick();
    expect(strip.scrollLeft).toBe(75);
    await click(buttons('Next step')[0]);
    await tick();
    expect(strip.querySelector('[aria-current="step"]')?.textContent).toContain(
      '7. Transport topic 7',
    );
    expect(strip.scrollLeft).toBe(750);
    expect(host.scrollTop).toBe(70);
  } finally {
    bounds.mockRestore();
    width.mockRestore();
  }
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
  expect(
    [...trail.querySelectorAll('button')].slice(0, 3).map((button) => button.textContent),
  ).toEqual(['DS346', 'Topic models', 'LDA story']);
  expect(trail.querySelectorAll('.lucide-chevron-right')).toHaveLength(2);
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
  expect(host.querySelector('.qard-jobs-item strong')?.textContent).toBe('Mapping course');
  expect(host.querySelector('.qard-jobs-detail')?.textContent).toBe('DS346');
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

it('cancels a pending retry without submitting its form', async () => {
  vi.spyOn(services.learn, 'job').mockImplementation((_path, kind, id = '') =>
    kind === 'tutor' && id === '0-retry' ? { kind, id, startedAt: Date.now() } : undefined,
  );
  const cancel = vi.spyOn(services.learn, 'cancel').mockImplementation(() => {});
  const { path } = await openRecap({
    close: undefined,
    finishedAt: undefined,
    accepted: true,
    map: {
      title: 'Generic contracts',
      plan: '',
      mermaid: '',
      steps: [{ title: 'Preserve a relationship', why: 'Connect the types.' }],
    },
    steps: [
      {
        title: 'Preserve a relationship',
        explain: 'Type parameters preserve a relationship.',
        connect: '',
        checkFirst: false,
        check: {
          id: 'check',
          type: 'short',
          prompt: 'Why use a type parameter?',
          marks: 1,
          rubric: [{ point: 'Preserves the relationship.', marks: 1 }],
          model: 'It preserves a relationship.',
        },
        misconceptions: [],
      },
    ],
    state: [
      {
        asks: [],
        mark: {
          score: 0,
          awarded: [false],
          annotations: [],
          mistake: 'incomplete',
          feedback: 'Try preserving a relationship.',
        },
      },
    ],
  });
  const button = host.querySelector<HTMLButtonElement>('form button[aria-label="Cancel"]')!;
  const submit = vi.fn();
  button.form!.addEventListener('submit', submit);
  await click(button);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(path, 'tutor', '0-retry');
  expect(submit).not.toHaveBeenCalled();
});

it('opens and closes diagnostic guidance from its info disclosure without submitting answers', async () => {
  const submit = vi.spyOn(services.learn, 'submitProbe');
  await openRecap({
    close: undefined,
    finishedAt: undefined,
    probe: { questions: [], answers: {} },
    map: undefined,
  });
  const info = host.querySelector<HTMLElement>('summary.qard-diagnostic-label')!;
  const disclosure = info.closest('details')!;
  const help = disclosure.querySelector('.qard-diagnostic-help');
  expect(disclosure.open).toBe(false);
  expect(info.title).toBe(help?.textContent);
  expect(info.textContent).toContain('Diagnostic · Programming');
  await click(info);
  expect(disclosure.open).toBe(true);
  expect(help?.textContent).toContain('They do not establish mastery');
  await click(info);
  expect(disclosure.open).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
