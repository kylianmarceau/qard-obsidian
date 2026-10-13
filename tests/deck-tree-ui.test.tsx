// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckBrowser } from '../src/components/DeckBrowser';
import { DeckOptions } from '../src/components/DeckOptions';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import { buildDecks } from '../src/decks/deck-index';
import { readSettings } from '../src/settings/settings';

let host: HTMLElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const card = (id: string, deck: string) =>
  parseCards(
    `---\nqard-deck: ${JSON.stringify(deck)}\n---\n\n${serializeCard(id, id, 'Answer')}`,
    `${id}.md`,
  ).cards[0]!;
const decks = buildDecks([
  card('a', 'Biology::Cells'),
  card('b', 'Biology::Genetics::DNA'),
  card('c', 'Biology'),
  card('d', 'Chemistry'),
]);
const names = () =>
  Array.from(host.querySelectorAll('.qard-deck-name strong')).map((el) => el.textContent);
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

function library(nested: boolean, handlers: Partial<Parameters<typeof DeckBrowser>[0]> = {}) {
  act(() =>
    root.render(
      <DeckBrowser
        hideNavigation
        nested={nested}
        decks={decks}
        search=""
        onSearch={() => {}}
        open={() => {}}
        create={() => {}}
        study={() => {}}
        loading={false}
        {...handlers}
      />,
    ),
  );
}

it('nests decks under their parents, opens real decks and studies a whole subtree', async () => {
  const open = vi.fn(),
    studyDecks = vi.fn(),
    options = vi.fn();
  library(true, { open, studyDecks, options });
  expect(names()).toEqual(['Biology', 'Cells', 'Genetics', 'DNA', 'Chemistry']);
  // Children are inside their parent's container, which is what indents them.
  expect(host.querySelectorAll('.qard-deck-children')).toHaveLength(2);
  expect(host.textContent).toContain('1 cards · 1 topic · 2 in subdecks');

  await click(button('Study Biology and its subdecks'));
  expect(studyDecks).toHaveBeenCalledWith(
    expect.arrayContaining(['Biology', 'Biology::Cells', 'Biology::Genetics::DNA']),
  );
  await click(button('Deck options for Biology'));
  expect(options).toHaveBeenCalledWith('Biology');
  // Leaves have nothing beneath them to study together.
  expect(host.querySelector('button[aria-label="Study Chemistry and its subdecks"]')).toBeNull();

  const row = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button.qard-deck')).find(
      (el) => el.querySelector('strong')?.textContent === label,
    )!;
  await click(row('Cells'));
  expect(open).toHaveBeenCalledWith('Biology::Cells');
  // Genetics has no cards of its own: its row folds the branch and does not open a deck.
  await click(row('Genetics'));
  expect(open).toHaveBeenCalledTimes(1);
  expect(names()).toEqual(['Biology', 'Cells', 'Genetics', 'Chemistry']);
  await click(button('Collapse Biology'));
  expect(names()).toEqual(['Biology', 'Chemistry']);
  expect(button('Expand Biology').getAttribute('aria-expanded')).toBe('false');
});

it('keeps the flat list with full names while searching or filtering', () => {
  library(false);
  expect(names()).toEqual(['Biology', 'Biology::Cells', 'Biology::Genetics::DNA', 'Chemistry']);
  expect(host.querySelector('.qard-deck-children')).toBeNull();
  expect(host.querySelector('.qard-deck-toggle')).toBeNull();
});

it('edits a deck’s options, showing what it inherits and rejecting invalid values', async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  const settings = readSettings({
    scheduler: 'fsrs',
    desiredRetention: 0.9,
    newCardsPerDay: 20,
    deckOptions: { Biology: { desiredRetention: 0.85, newCardsPerDay: 10 } },
  });
  act(() =>
    root.render(
      <DeckOptions deck="Biology::Cells" settings={settings} save={save} close={close} />,
    ),
  );
  expect(host.textContent).toContain('Empty uses 85% from Biology.');
  expect(host.textContent).toContain('Biology allows 10 as well.');
  expect(host.textContent).toContain('Your overall limit of 20 still applies.');
  const [target, limit] = Array.from(host.querySelectorAll<HTMLInputElement>('input'));
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = () =>
    click(
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save options')!,
    );
  await type(target!, '99');
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('between 70% and 97%');
  expect(save).not.toHaveBeenCalled();
  await type(target!, '95');
  await type(limit!, '4');
  await submit();
  expect(save).toHaveBeenCalledWith({
    Biology: { desiredRetention: 0.85, newCardsPerDay: 10 },
    'Biology::Cells': { desiredRetention: 0.95, newCardsPerDay: 4 },
  });
  expect(close).toHaveBeenCalledOnce();
});

it('clears a deck’s own options when both fields are emptied', async () => {
  const save = vi.fn(async () => {});
  const settings = readSettings({ deckOptions: { Law: { desiredRetention: 0.95 } } });
  act(() =>
    root.render(<DeckOptions deck="Law" settings={settings} save={save} close={() => {}} />),
  );
  const input = host.querySelector<HTMLInputElement>('input')!;
  expect(input.value).toBe('95');
  expect(host.textContent).toContain('Empty uses 90% from your Qard settings.');
  await act(() => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save options')!,
  );
  expect(save).toHaveBeenCalledWith({});
});
