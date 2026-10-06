import { useState, useSyncExternalStore } from 'react';
import { InlineMarkdown } from './Markdown';
import { Play, X } from 'lucide-react';
import type { QardServices } from '../views/services';
export function SavedSessions({
  services,
  resume,
  deck,
}: {
  services: QardServices;
  resume: (id: string) => Promise<void>;
  deck?: string;
}) {
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState('');
  const ids = deck
    ? new Set(index.cards.filter((c) => c.deck === deck).map((c) => c.id))
    : undefined;
  const sessions = saved.sessions
    .filter((s) => !ids || s.cardIds.some((id) => ids.has(id)))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
  async function run(id: string, remove = false) {
    setBusy(id);
    setError('');
    try {
      if (remove) {
        await services.reviews.discardSession(id);
        setDiscard('');
      } else await resume(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (!sessions.length) return null;
  return (
    <section className="qard-saved-sessions" aria-label="Saved flashcard sessions">
      <h2>Continue studying</h2>
      {sessions.map((s) => (
        <div key={s.id} className="qard-saved-session">
          <div className="qard-saved-session-row">
            <div className="qard-saved-session-copy">
              <strong className="qard-saved-session-title">
                <InlineMarkdown text={s.title} path="" services={services} />
              </strong>
              <span className="qard-saved-session-progress">
                {s.style === 'cram' ? 'Cram · ' : ''}
                {s.position} of {s.cardIds.length} completed
              </span>
            </div>
            <div className="qard-saved-session-actions">
              <button
                className="qard-primary"
                disabled={!!busy || index.loading}
                onClick={() => void run(s.id)}
              >
                <Play size={14} />
                {busy === s.id ? 'Opening…' : 'Resume'}
              </button>
              <button
                className="qard-saved-session-discard"
                aria-label={`Discard saved session: ${s.title}`}
                title="Discard saved session"
                disabled={!!busy}
                onClick={() => setDiscard(discard === s.id ? '' : s.id)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {discard === s.id && (
            <div className="qard-confirm qard-saved-session-confirm">
              <p>Discard this saved session? Completed ratings stay saved.</p>
              <div className="qard-actions">
                <button disabled={!!busy} onClick={() => void run(s.id, true)}>
                  Discard session
                </button>
                <button onClick={() => setDiscard('')}>Keep session</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
