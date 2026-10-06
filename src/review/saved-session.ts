import type { QardCard } from '../cards/card-types';
import type { SessionResult, SessionStyle } from './session';

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
}
export interface SessionStep {
  id: string;
  position: number;
}
export const stableId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
export function readSessions(raw: unknown): SavedSession[] {
  if (!Array.isArray(raw)) return [];
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
        s.position >= s.cardIds.length ||
        !['normal', 'cram'].includes(s.style) ||
        !Number.isFinite(s.createdAt) ||
        !Number.isFinite(s.updatedAt) ||
        !Array.isArray(s.results) ||
        s.results.some((r) => !r || !stableId(r.cardId) || ![1, 2, 3, 4].includes(r.rating))
      )
        return false;
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
    }));
}
/** Resolve fresh Markdown by ID, retaining saved order and the next unreviewed position. */
export function resolveSession(session: SavedSession, cards: QardCard[]) {
  const byId = new Map<string, QardCard>();
  const ambiguous = new Set<string>();
  for (const card of cards) {
    if (!card.stable || card.duplicateId || byId.has(card.id)) ambiguous.add(card.id);
    byId.set(card.id, card);
  }
  const available = (id: string) => byId.has(id) && !ambiguous.has(id);
  const cardIds = session.cardIds.filter(available);
  const position = session.cardIds.slice(0, session.position).filter(available).length;
  return {
    session: { ...session, cardIds, position },
    cards: cardIds.map((id) => byId.get(id)!),
    skipped: session.cardIds.length - cardIds.length,
  };
}
