import { check, type Schema } from '../tests/test-schema';
import { serializeCard } from './source-patch';
export interface SourceSuggestion { front: string; back: string; reason: string; change: 'none' | 'wording' | 'meaning' }
export const sourceSuggestionSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['front', 'back', 'reason', 'change'], properties: {
    front: { type: 'string' }, back: { type: 'string' }, reason: { type: 'string' },
    change: { type: 'string', enum: ['none', 'wording', 'meaning'] }
  }
};
export function readSourceSuggestion(value: unknown): SourceSuggestion {
  const result = check<SourceSuggestion>(sourceSuggestionSchema, value);
  const front = result.front.trim(), back = result.back.trim(), reason = result.reason.trim();
  if (front.length > 4000 || back.length > 12000 || !reason || reason.length > 3000) throw new Error('Return a concise card and a short explanation of the change.');
  serializeCard('validation', front, back);
  return { ...result, front, back, reason };
}
