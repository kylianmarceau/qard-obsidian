import { TFile, loadPdfJs, type App } from 'obsidian';
import { MAX_PDF_BYTES, documentText, extractPdfPages, type PdfJs } from './pdf-text';

/** Text kept for recently read PDFs, so repeated source checks don't extract them again. */
const CACHE_CHARS = 4_000_000;

/** Reads vault PDFs as page-marked text, cached by file version. */
export class PdfReader {
  private cache = new Map<string, { version: string; text: Promise<string>; chars: number }>();
  constructor(
    private app: App,
    private pdfjs: () => Promise<PdfJs> = () => loadPdfJs() as Promise<PdfJs>,
  ) {}
  /** Null when the file is missing, as for a note. */
  async read(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    const version = `${file.stat.mtime}:${file.stat.size}`,
      cached = this.cache.get(path);
    if (cached?.version === version) {
      this.cache.delete(path);
      this.cache.set(path, cached);
      return cached.text;
    }
    const entry = { version, text: this.extract(file), chars: 0 };
    this.cache.set(path, entry);
    try {
      const text = await entry.text;
      entry.chars = text.length;
      this.trim();
      return text;
    } catch (error) {
      if (this.cache.get(path) === entry) {
        this.cache.delete(path);
      }
      throw error;
    }
  }
  private async extract(file: TFile) {
    if (file.stat.size > MAX_PDF_BYTES) {
      throw new Error(`${file.path} is larger than 100 MB, so Qard can't read it.`);
    }
    const [pdfjs, data] = await Promise.all([this.pdfjs(), this.app.vault.readBinary(file)]);
    return documentText(await extractPdfPages(pdfjs, data, file.path));
  }
  /** Drops the least recently read PDFs once the cache holds too much text. */
  private trim() {
    let total = [...this.cache.values()].reduce((sum, e) => sum + e.chars, 0);
    for (const [path, entry] of this.cache) {
      if (total <= CACHE_CHARS || this.cache.size <= 1) {
        break;
      }
      this.cache.delete(path);
      total -= entry.chars;
    }
  }
}
