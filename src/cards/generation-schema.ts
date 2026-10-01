import { check, type Schema } from '../tests/test-schema';
import { serializeCard } from './source-patch';

export interface GeneratedContent { front: string; back: string; source: string }
export const flashcardsSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['cards'], properties: {
    cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back', 'source'], properties: {
      front: { type: 'string', description: 'One focused question in Markdown.' },
      back: { type: 'string', description: 'A concise, correct answer in Markdown.' },
      source: { type: 'string', description: 'Exact vault-relative Markdown note path, or empty if based on general knowledge.' }
    } } }
  }
};
export const MAX_FLASHCARDS = 100;
export function readFlashcards(value: unknown, count: number, paths: string[]): GeneratedContent[] {
  const result = check<{ cards: GeneratedContent[] }>(flashcardsSchema, value);
  if (result.cards.length !== count) throw new Error(`Return exactly ${count} cards; received ${result.cards.length}.`);
  const seen = new Set<string>();
  return result.cards.map((card, i) => {
    const front = card.front.trim(), back = card.back.trim(), source = card.source.trim();
    if (front.length > 4000 || back.length > 12000) throw new Error(`Card ${i + 1} is too long. Keep questions and answers concise.`);
    serializeCard('validation', front, back);
    const key = front.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) throw new Error(`Card ${i + 1} repeats a question. Write distinct cards.`);
    seen.add(key);
    if (source && !paths.includes(source)) throw new Error(`Card ${i + 1} cites a note that does not exist: ${source}.`);
    return { front, back, source };
  });
}
