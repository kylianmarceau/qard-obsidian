import { PASS } from './mastery';
import type { Question, QuestionMark, AnswerState, Confidence } from '../tests/test-types';

/** Scores are recomputed from the awarded rubric points, and extra fields (the tutor's reply) are dropped. */
export const scoreQuestion = (q: Question, m: QuestionMark): QuestionMark => ({
  awarded: m.awarded,
  annotations: m.annotations,
  mistake: m.mistake,
  feedback: m.feedback,
  score: Math.min(
    q.marks,
    q.rubric.reduce((n, r, i) => n + (m.awarded[i] ? r.marks : 0), 0),
  ),
});

/**
 * Sums a set of marked questions into one piece of evidence. A sure answer that was wrong (scored nothing,
 * or the marker called it a misconception) counts as sure, which makes a misconception; a sure but merely
 * incomplete answer does not. A pass that relied on a guess counts as a guess; all "I don't know" is unknown.
 */
export function summarise(items: { q: Question; answer?: AnswerState; mark?: QuestionMark }[]): {
  score: number;
  marks: number;
  confidence?: Confidence | 'unknown';
} {
  const score = items.reduce((n, i) => n + (i.mark?.score ?? 0), 0),
    marks = items.reduce((n, i) => n + i.q.marks, 0);
  const pass = marks > 0 && score / marks >= PASS;
  if (items.length && items.every((i) => i.answer?.unknown)) {
    return { score, marks, confidence: 'unknown' };
  }
  if (
    !pass &&
    items.some(
      (i) =>
        i.answer?.confidence === 'sure' &&
        ((i.mark?.score ?? 0) === 0 || i.mark?.mistake === 'misconception'),
    )
  ) {
    return { score, marks, confidence: 'sure' };
  }
  if (!pass) {
    return {
      score,
      marks,
      confidence: items.some((i) => i.answer?.confidence === 'guess') ? 'guess' : 'unsure',
    };
  }
  if (pass && items.some((i) => i.answer?.confidence === 'guess')) {
    return { score, marks, confidence: 'guess' };
  }
  const confidences = items.map((i) => i.answer?.confidence);
  return {
    score,
    marks,
    confidence: confidences.every((c) => c === 'sure')
      ? 'sure'
      : confidences.includes('unsure')
        ? 'unsure'
        : undefined,
  };
}
