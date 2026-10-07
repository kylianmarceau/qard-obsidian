import { CardSourceLinks } from './CardSourceLinks';
import { useState, useSyncExternalStore } from 'react';
import { Pencil, Trash2, Play, Pause } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import { CardContent } from './CardContent';
import { CardEditor } from './CardEditor';
export function CardPreview({
  card,
  services,
  back,
  study,
  changed,
}: {
  card: QardCard;
  services: QardServices;
  back: () => void;
  study: () => void;
  changed: (card: QardCard) => void;
}) {
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const paused = !!saved.states[card.id]?.paused;
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (editing) {
    return (
      <CardEditor
        services={services}
        card={card}
        cancel={() => setEditing(false)}
        saved={(next) => {
          changed(next);
          setEditing(false);
        }}
      />
    );
  }
  async function togglePaused() {
    setBusy(true);
    setError('');
    try {
      const [stable] = card.stable ? [card] : await services.writer.ensureStable([card]);
      if (!stable) {
        throw new Error('This card is no longer available.');
      }
      await services.reviews.setPaused(stable.id, !paused);
      changed(stable);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await services.writer.delete(card);
      back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="qard-preview-toolbar">
        <div className="qard-actions">
          <button disabled={card.duplicateId} onClick={() => setEditing(true)}>
            <Pencil size={15} />
            Edit
          </button>
          <button
            disabled={busy || card.duplicateId}
            onClick={() => void togglePaused()}
            title={
              paused
                ? 'Return this card to study sessions'
                : 'Keep this card out of study sessions until you resume it'
            }
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? 'Resume card' : 'Pause card'}
          </button>
          <button
            className="qard-icon-button"
            aria-label="Delete card"
            title="Delete card"
            disabled={card.duplicateId}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <button
          className="qard-primary"
          disabled={busy || paused || card.duplicateId}
          onClick={study}
        >
          <Play size={15} />
          Study
        </button>
      </div>
      {paused && (
        <p className="qard-muted" role="status">
          Paused · excluded from study sessions. Your review history and schedule are preserved.
        </p>
      )}
      <div className="qard-card-preview">
        <div className="qard-preview-side">
          <span className="qard-eyebrow">Front</span>
          <CardContent
            front={card.frontMarkdown}
            path={card.sourceFile}
            services={services}
            revealed={false}
          />
        </div>
        <div className="qard-preview-side qard-preview-answer">
          <span className="qard-eyebrow">Back</span>
          <CardContent
            front={card.frontMarkdown}
            back={card.backMarkdown}
            path={card.sourceFile}
            services={services}
            revealed={true}
          />
        </div>
      </div>
      {services.sourceSync && <CardSourceLinks card={card} services={services} changed={changed} />}
      {card.duplicateId && (
        <p className="qard-error">
          This card shares an ID with another card. Open the source and remove the copied ID to give
          it a fresh identity.
        </p>
      )}
      {confirm && (
        <div className="qard-confirm" role="alert">
          <div>
            <strong>Delete this card from its Markdown note?</strong>
            <p>Only this callout and its ID will be removed. This cannot be undone from Qard.</p>
          </div>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Keep card
          </button>
          <button className="qard-danger" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Deleting…' : 'Delete card'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="qard-error">
          {error}
        </p>
      )}
    </>
  );
}
