// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { marked } from 'marked';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component, MarkdownRenderer } from 'obsidian';
import { AnswerInput, MarkedAnswer, answered } from '../src/components/common/QuestionAnswer';
import type { AnswerState, Question } from '../src/tests/test-types';
import { ReviewAnswers } from '../src/components/tests/ReviewAnswers';
import { DeleteTest } from '../src/components/tests/DeleteTest';
import { TakeTest } from '../src/components/tests/TakeTest';
import { TestService } from '../src/tests/test-service';
import type { AgentRunner } from '../src/agents/runner';
import { marksSchema } from '../src/tests/test-schema';
import { type TestStorage } from '../src/tests/test-contracts';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { DEFAULT_TEST_SETTINGS } from '../src/settings/settings';
import type { QardServices } from '../src/views/services';
import type { TestNav } from '../src/views/navigation';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEST = {
  version: 1,
  createdAt: 1,
  title: 'HMM inference',
  sections: [
    {
      id: 's1',
      title: 'Inference',
      questions: [
        {
          id: 'q1',
          type: 'long',
          prompt: 'Viterbi vs Forward?',
          marks: 2,
          rubric: [
            { point: 'DP over trellis', marks: 1 },
            { point: 'Max not sum', marks: 1 },
          ],
          model: 'Viterbi maximises.',
          source: { path: 'Notes/HMM.md' },
        },
        {
          id: 'q2',
          type: 'mcq',
          prompt: 'Most likely path?',
          marks: 1,
          options: ['Forward', 'Viterbi'],
          answer: 1,
          rubric: [{ point: 'Viterbi', marks: 1 }],
          model: 'Viterbi.',
        },
      ],
    },
  ],
};
const ATTEMPT = {
  version: 1,
  startedAt: 1,
  finishedAt: 2,
  sections: { s1: { status: 'marked' } },
  review: {},
  answers: {
    q1: { text: 'Both use dynamic programming. Viterbi sums over states.', confidence: 'sure' },
    q2: { choice: 1 },
  },
  marks: {
    q1: {
      score: 1,
      awarded: [true, false],
      mistake: 'misconception',
      feedback: 'Close.',
      annotations: [
        { quote: 'dynamic programming', kind: 'correct', note: 'Right.' },
        { quote: 'sums over states', kind: 'wrong', note: 'Viterbi takes the max.' },
      ],
    },
    q2: { score: 1, awarded: [true], mistake: 'none', feedback: 'Correct.', annotations: [] },
  },
};
let host: HTMLElement, root: Root, services: QardServices, files: Record<string, string>;
let run: AgentRunner['run'];
const nav = {
  library: vi.fn(),
  tests: vi.fn(),
  newTest: vi.fn(),
  plan: vi.fn(),
  take: vi.fn(),
  results: vi.fn(),
  review: vi.fn(),
  cards: vi.fn(),
} satisfies TestNav;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  files = {
    'Qard/Tests/t/test.json': JSON.stringify(TEST),
    'Qard/Tests/t/attempt.json': JSON.stringify(ATTEMPT),
  };
  const storage: TestStorage = {
    trash: async (folder) => {
      for (const p of Object.keys(files)) if (p.startsWith(folder + '/')) delete files[p];
    },
    folders: async () => ['Qard/Tests/t'],
    read: async (p) => files[p] ?? null,
    write: async (p, t) => {
      files[p] = t;
    },
    exists: (p) => p in files,
  };
  run = vi.fn(async () => {
    throw new Error('offline');
  });
  const reviews = new ReviewStore(async () => {});
  services = {
    host,
    owner: new Component(),
    reviews,
    index: new CardIndex(),
    isActive: () => true,
    setFocus: vi.fn(),
    openSource: vi.fn(),
    tests: new TestService(
      storage,
      () => ({ ...DEFAULT_TEST_SETTINGS, ...reviews.getSnapshot().settings.tests }),
      () => ({ name: 'x', run: (task) => run(task) }),
    ),
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
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = (text: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes(text));

it('reviews a marked answer: underlines, linked notes, mark scheme and panels', async () => {
  await act(async () => {
    root.render(<ReviewAnswers services={services} nav={nav} folder="Qard/Tests/t" />);
  });
  await tick();
  await tick();
  expect(host.querySelector('.qard-seg-correct')?.textContent).toBe('dynamic programming');
  expect(host.querySelector('.qard-seg-wrong')?.textContent).toBe('sums over states');
  expect(host.querySelector('.qard-review-tag')?.textContent).toBe('Misconception · you were sure');
  expect([...host.querySelectorAll('.qard-rubric-row')].map((r) => r.textContent)).toEqual([
    '✓DP over trellis1/1',
    '✕Max not sum0/1',
  ]);
  // Only questions that lost marks are listed by default.
  expect(host.querySelectorAll('.qard-rail-item')).toHaveLength(1);
  await click(host.querySelector('.qard-pin-wrong'));
  expect(host.querySelector('.qard-note.is-selected')?.textContent).toContain(
    'Viterbi takes the max.',
  );
  expect(host.querySelector('.qard-seg-wrong')?.classList.contains('is-selected')).toBe(true);
  await click(buttons('Try again')[0]);
  expect(host.querySelector('textarea[aria-label="Second attempt"]')).not.toBeNull();
  await click(buttons('Model answer')[0]);
  expect(host.textContent).toContain('Viterbi maximises.');
  await click(host.querySelector('.qard-rail-toggle'));
  expect(host.querySelectorAll('.qard-rail-item')).toHaveLength(2);
});

it('takes a test: answers autosave and a section can be submitted', async () => {
  files['Qard/Tests/t/attempt.json'] = JSON.stringify({
    version: 1,
    startedAt: 1,
    sections: { s1: { status: 'open' } },
    answers: {},
    marks: {},
    review: {},
  });
  await act(async () => {
    root.render(<TakeTest services={services} nav={nav} folder="Qard/Tests/t" />);
  });
  await tick();
  await tick();
  await click(buttons('Viterbi').find((b) => b.getAttribute('role') === 'radio'));
  await click(buttons('Sure')[0]);
  expect(services.tests.get('Qard/Tests/t')?.attempt?.answers).toMatchObject({
    q2: { choice: 1 },
    q1: { confidence: 'sure' },
  });
  await click(buttons('Finish test')[0]);
  expect(nav.results).toHaveBeenCalledWith('Qard/Tests/t');
  await act(async () => {
    await services.tests.flush();
  });
  expect(JSON.parse(files['Qard/Tests/t/attempt.json']!).marks.q2.score).toBe(1);
});

it('deletes a selected test with one click and returns to the test list', async () => {
  await services.tests.load('Qard/Tests/t');
  const deleted = vi.fn();
  await act(async () =>
    root.render(<DeleteTest services={services} folder="Qard/Tests/t" deleted={deleted} />),
  );
  expect(host.querySelector('[aria-label="Delete test"]')).not.toBeNull();
  await click(host.querySelector('[aria-label="Delete test"]'));
  expect(deleted).toHaveBeenCalledOnce();
  expect(services.tests.get('Qard/Tests/t')).toBeUndefined();
  expect(Object.keys(files).some((p) => p.startsWith('Qard/Tests/t/'))).toBe(false);
});
it('shows a deletion error and leaves the user on the selected test so they can retry', async () => {
  const remove = vi
    .spyOn(services.tests, 'remove')
    .mockRejectedValueOnce(new Error('Could not move test to trash'));
  const deleted = vi.fn();
  await act(async () =>
    root.render(<DeleteTest services={services} folder="Qard/Tests/t" deleted={deleted} />),
  );
  await click(host.querySelector('[aria-label="Delete test"]'));
  expect(deleted).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not move test to trash',
  );
  expect((host.querySelector('[aria-label="Delete test"]') as HTMLButtonElement).disabled).toBe(
    false,
  );
  remove.mockResolvedValueOnce(undefined);
  await click(host.querySelector('[aria-label="Delete test"]'));
  expect(deleted).toHaveBeenCalledOnce();
});

