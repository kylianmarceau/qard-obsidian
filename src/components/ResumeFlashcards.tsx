import { useSyncExternalStore } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  flashcardDestination,
  flashcardTopics,
  type FlashcardGenerationService,
} from '../cards/generation-service';

/** Home-page shortcut to a running flashcard job or a batch still awaiting review. */
export function ResumeFlashcards({
  service,
  open,
}: {
  service: FlashcardGenerationService;
  open: () => void;
}) {
  const { batch, job, saving, error } = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
  );
  if (!batch) {
    return null;
  }
  const remaining = batch.cards.filter((c) => !c.added).length;
  const running = !!job && !job.error;
  if (batch.cards.length && !remaining && !running && !saving && !error && !job?.error) {
    return null;
  }
  const needsAttention = !!error || !!job?.error;
  const label = needsAttention
    ? 'Continue flashcards'
    : running || !batch.cards.length
      ? 'Generating flashcards'
      : 'Review flashcards';
  const status = needsAttention
    ? 'Needs attention'
    : running || !batch.cards.length
      ? 'Generating…'
      : saving
        ? 'Adding…'
        : `${remaining} ready to review`;
  const destination = flashcardDestination(batch);
  const topics = flashcardTopics(batch);
  const title = destination.deck
    ? [
        destination.deck,
        topics.length > 1 ? `${topics.length} topics` : topics[0] || destination.topic,
      ]
        .filter(Boolean)
        .join(' › ')
    : batch.request.prompt || 'From selected notes';
  return (
    <button className="qard-resume qard-row-update" onClick={open}>
      <span className="qard-resume-copy">
        <strong className="qard-resume-title">{title}</strong>
        <span className="qard-muted qard-resume-label">{label}</span>
      </span>
      <span className="qard-muted">{status}</span>
      <ChevronRight size={16} />
    </button>
  );
}
