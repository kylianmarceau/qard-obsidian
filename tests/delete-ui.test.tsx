// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeleteItem } from '../src/components/DeleteItem';
import { TopicBrowser } from '../src/components/TopicBrowser';
import { DeckBrowser } from '../src/components/DeckBrowser';
import { buildDecks } from '../src/decks/deck-index';
import { parseCards } from '../src/cards/parser';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const click = async (el: Element | null) =>
  act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
const deck = buildDecks(
  parseCards(
    '---\nqard-deck: Networks\n---\n# TCP\n> [!qard]- Q\n> A\n# UDP\n> [!qard]- Q2\n> A2\n',
    'a.md',
  ).cards,
)[0]!;
it('confirms deck deletion separately from navigation, including while search is active', async () => {
  const open = vi.fn(),
    remove = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <DeckBrowser
        decks={[deck]}
        search="TCP"
        onSearch={vi.fn()}
        open={open}
        create={vi.fn()}
        study={vi.fn()}
        loading={false}
        remove={remove}
      />,
    ),
  );
  await click(host.querySelector('[aria-label="Delete deck Networks"]'));
  expect(open).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('across every note');
  await click(button('Cancel'));
  expect(remove).not.toHaveBeenCalled();
  await click(host.querySelector('[aria-label="Delete deck Networks"]'));
  await click(button('Delete'));
  expect(remove).toHaveBeenCalledExactlyOnceWith('Networks');
  expect(host.querySelector('dialog')).toBeNull();
});
it('offers separate deck and topic deletes without expanding or studying a topic', async () => {
  const removeDeck = vi.fn().mockResolvedValue(undefined),
    removeTopic = vi.fn().mockResolvedValue(undefined),
    study = vi.fn();
  await act(async () =>
    root.render(
      <TopicBrowser
        deck={deck}
        select={vi.fn()}
        study={study}
        create={vi.fn()}
        removeDeck={removeDeck}
        removeTopic={removeTopic}
      />,
    ),
  );
  expect(host.querySelector('[aria-label="Delete deck Networks"]')).not.toBeNull();
  await click(host.querySelector('[aria-label="Delete topic TCP"]'));
  await click(button('Delete'));
  expect(removeTopic).toHaveBeenCalledExactlyOnceWith('TCP');
  expect(removeDeck).not.toHaveBeenCalled();
  expect(study).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-expanded="true"]')).toBeNull();
  expect(host.querySelector('[aria-label="Delete topic UDP"]')).not.toBeNull();
});
it('keeps the dialog open on errors and allows retry', async () => {
  const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('Trash unavailable'))
      .mockResolvedValue(undefined),
    deleted = vi.fn();
  await act(async () =>
    root.render(
      <DeleteItem
        label="Delete course"
        description="Course only"
        remove={remove}
        deleted={deleted}
      />,
    ),
  );
  await click(host.querySelector('[aria-label="Delete course"]'));
  await click(button('Delete'));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Trash unavailable');
  expect(deleted).not.toHaveBeenCalled();
  await click(button('Delete'));
  expect(deleted).toHaveBeenCalledOnce();
  expect(host.querySelector('dialog')).toBeNull();
});

it('filters topics, expands real cards and keeps opening a card separate from studying', async () => {
  const select = vi.fn(),
    study = vi.fn();
  await act(async () =>
    root.render(<TopicBrowser deck={deck} select={select} study={study} create={vi.fn()} />),
  );
  const search = host.querySelector<HTMLInputElement>('[type="search"]')!;
  await act(async () => {
    search.value = 'TCP';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelectorAll('.qard-topic')).toHaveLength(1);
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull();
  await click(host.querySelector('.qard-topic-heading > button'));
  expect(host.querySelector('.qard-question-list')).toBeNull();
  await click(host.querySelector('.qard-topic-heading > button'));
  const toggle = host.querySelector('[aria-expanded="true"]')!;
  expect(host.querySelector('.qard-question-list')?.id).toBe(toggle.getAttribute('aria-controls'));
  await click(host.querySelector('.qard-question-row'));
  expect(select).toHaveBeenCalledExactlyOnceWith(deck.topics[0]!.cards[0]);
  expect(study).not.toHaveBeenCalled();
  await click(host.querySelector('[aria-label="Study TCP"]'));
  expect(study).toHaveBeenCalledExactlyOnceWith('TCP');
  await act(async () => {
    search.value = 'missing';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.textContent).toContain('No matching cards.');
  await click(button('Clear search'));
  expect(host.querySelectorAll('.qard-topic')).toHaveLength(2);
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull();
});