const cloze: Question = {
  id: 'gaps',
  type: 'cloze',
  goal: 'recall',
  prompt:
    'The **algorithm** uses {{method}} and chooses {{operation}}. [[HMM#Paths|Read the source]]',
  blanks: [{ id: 'method' }, { id: 'operation' }],
  marks: 2,
  rubric: [
    { point: 'method', marks: 1 },
    { point: 'operation', marks: 1 },
  ],
  model: 'Dynamic programming; max.',
};

it('fills inline gaps within Markdown, requires every blank, and preserves exam marks', async () => {
  const renderer = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, text, el) => {
      el.innerHTML = text
        .replace('**algorithm**', '<strong>algorithm</strong>')
        .replace(
          '[[HMM#Paths|Read the source]]',
          '<a class="internal-link" data-href="HMM#Paths">Read the source</a>',
        );
    });
  let answer: AnswerState = {};
  const render = () =>
    root.render(
      <AnswerInput
        services={services}
        question={cloze}
        answer={answer}
        locked={false}
        path="Notes/HMM.md"
        label="Question 1"
        onChange={(patch) => {
          answer = { ...answer, ...patch };
          render();
        }}
      />,
    );
  try {
    await act(async () => render());
    await tick();
    expect(host.textContent).toContain('2 marks');
    expect(host.textContent).toContain('Fill in the blanks');
    expect(host.querySelector('.qard-q-prompt strong')?.textContent).toBe('algorithm');
    await click(host.querySelector('a.internal-link'));
    expect(services.app.workspace.openLinkText).toHaveBeenCalledWith(
      'HMM#Paths',
      'Notes/HMM.md',
      false,
    );
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).not.toContain('Dynamic programming; max.');
    const fill = async (label: string, value: string) =>
      act(async () => {
        const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await fill('Question 1: blank 1', 'DP');
    expect(answer.blanks).toEqual({ method: 'DP' });
    expect(answered(cloze, answer)).toBe(false);
    await fill('Question 1: blank 2', 'sum');
    expect(answer.blanks).toEqual({ method: 'DP', operation: 'sum' });
    expect(answered(cloze, answer)).toBe(true);
    await click(buttons("I don't know")[0]);
    expect([...host.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
    await click(buttons("I don't know")[0]);
    await act(async () =>
      root.render(
        <AnswerInput
          services={services}
          question={cloze}
          answer={answer}
          locked
          path="Notes/HMM.md"
          label="Question 1"
          onChange={() => {}}
        />,
      ),
    );
    expect([...host.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
    await act(async () =>
      root.render(
        <MarkedAnswer
          services={services}
          question={cloze}
          answer={answer}
          mark={{
            score: 1,
            awarded: [true, false],
            annotations: [],
            mistake: 'incomplete',
            feedback: 'Recall the operation.',
          }}
          path="Notes/HMM.md"
        />,
      ),
    );
    await tick();
    expect(host.textContent).toContain('DP — Correct');
    expect(host.textContent).toContain('sum — Incorrect');
    expect(host.querySelectorAll('.qard-rubric-row')).toHaveLength(2);
  } finally {
    renderer.mockRestore();
  }
});

it('takes a cloze practice test with saved gaps, unknown controls and section locking', async () => {
  run = vi.fn(async (task) =>
    task.schema === marksSchema
      ? {
          questions: [
            {
              id: 'gaps',
              score: 99,
              awarded: [true, false],
              annotations: [],
              mistake: 'incomplete',
              feedback: 'Recall the operation.',
            },
          ],
        }
      : { fixes: [], cards: [], profile: '' },
  );
  files['Qard/Tests/t/test.json'] = JSON.stringify({
    ...TEST,
    sections: [{ id: 's1', title: 'Recall', questions: [cloze] }],
  });
  files['Qard/Tests/t/attempt.json'] = JSON.stringify({
    ...ATTEMPT,
    finishedAt: undefined,
    sections: { s1: { status: 'open' } },
    answers: {},
    marks: {},
    review: {},
  });
  await act(async () =>
    root.render(<TakeTest services={services} nav={nav} folder="Qard/Tests/t" />),
  );
  await tick();
  await tick();
  expect(host.textContent).toContain('Fill in the blanks');
  expect(host.querySelector('textarea')).toBeNull();
  const inputs = () => [...host.querySelectorAll<HTMLInputElement>('.qard-cloze-input')];
  expect(inputs()).toHaveLength(2);
  await act(async () => {
    inputs()[0]!.value = 'DP';
    inputs()[0]!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(buttons('Sure')[0]);
  await click(host.querySelector('[aria-label="Flag question 1"]'));
  expect(services.tests.get('Qard/Tests/t')?.attempt?.answers.gaps).toMatchObject({
    blanks: { method: 'DP' },
    confidence: 'sure',
    flagged: true,
  });
  await click(buttons("I don't know")[0]);
  expect(inputs().every((input) => input.disabled)).toBe(true);
  await click(buttons("I don't know")[0]);
  expect(inputs().every((input) => !input.disabled)).toBe(true);
  // Practice tests retain their existing ability to finish with partial answers.
  await click(buttons('Finish test')[0]);
  await act(async () => {
    await services.tests.flush();
  });
  await tick();
  const attempt = JSON.parse(files['Qard/Tests/t/attempt.json']!);
  expect(attempt.answers.gaps.blanks).toEqual({ method: 'DP' });
  expect(attempt.marks.gaps).toMatchObject({ score: 1, awarded: [true, false] });
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ schema: marksSchema }));
  expect(inputs().every((input) => input.disabled)).toBe(true);
});

it('reviews cloze using saved slot grades, filled references and no text retry', async () => {
  files['Qard/Tests/t/test.json'] = JSON.stringify({
    ...TEST,
    sections: [{ id: 's1', title: 'Recall', questions: [cloze] }],
  });
  files['Qard/Tests/t/attempt.json'] = JSON.stringify({
    ...ATTEMPT,
    answers: { gaps: { blanks: { method: 'accepted override', operation: 'max' } } },
    marks: {
      gaps: {
        score: 1,
        awarded: [true, false],
        annotations: [],
        mistake: 'incomplete',
        feedback: 'Saved grading.',
      },
    },
    review: {},
  });
  await act(async () =>
    root.render(<ReviewAnswers services={services} nav={nav} folder="Qard/Tests/t" />),
  );
  await tick();
  await tick();
  expect(host.textContent).toContain('accepted override — Correct');
  expect(host.textContent).toContain('max — Incorrect');
  expect(host.querySelector('.qard-rail-title')?.textContent).toContain('accepted override');
  expect(host.textContent).not.toContain('{{method}}');
  expect(buttons('Try again')).toHaveLength(0);
  expect(buttons('Dispute')).toHaveLength(1);
  expect(buttons('Ask')).toHaveLength(1);
  expect(host.querySelectorAll('.qard-rubric-row')).toHaveLength(2);
  await click(buttons('Dispute')[0]);
  expect(
    host.querySelector('textarea[aria-label="Why should this get more marks?"]'),
  ).not.toBeNull();
  await click(buttons('Model answer')[0]);
  await click(buttons('Compare with mine')[0]);
  expect(host.querySelector('.qard-compare .qard-plain')?.textContent).toContain(
    'uses accepted override and chooses max',
  );
  expect(host.querySelector('textarea[aria-label="Second attempt"]')).toBeNull();
});

it('supports prototype-named blank IDs without inherited answers or completion crashes', async () => {
  const question: Question = {
    ...cloze,
    prompt: 'A {{constructor}} creates an {{__proto__}}.',
    blanks: [{ id: 'constructor' }, { id: '__proto__' }],
  };
  let answer: AnswerState = {};
  const render = () =>
    root.render(
      <AnswerInput
        services={services}
        question={question}
        answer={answer}
        locked={false}
        path="Notes/HMM.md"
        label="Question 1"
        onChange={(patch) => {
          answer = { ...answer, ...patch };
          render();
        }}
      />,
    );
  await act(async () => render());
  await tick();
  const inputs = () => [...host.querySelectorAll<HTMLInputElement>('.qard-cloze-input')];
  expect(inputs().map((input) => input.value)).toEqual(['', '']);
  await act(async () => {
    inputs()[1]!.value = 'object';
    inputs()[1]!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(answered(question, answer)).toBe(false);
  expect(inputs()[0]!.value).toBe('');
  await act(async () => {
    inputs()[0]!.value = 'constructor';
    inputs()[0]!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(answered(question, answer)).toBe(true);
  expect(Object.entries(answer.blanks!)).toEqual([
    ['__proto__', 'object'],
    ['constructor', 'constructor'],
  ]);
});

it('keeps Markdown-sensitive blank IDs editable with the real Markdown parser', async () => {
  const renderer = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, text, el) => {
      el.innerHTML = await marked.parse(text);
    });
  const question: Question = {
    ...cloze,
    prompt: '**Recall** {{_term_}}, {{__term__}}, and {{__proto__}}. QARDCLOZESLOT0END',
    blanks: ['_term_', '__term__', '__proto__'].map((id) => ({ id })),
  };
  let answer: AnswerState = {};
  const render = () =>
    root.render(
      <AnswerInput
        services={services}
        question={{ ...question, blanks: question.blanks?.map((blank) => ({ ...blank })) }}
        answer={answer}
        locked={false}
        path="Notes/HMM.md"
        label="Question 1"
        onChange={(patch) => {
          answer = { ...answer, ...patch };
          render();
        }}
      />,
    );
  try {
    await act(async () => render());
    await tick();
    expect(host.querySelector('.qard-q-prompt strong')?.textContent).toBe('Recall');
    const inputs = [...host.querySelectorAll<HTMLInputElement>('.qard-cloze-input')];
    expect(inputs).toHaveLength(3);
    expect(host.textContent).toContain('QARDCLOZESLOT0END');
    for (const input of inputs) {
      await act(async () => {
        input.value = 'tree';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(host.querySelectorAll('.qard-cloze-input')).toHaveLength(3);
    expect(Object.keys(answer.blanks!)).toEqual(['_term_', '__term__', '__proto__']);
    expect(answered(question, answer)).toBe(true);
    expect(Object.values(answer.blanks!)).toEqual(['tree', 'tree', 'tree']);
  } finally {
    renderer.mockRestore();
  }
});

it('replaces marked cloze slots when navigating between questions with different blank IDs', async () => {
  for (const id of ['first', 'second']) {
    const question: Question = {
      ...cloze,
      id,
      prompt: `The {{${id}}} is a tree.`,
      blanks: [{ id }],
    };
    await act(async () =>
      root.render(
        <MarkedAnswer
          services={services}
          question={question}
          answer={{ blanks: { [id]: id } }}
          mark={{
            score: 0,
            awarded: [false],
            annotations: [],
            mistake: 'incomplete',
            feedback: '',
          }}
          path="Notes/HMM.md"
        />,
      ),
    );
    await tick();
    expect(host.querySelector('.qard-cloze-slot')?.textContent).toBe(`${id} — Incorrect`);
    expect(host.querySelectorAll('.qard-cloze-slot')).toHaveLength(1);
  }
});

it('ignores detached cloze controls while the next question Markdown is rendering', async () => {
  const onChange = vi.fn();
  const render = (question: Question) =>
    root.render(
      <AnswerInput
        services={services}
        question={question}
        locked={false}
        path="Notes/HMM.md"
        label="Question 1"
        onChange={onChange}
      />,
    );
  await act(async () => render(cloze));
  await tick();
  const previous = host.querySelector<HTMLInputElement>('.qard-cloze-input')!;
  let finish!: () => void;
  const renderer = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
    (_app, text, el) =>
      new Promise<void>((resolve) => {
        finish = () => {
          el.textContent = text;
          resolve();
        };
      }),
  );
  try {
    await act(async () =>
      render({
        ...cloze,
        id: 'next',
        prompt: 'The {{next}} is a tree.',
        blanks: [{ id: 'next' }],
      }),
    );
    await act(async () => {
      previous.value = 'stale';
      previous.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => finish());
    await tick();
    expect(host.querySelectorAll('.qard-cloze-input')).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('.qard-cloze-input')?.value).toBe('');
  } finally {
    renderer.mockRestore();
  }
});

it('ignores a late Markdown render from a previous cloze question with the same blank IDs', async () => {
  let finish!: () => void;
  const renderer = vi.spyOn(MarkdownRenderer, 'render').mockImplementation((_app, text, el) => {
    if (text.startsWith('Previous')) {
      return new Promise<void>((resolve) => {
        finish = () => {
          el.textContent = text;
          resolve();
        };
      });
    }
    el.textContent = text;
    return Promise.resolve();
  });
  const render = (id: string) =>
    root.render(
      <AnswerInput
        services={services}
        question={{ ...cloze, id, prompt: `${id} {{method}}` }}
        answer={{ blanks: { method: id } }}
        locked={false}
        path="Notes/HMM.md"
        label={id}
        onChange={() => {}}
      />,
    );
  try {
    await act(async () => render('Previous'));
    await act(async () => render('Current'));
    await tick();
    await act(async () => finish());
    await tick();
    expect(host.textContent).toContain('Current');
    expect(host.textContent).not.toContain('Previous');
    expect(host.querySelectorAll('.qard-cloze-input')).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('.qard-cloze-input')?.value).toBe('Current');
  } finally {
    renderer.mockRestore();
  }
});
