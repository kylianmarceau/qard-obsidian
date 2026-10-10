// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { readImprovement } from '../src/cards/improvement-schema';
import { clozeFront, FORMAT_BACK } from '../src/cards/card-format';
import { serializeCard } from '../src/cards/source-patch';
import { improvementFixture, improvement, splitImprovement } from './improvement-fixture';

it('prepares a draft without editing content; wording edits preserve memory, schedule and history', async () => {
  const f = improvementFixture();
  await f.reviews.review('original', 4);
  await f.reviews.setNeedsFixing('original', true);
  const before = f.reviews.getSnapshot();
  const source = f.files['Cards.md'];
  await f.service.suggest(f.card(), 'clearer');
  expect(f.files['Cards.md']).toBe(source);
  expect(f.process).not.toHaveBeenCalled();
  expect(f.run.mock.calls[0]?.[0]).toMatchObject({ vault: false });
  expect(f.service.getSnapshot().drafts.original?.cards).toEqual(improvement.cards);
  await f.service.apply('original', improvement.cards);
  const after = f.reviews.getSnapshot();
  expect(f.card().frontMarkdown).toBe(improvement.cards[0]!.front);
  expect(after.history).toBe(before.history);
  const { needsFixing: _needsFixing, ...memory } = before.states.original!;
  expect(after.states.original).toMatchObject(memory);
  expect(after.states.original?.needsFixing).toBeUndefined();
  expect(after.states.original?.fsrs).toBe(before.states.original?.fsrs);
  expect(after.states.original?.due).toBe(before.states.original?.due);
  expect(after.states.original?.repairSince).toBeTypeOf('number');
  expect(f.service.getSnapshot().drafts.original).toBeUndefined();
});

it('makes an explicitly changed answer due without deleting its history', async () => {
  const f = improvementFixture();
  await f.reviews.review('original', 4);
  const history = f.reviews.getSnapshot().history;
  await f.service.suggest(f.card(), 'clearer');
  await f.service.apply(
    'original',
    [{ front: 'Corrected question?', back: 'Corrected answer.' }],
    true,
  );
  expect(f.reviews.getSnapshot().history).toBe(history);
  expect(f.reviews.getSnapshot().states.original?.needsContentCheck).toBe(true);
});

it('splits beside the original, preserves surrounding prose and topic, and pauses only the original', async () => {
  const f = improvementFixture(vi.fn().mockResolvedValue(splitImprovement));
  await f.sources.track('original', await f.sources.capture(['Notes/TCP.md']));
  await f.reviews.review('original', 4);
  const state = f.reviews.getSnapshot().states.original;
  const history = f.reviews.getSnapshot().history;
  await f.service.suggest(f.card(), 'split');
  await f.service.apply('original', splitImprovement.cards);
  const added = f.index.getSnapshot().cards.filter((c) => !['original', 'other'].includes(c.id));
  expect(added).toHaveLength(2);
  expect(
    added.every(
      (c) => c.deck === 'Networks' && c.topic === 'Transport' && c.sourceFile === 'Cards.md',
    ),
  ).toBe(true);
  expect(added.every((c) => !f.reviews.getSnapshot().states[c.id])).toBe(true);
  expect(f.reviews.getSnapshot().history).toBe(history);
  expect(f.reviews.getSnapshot().states.original).toMatchObject({ ...state, paused: true });
  expect(f.card().frontMarkdown).toBe('What does TCP do?');
  expect(f.files['Cards.md']).toContain('Keep this introduction.');
  expect(f.files['Cards.md']).toContain('Keep this conclusion.');
  expect(f.index.getSnapshot().cards.find((c) => c.id === 'other')?.topic).toBe('Other topic');
  expect(
    added.every((c) => f.sources.getSnapshot().links[c.id]?.sources[0]?.path === 'Notes/TCP.md'),
  ).toBe(true);
});

