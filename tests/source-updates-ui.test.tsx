// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { SourceUpdates, changedPassage } from '../src/components/SourceUpdates';
import { SourceSyncService } from '../src/cards/source-sync-service';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import { replaceCardInSource } from '../src/cards/source-patch';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('shows changed passages, editable suggestions, and approval before applying an update', async () => {
  const files: Record<string, string> = { 'Notes.md': '# Threshold\nMaximum is ten.\n', 'Cards.md': '<!-- qard-id: c1 -->\n> [!qard]- Maximum?\n> Ten.\n' };
  const cards = () => parseCards(files['Cards.md']!, 'Cards.md').cards, reviews = new ReviewStore(async () => {});
  const edit = vi.fn(async (card, front, back) => { files['Cards.md'] = replaceCardInSource(files['Cards.md']!, card, front, back, card.id); return cards()[0]!; });
  const run = vi.fn().mockResolvedValue({ front: 'Maximum?', back: 'Twenty.', reason: 'The threshold changed.', change: 'meaning' });
  const sourceSync = new SourceSyncService({ read: async p => files[p] ?? null, write: async (p, text) => { files[p] = text; } }, 'Qard/Source links.json', cards, { edit }, id => reviews.requireContentCheck(id), () => ({ name: 'Writer', run }));
  await sourceSync.track('c1', await sourceSync.capture(['Notes.md'])); files['Notes.md'] = '# Threshold\nMaximum is twenty.\n'; await sourceSync.refresh();
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  const services = { host, sourceSync, reviews, owner: new Component(), app: { workspace: { openLinkText: vi.fn() } }, openSource: vi.fn() } as unknown as QardServices;
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name)!;
  try {
    await act(async () => root.render(<SourceUpdates services={services} back={vi.fn()}/>));
    expect(host.textContent).toContain('Previous passage'); expect(host.textContent).toContain('Maximum is ten.'); expect(host.textContent).toContain('Maximum is twenty.'); expect(run).not.toHaveBeenCalled();
    await act(async () => { button('Suggest an update').click(); await vi.waitFor(() => expect(sourceSync.getSnapshot().changes[0]?.proposal).toBeDefined()); }); expect(edit).not.toHaveBeenCalled();
    const field = host.querySelector('[aria-label="Updated answer"]') as HTMLTextAreaElement;
    await act(async () => { field.value = 'Twenty, according to the updated note.'; field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    await act(async () => { button('Apply update').click(); await vi.waitFor(() => expect(sourceSync.getSnapshot().changes).toHaveLength(0)); }); expect(files['Cards.md']).toContain('Twenty, according to the updated note.'); expect(reviews.getSnapshot().states.c1?.needsContentCheck).toBe(true);
    expect(host.textContent).toContain('No source updates to review');
  } finally { await act(async () => root.unmount()); host.remove(); sourceSync.dispose(); }
});
it('shows nearby context for insertions and deletions without requiring full-note comparison', () => {
  const before = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].join('\n');
  expect(changedPassage(before, before.replace('Four', 'New four'))).toEqual({ before: 'Two\nThree\nFour\nFive\nSix', after: 'Two\nThree\nNew four\nFive\nSix' });
  expect(changedPassage('Old', null)).toEqual({ before: 'Old', after: '' });
});
