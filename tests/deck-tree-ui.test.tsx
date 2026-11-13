// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import * as obsidian from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckBrowser } from '../src/components/DeckBrowser';
import { DeckOptions } from '../src/components/DeckOptions';
import { TopicBrowser } from '../src/components/TopicBrowser';
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
  vi.restoreAllMocks();
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
  expect(options).toHaveBeenCalledWith('Biology', 'Biology');
  // Leaves have nothing beneath them to study together.
  expect(host.querySelector('button[aria-label="Study Chemistry and its subdecks"]')).toBeNull();

  const row = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button.qard-deck')).find(
      (el) => el.querySelector('strong')?.textContent === label,
    )!;
  await click(row('Cells'));
  expect(open).toHaveBeenCalledWith('Biology::Cells');
  // Genetics has no cards of its own: its row opens a page listing its subdecks.
  await click(row('Genetics'));
  expect(open).toHaveBeenLastCalledWith('Biology::Genetics');
  await click(button('Collapse Biology::Genetics'));
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

const appearanceField = (name: string) => {
  const label = [...host.querySelectorAll('label')].find(
    (label) => label.textContent === name || label.querySelector('span')?.textContent === name,
  )!;
  return label.htmlFor
    ? host.querySelector<HTMLInputElement>(`[id="${label.htmlFor}"]`)!
    : label.querySelector<HTMLInputElement>('input')!;
};
const selectedIcon = () =>
  button('Choose deck icon')
    .querySelector(':scope > span:not(.qard-deck-badge)')
    ?.textContent?.replace(/^Automatic$/, '') ?? '';
