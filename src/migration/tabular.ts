import { serializeCard } from '../cards/source-patch';
import { readCardFormat } from '../cards/card-format';
import { siblingGroup } from '../cards/siblings';
import type { QardCard } from '../cards/card-types';
import type { TransferCard, TransferInput } from './transfer-types';

export type Delimiter = ',' | '\t';
export type Column = 'front' | 'back' | 'deck' | 'topic' | 'tags' | 'group';
export type ColumnMap = Record<Column, number>;
export const MAX_CARDS = 10000;
export const MAX_TEXT = 20 * 1024 * 1024;
/** Quoted fields can contain delimiters, escaped quotes and real line breaks. */
export function readDelimited(text: string, delimiter: Delimiter): string[][] {
  if (text.length > MAX_TEXT) {
    throw new Error('Choose a text file smaller than 20 MB.');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false;
  const cell = () => {
    if (row.length >= 200) {
      throw new Error('Import up to 200 columns per row.');
    }
    row.push(value);
    value = '';
    closed = false;
  };
  const end = () => {
    cell();
    if (row.some((s) => s.trim())) {
      rows.push(row);
    }
    row = [];
    if (rows.length > MAX_CARDS + 1) {
      throw new Error('Import up to 10,000 cards at a time.');
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += ch;
      }
    } else if (ch === delimiter) {
      cell();
    } else if (ch === '\n') {
      end();
    } else if (ch === '"' && !value && !closed) {
      quoted = true;
    } else if (closed) {
      if (!/[ \t]/.test(ch)) {
        throw new Error(`Unexpected text after a closing quote near row ${rows.length + 1}.`);
      }
    } else {
      value += ch;
    }
  }
  if (quoted) {
    throw new Error('A quoted field is unfinished. Close its quote before importing.');
  }
  if (value || row.length || closed) {
    end();
  }
  if (!rows.length) {
    throw new Error('This file has no cards.');
  }
  return rows;
}
const aliases: Record<Column, string[]> = {
  front: ['question', 'front', 'prompt'],
  back: ['answer', 'back', 'response'],
  deck: ['deck'],
  topic: ['topic'],
  tags: ['tags'],
  group: ['sibling group', 'group'],
};
export function guessColumns(row: string[]): { header: boolean; columns: ColumnMap } {
  const lower = row.map((s) => s.trim().toLowerCase());
  const columns = Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [key, lower.findIndex((s) => names.includes(s))]),
  ) as ColumnMap;
  const header = columns.front >= 0 && columns.back >= 0;
  return {
    header,
    columns: header ? columns : { front: 0, back: 1, deck: -1, topic: -1, tags: -1, group: -1 },
  };
}
export function validateTransferCard(card: TransferCard) {
  if (
    !card ||
    typeof card.front !== 'string' ||
    typeof card.back !== 'string' ||
    typeof card.deck !== 'string' ||
    typeof card.topic !== 'string' ||
    !Array.isArray(card.tags) ||
    card.tags.some((tag) => typeof tag !== 'string')
  ) {
    throw new Error('Invalid imported card content.');
  }
  if (
    !card.deck.trim() ||
    !card.topic.trim() ||
    /[\r\n\0]/.test(card.deck + card.topic) ||
    card.deck.length > 200 ||
    card.topic.length > 200
  ) {
    throw new Error('Deck and topic must be single lines, up to 200 characters each.');
  }
  if (card.front.length + card.back.length > 100000) {
    throw new Error('This card is too large (maximum 100,000 characters).');
  }
  readCardFormat(card.front);
  serializeCard('validation', card.front, card.back);
  if (card.tags.some((t) => !t || /[\s\0]/.test(t))) {
    throw new Error('Separate tags with spaces; individual tags cannot contain whitespace.');
  }
}
export function mapRows(
  rows: string[][],
  columns: ColumnMap,
  header: boolean,
  deck: string,
  topic: string,
): TransferInput {
  if (columns.front < 0 || columns.back < 0 || columns.front === columns.back) {
    throw new Error('Choose different columns for question and answer.');
  }
  const cards: TransferCard[] = [],
    issues: TransferInput['issues'] = [];
  for (let i = header ? 1 : 0; i < rows.length; i++) {
    const row = rows[i]!,
      get = (key: Column) => (row[columns[key]] ?? '').trim();
    try {
      const card: TransferCard = {
        front: get('front'),
        back: get('back'),
        deck: get('deck') || deck.trim(),
        topic: get('topic') || topic.trim(),
        tags: get('tags')
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => t.replace(/^#/, '')),
        group: get('group') || undefined,
      };
      validateTransferCard(card);
      cards.push(card);
    } catch (e) {
      issues.push({ row: i + 1, message: (e as Error).message });
    }
  }
  return { cards, issues };
}
export function writeDelimited(cards: QardCard[], delimiter: Delimiter): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [
    ['Question', 'Answer', 'Deck', 'Topic', 'Tags', 'Sibling group'],
    ...cards.map((c) => [
      c.frontMarkdown,
      c.backMarkdown,
      c.deck,
      c.topic,
      c.tags.join(' '),
      siblingGroup(c) ?? '',
    ]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(quote).join(delimiter)).join('\r\n') + '\r\n';
}
