import { expect, it, vi } from 'vitest';
import { FlashcardGenerationService, type FlashcardRequest } from '../src/cards/generation-service';
import {
  readFlashcards,
  flashcardBatchSchema,
  flashcardsSchema,
} from '../src/cards/generation-schema';
import { flashcardPrompt } from '../src/cards/generation-prompts';
import { purposeOf } from '../src/agents/usage-report';
import type { AgentRunner } from '../src/agents/runner';
const request: FlashcardRequest = {
  deck: 'Networks',
  topic: 'Transport',
  prompt: 'TCP congestion control',
  notes: ['Notes/TCP.md'],
};
const content = {
  cards: [
    {
      front: 'What is slow start?',
      back: 'Exponential growth of the congestion window.',
      source: 'Notes/TCP.md',
    },
    {
      front: 'What ends slow start?',
      back: 'Reaching the threshold or detecting loss.',
      source: 'Notes/TCP.md',
    },
  ],
};
function setup(
  run = vi.fn<AgentRunner['run']>().mockResolvedValue(content),
  files: Record<string, string> = {},
) {
  const write = vi.fn(async (p: string, t: string) => {
    files[p] = t;
  });
  const writer = { createBatch: vi.fn().mockResolvedValue([]) },
    notify = vi.fn(),
    timing = vi.fn();
  const service = new FlashcardGenerationService(
    { read: async (p) => files[p] ?? null, write },
    () => 'Qard',
    () => ['Notes/TCP.md'],
    () => ({ name: 'Configured writer', run }),
    writer,
    notify,
    timing,
  );
  return { service, run, writer, notify, timing, files, write };
}
async function settled(service: FlashcardGenerationService) {
  await vi.waitFor(() =>
    expect(
      service.getSnapshot().job?.error || service.getSnapshot().batch?.cards.length,
    ).toBeTruthy(),
  );
  await service.flush();
}
it('generates through the writer, persists a review draft and only adds selected edited cards', async () => {
  const { service, run, writer, files, timing } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0]![0]).toMatchObject({ schema: flashcardsSchema, effort: 'high' });
  expect(writer.createBatch).not.toHaveBeenCalled();
  const cards = service.getSnapshot().batch!.cards;
  service.updateCard(cards[0]!.id, {
    front: 'How does slow start grow?',
    back: 'The congestion window doubles each RTT.',
  });
  service.updateCard(cards[1]!.id, { selected: false });
  await service.addSelected();
  expect(writer.createBatch).toHaveBeenCalledWith(
    expect.objectContaining({ deck: 'Networks', topic: 'Transport', folder: 'Qard' }),
    [
      expect.objectContaining({
        front: 'How does slow start grow?',
        back: 'The congestion window doubles each RTT.',
      }),
    ],
  );
  await service.addSelected();
  expect(writer.createBatch).toHaveBeenCalledOnce();
  expect(
    JSON.parse(files['Qard/Flashcard drafts.json']!).cards.map((c: { added: boolean }) => c.added),
  ).toEqual([true, false]);
  expect(timing).toHaveBeenCalledWith('flashcards', expect.any(Number));
  expect(purposeOf(flashcardsSchema)).toBe('Writing flashcards');
});
it('corrects malformed output once, including an empty batch or invented source', async () => {
  const run = vi
    .fn<AgentRunner['run']>()
    .mockResolvedValueOnce({ cards: [] })
    .mockResolvedValueOnce(content);
  const { service } = setup(run);
  await service.load();
  await service.start(request);
  await settled(service);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]![0].prompt).toContain('Return at least one useful flashcard');
  expect(() =>
    readFlashcards(
      { cards: [{ ...content.cards[0], source: '../missing.md' }, content.cards[1]] },
      ['Notes/TCP.md'],
    ),
  ).toThrow('does not exist');
  expect(() =>
    readFlashcards({ cards: [content.cards[0], content.cards[0]] }, ['Notes/TCP.md']),
  ).toThrow('repeats');
  expect(() =>
    readFlashcards({ cards: [{ ...content.cards[0], back: '' }, content.cards[1]] }, [
      'Notes/TCP.md',
    ]),
  ).toThrow('required');
});
it('cancels immediately and ignores late replies from an uninterruptible provider', async () => {
  let reply!: (v: unknown) => void;
  const run = vi
    .fn<AgentRunner['run']>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    )
    .mockResolvedValue(content);
  const { service, notify } = setup(run);
  await service.load();
  await service.start(request);
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  service.cancel();
  await settled(service);
  expect(service.getSnapshot().job?.error).toBe('Cancelled.');
  reply(content);
  await Promise.resolve();
  expect(service.getSnapshot().batch?.cards).toEqual([]);
  expect(notify).not.toHaveBeenCalled();
  await service.generate();
  expect(service.getSnapshot().batch?.cards).toHaveLength(2);
  expect(notify).toHaveBeenCalledOnce();
});
it('restores review edits and flags after reload without making another AI call', async () => {
  const { service, files } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  const id = service.getSnapshot().batch!.cards[0]!.id;
  service.updateCard(id, { front: 'Edited question?', selected: false });
  await service.flush();
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().batch?.cards[0]).toMatchObject({
    front: 'Edited question?',
    selected: false,
  });
  expect(restored.run).not.toHaveBeenCalled();
});
it('restores an interrupted job as an explicit retry, without silently spending tokens', async () => {
  const { service, files } = setup(
    vi.fn<AgentRunner['run']>().mockImplementation(() => new Promise(() => {})),
  );
  await service.load();
  await service.start(request);
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().job?.error).toContain('interrupted');
  expect(restored.run).not.toHaveBeenCalled();
  service.dispose();
});
it('validates notes, names and empty requests before calling the agent', async () => {
  const { service, run, files } = setup();
  await service.load();
  for (const patch of [
    { deck: 'x'.repeat(201) },
    { deck: 'Two\nlines' },
    { notes: ['Gone.md'] },
    { prompt: '', notes: [] },
  ])
    await expect(service.start({ ...request, ...patch })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(files).toEqual({});
  expect(flashcardPrompt({ ...request, notes: [] })).toContain('Search the vault');
  expect(flashcardPrompt(request)).toContain('Notes/TCP.md');
});
it('a failed batch save preserves every draft and can be retried', async () => {
  const { service, writer } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  writer.createBatch.mockRejectedValueOnce(new Error('Disk full'));
  await service.addSelected();
  expect(service.getSnapshot()).toMatchObject({ saving: false, error: 'Disk full' });
  expect(service.getSnapshot().batch?.cards.every((c) => !c.added)).toBe(true);
  await service.addSelected();
  expect(service.getSnapshot().batch?.cards.every((c) => c.added)).toBe(true);
});
it('does not lose the review draft when clearing its saved file fails', async () => {
  const { service, write } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  write.mockRejectedValueOnce(new Error('Read only'));
  await expect(service.clear()).rejects.toThrow('Read only');
  expect(service.getSnapshot().batch?.cards).toHaveLength(2);
});
it('does not contact the provider when cancelled before the request write finishes', async () => {
  const { service, run } = setup();
  await service.load();
  await service.start(request);
  service.cancel();
  await settled(service);
  expect(run).not.toHaveBeenCalled();
  expect(service.getSnapshot().job?.error).toBe('Cancelled.');
});
it('does not contact the provider until the request can be saved', async () => {
  const { service, run, write } = setup();
  await service.load();
  write.mockRejectedValueOnce(new Error('Read only'));
  await expect(service.start(request)).rejects.toThrow('Read only');
  expect(run).not.toHaveBeenCalled();
  expect(service.getSnapshot().job?.error).toContain('Could not save the request');
  await service.generate();
  expect(service.getSnapshot().batch?.cards).toHaveLength(2);
});

it.each([1, 3, 101])(
  'accepts an AI-chosen batch of %i cards without a fixed target',
  async (length) => {
    const reply = {
      cards: Array.from({ length }, (_, i) => ({
        front: `Question ${i + 1}?`,
        back: `Answer ${i + 1}.`,
        source: 'Notes/TCP.md',
      })),
    };
    const run = vi.fn<AgentRunner['run']>().mockResolvedValue(reply),
      { service, notify } = setup(run);
    await service.load();
    await service.start(request);
    await settled(service);
    expect(service.getSnapshot().batch?.cards).toHaveLength(length);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0].prompt).toContain('Choose how many cards the material needs');
    expect(notify).toHaveBeenCalledWith(`${length} flashcards ready to review: Networks`);
  },
);
it('restores legacy count-based drafts without losing edits, selections or added cards', async () => {
  const { service, files } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  const cards = service.getSnapshot().batch!.cards;
  service.updateCard(cards[0]!.id, { selected: false, front: 'Edited question?' });
  await service.addSelected();
  await service.flush();
  const draft = JSON.parse(files['Qard/Flashcard drafts.json']!);
  draft.request.count = 2;
  files['Qard/Flashcard drafts.json'] = JSON.stringify(draft);
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().error).toBeUndefined();
  expect(restored.run).not.toHaveBeenCalled();
  expect(restored.service.getSnapshot().batch!.request).not.toHaveProperty('count');
  expect(restored.service.getSnapshot().batch!.cards).toEqual(service.getSnapshot().batch!.cards);
});
it('retries an interrupted legacy request with an AI-chosen count', async () => {
  const files = {
    'Qard/Flashcard drafts.json': JSON.stringify({
      id: 'old-batch',
      folder: 'Qard',
      request: { ...request, count: 40 },
      cards: [],
    }),
  };
  const run = vi.fn<AgentRunner['run']>().mockResolvedValue({ cards: [content.cards[0]] }),
    { service } = setup(run, files);
  await service.load();
  expect(service.getSnapshot().job?.error).toContain('interrupted');
  expect(run).not.toHaveBeenCalled();
  await service.generate();
  expect(service.getSnapshot().batch!.cards).toHaveLength(1);
  expect(run.mock.calls[0]![0].prompt).not.toContain('40');
  expect(JSON.parse(files['Qard/Flashcard drafts.json']).request).not.toHaveProperty('count');
});
it('generates from a description alone and persists the AI destination without requiring names in the request', async () => {
  const run = vi.fn<AgentRunner['run']>().mockResolvedValue({
    ...content,
    cards: content.cards.map((c) => ({ ...c, topic: 'Congestion control' })),
    deck: 'Computer Networks',
    topic: 'Congestion control',
  });
  const { service, writer, files } = setup(run);
  await service.load();
  await service.start({ prompt: 'Explain TCP congestion control', notes: [] });
  await settled(service);
  expect(run.mock.calls[0]![0].schema).toBe(flashcardBatchSchema);
  expect(purposeOf(flashcardBatchSchema)).toBe('Writing flashcards');
  expect(service.getSnapshot().batch?.request).not.toHaveProperty('deck');
  expect(service.getSnapshot().batch?.request).not.toHaveProperty('topic');
  expect(service.getSnapshot().batch?.destination).toEqual({
    deck: 'Computer Networks',
    topic: 'Congestion control',
  });
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().batch?.destination).toEqual(
    service.getSnapshot().batch?.destination,
  );
  await service.addSelected();
  expect(writer.createBatch.mock.calls[0]![0]).toMatchObject({
    deck: 'Computer Networks',
    topic: 'Congestion control',
  });
});
it('retries missing or unusable AI destinations before offering a draft', async () => {
  const run = vi
    .fn<AgentRunner['run']>()
    .mockResolvedValueOnce(content)
    .mockResolvedValueOnce({
      ...content,
      cards: content.cards.map((c) => ({ ...c, topic: 'Transport' })),
      deck: 'Networks',
      topic: 'Transport',
    });
  const { service } = setup(run);
  await service.load();
  await service.start({ prompt: 'TCP and UDP', notes: [] });
  await settled(service);
  expect(run).toHaveBeenCalledTimes(2);
  expect(service.getSnapshot().batch?.destination).toEqual({
    deck: 'Networks',
    topic: 'Transport',
  });
});
it('preserves an incomplete destination edit across reload and validates it only when adding', async () => {
  const { service, files } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  service.updateDestination({ deck: '' });
  await service.flush();
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().error).toBeUndefined();
  await restored.service.addSelected();
  expect(restored.writer.createBatch).not.toHaveBeenCalled();
  expect(restored.service.getSnapshot().error).toContain('Deck and topic');
  restored.service.updateDestination({ deck: 'Revision', topic: 'TCP basics' });
  await restored.service.addSelected();
  expect(restored.writer.createBatch.mock.calls[0]![0]).toMatchObject({
    deck: 'Revision',
    topic: 'TCP basics',
  });
});
it('locks the destination before a save attempt so retries cannot create the same batch in another deck', async () => {
  const { service, writer, files } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  service.updateDestination({ deck: 'Revision' });
  writer.createBatch.mockRejectedValueOnce(new Error('Index failed after write'));
  await service.addSelected();
  service.updateDestination({ deck: 'Another deck' });
  expect(service.getSnapshot().batch?.destination?.deck).toBe('Revision');
  const restored = setup(undefined, files);
  await restored.service.load();
  restored.service.updateDestination({ deck: 'Another deck' });
  await restored.service.addSelected();
  expect(restored.writer.createBatch.mock.calls[0]![0]).toMatchObject({ deck: 'Revision' });
});
it('restores old drafts with the explicit destination stored only in their request', async () => {
  const { service, files } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  await service.addSelected();
  const batch = JSON.parse(files['Qard/Flashcard drafts.json']!);
  delete batch.destination;
  delete batch.destinationLocked;
  files['Qard/Flashcard drafts.json'] = JSON.stringify(batch);
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().error).toBeUndefined();
  expect(restored.service.getSnapshot().batch?.cards.every((c) => c.added)).toBe(true);
});

