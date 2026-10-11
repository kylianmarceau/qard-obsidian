// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { CardRepairActions } from '../src/components/CardRepairActions';
import { StudyView } from '../src/views/StudyView';
import type { QardServices } from '../src/views/services';
import type { VaultIndexer } from '../src/cards/indexer';
import { improvementFixture, improvement, splitImprovement } from './improvement-fixture';

let root: Root, host: HTMLElement, f: ReturnType<typeof improvementFixture>, services: QardServices;
beforeEach(() => {
  f = improvementFixture();
  host = document.createElement('div');
  host.className = 'qard-app';
  document.body.append(host);
  root = createRoot(host);
  services = {
    app: f.app,
    host,
    owner: new Component(),
    writer: f.writer,
    reviews: f.reviews,
    index: f.index as VaultIndexer,
    improvements: f.service,
    isActive: () => true,
    setFocus: vi.fn(),
    openSource: vi.fn(),
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  f.service.dispose();
  host.remove();
});
async function click(text: string) {
  await act(async () => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    expect(button, host.textContent ?? '').toBeDefined();
    button!.click();
  });
  await act(async () => {
    await vi.waitFor(() => expect(f.service.getSnapshot().busy).toHaveLength(0));
  });
}
async function mountRepair() {
  await f.service.load();
  await act(async () =>
    root.render(<CardRepairActions card={f.card()} services={services} edit={vi.fn()} />),
  );
  await click('More actions');
  await click('Improve this card');
}

it('opens from the existing card menu, lets the user edit and preview, and applies only on request', async () => {
  await mountRepair();
  expect(f.run).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Make clearer');
  expect(host.textContent).toContain('Shorten answer');
  expect(host.textContent).toContain('Split into smaller cards');
  await click('Make clearer');
  expect(f.process).not.toHaveBeenCalled();
  await act(async () => {
    const answer = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer 1"]')!;
    answer.value = 'Reliable delivery in the original order.';
    answer.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Preview suggestion');
  expect(host.textContent).toContain('Reliable delivery in the original order.');
  await click('Apply improvement');
  expect(f.card().backMarkdown).toBe('Reliable delivery in the original order.');
  expect(host.querySelector('.qard-improve-card')).toBeNull();
});

it('restores a prepared draft after reopening and discards it without touching the card', async () => {
  await mountRepair();
  await click('Make clearer');
  const note = f.files['Cards.md'];
  await click('Close');
  await click('More actions');
  await click('Improve this card');
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer 1"]')?.value).toBe(
    improvement.cards[0]!.back,
  );
  await click('Discard draft');
  expect(f.files['Cards.md']).toBe(note);
  expect(f.service.getSnapshot().drafts.original).toBeUndefined();
});

it('shows split consequences before saving and keeps the original card with its history', async () => {
  f.run.mockResolvedValue(splitImprovement);
  await f.reviews.review('original', 4);
  const history = f.reviews.getSnapshot().history;
  await mountRepair();
  await click('Split into smaller cards');
  expect(host.textContent).toContain('The original is paused with its history preserved');
  expect(host.querySelectorAll('textarea')).toHaveLength(4);
  await click('Add cards and pause original');
  expect(f.index.getSnapshot().cards).toHaveLength(4);
  expect(f.reviews.getSnapshot().history).toBe(history);
  expect(f.reviews.getSnapshot().states.original?.paused).toBe(true);
});

it('blocks study ratings while reviewing the suggestion and shows the edited card in the same session', async () => {
  await f.service.load();
  const cards = f.index.getSnapshot().cards;
  const session = await f.reviews.startSession(cards);
  await act(async () =>
    root.render(
      <StudyView
        cards={cards}
        services={services}
        session={session}
        exit={vi.fn()}
        repeat={vi.fn()}
      />,
    ),
  );
  await click('More actions');
  await click('Improve this card');
  await click('Make clearer');
  await act(async () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  expect(f.reviews.getSnapshot().history).toHaveLength(0);
  await click('Apply improvement');
  expect(host.textContent).toContain(improvement.cards[0]!.front);
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(f.reviews.getSnapshot().sessions[0]?.position).toBe(0);
});

it('offers Finish saving after a partial save, freezes the approved draft, and retries safely', async () => {
  await mountRepair();
  await click('Make clearer');
  f.persist.mockRejectedValueOnce(new Error('Disk full'));
  await click('Apply improvement');
  expect(host.textContent).toContain('Disk full');
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer 1"]')?.disabled).toBe(
    true,
  );
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.disabled,
  ).toBe(true);
  await click('Finish saving');
  expect(f.process).toHaveBeenCalledOnce();
  expect(host.querySelector('.qard-improve-card')).toBeNull();
});
