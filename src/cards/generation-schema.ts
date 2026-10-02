import { check, type Schema } from '../tests/test-schema';
import { serializeCard } from './source-patch';

export interface GeneratedContent { front: string; back: string; source: string }
export interface FlashcardDestination { deck: string; topic: string }
export const flashcardsSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['cards'], properties: {
    cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back', 'source'], properties: {
      front: { type: 'string', description: 'One focused question in Markdown.' },
      back: { type: 'string', description: 'A concise, correct answer in Markdown.' },
      source: { type: 'string', description: 'Exact vault-relative Markdown note path, or empty if based on general knowledge.' }
    } } }
  }
};
/** Prompt-first requests let the writer suggest a destination as well as the cards. */
export const flashcardBatchSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['deck', 'topic', 'cards'], properties: {
    deck: { type: 'string', description: 'A short descriptive deck name. Reuse an existing deck when it fits.' },
    topic: { type: 'string', description: 'A short topic name for this batch, based on the requested material.' },
    ...flashcardsSchema.properties
  }
};
export function readDestination(value: unknown, required = true): FlashcardDestination {
  const dest = value as FlashcardDestination | undefined;
  if (!dest || typeof dest.deck !== 'string' || typeof dest.topic !== 'string') throw new Error('Choose a deck and topic for the cards.');
  const deck = dest.deck.trim(), topic = dest.topic.trim();
  if ((required && (!deck || !topic)) || deck.length > 200 || topic.length > 200 || /[\r\n]/.test(deck + topic)) throw new Error('Deck and topic must be single lines, up to 200 characters each.');
  return { deck, topic };
}
export function readFlashcardBatch(value: unknown, paths: string[]) {
  const result = check<FlashcardDestination & { cards: GeneratedContent[] }>(flashcardBatchSchema, value);
  return { destination: readDestination(result), cards: readFlashcards({ cards: result.cards }, paths) };
}
export function readFlashcards(value: unknown, paths: string[]): GeneratedContent[] {
  const result = check<{ cards: GeneratedContent[] }>(flashcardsSchema, value);
  if (!result.cards.length) throw new Error('Return at least one useful flashcard based on the material.');
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
