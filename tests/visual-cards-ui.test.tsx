// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component, TFile } from 'obsidian';
import { CardEditor } from '../src/components/CardEditor';
import { ImageOcclusion } from '../src/components/ImageOcclusion';
import { StudyView } from '../src/views/StudyView';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import { parseCards } from '../src/cards/parser';
import { serializeCard } from '../src/cards/source-patch';
import type { CardDraft } from '../src/cards/card-writer';
import type { CardFormat, ImageMask } from '../src/cards/card-types';
import type { QardServices } from '../src/views/services';

let host: HTMLElement, root: Root, services: QardServices;
const cloze: CardFormat = { type: 'cloze' };
const occlusion: CardFormat = { type: 'occlusion', image: 'Images/diagram.svg', masks: [{ x: 20, y: 30, width: 25, height: 10 }] };
const saved = vi.fn();
// jsdom omits native pointer event properties; Preact uses them to normalise event names.
const pointerEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
beforeEach(() => {
  pointerEvents.forEach(name => Object.defineProperty(HTMLElement.prototype, 'on' + name, { configurable: true, value: null }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); saved.mockClear();
  const image = new (TFile as unknown as new (path: string) => TFile)('Images/diagram.svg');
  services = { host, owner: new Component(), reviews: new ReviewStore(async () => {}), index: new CardIndex(), setFocus: vi.fn(), isActive: () => true, openSource: vi.fn(),
    writer: { create: vi.fn(async (draft: CardDraft) => parseCards(serializeCard('created', draft.front, draft.back, '\n', draft.format), 'Cards.md').cards[0]!), edit: vi.fn() },
    app: { metadataCache: { getFirstLinkpathDest: vi.fn(() => image) }, vault: { getFiles: () => [image], getResourcePath: (f: TFile) => `app://vault/${f.path}` }, workspace: { on: vi.fn(), offref: vi.fn() } }
  } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); pointerEvents.forEach(name => { delete (HTMLElement.prototype as unknown as Record<string, unknown>)['on' + name]; }); });
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function change(el: Element, value: string) {
  await act(async () => { (el as HTMLInputElement).value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function editor() { await act(async () => root.render(<CardEditor services={services} initial={{ deck: 'Networks' }} cancel={vi.fn()} saved={saved}/>)); }
async function key(key: string) { await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await services.reviews.flush(); }); }

it('creates a cloze card by selecting text, previews hidden and revealed faces, and saves without an explanation', async () => {
  await editor(); await change(host.querySelector('select')!, 'cloze');
  const text = host.querySelector('textarea')!; await change(text, 'TCP is reliable.'); text.setSelectionRange(7, 15);
  await click('Mark as blank'); expect(text.value).toBe('TCP is {{reliable}}.');
  await click('Show preview');
  expect(host.querySelector('.qard-editor-rendered > div')?.textContent).toContain('TCP is […].');
  expect(host.querySelector('.qard-editor-rendered > div')?.textContent).not.toContain('reliable');
  await submit(); expect(saved.mock.calls[0]![0]).toMatchObject({ format: cloze, frontMarkdown: 'TCP is {{reliable}}.', backMarkdown: '' });
});
it('creates masks with keyboard-accessible controls', async () => {
  await editor(); await change(host.querySelector('select')!, 'occlusion');
  await change(host.querySelectorAll('select')[1]!, occlusion.image); await click('Add mask');
  await change(host.querySelector('[aria-label="Mask 1 x"]')!, '12');
  await submit(); expect(saved.mock.calls[0]![0].format).toMatchObject({ type: 'occlusion', image: occlusion.image, masks: [{ x: 12, y: 40, width: 20, height: 10 }] });
});
it('shows a useful error and stays in the editor for invalid blanks', async () => {
  await editor(); await change(host.querySelector('select')!, 'cloze'); await change(host.querySelector('textarea')!, 'No blanks here'); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('blank'); expect(saved).not.toHaveBeenCalled();
});
it('editing an image card restores masks and passes its format to the safe writer', async () => {
  const card = parseCards(serializeCard('existing', 'Identify it.', '', '\n', occlusion), 'Cards.md').cards[0]!;
  await act(async () => root.render(<CardEditor services={services} card={card} cancel={vi.fn()} saved={saved}/>));
  expect((host.querySelectorAll('select')[1] as HTMLSelectElement).value).toBe(occlusion.image);
  expect(host.querySelectorAll('.qard-image-mask')).toHaveLength(1); await submit();
  expect(services.writer.edit).toHaveBeenCalledWith(card, 'Identify it.', '', occlusion);
});
it('reuses the existing keyboard review flow for cloze cards without exposing answers on the front', async () => {
  const cards = parseCards(serializeCard('cloze', 'TCP is {{reliable::property}}.', '', '\n', cloze), 'Cards.md').cards;
  await act(async () => root.render(<StudyView cards={cards} services={services} exit={vi.fn()} repeat={vi.fn()}/>));
  expect(host.querySelector('.qard-study-front')?.textContent).toContain('[property]');
  expect(host.querySelector('.qard-study-front')?.textContent).not.toContain('reliable');
  await key('3'); expect(services.reviews.getSnapshot().history).toHaveLength(0);
  await key(' '); expect(host.querySelector('.qard-study-back')?.textContent).toContain('TCP is reliable.');
  await key('3'); expect(services.reviews.getSnapshot().history[0]?.cardId).toBe('cloze'); expect(host.textContent).toContain('Session complete');
});
it('covers only the front image, reveals the original, and saves a rating under the same card ID', async () => {
  const cards = parseCards(serializeCard('image', 'Identify it.', '', '\n', occlusion), 'Cards.md').cards;
  await act(async () => root.render(<StudyView cards={cards} services={services} exit={vi.fn()} repeat={vi.fn()}/>));
  expect(host.querySelectorAll('.qard-study-front .qard-image-mask')).toHaveLength(1);
  expect(host.querySelector('.qard-study-front img')?.getAttribute('src')).toBe('app://vault/Images/diagram.svg');
  expect(host.querySelectorAll('.qard-study-back .qard-image-mask')).toHaveLength(0);
  expect(host.querySelector('.qard-study-back')?.hasAttribute('inert')).toBe(true);
  await key(' '); expect(host.querySelector('.qard-study-back')?.hasAttribute('inert')).toBe(false);
  await key('3'); expect(services.reviews.getSnapshot().history[0]?.cardId).toBe('image');
});
it.each([false, true])('draws size-independent masks in either drag direction (reverse=%s)', async reverse => {
  const add = vi.fn<(mask: ImageMask) => void>();
  await act(async () => root.render(<ImageOcclusion image={occlusion.image} masks={[]} path="Cards.md" services={services} addMask={add}/>));
  const surface = host.querySelector('.qard-occlusion') as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 400, height: 200 } as DOMRect);
  Object.assign(surface, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const first = { clientX: 100, clientY: 80 }, last = { clientX: 340, clientY: 180 };
  await act(async () => { surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...(reverse ? last : first) })); });
  await act(async () => { surface.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, ...(reverse ? first : last) })); });
  await act(async () => { surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, ...(reverse ? first : last) })); });
  expect(add).toHaveBeenCalledWith({ x: 20, y: 20, width: 60, height: 50 });
});
it('handles missing attachments without trying to load an external image', async () => {
  vi.mocked(services.app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
  await act(async () => root.render(<ImageOcclusion image={occlusion.image} masks={[]} path="Cards.md" services={services}/>));
  expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Image not found');
});
