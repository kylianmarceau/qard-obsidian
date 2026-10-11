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
it('shows separate review/new counts and lets users explicitly exceed the daily allowance', async () => {
  const index = new CardIndex();
  index.update(
    'a.md',
    '<!-- qard-id: a -->\n> [!qard]- First\n> Answer\n\n<!-- qard-id: b -->\n> [!qard]- Second\n> Answer',
  );
  index.setLoading(false);
  const reviews = new ReviewStore(async () => {});
  await reviews.saveSettings({
    ...reviews.getSnapshot().settings,
    newCardsPerDay: 1,
    reviewBatchSize: 1,
  });
  await reviews.review('introduced-elsewhere', 4);
  const start = vi.fn();
  const services = {
    index,
    reviews,
    writer: { ensureStable: async (cards: QardCard[]) => cards },
  } as unknown as QardServices;
  const host = document.createElement('div'),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <StudySessionBuilder
          cards={index.getSnapshot().cards}
          decks={index.getSnapshot().decks}
          initial={{ decks: [], topics: [], cards: [] }}
          services={services}
          start={start}
          back={vi.fn()}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Select all')!
        .click(),
    );
    const button = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start session',
    )!;
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain('2 new cards held for another day');
    const extra = host.querySelector<HTMLInputElement>('.qard-pacing-summary input')!;
    await act(async () => extra.click());
    expect(button.disabled).toBe(false);
    expect(host.textContent).toContain('0 reviews · 1 new card');
    await act(async () => button.click());
    expect(start).toHaveBeenCalledWith(index.getSnapshot().cards, 'normal', 'all', {
      extraNew: true,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
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
        .find((b) => b.textContent === 'Start session')!
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
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Session type"] button:last-child')!
        .click(),
    );
    expect(host.textContent).toContain('No ratings or schedule changes');
    await act(async () =>
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start session')!.click(),
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

it('keeps deck, topic and individual selection consistent while filtering out reviewed and paused cards', async () => {
  const index = new CardIndex();
  const note = (deck: string, topic: string, ids: string[]) =>
    `---\nqard-deck: ${deck}\nqard-topic: ${topic}\n---\n` +
    ids.map((id) => `<!-- qard-id: ${id} -->\n> [!qard]- Question ${id}\n> Answer\n`).join('\n');
  index.update('transport.md', note('Networks', 'Transport', ['tcp', 'paused']));
  index.update('application.md', note('Networks', 'Application', ['dns']));
  index.update('biology.md', note('Biology', 'General', ['cell']));
  index.setLoading(false);
  const reviews = new ReviewStore(async () => {});
  await reviews.setPaused('paused', true);
  await reviews.review('dns', 3);
  const start = vi.fn();
  const services = {
    index,
    reviews,
    writer: { ensureStable: vi.fn(async (cards: QardCard[]) => cards) },
  } as unknown as QardServices;
  const host = document.createElement('div'),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <StudySessionBuilder
          cards={index.getSnapshot().cards}
          decks={index.getSnapshot().decks}
          initial={{ decks: [], topics: [], cards: [] }}
          services={services}
          start={start}
          back={vi.fn()}
        />,
      ),
    );
    const networks = host.querySelector<HTMLInputElement>('[aria-label="Networks"]')!;
    await act(async () => networks.closest('details')!.querySelector('summary')!.click());
    await act(async () => networks.click());
    expect(host.querySelector('.qard-session-counts')?.textContent).toBe(
      '2 cards selected1 deck · 2 topics',
    );
    expect(networks.closest('summary')?.querySelector('.qard-selection-count')?.textContent).toBe(
      '2 / 2',
    );
    const transport = host.querySelector<HTMLInputElement>('[aria-label="Networks: Transport"]')!;
    await act(async () => transport.click());
    expect(networks.indeterminate).toBe(true);
    expect(host.querySelector('.qard-session-counts')?.textContent).toBe(
      '1 card selected1 deck · 1 topic',
    );
    await act(async () => transport.closest('details')!.querySelector('summary')!.click());
    const tcp = [...host.querySelectorAll<HTMLLabelElement>('.qard-individuals label')]
      .find((label) => label.textContent === 'Question tcp')!
      .querySelector('input')!;
    const paused = [...host.querySelectorAll<HTMLLabelElement>('.qard-individuals label')]
      .find((label) => label.textContent === 'Question pausedPaused')!
      .querySelector('input')!;
    expect(paused.disabled).toBe(true);
    expect(paused.checked).toBe(false);
    await act(async () => tcp.click());
    expect(transport.checked).toBe(true);
    expect(networks.checked).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Biology"]')!.click());
    expect(host.querySelector('.qard-session-counts')?.textContent).toBe(
      '3 cards selected2 decks · 3 topics',
    );
    const mode = host.querySelector<HTMLSelectElement>('[aria-label="Study mode"]')!;
    await act(async () => {
      mode.value = 'new';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('.qard-session-counts')?.textContent).toBe(
      '2 cards selected2 decks · 2 topics',
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.qard-session-start button')!.click(),
    );
    const expected = ['cell', 'tcp'].map((id) =>
      index.getSnapshot().cards.find((card) => card.id === id),
    );
    expect(start).toHaveBeenCalledWith(expected, 'normal', 'new');
    expect(services.writer.ensureStable).toHaveBeenCalledWith(expected);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
