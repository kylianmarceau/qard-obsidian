// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { ReviewAnswers } from '../src/components/tests/ReviewAnswers';
import { TakeTest } from '../src/components/tests/TakeTest';
import { TestService, type TestStorage } from '../src/tests/test-service';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { DEFAULT_TEST_SETTINGS } from '../src/settings/settings';
import type { QardServices } from '../src/views/services';
import type { TestNav } from '../src/components/tests/common';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEST = { version: 1, createdAt: 1, title: 'HMM inference', sections: [{ id: 's1', title: 'Inference', questions: [
  { id: 'q1', type: 'long', prompt: 'Viterbi vs Forward?', marks: 2, rubric: [{ point: 'DP over trellis', marks: 1 }, { point: 'Max not sum', marks: 1 }], model: 'Viterbi maximises.', source: { path: 'Notes/HMM.md' } },
  { id: 'q2', type: 'mcq', prompt: 'Most likely path?', marks: 1, options: ['Forward', 'Viterbi'], answer: 1, rubric: [{ point: 'Viterbi', marks: 1 }], model: 'Viterbi.' }
] }] };
const ATTEMPT = { version: 1, startedAt: 1, finishedAt: 2, sections: { s1: { status: 'marked' } }, review: {},
  answers: { q1: { text: 'Both use dynamic programming. Viterbi sums over states.', confidence: 'sure' }, q2: { choice: 1 } },
  marks: { q1: { score: 1, awarded: [true, false], mistake: 'misconception', feedback: 'Close.', annotations: [{ quote: 'dynamic programming', kind: 'correct', note: 'Right.' }, { quote: 'sums over states', kind: 'wrong', note: 'Viterbi takes the max.' }] },
    q2: { score: 1, awarded: [true], mistake: 'none', feedback: 'Correct.', annotations: [] } } };
let host: HTMLElement, root: Root, services: QardServices, files: Record<string, string>;
const nav = { library: vi.fn(), tests: vi.fn(), newTest: vi.fn(), plan: vi.fn(), take: vi.fn(), results: vi.fn(), review: vi.fn(), cards: vi.fn() } satisfies TestNav;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  files = { 'Qard/Tests/t/test.json': JSON.stringify(TEST), 'Qard/Tests/t/attempt.json': JSON.stringify(ATTEMPT) };
  const storage: TestStorage = { folders: async () => ['Qard/Tests/t'], read: async p => files[p] ?? null, write: async (p, t) => { files[p] = t; }, exists: p => p in files };
  const reviews = new ReviewStore(async () => {});
  services = { host, owner: new Component(), reviews, index: new CardIndex(), isActive: () => true, setFocus: vi.fn(), openSource: vi.fn(),
    tests: new TestService(storage, () => ({ ...DEFAULT_TEST_SETTINGS, ...reviews.getSnapshot().settings.tests }), () => ({ name: 'x', run: () => Promise.reject(new Error('offline')) })),
    app: { workspace: { on: vi.fn(), offref: vi.fn(), openLinkText: vi.fn() }, vault: { getMarkdownFiles: () => [] } } } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await new Promise(r => setTimeout(r, 0)); }); };
const buttons = (text: string) => [...host.querySelectorAll('button')].filter(b => b.textContent?.includes(text));

it('reviews a marked answer: underlines, linked notes, mark scheme and panels', async () => {
  await act(async () => { root.render(<ReviewAnswers services={services} nav={nav} folder="Qard/Tests/t"/>); }); await tick(); await tick();
  expect(host.querySelector('.qard-seg-correct')?.textContent).toBe('dynamic programming');
  expect(host.querySelector('.qard-seg-wrong')?.textContent).toBe('sums over states');
  expect(host.querySelector('.qard-review-tag')?.textContent).toBe('Misconception · you were sure');
  expect([...host.querySelectorAll('.qard-rubric-row')].map(r => r.textContent)).toEqual(['✓DP over trellis1/1', '✕Max not sum0/1']);
  // Only questions that lost marks are listed by default.
  expect(host.querySelectorAll('.qard-rail-item')).toHaveLength(1);
  await click(host.querySelector('.qard-pin-wrong'));
  expect(host.querySelector('.qard-note.is-selected')?.textContent).toContain('Viterbi takes the max.');
  expect(host.querySelector('.qard-seg-wrong')?.classList.contains('is-selected')).toBe(true);
  await click(buttons('Try again')[0]);
  expect(host.querySelector('textarea[aria-label="Second attempt"]')).not.toBeNull();
  await click(buttons('Model answer')[0]);
  expect(host.textContent).toContain('Viterbi maximises.');
  await click(host.querySelector('.qard-rail-toggle'));
  expect(host.querySelectorAll('.qard-rail-item')).toHaveLength(2);
});

it('takes a test: answers autosave and a section can be submitted', async () => {
  files['Qard/Tests/t/attempt.json'] = JSON.stringify({ version: 1, startedAt: 1, sections: { s1: { status: 'open' } }, answers: {}, marks: {}, review: {} });
  await act(async () => { root.render(<TakeTest services={services} nav={nav} folder="Qard/Tests/t"/>); }); await tick(); await tick();
  await click(buttons('Viterbi').find(b => b.getAttribute('role') === 'radio'));
  await click(buttons('Sure')[0]);
  expect(services.tests.get('Qard/Tests/t')?.attempt?.answers).toMatchObject({ q2: { choice: 1 }, q1: { confidence: 'sure' } });
  await click(buttons('Finish test')[0]);
  expect(nav.results).toHaveBeenCalledWith('Qard/Tests/t');
  await act(async () => { await services.tests.flush(); });
  expect(JSON.parse(files['Qard/Tests/t/attempt.json']!).marks.q2.score).toBe(1);
});
