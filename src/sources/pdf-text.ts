/** PDFs become plain text with one marker line per page, so prompts can cite pages and source checks can compare versions line by line. */

/** No page total in the marker: a page added at the end leaves the earlier text unchanged. */
export const pageMarker = (page: number) => `[Page ${page}]`;
const MARKER = /^\[Page (\d+)\]$/;

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
/** About 250,000 tokens: more than one request should carry from a single source. */
export const MAX_PDF_CHARS = 1_000_000;

/** The parts of PDF.js this file uses; Obsidian bundles the library and loads it on request. */
export interface PdfJs {
  getDocument(source: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
  }): PdfLoadingTask;
}
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
}
interface PdfPage {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup?(): unknown;
}

/** Joins text items into lines. A line ends where PDF.js marks one, or where the baseline moves when it doesn't say. */
export function pageText(items: readonly unknown[]): string {
  const lines: string[] = [];
  let line = '',
    baseline: number | undefined;
  for (const raw of items) {
    const item = raw as { str?: unknown; hasEOL?: unknown; transform?: unknown } | null;
    // Marked-content items carry no text.
    if (typeof item?.str !== 'string') {
      continue;
    }
    const y = Array.isArray(item.transform) ? (item.transform[5] as unknown) : undefined;
    if (
      item.hasEOL === undefined &&
      typeof y === 'number' &&
      baseline !== undefined &&
      Math.abs(y - baseline) > 1
    ) {
      lines.push(line);
      line = '';
    }
    line += item.str;
    if (typeof y === 'number') {
      baseline = y;
    }
    if (item.hasEOL === true) {
      lines.push(line);
      line = '';
    }
  }
  lines.push(line);
  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function documentText(pages: readonly string[]): string {
  return pages
    .map((text, i) => (text ? `${pageMarker(i + 1)}\n${text}` : pageMarker(i + 1)))
    .join('\n\n');
}

/** The pages of documentText, for reading a long PDF a few pages at a time. */
export function splitPages(text: string): { page: number; text: string }[] {
  const pages: { page: number; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const marker = MARKER.exec(line);
    if (marker) {
      pages.push({ page: Number(marker[1]), lines: [] });
    } else if (pages.length) {
      pages.at(-1)!.lines.push(line);
    } else {
      pages.push({ page: 1, lines: [line] });
    }
  }
  return pages.map((p) => ({ page: p.page, text: p.lines.join('\n').trim() }));
}

const failure = (path: string, error: unknown) => {
  const kind = (error as { name?: unknown } | null)?.name;
  if (kind === 'PasswordException') {
    return new Error(`${path} is password-protected. Remove the password to use it in Qard.`);
  }
  if (kind === 'InvalidPDFException') {
    return new Error(`${path} is not a valid PDF, so Qard can't read it.`);
  }
  return new Error(
    `Qard could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
  );
};

/** Extracts each page's text. Nothing is rendered: fonts aren't loaded, and PDF.js may not evaluate code from the file. */
export async function extractPdfPages(
  pdfjs: PdfJs,
  data: ArrayBuffer,
  path: string,
): Promise<string[]> {
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`${path} is larger than 100 MB, so Qard can't read it.`);
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const pages: string[] = [];
    let chars = 0;
    try {
      const doc = await task.promise;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const text = pageText((await page.getTextContent()).items);
        page.cleanup?.();
        chars += text.length;
        if (chars > MAX_PDF_CHARS) {
          break;
        }
        pages.push(text);
      }
    } catch (error) {
      throw failure(path, error);
    }
    if (chars > MAX_PDF_CHARS) {
      throw new Error(
        `${path} is too long to use as one source (Qard reads up to about 1,000,000 characters from a PDF). Use a shorter PDF, such as a single chapter.`,
      );
    }
    if (!pages.some(Boolean)) {
      throw new Error(
        `${path} has no selectable text, so Qard can't read it. If it is a scan, use a version with recognised text (OCR).`,
      );
    }
    return pages;
  } finally {
    await task.destroy().catch(() => {});
  }
}
