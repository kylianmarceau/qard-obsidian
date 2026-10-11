import type { CardLocation } from './card-location';
export interface QardCard {
  /** Persistent ID, or a temporary read-only index key until an ID is assigned. */
  id: string;
  stable: boolean;
  duplicateId?: boolean;
  /** Variants of one cloze sentence or image, never a whole source note. */
  siblingGroup?: string;
  /** Reciprocal ID of the basic card's other direction, in the same source note. */
  reverseId?: string;
  location?: CardLocation;
  deck: string;
  topic: string;
  frontMarkdown: string;
  backMarkdown: string;
  sourceFile: string;
  sourcePosition: { start: number; end: number; line: number; calloutStart: number };
  sourceText: string;
  tags: string[];
}
export interface ParseIssue {
  file: string;
  line: number;
  message: string;
}
export interface ParseResult {
  cards: QardCard[];
  issues: ParseIssue[];
}
export interface Topic {
  name: string;
  cards: QardCard[];
}
export interface Deck {
  name: string;
  topics: Topic[];
  cards: QardCard[];
  files: string[];
}