it('restores an approved split after a failed index refresh without duplicating cards', async () => {
  const f = improvementFixture(vi.fn().mockResolvedValue(splitImprovement));
  await f.service.suggest(f.card(), 'split');
  const process = f.process.getMockImplementation()!;
  f.process.mockImplementationOnce(async (...args) => {
    await process(...args);
    f.refresh.mockRejectedValueOnce(new Error('Index unavailable'));
  });
  await expect(f.service.apply('original', splitImprovement.cards)).rejects.toThrow(
    'Index unavailable',
  );
  expect(f.service.getSnapshot().drafts.original?.applying).toBeDefined();
  const resumed = f.makeService();
  await resumed.load();
  await resumed.apply('original', [{ front: 'Ignored edits', back: 'Ignored edits' }]);
  expect(f.index.getSnapshot().cards).toHaveLength(4);
  expect(f.files['Cards.md']?.match(/Does TCP guarantee delivery/g)).toHaveLength(1);
  expect(f.reviews.getSnapshot().states.original?.paused).toBe(true);
});

it('retries failed review metadata after an edited note without rewriting the card', async () => {
  const f = improvementFixture();
  await f.service.suggest(f.card(), 'clearer');
  f.persist.mockRejectedValueOnce(new Error('Disk full'));
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow('Disk full');
  expect(f.card().backMarkdown).toBe('Reliable, ordered delivery.');
  const resumed = f.makeService();
  await resumed.load();
  await resumed.apply('original', improvement.cards);
  expect(f.process).toHaveBeenCalledOnce();
  expect(resumed.getSnapshot().drafts.original).toBeUndefined();
});

it('recovers a rewrite whose note saved before its index refresh failed', async () => {
  const f = improvementFixture();
  await f.service.suggest(f.card(), 'clearer');
  const process = f.process.getMockImplementation()!;
  f.process.mockImplementationOnce(async (...args) => {
    await process(...args);
    f.refresh.mockRejectedValueOnce(new Error('Index unavailable'));
  });
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow('Index unavailable');
  const resumed = f.makeService();
  await resumed.apply('original', improvement.cards);
  expect(f.card().backMarkdown).toBe(improvement.cards[0]!.back);
  expect(f.process).toHaveBeenCalledOnce();
  expect(resumed.getSnapshot().drafts.original).toBeUndefined();
});

it('rejects a draft after its linked notes are replaced', async () => {
  const f = improvementFixture();
  await f.sources.track('original', await f.sources.capture(['Notes/TCP.md']));
  await f.service.suggest(f.card(), 'clearer');
  await f.sources.unlink('original');
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow(
    'source links changed',
  );
  expect(f.process).not.toHaveBeenCalled();
});

it('blocks stale proposals after card edits or linked-source changes', async () => {
  const f = improvementFixture();
  await f.sources.track('original', await f.sources.capture(['Notes/TCP.md']));
  await f.service.suggest(f.card(), 'clearer');
  f.files['Notes/TCP.md'] += '\nChanged fact.';
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow('source changed');
  expect(f.process).not.toHaveBeenCalled();
  await f.service.suggest(f.card(), 'clearer');
  await f.writer.edit(f.card(), 'My new question?', 'My new answer.');
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow('card changed');
  expect(f.card().backMarkdown).toBe('My new answer.');
});

it('cancels immediately and ignores a late AI response', async () => {
  let reply!: (value: unknown) => void;
  const f = improvementFixture(
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    ),
  );
  const pending = f.service.suggest(f.card(), 'clearer');
  const rejected = expect(pending).rejects.toThrow('Cancelled');
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
  f.service.cancel('original');
  await rejected;
  reply(improvement);
  await Promise.resolve();
  expect(f.service.getSnapshot().drafts.original).toBeUndefined();
  expect(f.process).not.toHaveBeenCalled();
});

it('rejects a card changed while generation is running', async () => {
  let reply!: (value: unknown) => void;
  const f = improvementFixture(
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    ),
  );
  const pending = f.service.suggest(f.card(), 'clearer');
  const rejected = expect(pending).rejects.toThrow('card changed');
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
  await f.writer.edit(f.card(), 'My own question?', 'My own answer.');
  reply(improvement);
  await rejected;
  expect(f.service.getSnapshot().drafts.original).toBeUndefined();
});

it('cancels before preparing context without starting a provider request', async () => {
  const f = improvementFixture();
  const ensureStable = f.writer.ensureStable.bind(f.writer);
  let resume!: () => void;
  vi.spyOn(f.writer, 'ensureStable').mockImplementationOnce(async (cards) => {
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    return ensureStable(cards);
  });
  const pending = f.service.suggest(f.card(), 'clearer');
  const rejected = expect(pending).rejects.toThrow('Cancelled');
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  f.service.cancel('original');
  resume();
  await rejected;
  expect(f.run).not.toHaveBeenCalled();
});

