// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { SourceSyncService, sourceNoteText } from '../src/cards/source-sync-service';
import { parseCards } from '../src/cards/parser';
import { replaceCardInSource } from '../src/cards/source-patch';
import { ReviewStore } from '../src/review/review-store';
import { memoryStatistics } from '../src/review/fsrs-scheduler';
import { scheduler } from '../src/review/scheduler';
import type { AgentRunner } from '../src/agents/runner';
import type { QardCard } from '../src/cards/card-types';
const initialCard = '<!-- qard-id: card-1 -->\n> [!qard]- What is the limit?\n> Ten.\n';
const suggestion = { front: 'What is the limit?', back: 'Twenty.', reason: 'The source now specifies twenty.', change: 'meaning' };
function setup(run = vi.fn<AgentRunner['run']>().mockResolvedValue(suggestion), files: Record<string, string> = { 'Notes/Limits.md': '# Limits\nThe limit is ten.\n', 'Cards.md': initialCard }) {
  const reviews = new ReviewStore(async () => {});
  const write = vi.fn(async (p: string, text: string) => { files[p] = text; });
  const cards = () => Object.entries(files).filter(([p]) => p.endsWith('.md')).flatMap(([p, text]) => parseCards(text, p).cards);
  const edit = vi.fn(async (card: QardCard, front: string, back: string) => { files[card.sourceFile] = replaceCardInSource(files[card.sourceFile]!, card, front, back, card.id); return cards().find(c => c.id === card.id)!; });
  const requireCheck = vi.fn((id: string) => reviews.requireContentCheck(id));
  const service = new SourceSyncService({ read: async p => files[p] ?? null, write }, 'Qard/Source links.json', cards, { edit }, requireCheck, () => ({ name: 'Writer', run }));
  const track = async () => { await service.track('card-1', await service.capture(['Notes/Limits.md'])); };
  return { service, reviews, files, run, cards, edit, requireCheck, write, track };
}
it('detects changes locally, persists a suggestion and only edits after approval', async () => {
  const { service, files, run, edit, reviews, track } = setup(); await track();
  await reviews.review('card-1', 3, Date.now() - 1000); const history = reviews.getSnapshot().history;
  files['Notes/Limits.md'] = '# Limits\nThe limit is twenty.\n'; await service.refresh();
  expect(service.getSnapshot().changes).toHaveLength(1); expect(run).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
  await service.suggest('card-1'); expect(edit).not.toHaveBeenCalled(); expect(service.getSnapshot().changes[0]?.proposal?.change).toBe('meaning');
  expect(run.mock.calls[0]?.[0]).toMatchObject({ vault: false }); expect(run.mock.calls[0]?.[0].prompt).toContain('The limit is ten.');
  await service.accept('card-1', suggestion.front, suggestion.back, true);
  expect(files['Cards.md']).toContain('> Twenty.'); expect(parseCards(files['Cards.md']!, 'Cards.md').cards[0]?.id).toBe('card-1');
  expect(service.getSnapshot().changes).toHaveLength(0); expect(reviews.getSnapshot().history).toEqual(history);
  expect(reviews.getSnapshot().states['card-1']?.needsContentCheck).toBe(true);
  expect(scheduler.isDue(reviews.getSnapshot().states['card-1'], Date.now())).toBe(true);
  expect(memoryStatistics(parseCards(files['Cards.md']!, 'Cards.md').cards, reviews.getSnapshot().states, Date.now(), .9).count).toBe(0);
  await reviews.review('card-1', 3); expect(reviews.getSnapshot().states['card-1']?.needsContentCheck).toBeUndefined();
});
it('keeps the full schedule and history for wording edits', async () => {
  const { service, files, reviews, track, requireCheck } = setup(vi.fn().mockResolvedValue({ ...suggestion, back: 'The limit is ten.', change: 'wording' }));
  await track(); await reviews.review('card-1', 4); const before = reviews.getSnapshot();
  files['Notes/Limits.md'] += '\nThe limit is a maximum.\n'; await service.suggest('card-1');
  await service.accept('card-1', suggestion.front, 'The limit is ten.', false);
  expect(reviews.getSnapshot()).toBe(before); expect(requireCheck).not.toHaveBeenCalled();
});
it('acknowledges an unrelated change without adding a review or changing the card', async () => {
  const { service, files, edit, track } = setup(); await track();
  files['Notes/Limits.md'] += '\nOther context.\n'; await service.refresh(); await service.keep('card-1');
  expect(service.getSnapshot().changes).toHaveLength(0); expect(edit).not.toHaveBeenCalled();
  files['Notes/Limits.md'] += '\nAnother change.\n'; await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(1);
});
it('invalidates stale suggestions when either the note or the card changes', async () => {
  const { service, files, track, edit } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; await service.suggest('card-1');
  files['Notes/Limits.md'] += '\nActually thirty.\n'; await service.refresh();
  expect(service.getSnapshot().changes[0]?.proposal).toBeUndefined();
  await expect(service.accept('card-1', suggestion.front, suggestion.back, true)).rejects.toThrow('changed'); expect(edit).not.toHaveBeenCalled();
  await service.suggest('card-1'); files['Cards.md'] = initialCard.replace('Ten.', 'My own answer.'); await service.refresh();
  expect(service.getSnapshot().changes[0]?.proposal).toBeUndefined(); await expect(service.accept('card-1', suggestion.front, suggestion.back, true)).rejects.toThrow('changed');
});
it('rejects a reply when source notes change during the AI request', async () => {
  let reply!: (v: unknown) => void;
  const { service, files, track, run } = setup(vi.fn().mockImplementation(() => new Promise(resolve => { reply = resolve; })));
  await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; const pending = service.suggest('card-1'); pending.catch(() => {});
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce()); files['Notes/Limits.md'] += '\nThirty.\n'; reply(suggestion);
  await expect(pending).rejects.toThrow('changed while'); expect(service.getSnapshot().links['card-1']?.proposal).toBeUndefined();
});
it('cancels immediately and ignores late provider replies', async () => {
  let reply!: (v: unknown) => void;
  const { service, files, track, run } = setup(vi.fn().mockImplementation(() => new Promise(resolve => { reply = resolve; })));
  await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; const pending = service.suggest('card-1'); const rejected = expect(pending).rejects.toThrow('Cancelled');
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce()); service.cancel('card-1'); await rejected; reply(suggestion); await Promise.resolve();
  expect(service.getSnapshot().links['card-1']?.proposal).toBeUndefined(); expect(service.getSnapshot().busy).toEqual([]);
});
it('restores pending changes and prepared suggestions after a reload', async () => {
  const { service, files, track } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; await service.suggest('card-1');
  const restored = setup(undefined, files); await restored.service.load(); await restored.service.refresh();
  expect(restored.service.getSnapshot().changes[0]?.proposal?.back).toBe('Twenty.'); expect(restored.run).not.toHaveBeenCalled();
});
it('deduplicates source versions for many generated cards', async () => {
  const { service, files } = setup(); const versions = await service.capture(['Notes/Limits.md']);
  await service.track('card-1', versions); await service.track('card-2', versions);
  const saved = JSON.parse(files['Qard/Source links.json']!); expect(Object.keys(saved.notes)).toHaveLength(1); expect(saved.links['card-1'].sources).toEqual(saved.links['card-2'].sources);
});
it('retains source links across a note or folder rename and reports deleted sources', async () => {
  const { service, files, track, run } = setup(); await track(); files['New/Limits.md'] = files['Notes/Limits.md']!; delete files['Notes/Limits.md'];
  await service.rename('Notes', 'New'); expect(service.getSnapshot().changes).toHaveLength(0); expect(service.getSnapshot().links['card-1']?.sources[0]?.path).toBe('New/Limits.md');
  delete files['New/Limits.md']; await service.refresh(); expect(service.getSnapshot().changes[0]?.sources[0]?.after).toBeNull();
  await expect(service.suggest('card-1')).rejects.toThrow('missing'); expect(run).not.toHaveBeenCalled();
  await service.keep('card-1'); await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(0);
});
it('never edits a deleted card or a duplicated ID', async () => {
  const { service, files, track, run } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; files['Copy.md'] = initialCard;
  await expect(service.suggest('card-1')).rejects.toThrow('shares an ID'); expect(run).not.toHaveBeenCalled();
  delete files['Copy.md']; delete files['Cards.md']; await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(0);
});
it('finishes a partially saved update after reload without editing the card twice', async () => {
  const { service, files, track, requireCheck, edit } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; await service.suggest('card-1');
  requireCheck.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(service.accept('card-1', suggestion.front, suggestion.back, true)).rejects.toThrow('unavailable'); expect(edit).toHaveBeenCalledOnce();
  const restored = setup(undefined, files); await restored.service.load(); await restored.service.refresh();
  expect(restored.service.getSnapshot().changes[0]?.applying).toBeDefined();
  await restored.service.accept('card-1', '', '', false); expect(restored.edit).not.toHaveBeenCalled(); expect(restored.requireCheck).toHaveBeenCalledOnce();
  expect(restored.service.getSnapshot().changes).toHaveLength(0);
});
it('leaves the card untouched if the update journal cannot be saved', async () => {
  const { service, files, track, edit, write } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n'; await service.suggest('card-1');
  write.mockRejectedValueOnce(new Error('Disk full')); await expect(service.accept('card-1', suggestion.front, suggestion.back, true)).rejects.toThrow('Disk full');
  expect(edit).not.toHaveBeenCalled(); expect(service.getSnapshot().links['card-1']?.applying).toBeUndefined();
  await service.accept('card-1', suggestion.front, suggestion.back, true); expect(edit).toHaveBeenCalledOnce();
});
it('does not hide source failures or overwrite corrupt tracking metadata', async () => {
  const { service, write } = setup(undefined, { 'Qard/Source links.json': '{invalid' }); await service.load();
  expect(service.getSnapshot().error).toContain('Could not load'); await expect(service.track('card-1', [{ path: 'a.md', text: 'Text' }])).rejects.toThrow('Could not load'); expect(write).not.toHaveBeenCalled();
});
it('ignores its own card edits in a source note while detecting other card changes', async () => {
  const other = '<!-- qard-id: other -->\n> [!qard]- Other fact?\n> Original.\n';
  const { service, files, cards } = setup(undefined, { 'Cards.md': '# Limits\nThe limit is ten.\n\n' + initialCard + '\n' + other });
  await service.track('card-1', await service.capture(['Cards.md']));
  files['Cards.md'] = files['Cards.md']!.replace('> Ten.', '> My own edit.'); await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(0);
  files['Cards.md'] = files['Cards.md']!.replace('> Original.', '> Changed.'); await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(1);
  expect(sourceNoteText(files['Cards.md']!, 'Cards.md', ['card-1'])).not.toContain('My own edit.'); expect(cards()).toHaveLength(2);
});
it('retains the generated source version when tracking is retried after the source changed', async () => {
  const { service, files, track } = setup(); await track(); files['Notes/Limits.md'] += '\nTwenty.\n';
  await service.track('card-1', await service.capture(['Notes/Limits.md'])); await service.refresh(); expect(service.getSnapshot().changes).toHaveLength(1);
});
it('rejects hidden and non-vault source paths', async () => {
  const { service } = setup();
  for (const path of ['../a.md', '/a.md', '.obsidian/a.md', 'C:/a.md', 'a.pdf']) await expect(service.capture([path])).rejects.toThrow('ordinary Markdown');
});
