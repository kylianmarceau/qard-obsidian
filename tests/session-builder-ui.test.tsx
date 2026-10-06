// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { QardCard } from '../src/cards/card-types';
import { StudySessionBuilder } from '../src/components/StudySessionBuilder';
import { CardIndex } from '../src/cards/card-index';
import { ReviewStore } from '../src/review/review-store';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('selects all cards across collapsed decks and starts the complete session', async () => {
  const index = new CardIndex();
  index.update('a.md', '> [!qard]- First\n> Answer\n\n> [!qard]- Second\n> Answer');
  index.update('b.md', '> [!qard]- Third\n> Answer');
  index.setLoading(false);
  const snapshot = index.getSnapshot(),
    start = vi.fn();
  const services = {
    index,
    reviews: new ReviewStore(async () => {}),
    writer: { ensureStable: vi.fn(async (cards) => cards) },
  } as unknown as QardServices;
  const host = document.createElement('div'),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <StudySessionBuilder
          cards={snapshot.cards}
          decks={snapshot.decks}
          initial={{ decks: [], topics: [], cards: [] }}
          services={services}
          start={start}
          back={vi.fn()}
        />,
      ),
    );
    expect(host.querySelectorAll('.qard-select-deck[open]')).toHaveLength(0);
    const buttons = () => [...host.querySelectorAll('button')];
    await act(async () =>
      buttons()
        .find((b) => b.textContent === 'Select all')!
        .click(),
    );
    expect(host.textContent).toContain('3 cards selected');
    expect((host.querySelector('[aria-label="Study mode"]') as HTMLSelectElement).value).toBe(
      'all',
    );
    await act(async () =>
      buttons()
        .find((b) => b.textContent === 'Start')!
        .click(),
    );
    expect(start).toHaveBeenCalledWith(snapshot.cards);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('assigns stable IDs for resumable cram without recording ratings', async () => {
  const index = new CardIndex();
  index.update('a.md', '> [!qard]- First\n> Answer');
  index.setLoading(false);
  const snapshot = index.getSnapshot(),
    start = vi.fn(),
    writer = {
      ensureStable: vi.fn(async (cards: QardCard[]) =>
        cards.map((c) => ({ ...c, id: 'stable-cram', stable: true })),
      ),
    };
  const services = {
    index,
    reviews: new ReviewStore(async () => {}),
    writer,
  } as unknown as QardServices;
  const host = document.createElement('div'),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <StudySessionBuilder
          cards={snapshot.cards}
          decks={snapshot.decks}
          initial={{ decks: ['a'], topics: [], cards: [] }}
          services={services}
          start={start}
          back={vi.fn()}
        />,
      ),
    );
    const type = host.querySelector('[aria-label="Session type"]') as HTMLSelectElement;
    await act(async () => {
      type.value = 'cram';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('No ratings or schedule changes');
    await act(async () =>
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start')!.click(),
    );
    expect(start).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'stable-cram', stable: true })],
      'cram',
    );
    expect(writer.ensureStable).toHaveBeenCalledWith(snapshot.cards);
    expect(services.reviews.getSnapshot().history).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
