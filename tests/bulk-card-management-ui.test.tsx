// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TopicBrowser } from '../src/components/TopicBrowser';
import type { CardManagement } from '../src/components/BulkCardActions';
import { buildDecks } from '../src/decks/deck-index';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { transferFixture } from './transfer-fixture';
import { CardWriter } from '../src/cards/card-writer';
import type { VaultIndexer } from '../src/cards/indexer';

let host: HTMLDivElement, root: Root;
afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
    host.remove();
  }
});
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (entry) => entry.textContent === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
};
const check = async (label: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input, label).toBeTruthy();
  await act(async () => {
    input.click();
  });
};
const input = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
async function render(count = 3) {
  const f = transferFixture();
  Object.assign(f.app.vault, {
    process: async (file: { path: string }, transform: (text: string) => string) => {
      f.texts[file.path] = transform(f.texts[file.path]!);
    },
  });
  const cards = Array.from({ length: count }, (_, i) =>
    serializeCard(
      `card-${i}`,
      `Question ${i}?`,
      i === 0 ? 'Only this answer says mitochondria.' : 'Different answer.',
    ),
  ).join('\n');
  await f.refresh(await f.create('a.md', '---\nqard-deck: Biology\n---\n# Cells\n' + cards));
  const writer = new CardWriter(f.app, f.index as VaultIndexer);
  const update = vi.fn<CardManagement['update']>(async (selected, action) => {
    await writer.validateSelection(selected);
    const ready = await writer.ensureStable(selected);
    await f.reviews.updateCards(
      ready.map((card) => card.id),
      action,
    );
  });
  const move = vi.fn<CardManagement['move']>(async (selected, destination) => {
    await writer.move(selected, destination);
  });
  function Harness() {
    const snapshot = useSyncExternalStore(f.index.subscribe, f.index.getSnapshot);
    const reviews = useSyncExternalStore(f.reviews.subscribe, f.reviews.getSnapshot);
    const [deck, setDeck] = useState('Biology');
    const management: CardManagement = {
      decks: snapshot.decks,
      update,
      move: async (selected, destination) => {
        await move(selected, destination);
        setDeck(destination.deck.trim());
      },
    };
    const current = snapshot.decks.find((entry) => entry.name === deck);
    return current ? (
      <TopicBrowser
        key={deck}
        deck={current}
        states={reviews.states}
        select={() => {}}
        create={() => {}}
        study={() => {}}
        management={management}
      />
    ) : (
      <p>No cards</p>
    );
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  return { ...f, writer, update, move };
}
it('keeps actions hidden until selection, searches answers, and selects only matching cards', async () => {
  const f = await render();
  expect(host.querySelector('.qard-bulk-actions')).toBeNull();
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
  await click('Select cards');
  expect(host.querySelector('.qard-bulk-actions')).toBeNull();
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'mitochondria');
  expect(host.querySelectorAll('.qard-question-row')).toHaveLength(1);
  await click('Select matching cards');
  expect(host.querySelector('.qard-bulk-actions')?.textContent).toContain('1 selected');
  await click('Pause');
  expect(f.update.mock.calls[0]![0].map((card: { id: string }) => card.id)).toEqual(['card-0']);
  expect(f.reviews.getSnapshot().states['card-0']?.paused).toBe(true);
  expect(f.reviews.getSnapshot().states['card-1']).toBeUndefined();
  expect(host.textContent).toContain('Paused 1 card.');
  expect(host.querySelector('.qard-bulk-actions')).toBeNull();
  expect(host.querySelector('.qard-question-row')?.textContent).toContain('Paused');
});
it('selects a whole topic beyond pagination and can resume or flag the selection', async () => {
  const f = await render(65);
  await click('Select cards');
  await check('Select topic Cells');
  expect(host.querySelector('.qard-bulk-actions')?.textContent).toContain('65 selected');
  await click('Needs fixing');
  expect(Object.values(f.reviews.getSnapshot().states).every((state) => state.needsFixing)).toBe(
    true,
  );
  expect(f.update.mock.calls[0]![0]).toHaveLength(65);
  await check('Select topic Cells');
  await click('Resume');
  expect(f.update.mock.calls[1]![1]).toBe('resume');
  expect(
    Object.values(f.reviews.getSnapshot().states).every(
      (state) => state.needsFixing && !state.paused,
    ),
  ).toBe(true);
  await click('Done selecting');
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
});
it('moves selected cards to a new deck/topic while preserving unselected cards', async () => {
  const f = await render();
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'mitochondria');
  await click('Select cards');
  await check('Select card Question 0?');
  await click('Move…');
  const fields = host.querySelectorAll<HTMLInputElement>('.qard-bulk-move input');
  await input(fields[0]!, 'Exam revision');
  await input(fields[1]!, 'Organelles');
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(host.querySelector('h1')?.textContent).toBe('Exam revision');
  expect(f.index.getSnapshot().cards.find((card) => card.id === 'card-0')).toMatchObject({
    deck: 'Exam revision',
    topic: 'Organelles',
  });
  expect(f.index.getSnapshot().cards.filter((card) => card.deck === 'Biology')).toHaveLength(2);
  expect(f.move).toHaveBeenCalledOnce();
});
it('reports a failed action, preserves selection for retry, and locks controls during a save', async () => {
  const f = await render();
  await click('Select cards');
  await check('Select topic Cells');
  let reject!: (error: Error) => void;
  f.persist.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await click('Pause');
  expect(host.querySelector<HTMLButtonElement>('.qard-bulk-actions button')?.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.disabled).toBe(true);
  await act(async () => {
    reject(new Error('Could not save'));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Could not save');
  expect(host.querySelector('.qard-bulk-actions')?.textContent).toContain('3 selected');
  expect(f.reviews.getSnapshot().states).toEqual({});
  await click('Pause');
  expect(Object.values(f.reviews.getSnapshot().states).every((state) => state.paused)).toBe(true);
  expect(f.update).toHaveBeenCalledTimes(2);
});
it('excludes duplicate IDs from topic and whole-deck selection', async () => {
  const cards = parseCards(
    serializeCard('a', 'Q?', 'A') + serializeCard('b', 'R?', 'B'),
    'a.md',
  ).cards;
  cards[0]!.duplicateId = true;
  const deck = buildDecks(cards)[0]!,
    update = vi.fn<CardManagement['update']>(async () => {});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <TopicBrowser
        deck={deck}
        create={() => {}}
        study={() => {}}
        select={() => {}}
        management={{ decks: [deck], move: vi.fn(), update }}
      />,
    ),
  );
  await click('Select cards');
  await check('Select topic General');
  expect(host.querySelector('.qard-bulk-actions')?.textContent).toContain('1 selected');
  await click('Pause');
  expect(update.mock.calls[0]![0]).toEqual([cards[1]]);
});