const typeAppearance = async (name: string, value: string) => {
  if (name === 'Icon') {
    if (!value) return click(button('Automatic icon'));
    await click(button('Choose deck icon'));
    const search = host.querySelector<HTMLInputElement>('[aria-label="Find icons"]')!;
    await act(() => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return click(button(`Use ${value} icon`));
  }
  return act(() => {
    const input = appearanceField(name);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const action = async (text: string) =>
  act(async () => {
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === text || button.getAttribute('aria-label') === text)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

it('configures exact-deck appearance in nested/filtered rows and opens options for leaves', async () => {
  const options = vi.fn();
  const choices = {
    'Biology::Cells': { icon: 'terminal', color: '#123456' },
    'History::Cells': { icon: 'network', color: '#654321' },
    Biology: { icon: 'atom' },
  };
  const all = buildDecks([
    card('a', 'Biology::Cells'),
    card('b', 'History::Cells'),
    card('c', 'Chemistry'),
  ]);
  library(true, { decks: all, deckOptions: choices, options });
  const rows = [...host.querySelectorAll('.qard-deck-row')];
  expect(
    rows
      .filter((row) => row.querySelector('strong')?.textContent === 'Cells')
      .map((row) => row.querySelector('svg[data-icon]')?.getAttribute('data-icon')),
  ).toEqual(['terminal', 'network']);
  await click(button('Deck options for Chemistry'));
  expect(options).toHaveBeenCalledWith('Chemistry', 'Chemistry');
  library(false, { decks: all, deckOptions: choices, options });
  expect(host.querySelectorAll('.qard-deck-badge [data-icon]')).toHaveLength(2);
  expect(
    host.querySelector<HTMLElement>('.qard-deck-badge')?.style.getPropertyValue('--qard-course'),
  ).toBe('#123456');
});

it('previews appearance, saves independent resets and preserves scheduling options', async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  const settings = readSettings({
    deckOptions: {
      Biology: { desiredRetention: 0.85, newCardsPerDay: 3, icon: 'terminal', color: '#123456' },
    },
  });
  act(() =>
    root.render(<DeckOptions deck="Biology" settings={settings} save={save} close={close} />),
  );
  expect(
    host.querySelector('.qard-deck-appearance-preview [data-icon]')?.getAttribute('data-icon'),
  ).toBe('terminal');
  await typeAppearance('Icon', 'network');
  await typeAppearance('Color', '#aabbcc');
  expect(
    host.querySelector('.qard-deck-appearance-preview [data-icon]')?.getAttribute('data-icon'),
  ).toBe('network');
  expect(
    host
      .querySelector<HTMLElement>('.qard-deck-appearance-preview .qard-deck-badge')
      ?.style.getPropertyValue('--qard-course'),
  ).toBe('#aabbcc');
  await action('Automatic icon');
  await action('Save options');
  expect(save).toHaveBeenCalledWith({
    Biology: { desiredRetention: 0.85, newCardsPerDay: 3, color: '#aabbcc' },
  });
  expect(close).toHaveBeenCalledOnce();
});

it.each([0.855, 0.851234567890123])(
  'keeps exact retention %s when only appearance changes',
  async (desiredRetention) => {
    const save = vi.fn(async () => {});
    const settings = readSettings({
      deckOptions: { Biology: { desiredRetention, newCardsPerDay: 3 } },
    });
    act(() =>
      root.render(<DeckOptions deck="Biology" settings={settings} save={save} close={vi.fn()} />),
    );
    expect(appearanceField('Target retention (%)').value).toBe(String(desiredRetention * 100));
    expect(appearanceField('Target retention (%)').step).toBe('any');
    await typeAppearance('Icon', 'terminal');
    await typeAppearance('Color', '#aabbcc');
    await action('Save options');
    expect(save).toHaveBeenCalledWith({
      Biology: { desiredRetention, newCardsPerDay: 3, icon: 'terminal', color: '#aabbcc' },
    });
  },
);

it('rejects malformed colors, keeps edits on save failure, and allows retry', async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  act(() =>
    root.render(
      <DeckOptions deck="Biology" settings={readSettings({})} save={save} close={close} />,
    ),
  );
  await typeAppearance('Icon', 'terminal');
  await typeAppearance('Color', '#12');
  await action('Save options');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('six-digit');
  await typeAppearance('Color', '#abcdef');
  save.mockRejectedValueOnce(new Error('disk full'));
  await action('Save options');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not save');
  expect(selectedIcon()).toBe('terminal');
  expect(appearanceField('Color').value).toBe('#abcdef');
  expect(close).not.toHaveBeenCalled();
  await action('Save options');
  expect(close).toHaveBeenCalledOnce();
});

it('retains an unavailable saved icon on color edits and Cancel never saves', async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  act(() =>
    root.render(
      <DeckOptions
        deck="A"
        settings={readSettings({
          deckOptions: { A: { icon: 'other-device-icon', color: '#123456' } },
        })}
        save={save}
        close={close}
      />,
    ),
  );
  expect(host.textContent).toContain('unavailable on this device');
  await action('Automatic color');
  await action('Save options');
  expect(save).toHaveBeenCalledWith({ A: { icon: 'other-device-icon' } });
  save.mockClear();
  await action('Cancel');
  expect(save).not.toHaveBeenCalled();
});

it.each([true, false])(
  'previews the same automatic badge as its library row (nested=%s)',
  async (nested) => {
    const options = vi.fn();
    library(nested, { options });
    const row = button('Deck options for Biology::Cells').closest('.qard-deck-row')!;
    const expected = row.querySelector('.qard-deck-badge')!.outerHTML;
    await click(button('Deck options for Biology::Cells'));
    expect(options).toHaveBeenCalledWith('Biology::Cells', nested ? 'Cells' : 'Biology::Cells');
    const [deck, badgeName] = options.mock.calls[0]!;
    act(() =>
      root.render(
        <DeckOptions
          deck={deck}
          badgeName={badgeName}
          settings={readSettings({})}
          save={vi.fn()}
          close={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector('.qard-deck-appearance-preview .qard-deck-badge')!.outerHTML).toBe(
      expected,
    );
    expect(host.querySelector('h2')!.textContent).toContain('Biology::Cells');
  },
);

it('suggests, previews and saves registered icon-pack IDs', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const owner = frame.contentDocument!;
  owner.body.append(host);
  const save = vi.fn(async (_options: unknown) => {});
  try {
    act(() =>
      root.render(<DeckOptions deck="A" settings={readSettings({})} save={save} close={vi.fn()} />),
    );
    await click(button('Choose deck icon'));
    await act(() => {
      owner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.qard-deck-icon-picker')).toBeNull();
    await click(button('Choose deck icon'));
    const outside = owner.createElement('button');
    owner.body.append(outside);
    await act(() => {
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    });
    expect(host.querySelector('.qard-deck-icon-picker')).toBeNull();
    await typeAppearance('Icon', 'ri_terminal');
    expect(
      host.querySelector('.qard-deck-appearance-preview [data-icon]')?.getAttribute('data-icon'),
    ).toBe('ri_terminal');
    await action('Save options');
    expect(save).toHaveBeenCalledWith({ A: { icon: 'ri_terminal' } });
    expect(readSettings({ deckOptions: save.mock.calls[0]![0] }).deckOptions).toEqual({
      A: { icon: 'ri_terminal' },
    });
  } finally {
    document.body.append(host);
    frame.remove();
  }
});

it.each([
  {
    field: 'Target retention (%)',
    value: '86',
    remote: { icon: 'network', color: '#aabbcc' },
    expected: { desiredRetention: 0.86, icon: 'network', color: '#aabbcc' },
  },
  {
    field: 'Icon',
    value: 'network',
    remote: { icon: 'atom', color: '#aabbcc' },
    expected: { desiredRetention: 0.85, icon: 'network', color: '#aabbcc' },
  },
  {
    field: 'Color',
    value: '#abcdef',
    remote: { icon: 'network', color: '#aabbcc' },
    expected: { desiredRetention: 0.85, icon: 'network', color: '#abcdef' },
  },
  {
    field: 'Icon',
    value: '',
    remote: { icon: 'network', color: '#aabbcc' },
    expected: { desiredRetention: 0.85, color: '#aabbcc' },
  },
  {
    field: 'Color',
    value: '',
    remote: { icon: 'network', color: '#aabbcc' },
    expected: { desiredRetention: 0.85, icon: 'network' },
  },
  { field: 'Target retention (%)', value: '86', remote: {}, expected: { desiredRetention: 0.86 } },
  {
    field: 'Color',
    value: '#abcdef',
    remote: { icon: 'other-device-icon', color: '#aabbcc' },
    expected: { desiredRetention: 0.85, icon: 'other-device-icon', color: '#abcdef' },
  },
])(
  'preserves unedited synced appearance while editing $field to "$value"',
  async ({ field, value, remote, expected }) => {
    const save = vi.fn(async () => {});
    const render = (appearance: { icon?: string; color?: string }) =>
      act(() =>
        root.render(
          <DeckOptions
            deck="A"
            settings={readSettings({
              deckOptions: {
                A: { desiredRetention: 0.85, newCardsPerDay: 3, ...appearance },
                B: { icon: 'atom' },
              },
            })}
            save={save}
            close={vi.fn()}
          />,
        ),
      );
    render({ icon: 'terminal', color: '#123456' });
    await typeAppearance(field, value);
    render(remote);
    if (field !== 'Icon') expect(selectedIcon()).toBe(remote.icon ?? '');
    if (field !== 'Color') expect(appearanceField('Color').value).toBe(remote.color ?? '');
    await action('Save options');
    expect(save).toHaveBeenCalledWith({
      A: { newCardsPerDay: 3, ...expected },
      B: { icon: 'atom' },
    });
  },
);

it('explicitly selects the default grey without requiring a picker change', async () => {
  const save = vi.fn(async () => {});
  act(() =>
    root.render(<DeckOptions deck="A" settings={readSettings({})} save={save} close={vi.fn()} />),
  );
  expect(host.querySelector('input[type=color]')).toBeNull();
  await action('Use custom color');
  expect(appearanceField('Color').value).toBe('#808080');
  expect(host.querySelector<HTMLInputElement>('input[type=color]')!.value).toBe('#808080');
  await action('Save options');
  expect(save).toHaveBeenCalledWith({ A: { color: '#808080' } });
});

it('changes custom picker colors, resets to automatic, and cancels without saving', async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  act(() =>
    root.render(<DeckOptions deck="A" settings={readSettings({})} save={save} close={close} />),
  );
  await action('Use custom color');
  await act(() => {
    const picker = host.querySelector<HTMLInputElement>('input[type=color]')!;
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(appearanceField('Color').value).toBe('#123456');
  await action('Automatic color');
  expect(appearanceField('Color').value).toBe('');
  expect(host.querySelector('input[type=color]')).toBeNull();
  await action('Use custom color');
  await action('Cancel');
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it('does not construct availability SVGs while editing unrelated fields', async () => {
  const lookup = vi.spyOn(obsidian, 'getIcon');
  act(() =>
    root.render(
      <DeckOptions
        deck="A"
        settings={readSettings({ deckOptions: { A: { icon: 'terminal' } } })}
        save={vi.fn()}
        close={vi.fn()}
      />,
    ),
  );
  lookup.mockClear();
  await typeAppearance('Color', '#123456');
  await typeAppearance('Target retention (%)', '85');
  expect(lookup).not.toHaveBeenCalled();
});

it.each(['terminal', 'network', 'enter'])(
  'preserves the saved Obsidian icon alias %s omitted from registry IDs without repeated SVG checks',
  async (icon) => {
    const save = vi.fn(async () => {}),
      lookup = vi.spyOn(obsidian, 'getIcon');
    expect(obsidian.getIconIds()).not.toContain(icon);
    act(() =>
      root.render(
        <DeckOptions
          deck="A"
          settings={readSettings({ deckOptions: { A: { icon } } })}
          save={save}
          close={vi.fn()}
        />,
      ),
    );
    expect(
      host.querySelector('.qard-deck-appearance-preview [data-icon]')?.getAttribute('data-icon'),
    ).toBe(icon);
    lookup.mockClear();
    await typeAppearance('Color', '#123456');
    await typeAppearance('Target retention (%)', '85');
    await action('Save options');
    expect(save).toHaveBeenCalledWith({
      A: { icon, color: '#123456', desiredRetention: 0.85 },
    });
    expect(lookup).not.toHaveBeenCalled();
  },
);

it.each([
  ['Biology::Cells', 'terminal', '#123456'],
  ['History::Cells', 'network', '#654321'],
])('looks up header appearance by full deck name %s', (name, icon, color) => {
  const deck = buildDecks([card('a', name)])[0]!;
  act(() =>
    root.render(
      <TopicBrowser
        deck={deck}
        deckOptions={{
          'Biology::Cells': { icon: 'terminal', color: '#123456' },
          'History::Cells': { icon: 'network', color: '#654321' },
        }}
        select={vi.fn()}
        study={vi.fn()}
        create={vi.fn()}
      />,
    ),
  );
  expect(host.querySelector('.qard-deck-identity [data-icon]')?.getAttribute('data-icon')).toBe(
    icon,
  );
  expect(
    host
      .querySelector<HTMLElement>('.qard-deck-identity .qard-deck-badge')!
      .style.getPropertyValue('--qard-course'),
  ).toBe(color);
});
