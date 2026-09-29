// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { StudySessionBuilder } from '../src/components/StudySessionBuilder';
import { CardIndex } from '../src/cards/card-index';
import { ReviewStore } from '../src/review/review-store';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('selects all cards across collapsed decks and starts the complete session', async () => {
  const index = new CardIndex();
  index.update('a.md', '> [!qard]- First\n> Answer\n\n> [!qard]- Second\n> Answer');
  index.update('b.md', '> [!qard]- Third\n> Answer'); index.setLoading(false);
  const snapshot = index.getSnapshot(), start = vi.fn();
  const services = { index, reviews: new ReviewStore(async () => {}), writer: { ensureStable: vi.fn(async cards => cards) } } as unknown as QardServices;
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<StudySessionBuilder cards={snapshot.cards} decks={snapshot.decks} initial={{ decks: [], topics: [], cards: [] }} services={services} start={start} back={vi.fn()}/>));
    expect(host.querySelectorAll('.qard-select-deck[open]')).toHaveLength(0);
    const buttons = () => [...host.querySelectorAll('button')];
    await act(async () => buttons().find(b => b.textContent === 'Select all')!.click());
    expect(host.textContent).toContain('3 cards selected');
    expect((host.querySelector('[aria-label="Study mode"]') as HTMLSelectElement).value).toBe('all');
    await act(async () => buttons().find(b => b.textContent === 'Start')!.click());
    expect(start).toHaveBeenCalledWith(snapshot.cards);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
