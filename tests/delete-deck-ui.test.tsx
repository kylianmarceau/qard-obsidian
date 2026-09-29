// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeleteDeck } from '../src/components/DeleteDeck';
import { CardIndex } from '../src/cards/card-index';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('requires confirmation, supports cancellation, and keeps the confirmed card selection', async () => {
  const index = new CardIndex(); index.update('a.md', '> [!qard]- First\n> Answer');
  const deck = index.getSnapshot().decks[0]!, remove = vi.fn(async () => {});
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  const click = async (label: string) => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click());
  try {
    await act(async () => root.render(<DeleteDeck deck={deck} remove={remove}/>));
    await click('Delete deck'); expect(remove).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Remove all 1 card from 1 Markdown note');
    await click('Keep deck'); expect(remove).not.toHaveBeenCalled();
    await click('Delete deck');
    index.update('a.md', '> [!qard]- First\n> Answer\n\n> [!qard]- Later\n> Answer');
    await act(async () => root.render(<DeleteDeck deck={index.getSnapshot().decks[0]!} remove={remove}/>));
    await click('Delete deck'); expect(remove).toHaveBeenCalledExactlyOnceWith(deck.cards);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('shows write failures without reporting success', async () => {
  const index = new CardIndex(); index.update('a.md', '> [!qard]- First\n> Answer');
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<DeleteDeck deck={index.getSnapshot().decks[0]!} remove={async () => { throw new Error('Note changed'); }}/>));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Delete deck')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Note changed');
  } finally { await act(async () => root.unmount()); }
});
