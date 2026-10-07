import { expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { attachImage, imageResource } from '../src/cards/image-attachment';
const file = (path: string) => new (TFile as unknown as new (p: string) => TFile)(path);
it('resolves vault-relative and source-relative attachments through Obsidian, without a network request', () => {
  const diagram = file('Attachments/diagram.png');
  const resolve = vi.fn().mockReturnValue(diagram);
  const resource = vi.fn().mockReturnValue('app://local-image/diagram.png');
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === diagram.path ? diagram : undefined),
      getResourcePath: resource,
    },
    metadataCache: { getFirstLinkpathDest: resolve },
  } as unknown as App;
  expect(imageResource(app, diagram.path, 'Notes/Card.md')).toBe('app://local-image/diagram.png');
  expect(resolve).not.toHaveBeenCalled();
  expect(imageResource(app, 'diagram.png', 'Notes/Card.md')).toBe('app://local-image/diagram.png');
  expect(resolve).toHaveBeenCalledWith('diagram.png', 'Notes/Card.md');
});
it('handles missing attachments and rejects non-image resources', () => {
  const app = {
    vault: { getAbstractFileByPath: () => null, getResourcePath: vi.fn() },
    metadataCache: { getFirstLinkpathDest: () => null },
  } as unknown as App;
  expect(imageResource(app, 'missing.png', 'Cards.md')).toBeUndefined();
  app.vault.getAbstractFileByPath = () => file('notes.md');
  expect(imageResource(app, 'notes.md', 'Cards.md')).toBeUndefined();
  expect(app.vault.getResourcePath).not.toHaveBeenCalled();
});
it('adds image bytes at Obsidian’s deduplicated attachment location and never overwrites a file', async () => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  const path = 'Attachments/Diagram 1.png';
  const available = vi.fn().mockResolvedValue(path);
  const create = vi.fn().mockResolvedValue(file(path));
  const app = {
    fileManager: { getAvailablePathForAttachment: available },
    vault: { createBinary: create },
  } as unknown as App;
  const upload = { name: 'Diagram.png', size: 3, arrayBuffer: async () => data } as File;
  expect(await attachImage(app, upload, 'Notes/Card.md')).toBe(path);
  expect(available).toHaveBeenCalledWith('Diagram.png', 'Notes/Card.md');
  expect(create).toHaveBeenCalledWith(path, data);
});
it.each([
  { name: 'not-an-image.pdf', size: 5 },
  { name: 'empty.png', size: 0 },
  { name: 'huge.jpg', size: 21 * 1024 * 1024 },
])('rejects unsupported or invalid uploads before changing the vault', async (upload) => {
  const available = vi.fn();
  const app = { fileManager: { getAvailablePathForAttachment: available } } as unknown as App;
  await expect(attachImage(app, upload as File, 'Cards.md')).rejects.toThrow();
  expect(available).not.toHaveBeenCalled();
});