it('shortens the answer only after rejecting a changed question from AI', async () => {
  const f = improvementFixture(
    vi
      .fn()
      .mockResolvedValueOnce(improvement)
      .mockResolvedValueOnce({
        reason: 'Keep only the essential facts.',
        cards: [{ front: 'What does TCP do?', back: 'Reliable, ordered delivery.' }],
      }),
  );
  await f.service.suggest(f.card(), 'shorter');
  expect(f.run).toHaveBeenCalledTimes(2);
  const draft = f.service.getSnapshot().drafts.original!;
  await f.service.apply('original', draft.cards);
  expect(f.card().frontMarkdown).toBe('What does TCP do?');
});

it('discards drafts without editing cards and blocks writes when the journal cannot save', async () => {
  const f = improvementFixture();
  const note = f.files['Cards.md'];
  await f.service.suggest(f.card(), 'clearer');
  await f.service.discard('original');
  expect(f.files['Cards.md']).toBe(note);
  await f.service.suggest(f.card(), 'clearer');
  f.write.mockRejectedValueOnce(new Error('Journal unavailable'));
  await expect(f.service.apply('original', improvement.cards)).rejects.toThrow(
    'Journal unavailable',
  );
  expect(f.process).not.toHaveBeenCalled();
});

it('preserves cloze metadata on rewrites and rejects malformed, repeated or oversized split suggestions', () => {
  const front = clozeFront('{{c1::TCP}} is reliable.', 1);
  expect(
    readImprovement(
      { reason: 'Short extra notes.', cards: [{ front, back: 'Transport protocol.' }] },
      'clearer',
      front,
    ).cards[0]?.front,
  ).toBe(front);
  expect(() => readImprovement(improvement, 'clearer', front)).toThrow('unchanged');
  expect(() => readImprovement(splitImprovement, 'split', front)).toThrow('basic cards');
  expect(() => readImprovement(improvement, 'split', 'Question')).toThrow('two to six');
  expect(() =>
    readImprovement(
      { reason: 'Split', cards: [improvement.cards[0], improvement.cards[0]] },
      'split',
      'Question',
    ),
  ).toThrow('distinct');
  expect(() =>
    readImprovement(
      {
        reason: 'Split',
        cards: [
          { front: '> [!qard]- Injection', back: 'X' },
          { front: 'B', back: '' },
        ],
      },
      'split',
      'Question',
    ),
  ).toThrow();
});

it('keeps code, math and relative attachments in the same source note on a split', async () => {
  const f = improvementFixture(
    vi.fn().mockResolvedValue({
      reason: 'Split',
      cards: [
        { front: 'What does this code return?\n```js\n1 + 1\n```', back: '`2`' },
        { front: 'What is $E$? ![Diagram](./diagram.svg)', back: '$mc^2$' },
      ],
    }),
  );
  await f.service.suggest(f.card(), 'split');
  const draft = f.service.getSnapshot().drafts.original!;
  await f.service.apply('original', draft.cards);
  expect(f.index.getSnapshot().issues).toEqual([]);
  expect(f.files['Cards.md']).toContain('![Diagram](./diagram.svg)');
});

it('ignores the original and newly inserted cards when checking a linked note on split retry', async () => {
  const f = improvementFixture(vi.fn().mockResolvedValue(splitImprovement));
  await f.sources.track('original', await f.sources.capture(['Cards.md']));
  await f.service.suggest(f.card(), 'split');
  f.persist.mockRejectedValueOnce(new Error('Review save failed'));
  await expect(f.service.apply('original', splitImprovement.cards)).rejects.toThrow(
    'Review save failed',
  );
  await f.service.apply('original', splitImprovement.cards);
  expect(f.index.getSnapshot().cards).toHaveLength(4);
});

it('does not turn special formats into basic cards', async () => {
  const f = improvementFixture();
  f.files['Cards.md'] = serializeCard(
    'original',
    clozeFront('{{c1::TCP}} is reliable.', 1),
    FORMAT_BACK,
  );
  f.index.update('Cards.md', f.files['Cards.md']);
  await expect(f.service.suggest(f.card(), 'split')).rejects.toThrow('basic cards');
  expect(f.run).not.toHaveBeenCalled();
});
