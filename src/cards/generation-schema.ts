import { check, type Schema } from '../tests/test-schema';
import { serializeCard } from './source-patch';
import type { CardFormat } from './card-types';

export interface GeneratedContent { front: string; back: string; source: string; format?: CardFormat }
export const flashcardsSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['cards'], properties: {
    cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back', 'source'], properties: {
      front: { type: 'string', description: 'One focused question or, when requested, a cloze statement with {{answer}} blanks in Markdown.' },
      back: { type: 'string', description: 'A concise, correct answer in Markdown; optional explanation for a cloze card.' },
      source: { type: 'string', description: 'Exact vault-relative Markdown note path, or empty if based on general knowledge.' }
    } } }
  }
};
export function readFlashcards(value: unknown, paths: string[], kind?: 'cloze'): GeneratedContent[] {
  const result = check<{ cards: GeneratedContent[] }>(flashcardsSchema, value);
  if (!result.cards.length) throw new Error('Return at least one useful flashcard based on the material.');
  const seen = new Set<string>();
  return result.cards.map((card, i) => {
    const front = card.front.trim(), back = card.back.trim(), source = card.source.trim();
    if (front.length > 4000 || back.length > 12000) throw new Error(`Card ${i + 1} is too long. Keep questions and answers concise.`);
    const format: CardFormat | undefined = kind === 'cloze' ? { type: 'cloze' } : undefined;
    serializeCard('validation', front, back, '\n', format);
    const key = front.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) throw new Error(`Card ${i + 1} repeats a question. Write distinct cards.`);
    seen.add(key);
    if (source && !paths.includes(source)) throw new Error(`Card ${i + 1} cites a note that does not exist: ${source}.`);
    return { front, back, source, ...(format ? { format } : {}) };
  });
}
