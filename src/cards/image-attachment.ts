import { TFile, type App } from 'obsidian';
import { IMAGE_EXTENSIONS } from './card-format';

export function imageResource(app: App, image: string, sourcePath: string): string | undefined {
  const file =
    app.vault.getAbstractFileByPath(image) ??
    app.metadataCache.getFirstLinkpathDest(image, sourcePath);
  return file instanceof TFile && IMAGE_EXTENSIONS.test(file.path)
    ? app.vault.getResourcePath(file)
    : undefined;
}

/** Use Obsidian's attachment location and collision handling, just like pasting into a note. */
export async function attachImage(app: App, file: File, sourcePath: string): Promise<string> {
  if (!IMAGE_EXTENSIONS.test(file.name)) {
    throw new Error('Choose a PNG, JPEG, GIF, WebP, SVG or AVIF image.');
  }
  if (!file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 20 MB.');
  }
  const name = file.name.replace(/[\\/:*?"<>|#^[\]]/g, '-');
  const data = await file.arrayBuffer();
  const path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
  const saved = await app.vault.createBinary(path, data);
  return saved.path;
}
