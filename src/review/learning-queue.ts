import { State } from 'ts-fsrs';
import { validFsrs } from './fsrs-scheduler';
import { isBuried, type ReviewState } from './scheduler';
import type { SavedSession } from './saved-session';

export interface LearningReview {
  cardId: string;
  due: number;
}

/** Only an Again rating returns an FSRS learning/relearning card within the session. */
export function learningReview(state: ReviewState | undefined): LearningReview | undefined {
  if (
    !state ||
    state.lastRating !== 1 ||
    state.paused ||
    isBuried(state) ||
    !validFsrs(state.fsrs) ||
    ![State.Learning, State.Relearning].includes(state.fsrs.state) ||
    !Number.isFinite(state.due)
  ) {
    return undefined;
  }
  return { cardId: state.cardId, due: state.due! };
}

export function pendingLearning(
  session: SavedSession | undefined,
  states: Record<string, ReviewState>,
): LearningReview[] {
  return (session?.learning ?? [])
    .flatMap((entry) => {
      const current = learningReview(states[entry.cardId]);
      return current ? [current] : [];
    })
    .sort((a, b) => a.due - b.due || a.cardId.localeCompare(b.cardId));
}

/** Count finished cards separately from attempts and the first-pass queue position. */
export function completedReviewCount(
  session: Pick<
    SavedSession,
    'results' | 'cardIds' | 'repeatLearning' | 'skippedIds' | 'deferredIds'
  >,
  states: Record<string, ReviewState>,
): number {
  const available = new Set(session.cardIds);
  const excluded = new Set([...(session.skippedIds ?? []), ...(session.deferredIds ?? [])]);
  return new Set(
    session.results
      .filter(
        ({ cardId }) =>
          available.has(cardId) &&
          !excluded.has(cardId) &&
          (!session.repeatLearning || !learningReview(states[cardId])),
      )
      .map(({ cardId }) => cardId),
  ).size;
}
