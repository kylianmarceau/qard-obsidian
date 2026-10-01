import { expect, it, vi } from 'vitest';
import { FlashcardGenerationService, type FlashcardRequest } from '../src/cards/generation-service';
import { readFlashcards, flashcardsSchema } from '../src/cards/generation-schema';
import { flashcardPrompt } from '../src/cards/generation-prompts';
import { purposeOf } from '../src/agents/usage-report';
import type { AgentRunner } from '../src/agents/runner';
const request: FlashcardRequest = { deck: 'Networks', topic: 'Transport', prompt: 'TCP congestion control', count: 2, notes: ['Notes/TCP.md'] };
const content = { cards: [{ front: 'What is slow start?', back: 'Exponential growth of the congestion window.', source: 'Notes/TCP.md' }, { front: 'What ends slow start?', back: 'Reaching the threshold or detecting loss.', source: 'Notes/TCP.md' }] };
function setup(run = vi.fn<AgentRunner['run']>().mockResolvedValue(content), files: Record<string, string> = {}) {
  const write = vi.fn(async (p: string, t: string) => { files[p] = t; });
  const writer = { createBatch: vi.fn().mockResolvedValue([]) }, notify = vi.fn(), timing = vi.fn();
  const service = new FlashcardGenerationService({ read: async p => files[p] ?? null, write }, () => 'Qard', () => ['Notes/TCP.md'], () => ({ name: 'Configured writer', run }), writer, notify, timing);
  return { service, run, writer, notify, timing, files, write };
}
async function settled(service: FlashcardGenerationService) {
  await vi.waitFor(() => expect(service.getSnapshot().job?.error || service.getSnapshot().batch?.cards.length).toBeTruthy());
  await service.flush();
}
it('generates through the writer, persists a review draft and only adds selected edited cards', async () => {
  const { service, run, writer, files, timing } = setup(); await service.load(); await service.start(request); await settled(service);
  expect(run).toHaveBeenCalledOnce(); expect(run.mock.calls[0]![0]).toMatchObject({ schema: flashcardsSchema, effort: 'high' });
  expect(writer.createBatch).not.toHaveBeenCalled();
  const cards = service.getSnapshot().batch!.cards;
  service.updateCard(cards[0]!.id, { front: 'How does slow start grow?', back: 'The congestion window doubles each RTT.' });
  service.updateCard(cards[1]!.id, { selected: false });
  await service.addSelected();
  expect(writer.createBatch).toHaveBeenCalledWith(expect.objectContaining({ deck: 'Networks', topic: 'Transport', folder: 'Qard' }), [expect.objectContaining({ front: 'How does slow start grow?', back: 'The congestion window doubles each RTT.' })]);
  await service.addSelected(); expect(writer.createBatch).toHaveBeenCalledOnce();
  expect(JSON.parse(files['Qard/Flashcard drafts.json']!).cards.map((c: { added: boolean }) => c.added)).toEqual([true, false]);
  expect(timing).toHaveBeenCalledWith('flashcards', expect.any(Number)); expect(purposeOf(flashcardsSchema)).toBe('Writing flashcards');
});
it('corrects malformed output once, including a wrong count or invented source', async () => {
  const run = vi.fn<AgentRunner['run']>().mockResolvedValueOnce({ cards: [content.cards[0]] }).mockResolvedValueOnce(content);
  const { service } = setup(run); await service.load(); await service.start(request); await settled(service);
  expect(run).toHaveBeenCalledTimes(2); expect(run.mock.calls[1]![0].prompt).toContain('Return exactly 2 cards');
  expect(() => readFlashcards({ cards: [{ ...content.cards[0], source: '../missing.md' }, content.cards[1]] }, 2, ['Notes/TCP.md'])).toThrow('does not exist');
  expect(() => readFlashcards({ cards: [content.cards[0], content.cards[0]] }, 2, ['Notes/TCP.md'])).toThrow('repeats');
  expect(() => readFlashcards({ cards: [{ ...content.cards[0], back: '' }, content.cards[1]] }, 2, ['Notes/TCP.md'])).toThrow('required');
});
it('cancels immediately and ignores late replies from an uninterruptible provider', async () => {
  let reply!: (v: unknown) => void;
  const run = vi.fn<AgentRunner['run']>().mockImplementationOnce(() => new Promise(resolve => { reply = resolve; })).mockResolvedValue(content);
  const { service, notify } = setup(run); await service.load(); await service.start(request);
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  service.cancel(); await settled(service); expect(service.getSnapshot().job?.error).toBe('Cancelled.');
  reply(content); await Promise.resolve(); expect(service.getSnapshot().batch?.cards).toEqual([]); expect(notify).not.toHaveBeenCalled();
  await service.generate(); expect(service.getSnapshot().batch?.cards).toHaveLength(2); expect(notify).toHaveBeenCalledOnce();
});
it('restores review edits and flags after reload without making another AI call', async () => {
  const { service, files } = setup(); await service.load(); await service.start(request); await settled(service);
  const id = service.getSnapshot().batch!.cards[0]!.id; service.updateCard(id, { front: 'Edited question?', selected: false }); await service.flush();
  const restored = setup(undefined, files); await restored.service.load();
  expect(restored.service.getSnapshot().batch?.cards[0]).toMatchObject({ front: 'Edited question?', selected: false }); expect(restored.run).not.toHaveBeenCalled();
});
it('restores an interrupted job as an explicit retry, without silently spending tokens', async () => {
  const { service, files } = setup(vi.fn<AgentRunner['run']>().mockImplementation(() => new Promise(() => {}))); await service.load(); await service.start(request);
  const restored = setup(undefined, files); await restored.service.load();
  expect(restored.service.getSnapshot().job?.error).toContain('interrupted'); expect(restored.run).not.toHaveBeenCalled(); service.dispose();
});
it('validates counts, notes, names and empty requests before calling the agent', async () => {
  const { service, run, files } = setup(); await service.load();
  for (const patch of [{ count: 0 }, { count: 41 }, { count: 1.5 }, { deck: '' }, { deck: 'Two\nlines' }, { notes: ['Gone.md'] }, { prompt: '', notes: [] }]) await expect(service.start({ ...request, ...patch })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled(); expect(files).toEqual({});
  expect(flashcardPrompt({ ...request, notes: [] })).toContain('Search the vault'); expect(flashcardPrompt(request)).toContain('Notes/TCP.md');
});
it('a failed batch save preserves every draft and can be retried', async () => {
  const { service, writer } = setup(); await service.load(); await service.start(request); await settled(service);
  writer.createBatch.mockRejectedValueOnce(new Error('Disk full'));
  await service.addSelected(); expect(service.getSnapshot()).toMatchObject({ saving: false, error: 'Disk full' }); expect(service.getSnapshot().batch?.cards.every(c => !c.added)).toBe(true);
  await service.addSelected(); expect(service.getSnapshot().batch?.cards.every(c => c.added)).toBe(true);
});
it('does not lose the review draft when clearing its saved file fails', async () => {
  const { service, write } = setup(); await service.load(); await service.start(request); await settled(service);
  write.mockRejectedValueOnce(new Error('Read only')); await expect(service.clear()).rejects.toThrow('Read only'); expect(service.getSnapshot().batch?.cards).toHaveLength(2);
});
it('does not contact the provider when cancelled before the request write finishes', async () => {
  const { service, run } = setup(); await service.load(); await service.start(request); service.cancel(); await settled(service);
  expect(run).not.toHaveBeenCalled(); expect(service.getSnapshot().job?.error).toBe('Cancelled.');
});
it('does not contact the provider until the request can be saved', async () => {
  const { service, run, write } = setup(); await service.load(); write.mockRejectedValueOnce(new Error('Read only'));
  await expect(service.start(request)).rejects.toThrow('Read only'); expect(run).not.toHaveBeenCalled();
  expect(service.getSnapshot().job?.error).toContain('Could not save the request');
  await service.generate(); expect(service.getSnapshot().batch?.cards).toHaveLength(2);
});