it('preserves AI topics through edits, reload, selection and saving', async () => {
  const reply = {
    deck: 'Networks',
    topic: 'Lectures',
    cards: content.cards.map((c, i) => ({ ...c, topic: `Lecture ${i + 1}` })),
  };
  const { service, files } = setup(vi.fn<AgentRunner['run']>().mockResolvedValue(reply));
  await service.load();
  await service.start({ prompt: 'Separate topics for each lecture', notes: [] });
  await settled(service);
  const drafts = service.getSnapshot().batch!.cards;
  service.updateCard(drafts[0]!.id, { topic: 'Introduction' });
  service.updateCard(drafts[1]!.id, { selected: false });
  await service.flush();
  const restored = setup(undefined, files);
  await restored.service.load();
  await restored.service.addSelected();
  expect(restored.writer.createBatch.mock.calls[0]![1]).toEqual([
    expect.objectContaining({ topic: 'Introduction' }),
  ]);
  restored.service.updateCard(drafts[1]!.id, {
    topic: 'Cannot change after saving',
    selected: true,
  });
  expect(restored.service.getSnapshot().batch!.cards[1]?.topic).toBe('Lecture 2');
  restored.service.updateCard(drafts[1]!.id, { selected: true });
  await restored.service.addSelected();
  expect(restored.writer.createBatch.mock.calls[1]![1]).toEqual([
    expect.objectContaining({ topic: 'Lecture 2' }),
  ]);
});
it('splits a legacy unsaved draft by source note, disambiguates duplicate titles and preserves source-less cards', async () => {
  const sources = [
    'Notes/A/01_Introduction.md',
    'Notes/B/01_Introduction.md',
    'Notes/02_Agents.md',
    '',
  ];
  const batch = {
    id: 'old-batch',
    folder: 'Qard',
    request,
    destination: { deck: 'Networks', topic: 'Lectures 1–9' },
    cards: sources.map((source, i) => ({
      id: `card-${i}`,
      front: `Q${i}?`,
      back: 'Answer.',
      source,
      selected: i !== 2,
      added: false,
    })),
  };
  const { service, files, writer } = setup(undefined, {
    'Qard/Flashcard drafts.json': JSON.stringify(batch),
  });
  await service.load();
  service.useTopicsFromNotes();
  await service.flush();
  expect(service.getSnapshot().batch!.cards.map((c) => c.topic)).toEqual([
    'Notes/A/01 Introduction',
    'Notes/B/01 Introduction',
    '02 Agents',
    undefined,
  ]);
  expect(service.getSnapshot().batch!.cards[2]?.selected).toBe(false);
  const restored = setup(undefined, files);
  await restored.service.load();
  expect(restored.service.getSnapshot().batch!.cards).toEqual(service.getSnapshot().batch!.cards);
  await service.addSelected();
  expect(writer.createBatch.mock.calls[0]![1]).toHaveLength(3);
  const before = service.getSnapshot().batch!.cards;
  service.useTopicsFromNotes();
  expect(service.getSnapshot().batch!.cards).toBe(before);
});
it('requires individual AI topics and retries malformed topic names', async () => {
  const run = vi
    .fn<AgentRunner['run']>()
    .mockResolvedValueOnce({ ...content, deck: 'Networks', topic: 'Transport' })
    .mockResolvedValueOnce({
      ...content,
      deck: 'Networks',
      topic: 'Transport',
      cards: content.cards.map((c) => ({ ...c, topic: 'TCP' })),
    });
  const { service } = setup(run);
  await service.load();
  await service.start({ prompt: 'TCP', notes: [] });
  await settled(service);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]![0].prompt).toContain('topic is missing');
  expect(() =>
    readFlashcards({ cards: [{ ...content.cards[0], topic: 'Two\nlines' }] }, ['Notes/TCP.md']),
  ).toThrow('single lines');
});
it('keeps an explicitly selected topic for every card even if AI suggests others', async () => {
  const { service, writer } = setup(
    vi
      .fn<AgentRunner['run']>()
      .mockResolvedValue({ cards: content.cards.map((c) => ({ ...c, topic: 'Other' })) }),
  );
  await service.load();
  await service.start(request);
  await settled(service);
  await service.addSelected();
  expect(
    writer.createBatch.mock.calls[0]![1].every((c: { topic: string }) => c.topic === 'Transport'),
  ).toBe(true);
  expect(flashcardPrompt({ prompt: 'Separate topics', notes: [] })).toContain(
    'one topic per source note',
  );
});
it('keeps topics editable when a deselected card has no topic, before locking a save', async () => {
  const { service, writer } = setup();
  await service.load();
  await service.start(request);
  await settled(service);
  const drafts = service.getSnapshot().batch!.cards;
  service.updateCard(drafts[1]!.id, { topic: '', selected: false });
  await service.addSelected();
  expect(writer.createBatch).not.toHaveBeenCalled();
  expect(service.getSnapshot().batch!.destinationLocked).toBeFalsy();
  expect(service.getSnapshot().error).toContain('Card 2 needs a topic');
  service.updateCard(drafts[1]!.id, { topic: 'Transport' });
  await service.addSelected();
  expect(writer.createBatch).toHaveBeenCalledOnce();
});

