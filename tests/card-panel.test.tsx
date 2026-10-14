// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { CardPanelView } from '../src/views/CardPanelView';
import { forgetEditorChoices } from '../src/components/CardEditor';
import { CardIndex } from '../src/cards/card-index';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import type QardPlugin from '../src/main';

let view: CardPanelView;
afterEach(async () => {
  await act(async () => view.release());
  forgetEditorChoices();
});
async function open() {
  const create = vi.fn(
    async (draft: { deck: string; topic: string; front: string; back: string }) => {
      const card = parseCards(
        `---\nqard-deck: ${draft.deck}\n---\n# ${draft.topic}\n` +
          serializeCard(crypto.randomUUID(), draft.front, draft.back),
        'Qard/Bio.md',
      ).cards[0]!;
      return card;
    },
  );
  const plugin = {
    index: new CardIndex(),
    reviews: new ReviewStore(async () => {}),
    writer: { create, targetFor: () => ({ path: 'Qard/Bio.md', exists: true }) },
    openSource: vi.fn(),
  } as unknown as QardPlugin;
  view = new CardPanelView(new WorkspaceLeaf() as never, plugin);
  document.body.append(view.contentEl);
  await act(async () => view.onOpen());
  return { create, plugin };
}
const field = (selector: string) => view.contentEl.querySelector<HTMLInputElement>(selector)!;
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('keeps deck and topic for the next card and moves to a new topic without losing typing', async () => {
  const { create, plugin } = await open();
  await act(async () => view.prefill({ deck: 'Bio', topic: 'Cells' }));
  let [front, back] = view.contentEl.querySelectorAll('textarea');
  await type(front!, 'Q1?');
  await type(back!, 'A1');
  await act(async () => {
    view.contentEl
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ deck: 'Bio', topic: 'Cells' }));
  expect(view.contentEl.textContent).toContain('Added to Bio › Cells');
  [front] = view.contentEl.querySelectorAll('textarea');
  expect(front!.value).toBe('');
  expect(field('input[list$="-decks"]').value).toBe('Bio');
  expect(field('input[list$="-topics"]').value).toBe('Cells');
  await type(front!, 'Half-typed');
  await act(async () => view.prefill({ deck: 'Bio', topic: 'Genes', sourceFile: 'Notes/Bio.md' }));
  expect(field('input[list$="-topics"]').value).toBe('Genes');
  expect(view.contentEl.querySelector('textarea')!.value).toBe('Half-typed');
  const show = [...view.contentEl.querySelectorAll('button')].find(
    (b) => b.textContent === 'Show in note',
  )!;
  await act(async () => show.click());
  expect(plugin.openSource).toHaveBeenCalledOnce();
});
