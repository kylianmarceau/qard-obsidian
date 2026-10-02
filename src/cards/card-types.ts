export interface ImageMask { x: number; y: number; width: number; height: number }
/** Image coordinates are percentages, independent of display size. */
export type CardFormat = { type: 'cloze' } | { type: 'occlusion'; image: string; masks: ImageMask[] };
export interface QardCard {
  /** Persistent ID, or a temporary read-only index key until an ID is assigned. */
  id: string;
  stable: boolean;
  duplicateId?: boolean;
  deck: string;
  topic: string;
  frontMarkdown: string;
  backMarkdown: string;
  format?: CardFormat;
  sourceFile: string;
  sourcePosition: { start: number; end: number; line: number; calloutStart: number };
  sourceText: string;
  tags: string[];
}
export interface ParseIssue { file: string; line: number; message: string }
export interface ParseResult { cards: QardCard[]; issues: ParseIssue[] }
export interface Topic { name: string; cards: QardCard[] }
export interface Deck { name: string; topics: Topic[]; cards: QardCard[]; files: string[] }
