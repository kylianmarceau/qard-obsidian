import type { Annotation, AnnotationKind } from './test-types';

export interface Segment {
  text: string;
  kind?: AnnotationKind;
  note?: number;
}
export interface Placed {
  segments: Segment[];
  notes: (Annotation & { n: number; placed: boolean })[];
}

/** Find a quote even when the agent normalised whitespace or case. Returns [start, end) or undefined. */
function locate(text: string, quote: string, from: number): [number, number] | undefined {
  if (!quote) {
    return undefined;
  }
  const exact = text.indexOf(quote, from);
  if (exact >= 0) {
    return [exact, exact + quote.length];
  }
  const pattern = quote
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  if (!pattern) {
    return undefined;
  }
  const match = new RegExp(pattern, 'i').exec(text.slice(from));
  return match ? [from + match.index, from + match.index + match[0].length] : undefined;
}

/**
 * Anchors the marker's notes to the answer, like a marked script. Highlights must not overlap;
 * a "missing" note marks the point after its quote (or the end when the quote is empty).
 * Notes that cannot be placed are still listed.
 */
export function placeAnnotations(text: string, annotations: Annotation[]): Placed {
  const spans: { start: number; end: number; n: number; kind: AnnotationKind }[] = [];
  const notes = annotations.map((a, i) => ({ ...a, n: i + 1, placed: false }));
  // Highlights first, so a missing point that lands inside one can move to its end.
  for (const note of notes) {
    if (note.kind === 'missing') {
      continue;
    }
    let from = 0,
      range = locate(text, note.quote, from);
    while (
      range &&
      spans.some((s) => s.end > s.start && range![0] < s.end && s.start < range![1])
    ) {
      from = range[0] + 1;
      range = locate(text, note.quote, from);
    }
    if (range) {
      spans.push({ start: range[0], end: range[1], n: note.n, kind: note.kind });
      note.placed = true;
    }
  }
  for (const note of notes) {
    if (note.kind !== 'missing') {
      continue;
    }
    let at = note.quote ? locate(text, note.quote, 0)?.[1] : text.length;
    if (at === undefined) {
      continue;
    }
    const inside = spans.find((s) => s.end > s.start && s.start < at! && at! < s.end);
    if (inside) {
      at = inside.end;
    }
    spans.push({ start: at, end: at, n: note.n, kind: 'missing' });
    note.placed = true;
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start) });
    }
    segments.push({ text: text.slice(span.start, span.end), kind: span.kind, note: span.n });
    cursor = span.end;
  }
  if (cursor < text.length || !segments.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return { segments, notes };
}
