// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExamPlanner } from '../src/components/ExamPlanner';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { localDay, type ExamPlan } from '../src/exams/exam-plan';
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
  await click('Continue');
  await act(async () => (host.querySelector('input[aria-label="Include biology"]') as HTMLInputElement).click());
  await click('Continue');
  await act(async () => { const inputs = [...host.querySelectorAll('.qard-exam-days input')] as HTMLInputElement[]; inputs.filter(i => !i.checked).forEach(i => i.click()); });
  await click('Save plan'); expect(host.textContent).toContain('Biology exam'); expect(host.textContent).toContain('0 / 1');
  const plan = services.reviews.getSnapshot().exams[0]!; expect(plan.selection.decks).toEqual(['biology']);
  await click("Study today's cards"); expect(start).toHaveBeenCalledWith(services.index.getSnapshot().cards, plan.id);
  await click('Create practice test'); expect(test).toHaveBeenCalledWith(expect.stringContaining('biology.md'));
  await click('Plan details'); await click('Edit plan'); await click('Continue'); await click('Continue'); await field('input[type="number"]', '12'); await click('Save plan');
  expect(services.reviews.getSnapshot().exams[0]!.dailyLimit).toBe(12); expect(services.reviews.getSnapshot().exams[0]!.createdAt).toBe(plan.createdAt);
  await services.reviews.startSession(services.index.getSnapshot().cards, 'normal', plan.id);
  await act(async () => {}); await click('Resume exam session'); expect(resume).toHaveBeenCalledWith(services.reviews.getSnapshot().sessions[0]!.id);
  await click('Delete'); await click('Delete plan'); expect(services.reviews.getSnapshot().exams).toEqual([]); expect(services.reviews.getSnapshot().sessions).toHaveLength(1);
});

it('validates each setup step and preserves choices when going back without saving on cancel', async () => {
  await act(async () => root.render(<ExamPlanner services={services} start={start} resume={resume} test={test} back={vi.fn()}/>));
  await click('New exam'); await click('Continue'); expect(host.textContent).toContain('Enter an exam name.');
  await field('input[placeholder="Biology final"]', 'Biology exam'); await click('Continue');
  expect(host.textContent).toContain('Choose an exam date today or later.');
  await field('input[type="date"]', localDay()); await click('Continue'); await click('Continue');
  expect(host.textContent).toContain('Choose at least one deck or topic.');
  await act(async () => (host.querySelector('.qard-exam-topics input') as HTMLInputElement).click());
  await click('Continue'); await click('Back');
  expect((host.querySelector('.qard-exam-topics input') as HTMLInputElement).checked).toBe(true);
  await click('Continue'); await field('input[type="number"]', '0'); await click('Save plan');
  expect(host.textContent).toContain('Enter a daily target from 1 to 1,000 reviews.');
  await field('input[type="number"]', '12');
  await act(async () => { [...host.querySelectorAll('.qard-exam-days input')].forEach(input => { if ((input as HTMLInputElement).checked) (input as HTMLInputElement).click(); }); });
  await click('Save plan'); expect(host.textContent).toContain('Choose at least one study day.');
  expect(services.reviews.getSnapshot().exams).toEqual([]);
  await click('Cancel'); expect(services.reviews.getSnapshot().exams).toEqual([]);
});
it('opens the upcoming exam month, shows multiple exams and revision, and navigates across months with the keyboard', async () => {
  const today = localDay(), first = new Date(`${today}T12:00:00`); first.setMonth(first.getMonth() + 1, 1);
  const date = localDay(first), month = date.slice(0, 7);
  const plan: ExamPlan = { id: 'biology', name: 'Biology final', date, selection: { decks: ['biology'], topics: [], cards: [] }, weekdays: [0, 1, 2, 3, 4, 5, 6], dailyLimit: 30, createdAt: Date.now() };
  await services.reviews.saveExam(plan); await services.reviews.saveExam({ ...plan, id: 'second', name: 'Second exam' });
  await act(async () => root.render(<ExamPlanner services={services} start={start} resume={resume} test={test} back={vi.fn()}/>));
  await click('Calendar');
  const selected = () => host.querySelector<HTMLButtonElement>('.qard-calendar-day[aria-pressed="true"]')!;
  expect(selected().dataset.day).toBe(date); expect(host.textContent).toContain('2 exams this month');
  const agenda = host.querySelector('.qard-calendar-agenda')!;
  expect(agenda.textContent).toContain('Biology final'); expect(agenda.textContent).toContain('Second exam'); expect(agenda.textContent).toContain('Up to 30 reviews');
  expect(selected().getAttribute('aria-label')).toContain('2 planned revision sessions');
  await act(async () => { selected().focus(); selected().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 5)); });
  first.setDate(0); expect(selected().dataset.day).toBe(localDay(first)); expect(document.activeElement).toBe(selected());
  await click('Exam month'); expect(selected().dataset.day).toBe(date);
  await click('Today'); expect(selected().dataset.day).toBe(today); expect(host.textContent).toContain('Study');
  await click('Study'); expect(start).toHaveBeenCalledWith(services.index.getSnapshot().cards, plan.id);
  await click('Exam month'); await click('View plan');
  expect(host.querySelector('.qard-calendar')).toBeNull(); expect(host.querySelector('[aria-label="Biology final"]')?.textContent).toContain('Edit plan'); expect(document.activeElement).toBe(host.querySelector('[data-exam-id="biology"]'));
  expect(services.reviews.getSnapshot().exams.map(item => item.date)).toEqual([`${month}-01`, `${month}-01`]);
});