it('keeps the note version supplied to generation when the note changes before cards are added', async () => {
  const files: Record<string, string> = { 'Notes/TCP.md': 'Original note.' },
    writer = { createBatch: vi.fn().mockResolvedValue([]) },
    run = vi.fn().mockResolvedValue(content);
  const capture = vi.fn(async (paths: string[]) =>
    paths.map((path) => ({ path, text: files[path] ?? null })),
  );
  const service = new FlashcardGenerationService(
    {
      read: async (p) => files[p] ?? null,
      write: async (p, text) => {
        files[p] = text;
      },
    },
    () => 'Qard',
    () => ['Notes/TCP.md'],
    () => ({ name: 'Writer', run }),
    writer,
    undefined,
    undefined,
    undefined,
    capture,
  );
  await service.load();
  await service.start(request);
  await settled(service);
  expect(run.mock.calls[0]?.[0].prompt).toContain('Original note.');
  files['Notes/TCP.md'] = 'Updated note.';
  await service.addSelected();
  expect(writer.createBatch.mock.calls[0]?.[1][0].sourceSnapshots).toEqual([
    { path: 'Notes/TCP.md', text: 'Original note.' },
  ]);
  const restored = new FlashcardGenerationService(
    { read: async (p) => files[p] ?? null, write: async () => {} },
    () => 'Qard',
    () => ['Notes/TCP.md'],
    () => ({ name: 'Writer', run }),
    writer,
  );
  await restored.load();
  expect(restored.getSnapshot().batch?.cards[0]?.sourceSnapshots?.[0]?.text).toBe('Original note.');
});
