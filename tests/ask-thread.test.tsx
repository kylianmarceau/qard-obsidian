// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { AskThread, type AskItem } from '../src/components/common/AskThread';
import { readSettings } from '../src/settings/settings';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement, root: Root, services: QardServices, create: ReturnType<typeof vi.fn>;
const snapshot = { settings: readSettings({}) };
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  create = vi.fn(async () => ({ id: 'card-1' }));
  services = { host, owner: new Component(), app: { workspace: { openLinkText: vi.fn() } }, writer: { create }, reviews: { subscribe: () => () => {}, getSnapshot: () => snapshot } } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await new Promise(r => setTimeout(r, 0)); }); };
const buttons = (text: string) => [...host.querySelectorAll('button')].filter(b => b.textContent?.includes(text));
const type = async (value: string) => { await act(async () => { const t = host.querySelector('.qard-ask-input textarea') as HTMLTextAreaElement; t.value = value; t.dispatchEvent(new Event('input', { bubbles: true })); }); };
const key = async (init: KeyboardEventInit) => { await act(async () => { host.querySelector('.qard-ask-input textarea')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); }); };

it('folds older answers, shows a question as soon as it is sent, and handles failures', async () => {
  let items: AskItem[] = [{ q: 'Why Dirichlet?', a: 'It produces **proportions** that sum to 1.' }, { q: 'Same α for every topic?', a: 'No, but symmetric α is the default.' }];
  let busy = false, error: string | undefined;
  const ask = vi.fn(), dismiss = vi.fn(), onCard = vi.fn();
  const render = () => act(async () => { root.render(<AskThread services={services} path="Notes/T.md" items={items} busy={busy} error={error} role="tutor" placeholder="Ask anything" ask={ask} dismiss={dismiss} card={{ deck: 'DS346', topic: 'LDA' }} onCard={onCard}/>); });
  await render();
  expect(host.querySelector('.qard-ask-head')?.textContent).toContain('Questions · 2');
  expect([...host.querySelectorAll('.qard-ask-item.is-folded strong')].map(e => e.textContent)).toEqual(['Why Dirichlet?']);
  expect(host.querySelector('.qard-ask-item.is-folded .qard-muted')?.textContent).toBe('It produces proportions that sum to 1.');
  expect(host.querySelector('.qard-ask-item.is-open .qard-agent')?.textContent).toBe('Tutor · Claude Code · haiku');
  await click(host.querySelector('.qard-ask-item.is-folded'));
  expect(host.querySelectorAll('.qard-ask-item.is-open')).toHaveLength(2);
  await click(buttons('Collapse all')[0]);
  expect(host.querySelectorAll('.qard-ask-item.is-folded')).toHaveLength(2);

  // Shift+Enter is a new line; Enter sends, and the question shows straight away while the tutor thinks.
  await type('What does small α do?');
  await key({ key: 'Enter', shiftKey: true });
  expect(ask).not.toHaveBeenCalled();
  await key({ key: 'Enter' });
  expect(ask).toHaveBeenCalledWith('What does small α do?');
  busy = true; await render();
  expect([...host.querySelectorAll('.qard-ask-q')].at(-1)?.textContent).toBe('What does small α do?');
  expect(host.textContent).toContain('Thinking…');

  // A failure stays on the question's row; Try again asks the same question.
  busy = false; error = 'Rate limited.'; await render();
  expect(host.querySelector('.qard-ask-a .qard-error')?.textContent).toContain('Rate limited.');
  await click(buttons('Try again')[0]);
  expect(dismiss).toHaveBeenCalled();
  expect(ask).toHaveBeenLastCalledWith('What does small α do?');

  // The answer arrives: it is the one open exchange, and the rest are folded.
  error = undefined; items = [...items, { q: 'What does small α do?', a: 'Pushes draws toward a corner.' }]; await render(); await tick();
  expect(host.textContent).not.toContain('Thinking…');
  expect(host.querySelectorAll('.qard-ask-item.is-open')).toHaveLength(1);
  expect(host.querySelectorAll('.qard-ask-item.is-folded')).toHaveLength(2);

  // Make card: question on the front, answer on the back, linked by the caller.
  await click(buttons('Make card')[0]);
  expect((host.querySelector('textarea[aria-label="Card question"]') as HTMLTextAreaElement).value).toBe('What does small α do?');
  await click(buttons('Add card')[0]);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ deck: 'DS346', topic: 'LDA', front: 'What does small α do?', back: 'Pushes draws toward a corner.' }));
  expect(onCard).toHaveBeenCalledWith('card-1');
  expect(host.textContent).toContain('Card added');
});
