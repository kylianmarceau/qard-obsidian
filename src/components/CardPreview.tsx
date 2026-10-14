import { CardRepairActions } from './CardRepairActions';
import { isBuried } from '../review/scheduler';
import { dueLabel } from '../review/due-label';
import { CardSourceLinks } from './CardSourceLinks';
import { useState, useSyncExternalStore } from 'react';
import { Trash2, Play, Pause, ArrowLeftRight } from 'lucide-react';
import { canReverse } from '../cards/source-patch';
import { cardTitle } from '../cards/card-format';
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
  const schedule = dueLabel(saved.states[card.id], Date.now(), saved.settings.scheduling);
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState(false),
    [confirmUnlink, setConfirmUnlink] = useState(false),
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
  const partner = card.reverseId
    ? services.index.getSnapshot().cards.find((c) => c.id === card.reverseId)
    : undefined;
  async function reverse(add: boolean) {
    setBusy(true);
    setError('');
    try {
      changed(
        add ? await services.writer.addReverse(card) : await services.writer.removeReverse(card),
      );
      setConfirmUnlink(false);
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
          {canReverse(card) ? (
            <button
              disabled={busy}
              title="Also test this card from back to front, with its own schedule"
              onClick={() => void reverse(true)}
            >
              <ArrowLeftRight size={15} />
              Add reverse
            </button>
          ) : (
            card.reverseId &&
            !card.duplicateId && (
              <button disabled={busy} onClick={() => setConfirmUnlink(true)}>
                <ArrowLeftRight size={15} />
                Remove reverse
              </button>
            )
          )}
          <button
            className="qard-icon-button"
            aria-label="Delete card"
            title="Delete card"
            disabled={busy || card.duplicateId}
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
      {schedule && <p className="qard-muted">{schedule}</p>}
      {isBuried(saved.states[card.id]) && (
        <p className="qard-muted" role="status">
          Related card deferred until tomorrow · available in cram.
        </p>
      )}
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
      <CardRepairActions
        card={card}
        services={services}
        edit={() => setEditing(true)}
        disabled={busy}
        onBusy={setBusy}
        changed={changed}
      />
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
      {confirmUnlink && (
        <div className="qard-confirm" role="alert">
          <div>
            <strong>Remove the reverse card?</strong>
            <p>
              {partner
                ? `“${cardTitle(partner.frontMarkdown)}” is deleted from your note and its review history is lost.`
                : 'The reverse card is deleted from your note and its review history is lost.'}{' '}
              This card keeps its own schedule.
            </p>
          </div>
          <button disabled={busy} onClick={() => setConfirmUnlink(false)}>
            Keep both
          </button>
          <button className="qard-danger" disabled={busy} onClick={() => void reverse(false)}>
            {busy ? 'Removing…' : 'Remove reverse'}
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
