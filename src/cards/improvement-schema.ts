import { check, type Schema } from '../tests/test-schema';
import { readCardFormat } from './card-format';
import { serializeCard } from './source-patch';

export type ImprovementKind = 'clearer' | 'shorter' | 'split';
export interface ImprovedCard {
  front: string;
  back: string;
}
export interface CardImprovement {
  reason: string;
  cards: ImprovedCard[];
}
export const improvementSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'cards'],
  properties: {
    reason: { type: 'string', description: 'A short explanation of the proposed improvement.' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['front', 'back'],
        properties: { front: { type: 'string' }, back: { type: 'string' } },
      },
    },
  },
};
export function readImprovement(value: unknown, kind: ImprovementKind, originalFront: string) {
  const result = check<CardImprovement>(improvementSchema, value);
  const reason = result.reason.trim();
  if (!reason || reason.length > 3000) {
    throw new Error('Explain the improvement briefly.');
  }
  if (
    kind === 'split'
      ? result.cards.length < 2 || result.cards.length > 6
      : result.cards.length !== 1
  ) {
    throw new Error(
      kind === 'split'
        ? 'Split into two to six focused cards.'
        : 'Return exactly one improved card.',
    );
  }
  const format = readCardFormat(originalFront);
  if (kind === 'split' && format.kind !== 'basic') {
    throw new Error(
      'Split is available for basic cards. Edit cloze blanks or image masks directly.',
    );
  }
  const seen = new Set<string>();
  const cards = result.cards.map((card) => {
    const front = card.front.replace(/\r\n?/g, '\n').trim();
    const back = card.back.replace(/\r\n?/g, '\n').trim();
    if (front.length > 4000 || back.length > 12000) {
      throw new Error('Keep questions and answers concise.');
    }
    serializeCard('validation', front, back);
    if (format.kind !== 'basic' && front !== originalFront) {
      throw new Error(
        'Keep the cloze question or image masks unchanged; improve only its extra notes.',
      );
    }
    if (format.kind === 'basic' && readCardFormat(front).kind !== 'basic') {
      throw new Error('Keep the basic question-and-answer format.');
    }
    const key = front.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) {
      throw new Error('Each split card needs a distinct question.');
    }
    seen.add(key);
    return { front, back };
  });
  return { reason, cards };
}
