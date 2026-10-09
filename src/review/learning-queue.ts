import { State } from 'ts-fsrs';
import { validFsrs } from './fsrs-scheduler';
import type { ReviewState } from './scheduler';
import type { SavedSession } from './saved-session';

export interface LearningReview {
  cardId: string;
  due: number;
}

/** Only FSRS learning/relearning steps return within a due-review session. */
export function learningReview(state: ReviewState | undefined): LearningReview | undefined {
  if (
    !state ||
    state.paused ||
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
