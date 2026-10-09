import type { QardCard } from '../cards/card-types';
import type { SessionResult, SessionStyle } from './session';
import type { ReviewState } from './scheduler';
import { pendingLearning, type LearningReview } from './learning-queue';

export interface SavedSession {
  id: string;
  title: string;
  cardIds: string[];
  position: number;
  style: SessionStyle;
  results: SessionResult[];
  createdAt: number;
  updatedAt: number;
  examId?: string;
  skippedIds?: string[];
  /** Opt-in for new normal Due sessions; older/manual/cram sessions stay single-pass. */
  repeatLearning?: true;
  learning?: LearningReview[];
}
export interface SessionStep {
  id: string;
  position: number;
  /** Identifies a scheduled repeat, without advancing the first-pass cursor. */
  learningDue?: number;
}
export const stableId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
export const hasRemainingSession = (session: SavedSession): boolean =>
  session.position < session.cardIds.length || !!session.learning?.length;

function readLearning(session: SavedSession): LearningReview[] {
  if (session.repeatLearning !== true || session.style !== 'normal' || session.examId) {
    return [];
  }
  const seen = new Set<string>();
  return (Array.isArray(session.learning) ? session.learning : [])
    .filter((entry) => {
      if (
        !entry ||
        !stableId(entry.cardId) ||
        seen.has(entry.cardId) ||
        typeof entry.due !== 'number' ||
        !Number.isFinite(new Date(entry.due).getTime()) ||
        !session.cardIds.slice(0, session.position).includes(entry.cardId) ||
        (Array.isArray(session.skippedIds) && session.skippedIds.includes(entry.cardId))
      ) {
        return false;
      }
      seen.add(entry.cardId);
      return true;
    })
    .map((entry) => ({ cardId: entry.cardId, due: entry.due }));
}

export function matchesSessionStep(session: SavedSession, step: SessionStep, cardId: string) {
  return (
    session.position === step.position &&
    (step.learningDue === undefined
      ? session.cardIds[step.position] === cardId
      : session.repeatLearning &&
        session.learning?.some(
          (entry) => entry.cardId === cardId && entry.due === step.learningDue,
        ))
  );
}
export function readSessions(raw: unknown): SavedSession[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  return (raw as SavedSession[])
    .filter((s: SavedSession) => {
      if (
        !s ||
        !stableId(s.id) ||
        seen.has(s.id) ||
        typeof s.title !== 'string' ||
        !Array.isArray(s.cardIds) ||
        !s.cardIds.length ||
        !s.cardIds.every(stableId) ||
        new Set(s.cardIds).size !== s.cardIds.length ||
        !Number.isSafeInteger(s.position) ||
        s.position < 0 ||
        s.position > s.cardIds.length ||
        !['normal', 'cram'].includes(s.style) ||
        !Number.isFinite(s.createdAt) ||
        !Number.isFinite(s.updatedAt) ||
        !Array.isArray(s.results) ||
        s.results.some((r) => !r || !stableId(r.cardId) || ![1, 2, 3, 4].includes(r.rating))
      ) {
        return false;
      }
      if (s.position === s.cardIds.length && !readLearning(s).length) {
        return false;
      }
      seen.add(s.id);
      return true;
    })
    .map((s) => ({
      id: s.id,
      title: s.title,
      cardIds: [...s.cardIds],
      position: s.position,
      style: s.style,
      results: s.results.map((r) => ({ cardId: r.cardId, rating: r.rating })),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...(stableId(s.examId) ? { examId: s.examId } : {}),
      ...(s.repeatLearning === true && s.style === 'normal' && !s.examId
        ? { repeatLearning: true as const, learning: readLearning(s) }
        : {}),
      ...(Array.isArray(s.skippedIds)
        ? {
            skippedIds: [
              ...new Set(
                s.skippedIds.filter(
                  (id) => stableId(id) && s.cardIds.slice(0, s.position).includes(id),
                ),
              ),
            ],
          }
        : {}),
    }));
}
/** Resolve fresh Markdown by ID, retaining saved order and the next unreviewed position. */
export function resolveSession(
  session: SavedSession,
  cards: QardCard[],
  states: Record<string, ReviewState> = {},
) {
  const byId = new Map<string, QardCard>();
  const ambiguous = new Set<string>();
  for (const card of cards) {
    if (!card.stable || card.duplicateId || byId.has(card.id)) {
      ambiguous.add(card.id);
    }
    byId.set(card.id, card);
  }
  const available = (id: string) => byId.has(id) && !ambiguous.has(id);
  const cardIds = session.cardIds.filter(
    (id, index) => available(id) && (index < session.position || !states[id]?.paused),
  );
  const position = session.cardIds.slice(0, session.position).filter(available).length;
  const learning = pendingLearning(session, states).filter(
    (entry) => available(entry.cardId) && !session.skippedIds?.includes(entry.cardId),
  );
  return {
    session: {
      ...session,
      cardIds,
      position,
      ...(session.repeatLearning ? { learning } : {}),
      ...(session.skippedIds ? { skippedIds: session.skippedIds.filter(available) } : {}),
    },
    cards: cardIds.map((id) => byId.get(id)!),
    skipped: session.cardIds.length - cardIds.length,
  };
}
