// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component, TFile } from 'obsidian';
import { ResumeFlashcards } from '../src/components/ResumeFlashcards';
import { GenerateFlashcards } from '../src/components/GenerateFlashcards';
import { CardEditor } from '../src/components/CardEditor';
import { DeckBrowser } from '../src/components/DeckBrowser';
import { FlashcardGenerationService } from '../src/cards/generation-service';
import { ReviewStore } from '../src/review/review-store';
import { CardIndex } from '../src/cards/card-index';
import type { QardServices } from '../src/views/services';
import type { CardWriter } from '../src/cards/card-writer';
import type { AgentRunner } from '../src/agents/runner';
let root: Root, host: HTMLElement, services: QardServices, run: ReturnType<typeof vi.fn<AgentRunner['run']>>, writer: { createBatch: ReturnType<typeof vi.fn<CardWriter['createBatch']>> };
const back = vi.fn(), openDeck = vi.fn();
const reply = { deck: 'Networks', topic: 'Transport', cards: [{ front: 'What is TCP?', back: 'Reliable transport.', source: 'Notes/TCP.md' }, { front: 'What is UDP?', back: 'Connectionless transport.', source: 'Notes/TCP.md' }] };
beforeEach(async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  run = vi.fn<AgentRunner['run']>().mockResolvedValue(reply); writer = { createBatch: vi.fn<CardWriter['createBatch']>().mockResolvedValue([]) };
  const flashcards = new FlashcardGenerationService({ read: async () => null, write: async () => {} }, () => 'Qard', () => ['Notes/TCP.md'], () => ({ name: 'Writer', run }), writer);
  await flashcards.load();
  const file = Object.assign(new (TFile as unknown as new (p: string) => TFile)('Notes/TCP.md'), { stat: { mtime: 1 } });
  services = { flashcards, writer, host, owner: new Component(), reviews: new ReviewStore(async () => {}), index: new CardIndex(), app: { vault: { getMarkdownFiles: () => [file] }, workspace: { openLinkText: vi.fn() } } } as unknown as QardServices;
});
afterEach(async () => { await act(async () => root.unmount()); services.flashcards?.dispose(); host.remove(); });
const tick = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const click = async (el?: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await tick(); };
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text));
const input = async (el: Element, value: string) => { await act(async () => { (el as HTMLInputElement).value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const render = async () => { await act(async () => root.render(<GenerateFlashcards services={services} initial={{ deck: 'Networks' }} back={back} openDeck={openDeck}/>)); };
it('chooses notes, previews and edits generated cards, then adds only the selected cards', async () => {
  await render(); expect(host.querySelector('input[type="number"]')).toBeNull();
  await click(button('+ Note')); await click(button('TCP')); expect(host.textContent).toContain('reads your selected notes');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await tick();
  expect(host.textContent).toContain('Review flashcards'); expect(run.mock.calls[0]![0].prompt).toContain('Choose how many cards the material needs');
  await input(host.querySelector('textarea[aria-label="Back of card 1"]')!, 'TCP provides ordered, reliable delivery.');
  await click(host.querySelector('[aria-label="Select card 2"]')); await click(button('Preview cards'));
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).toContain('ordered, reliable');
  await click(button('Add selected (1)')); expect(writer.createBatch).toHaveBeenCalledOnce();
  expect(writer.createBatch.mock.calls[0]![1]).toEqual([expect.objectContaining({ back: 'TCP provides ordered, reliable delivery.' })]);
  expect(host.textContent).toContain('1 of 2 added'); await click(button('Open deck')); expect(openDeck).toHaveBeenCalledWith('Networks');
});
it('keeps generation running after leaving, then reopens the same review draft', async () => {
  let resolve!: (v: unknown) => void; run.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(); expect(host.querySelector('input[type="number"]')).toBeNull(); await input(host.querySelector('[aria-label="Flashcard prompt"]')!, 'Transport basics');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await tick();
  expect(host.textContent).toContain('Generating flashcards'); await click(button('Back to decks')); expect(back).toHaveBeenCalled();
  await act(async () => root.render(<div>Other screen</div>)); resolve(reply); await tick(); await render(); expect(host.textContent).toContain('Review flashcards');
});
it('allows cancellation and retry and preserves the request when editing it', async () => {
  run.mockImplementationOnce(() => new Promise(() => {})); await render();
  await input(host.querySelector('[aria-label="Flashcard prompt"]')!, 'Transport basics');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await tick();
  await click(button('Cancel')); expect(host.textContent).toContain('Cancelled.'); expect(button('Try again')).toBeTruthy();
  await click(button('Edit request')); expect((host.querySelector('[aria-label="Flashcard prompt"]') as HTMLTextAreaElement).value).toBe('Transport basics');
  expect(host.querySelector('input[type="number"]')).toBeNull(); expect(host.textContent).toContain('No sources selected');
});
it('offers AI generation from both the deck list and the manual new-card editor', async () => {
  const generate = vi.fn();
  await act(async () => root.render(<DeckBrowser decks={[]} search="" onSearch={vi.fn()} open={vi.fn()} create={vi.fn()} study={vi.fn()} generate={generate} loading={false}/>));
  await click(button('Generate with AI')); expect(generate).toHaveBeenCalledOnce();
  await act(async () => root.render(<CardEditor services={services} initial={{ deck: 'Networks', topic: 'Transport', sourceFile: 'Notes/TCP.md' }} cancel={back} saved={vi.fn()} generate={generate}/>));
  await click(button('Generate with AI')); expect(generate).toHaveBeenLastCalledWith({ deck: 'Networks', topic: 'Transport', sourceFile: 'Notes/TCP.md' });
});
it('requests AI cloze cards and previews hidden answers before accepting them', async () => {
  run.mockResolvedValue({ deck: 'Networks', topic: 'Transport', cards: [{ front: 'TCP provides {{reliable::property}} delivery.', back: '', source: 'Notes/TCP.md' }] });
  await render();
  await click(button('Cloze'));
  await input(host.querySelector('[aria-label="Flashcard prompt"]')!, 'Transport properties');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await tick();
  expect(services.flashcards!.getSnapshot().batch!.request.format).toBe('cloze');
  await click(button('Preview cards'));
  const front = host.querySelector('.qard-editor-rendered > div')!;
  expect(front.textContent).toContain('TCP provides [property] delivery.'); expect(front.textContent).not.toContain('reliable');
  await click(button('Add selected (1)'));
  expect(writer.createBatch.mock.calls[0]![1][0]).toMatchObject({ format: { type: 'cloze' }, front: 'TCP provides {{reliable::property}} delivery.' });
});
it('starts from a description without deck or topic controls, then offers the suggested destination for review', async () => {
  await act(async () => root.render(<GenerateFlashcards services={services} back={back} openDeck={openDeck}/>));
  expect(host.querySelector('input')).toBeNull(); expect(host.querySelector('select')).toBeNull();
  expect(host.textContent).toContain('What should these flashcards cover?'); expect(button('Start')?.disabled).toBe(true);
  await input(host.querySelector('[aria-label="Flashcard prompt"]')!, 'TCP and UDP basics'); await click(button('Start'));
  expect(services.flashcards!.getSnapshot().batch?.request).not.toHaveProperty('deck'); expect(services.flashcards!.getSnapshot().batch?.request).not.toHaveProperty('topic');
  expect((host.querySelector('[aria-label="Save to deck"]') as HTMLInputElement).value).toBe('Networks');
  await input(host.querySelector('[aria-label="Save to deck"]')!, 'Exam revision'); await input(host.querySelector('[aria-label="Topic"]')!, 'Transport protocols');
  await click(button('Add selected (2)')); expect(writer.createBatch.mock.calls[0]![0]).toMatchObject({ deck: 'Exam revision', topic: 'Transport protocols' });
  expect((host.querySelector('[aria-label="Save to deck"]') as HTMLInputElement).disabled).toBe(true);
  await click(button('Open deck')); expect(openDeck).toHaveBeenLastCalledWith('Exam revision');
});
it('attaches a whole folder and starts without a prompt or upfront destination', async () => {
  await act(async () => root.render(<GenerateFlashcards services={services} back={back} openDeck={openDeck}/>));
  await click(button('+ Folder')); await click(host.querySelector('[aria-label="Attach folder Notes, 1 note"]'));
  expect(host.textContent).toContain('1 note attached, including subfolders'); expect(button('Start')?.disabled).toBe(false);
  await click(button('Start')); expect(services.flashcards!.getSnapshot().batch?.request.notes).toEqual(['Notes/TCP.md']);
  expect(services.flashcards!.getSnapshot().batch?.request.folders).toEqual(['Notes']); expect(services.flashcards!.getSnapshot().batch?.destination).toEqual({ deck: 'Networks', topic: 'Transport' });
});
it('blocks a source-only request when the attached folder loses its notes before Start', async () => {
  await act(async () => root.render(<GenerateFlashcards services={services} back={back} openDeck={openDeck}/>));
  await click(button('+ Folder')); await click(host.querySelector('[aria-label="Attach folder Notes, 1 note"]'));
  vi.spyOn(services.app.vault, 'getMarkdownFiles').mockReturnValue([]); await click(button('Start'));
  expect(run).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('no longer contain');
});

it('the Decks home row updates from generating to ready, opens the batch and disappears after all cards are added', async () => {
  let resolve!: (v: unknown) => void; run.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const open = vi.fn(), service = services.flashcards!;
  await act(async () => root.render(<DeckBrowser decks={[]} search="" onSearch={vi.fn()} open={vi.fn()} create={vi.fn()} study={vi.fn()} loading={false} resume={<ResumeFlashcards service={service} open={open}/>}/>));
  expect(host.querySelector('.qard-resume')).toBeNull();
  await act(async () => { await service.start({ deck: 'Networks', topic: 'Transport', prompt: 'Transport basics', notes: [] }); }); await tick();
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Generating flashcards');
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Networks › Transport');
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Generating…'); expect(host.querySelector('.qard-resume')?.textContent).not.toContain('2 cards');
  await click(host.querySelector('.qard-resume')); expect(open).toHaveBeenCalledOnce();
  await act(async () => { resolve(reply); }); await tick();
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Review flashcards');
  expect(host.querySelector('.qard-resume')?.textContent).toContain('2 ready to review');
  const second = service.getSnapshot().batch!.cards[1]!;
  await act(async () => { service.updateCard(second.id, { selected: false }); await service.addSelected(); });
  expect(host.querySelector('.qard-resume')?.textContent).toContain('1 ready to review');
  await act(async () => { service.updateCard(second.id, { selected: true }); await service.addSelected(); });
  expect(host.querySelector('.qard-resume')).toBeNull();
});
it('the home row keeps a cancelled job accessible and updates when it is retried', async () => {
  run.mockImplementationOnce(() => new Promise(() => {})); const service = services.flashcards!;
  await act(async () => root.render(<ResumeFlashcards service={service} open={vi.fn()}/>));
  await act(async () => { await service.start({ deck: 'Networks', topic: 'Transport', prompt: 'Transport basics', notes: [] }); }); await tick();
  await act(async () => service.cancel()); await tick();
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Needs attention');
  await act(async () => { await service.generate(); });
  expect(host.querySelector('.qard-resume')?.textContent).toContain('Review flashcards');
});
