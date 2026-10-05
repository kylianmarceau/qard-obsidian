// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExamPlanner } from '../src/components/ExamPlanner';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { localDay } from '../src/exams/exam-plan';
import type { QardServices } from '../src/views/services';
let host: HTMLElement, root: Root, services: QardServices;
const start = vi.fn(async () => {}), resume = vi.fn(async () => {}), test = vi.fn();
beforeEach(() => {
  start.mockClear(); resume.mockClear(); test.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const index = new CardIndex(); index.setLoading(false); index.update('biology.md', '<!-- qard-id: a -->\n> [!qard]- Cells\n> Answer\n');
  services = { index, reviews: new ReviewStore(async () => {}) } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(text: string) { await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click(); await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function field(selector: string, value: string) { await act(async () => { const input = host.querySelector(selector) as HTMLInputElement; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }); }
it('creates, edits, studies and deletes a persistent plan, and sends its sources to practice test creation', async () => {
  await act(async () => root.render(<ExamPlanner services={services} start={start} resume={resume} test={test} back={vi.fn()}/>));
  await click('New exam'); await field('input[placeholder="Biology final"]', 'Biology exam'); await field('input[type="date"]', localDay());
  await act(async () => { const inputs = [...host.querySelectorAll('.qard-exam-days input')] as HTMLInputElement[]; inputs.filter(i => !i.checked).forEach(i => i.click()); });
  await act(async () => (host.querySelector('.qard-select-deck input') as HTMLInputElement).click());
  await click('Save plan'); expect(host.textContent).toContain('Biology exam'); expect(host.textContent).toContain('0 / 1');
  const plan = services.reviews.getSnapshot().exams[0]!; expect(plan.selection.decks).toEqual(['biology']);
  await click("Study today's cards"); expect(start).toHaveBeenCalledWith(services.index.getSnapshot().cards, plan.id);
  await click('Create practice test'); expect(test).toHaveBeenCalledWith(expect.stringContaining('biology.md'));
  await click('Edit plan'); await field('input[type="number"]', '12'); await click('Save plan');
  expect(services.reviews.getSnapshot().exams[0]!.dailyLimit).toBe(12); expect(services.reviews.getSnapshot().exams[0]!.createdAt).toBe(plan.createdAt);
  await services.reviews.startSession(services.index.getSnapshot().cards, 'normal', plan.id);
  await act(async () => {}); await click('Resume exam session'); expect(resume).toHaveBeenCalledWith(services.reviews.getSnapshot().sessions[0]!.id);
  await click('Delete'); await click('Delete plan'); expect(services.reviews.getSnapshot().exams).toEqual([]); expect(services.reviews.getSnapshot().sessions).toHaveLength(1);
});
