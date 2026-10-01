// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsageView, compact } from '../src/components/usage/UsageView';
import { addToLog, usageKey } from '../src/agents/usage-report';
import { isoDay, addDays } from '../src/learn/mastery';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await new Promise(r => setTimeout(r, 0)); }); };
const buttons = (text: string) => [...host.querySelectorAll('button')].filter(b => b.textContent?.includes(text));

it('shows totals, a daily chart and breakdowns, and can clear the history', async () => {
  const today = isoDay(Date.now());
  let log = addToLog({}, today, usageKey('Writing lessons', 'writer', 'claude-code', ''), { input: 1200, output: 3400, cacheRead: 50_000, cacheWrite: 6000, costUsd: 0.25 });
  log = addToLog(log, addDays(today, -3), usageKey('Tutoring', 'tutor', 'anthropic', 'claude-haiku-4-5'), { input: 900, output: 200, cacheRead: 0, cacheWrite: 0 });
  log = addToLog(log, addDays(today, -20), usageKey('Course mapping', 'writer', 'claude-code', ''), { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
  const snapshot = { usage: log }, resetUsage = vi.fn(async () => {});
  const services = { reviews: { subscribe: () => () => {}, getSnapshot: () => snapshot, resetUsage } } as unknown as QardServices;
  await act(async () => { root.render(<UsageView services={services}/>); });
  // Seven days by default: the course mapping 20 days ago is outside.
  expect(host.querySelector('.qard-usage-total strong')?.textContent).toBe(compact(1200 + 3400 + 56_000 + 1100));
  expect(host.querySelector('.qard-usage-total')?.textContent).toContain('2 runs');
  expect(host.querySelectorAll('.qard-usage-day')).toHaveLength(7);
  expect([...host.querySelectorAll('.qard-usage-table')[0]!.querySelectorAll('tbody td:first-child')].map(td => td.textContent)).toEqual(['Writing lessons', 'Tutoring']);
  expect(host.querySelectorAll('.qard-usage-table')[1]!.textContent).toContain('Anthropic APIclaude-haiku-4-5');
  expect(host.querySelector('.qard-usage-stats')?.textContent).toContain('$0.250');
  await click(buttons('All time')[0]);
  expect(host.querySelector('.qard-usage-total')?.textContent).toContain('3 runs');
  await click(buttons('Clear usage history')[0]);
  await click(buttons('Clear')[0]);
  expect(resetUsage).toHaveBeenCalled();
  expect(compact(999)).toBe('999'); expect(compact(1234)).toBe('1.2k'); expect(compact(3_400_000)).toBe('3.4M');
});

import { AgentLabel } from '../src/components/jobs/AgentLabel';
import { readSettings } from '../src/settings/settings';
it('labels who is working, and can be turned off', async () => {
  let snapshot = { settings: readSettings({ agents: { roles: { tutor: { provider: 'claude-code', model: '' }, writer: { provider: 'openrouter', model: 'anthropic/claude-opus-5.5' }, marker: { provider: 'codex', model: '' } } } }) };
  const listeners = new Set<() => void>();
  const services = { reviews: { subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); }, getSnapshot: () => snapshot } } as unknown as QardServices;
  await act(async () => { root.render(<><AgentLabel services={services} role="tutor"/><AgentLabel services={services} role="writer"/><AgentLabel services={services} role="marker"/></>); });
  expect([...host.querySelectorAll('.qard-agent')].map(e => e.textContent)).toEqual(['Tutor · Claude Code · haiku', 'Writer · OpenRouter · anthropic/claude-opus-5.5', 'Marker · Codex · default model']);
  expect(readSettings({}).showAgent).toBe(true);
  snapshot = { settings: { ...snapshot.settings, showAgent: false } };
  await act(async () => { listeners.forEach(l => l()); });
  expect(host.querySelectorAll('.qard-agent')).toHaveLength(0);
});
