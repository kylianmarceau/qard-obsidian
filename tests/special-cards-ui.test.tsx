// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Component, TFile } from 'obsidian';
import { CardEditor } from '../src/components/CardEditor';
import { CardPreview } from '../src/components/CardPreview';
import { StudyView } from '../src/views/StudyView';
import { OcclusionEditor } from '../src/components/OcclusionEditor';
import { CardIndex } from '../src/cards/card-index';
import { ReviewStore } from '../src/review/review-store';
import {
  clozeFront,
  FORMAT_BACK,
  occlusionFront,
  readCardFormat,
  type ImageOcclusion,
} from '../src/cards/card-format';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import type { QardCard } from '../src/cards/card-types';
import type { QardServices } from '../src/views/services';
import type { CardWriter } from '../src/cards/card-writer';

let root: Root, host: HTMLElement, services: QardServices;
const saved = vi.fn();
const diagram = new (TFile as unknown as new (p: string) => TFile)('Attachments/network.svg');
const image: ImageOcclusion = {
  image: diagram.path,
  masks: [
    { id: 'one', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { id: 'two', x: 0.5, y: 0.1, width: 0.2, height: 0.2 },
  ],
  target: 'one',
};
const makeCard = (front: string, id = 'card') =>
  parseCards(serializeCard(id, front, FORMAT_BACK), 'Qard/Cards.md').cards[0]!;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  saved.mockClear();
  services = {
    host,
    owner: new Component(),
    reviews: new ReviewStore(async () => {}),
    index: new CardIndex(),
    writer: {
      create: vi.fn(async (draft) => makeCard(draft.front)),
      edit: vi.fn(async (card, front) => makeCard(front, card.id)),
      createBatch: vi.fn<CardWriter['createBatch']>(async (_target, cards) =>
        cards.map((c) => makeCard(c.front, c.id)),
      ),
    },
    app: {
      vault: {
        getFiles: () => [diagram],
        getAbstractFileByPath: (path: string) => (path === diagram.path ? diagram : null),
        getResourcePath: () => 'app://local-image/network.svg',
      },
      metadataCache: { getFirstLinkpathDest: () => null },
      workspace: { on: vi.fn(), offref: vi.fn() },
    },
    setFocus: vi.fn(),
    isActive: () => true,
    openSource: vi.fn(),
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const click = async (el: HTMLElement) => {
  expect(el).toBeTruthy();
  await act(async () => el.click());
};
const input = async (
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const submit = async () => {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};
const editor = async (card?: QardCard) => {
  await act(async () =>
    root.render(
      <CardEditor
        services={services}
        initial={{ deck: 'Networks', topic: 'Labels' }}
        card={card}
        cancel={vi.fn()}
        saved={saved}
      />,
    ),
  );
};

it('keeps the basic editor and save path unchanged', async () => {
  await editor();
  expect(button('Basic').getAttribute('aria-pressed')).toBe('true');
  const areas = host.querySelectorAll('textarea');
  await input(areas[0]!, 'Question?');
  await input(areas[1]!, 'Answer.');
  await submit();
  expect(services.writer.create).toHaveBeenCalledWith(
    expect.objectContaining({ front: 'Question?', back: 'Answer.', deck: 'Networks' }),
  );
  expect(services.writer.createBatch).not.toHaveBeenCalled();
});
it('turns selected text into a cloze and previews it without leaking its answer', async () => {
  await editor();
  await click(button('Cloze'));
  const area = host.querySelector('textarea')!;
  await input(area, 'TCP provides reliability.');
  await act(async () => {
    area.setSelectionRange(0, 3);
    area.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await click(button('Hide selection'));
  expect(area.value).toBe('{{c1::TCP}} provides reliability.');
  await click(button('Show preview'));
  expect(host.querySelector('.qard-editor-rendered > div:first-child')?.textContent).not.toContain(
    'TCP',
  );
  expect(host.querySelector('.qard-editor-rendered > div:last-child')?.textContent).toContain(
    'TCP',
  );
  await submit();
  expect(services.writer.createBatch).toHaveBeenCalledWith(
    expect.objectContaining({ label: 'cloze' }),
    [expect.objectContaining({ front: clozeFront(area.value, 1), back: FORMAT_BACK })],
  );
  expect(saved).toHaveBeenCalledOnce();
});
it('creates a separate stable card per numbered blank and reuses identities on a failed-save retry', async () => {
  await editor();
  await click(button('Cloze'));
  await input(host.querySelector('textarea')!, '{{c1::TCP}} is {{c2::reliable}}.');
  const create = services.writer.createBatch as ReturnType<typeof vi.fn<CardWriter['createBatch']>>;
  create.mockRejectedValueOnce(new Error('Could not refresh after save'));
  await submit();
  expect(host.textContent).toContain('Could not refresh');
  await submit();
  const [firstTarget, firstCards] = create.mock.calls[0]!;
  const [nextTarget, nextCards] = create.mock.calls[1]!;
  expect(nextTarget.batchId).toBe(firstTarget.batchId);
  expect(nextCards.map((c) => c.id)).toEqual(firstCards.map((c) => c.id));
  expect(new Set(nextCards.map((c) => c.id)).size).toBe(2);
  expect(nextCards.map((c) => readCardFormat(c.front))).toEqual([
    { kind: 'cloze', text: '{{c1::TCP}} is {{c2::reliable}}.', target: 1 },
    { kind: 'cloze', text: '{{c1::TCP}} is {{c2::reliable}}.', target: 2 },
  ]);
});
it('blocks an empty cloze before writing and keeps the editor usable', async () => {
  await editor();
  await click(button('Cloze'));
  await input(host.querySelector('textarea')!, 'No blank yet');
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('matching blank');
  expect(services.writer.createBatch).not.toHaveBeenCalled();
  expect(button('Create card').disabled).toBe(false);
});
it('edits an existing cloze without replacing its ID or changing its target', async () => {
  const card = makeCard(clozeFront('{{c1::TCP}} is {{c2::reliable}}.', 2), 'same-id');
  await editor(card);
  await input(host.querySelector('textarea')!, '{{c1::TCP}} is {{c2::reliable transport}}.');
  await submit();
  expect(services.writer.edit).toHaveBeenCalledWith(
    card,
    clozeFront('{{c1::TCP}} is {{c2::reliable transport}}.', 2),
    FORMAT_BACK,
  );
  expect(services.writer.createBatch).not.toHaveBeenCalled();
});
it('reveals only the active image region, rates through the existing controls, and removes source chrome', async () => {
  await act(async () =>
    root.render(
      <StudyView
        cards={[makeCard(occlusionFront('Diagram', image))]}
        services={services}
        exit={vi.fn()}
        repeat={vi.fn()}
      />,
    ),
  );
  const front = host.querySelector('.qard-study-front')!,
    back = host.querySelector('.qard-study-back')!;
  expect(front.querySelectorAll('.qard-image-mask')).toHaveLength(2);
  expect(front.querySelectorAll('.is-answer')).toHaveLength(0);
  expect(back.querySelectorAll('.is-answer')).toHaveLength(1);
  expect(back.querySelector('.is-answer')?.getAttribute('aria-label')).toBe('Revealed region 1');
  expect(host.textContent).not.toContain('Open source');
  await click(button('Reveal answer Space'));
  expect(back.getAttribute('aria-hidden')).toBe('false');
  await act(async () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await services.reviews.flush();
  });
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(host.textContent).toContain('Session complete');
});
it('renders special previews and keeps edit, delete and study without the source button', async () => {
  await act(async () =>
    root.render(
      <CardPreview
        card={makeCard(clozeFront('{{c1::TCP}} is reliable.', 1))}
        services={services}
        back={vi.fn()}
        study={vi.fn()}
        changed={vi.fn()}
      />,
    ),
  );
  expect(host.querySelector('.qard-preview-side:first-child')?.textContent).not.toContain('TCP');
  expect(host.querySelector('.qard-preview-answer')?.textContent).toContain('TCP');
  expect(button('Edit')).toBeTruthy();
  expect(button('Study')).toBeTruthy();
  expect(button('Source')).toBeUndefined();
});
it('shows a recoverable missing-image message instead of an empty or broken card', async () => {
  await act(async () =>
    root.render(
      <CardPreview
        card={makeCard(occlusionFront('Diagram', { ...image, image: 'missing.png' }))}
        services={services}
        back={vi.fn()}
        study={vi.fn()}
        changed={vi.fn()}
      />,
    ),
  );
  expect(host.querySelector('[role=alert]')?.textContent).toContain(
    'Image unavailable: missing.png',
  );
  expect(button('Edit')).toBeTruthy();
});
it('draws normalized masks, preserves them across resizing, and supports keyboard movement and deletion', async () => {
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    Object.defineProperty(HTMLElement.prototype, 'on' + type, { value: null, configurable: true });
  }
  let value: ImageOcclusion = { image: diagram.path, masks: [] };
  const render = () =>
    root.render(
      <OcclusionEditor
        value={value}
        change={(next) => {
          value = next;
          render();
        }}
        services={services}
        path="Qard/Cards.md"
        uploading={false}
        setUploading={vi.fn()}
        editing={false}
      />,
    );
  await act(async () => render());
  const stage = host.querySelector('.qard-mask-canvas') as HTMLElement;
  Object.assign(stage, {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  await act(async () => {
    host.querySelector('img')!.dispatchEvent(new Event('load'));
  });
  expect(stage.classList.contains('is-ready')).toBe(true);
  const pointer = (type: string, x: number, y: number) => {
    const e = new Event(type, { bubbles: true });
    Object.assign(e, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
    stage.dispatchEvent(e);
  };
  await act(async () => pointer('pointerdown', 100, 50));
  await act(async () => pointer('pointermove', 300, 150));
  await act(async () => pointer('pointerup', 300, 150));
  expect(value.masks[0]?.x).toBeCloseTo(0.1);
  expect(value.masks[0]?.y).toBeCloseTo(0.1);
  expect(value.masks[0]?.width).toBeCloseTo(0.2);
  expect(value.masks[0]?.height).toBeCloseTo(0.2);
  const width = host.querySelector('input[type=number]') as HTMLInputElement;
  await input(width, '14.7');
  expect(width.validity.valid).toBe(true);
  const mask = host.querySelector('.qard-edit-mask') as HTMLButtonElement;
  expect(mask.style.left).toBe('10%');
  expect(parseFloat(mask.style.width)).toBeCloseTo(14.7);
  await act(async () => {
    mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(value.masks[0]?.x).toBeCloseTo(0.105);
  await act(async () => {
    mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  });
  expect(value.masks).toHaveLength(0);
});
it('creates one card per mask or a combined card without changing the rating model', async () => {
  // An initial format draft is also used by the selection/create workflow.
  await act(async () =>
    root.render(
      <CardEditor
        services={services}
        initial={{
          deck: 'Networks',
          topic: 'Labels',
          front: occlusionFront('Diagram', { ...image, target: undefined }),
        }}
        cancel={vi.fn()}
        saved={saved}
      />,
    ),
  );
  await submit();
  const create = services.writer.createBatch as ReturnType<typeof vi.fn<CardWriter['createBatch']>>;
  expect(create.mock.calls[0]?.[1]).toHaveLength(2);
  expect(create.mock.calls[0]?.[1].map((c) => readCardFormat(c.front))).toEqual(
    image.masks.map((mask) => ({
      kind: 'occlusion',
      text: 'Diagram',
      occlusion: { ...image, target: mask.id },
    })),
  );
});

it('pauses and resumes a card from its preview without losing history or enabling study while paused', async () => {
  const card = makeCard(clozeFront('{{c1::TCP}} is reliable.', 1));
  await services.reviews.review(card.id, 4, 1000);
  const before = services.reviews.getSnapshot().states[card.id],
    changed = vi.fn();
  await act(async () =>
    root.render(
      <CardPreview
        card={card}
        services={services}
        back={vi.fn()}
        study={vi.fn()}
        changed={changed}
      />,
    ),
  );
  await act(async () => {
    button('Pause card').click();
    await services.reviews.flush();
  });
  expect(services.reviews.getSnapshot().states[card.id]).toEqual({ ...before, paused: true });
  expect(button('Study')?.disabled).toBe(true);
  expect(host.textContent).toContain('history and schedule are preserved');
  await act(async () => {
    button('Resume card').click();
    await services.reviews.flush();
  });
  expect(services.reviews.getSnapshot().states[card.id]).toEqual(before);
  expect(button('Study')?.disabled).toBe(false);
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(changed).toHaveBeenCalledWith(card);
});
