import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { QardCard } from '../cards/card-types';
import { readCardFormat } from '../cards/card-format';
import type { ImprovementKind, ImprovedCard } from '../cards/improvement-schema';
import type { QardServices } from '../views/services';
import { CardContent } from './CardContent';
import { Markdown } from './Markdown';

export function ImproveCard({
  card,
  services,
  changed,
  close,
}: {
  card: QardCard;
  services: QardServices;
  changed?: (card: QardCard) => void;
  close: () => void;
}) {
  const service = services.improvements!;
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const draft = snapshot.drafts[card.id];
  const [cards, setCards] = useState<ImprovedCard[]>([]);
  const [answerChanged, setAnswerChanged] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState(false);
  const [action, setAction] = useState<ImprovementKind>();
  const mounted = useRef(true);
  const special = readCardFormat(card.frontMarkdown).kind !== 'basic';
  const busy = working || snapshot.busy.includes(card.id);
  useEffect(() => {
    if (!draft) {
      return;
    }
    setCards(draft.applying?.cards ?? draft.cards);
    setAnswerChanged(draft.applying?.answerChanged ?? false);
  }, [draft]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      service.cancel(card.id);
    };
  }, [service, card.id]);
  async function suggest(kind: ImprovementKind) {
    setWorking(true);
    setAction(kind);
    setError('');
    setPreview(false);
    try {
      const next = await service.suggest(card, kind);
      if (mounted.current) {
        changed?.(next);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
      }
    } finally {
      if (mounted.current) {
        setWorking(false);
      }
    }
  }
  async function apply() {
    setWorking(true);
    setError('');
    try {
      const next = await service.apply(card.id, cards, answerChanged);
      if (mounted.current) {
        changed?.(next);
        close();
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
      }
    } finally {
      if (mounted.current) {
        setWorking(false);
      }
    }
  }
  async function discard() {
    setWorking(true);
    setError('');
    try {
      await service.discard(card.id);
      if (mounted.current) {
        close();
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
      }
    } finally {
      if (mounted.current) {
        setWorking(false);
      }
    }
  }
  function update(index: number, field: 'front' | 'back', value: string) {
    setCards((old) => old.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }
  return (
    <section
      className="qard-improve-card qard-panel"
      aria-label="Improve this card"
      data-qard-keyboard-ignore
    >
      <div className="qard-heading">
        <h2>Improve this card</h2>
        <button
          disabled={!!draft?.applying}
          onClick={() => {
            service.cancel(card.id);
            close();
          }}
        >
          {busy ? 'Cancel' : 'Close'}
        </button>
      </div>
      <p className="qard-muted qard-small">
        Uses your Writer AI connection. Review and edit the suggestion before applying it.
      </p>
      {!draft?.applying && (
        <div className="qard-actions">
          <button disabled={busy || snapshot.loading} onClick={() => void suggest('clearer')}>
            Make clearer
          </button>
          <button disabled={busy || snapshot.loading} onClick={() => void suggest('shorter')}>
            Shorten answer
          </button>
          <button
            disabled={busy || snapshot.loading || special}
            onClick={() => void suggest('split')}
          >
            Split into smaller cards
          </button>
        </div>
      )}
      {special && (
        <p className="qard-muted qard-small">
          AI can improve extra notes. Cloze blanks and image masks stay unchanged; use Edit to
          adjust them.
        </p>
      )}
      {busy && (
        <p role="status">
          {draft?.applying
            ? 'Saving improvement…'
            : action === 'split'
              ? 'Preparing smaller cards…'
              : 'Preparing an improvement…'}
        </p>
      )}
      {draft && (
        <>
          <Markdown text={draft.reason} path={card.sourceFile} services={services} />
          <details>
            <summary>Original card</summary>
            <CardContent
              front={draft.originalFront}
              back={draft.originalBack}
              path={card.sourceFile}
              services={services}
              revealed
            />
          </details>
          <div className="qard-improvement-drafts">
            {cards.map((proposed, index) => (
              <div className="qard-improvement-draft" key={index}>
                <h3>{draft.kind === 'split' ? `Card ${index + 1}` : 'Suggested card'}</h3>
                {preview ? (
                  <CardContent
                    front={proposed.front}
                    back={proposed.back}
                    path={card.sourceFile}
                    services={services}
                    revealed
                  />
                ) : (
                  <>
                    {!special && (
                      <label>
                        Question
                        <textarea
                          aria-label={`Question ${index + 1}`}
                          value={proposed.front}
                          disabled={busy || !!draft.applying}
                          onChange={(e) => update(index, 'front', e.target.value)}
                        />
                      </label>
                    )}
                    <label>
                      {special ? 'Extra notes' : 'Answer'}
                      <textarea
                        aria-label={`Answer ${index + 1}`}
                        value={proposed.back}
                        disabled={busy || !!draft.applying}
                        onChange={(e) => update(index, 'back', e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
          <button disabled={busy} onClick={() => setPreview(!preview)}>
            {preview ? 'Edit suggestion' : 'Preview suggestion'}
          </button>
          {draft.kind === 'split' ? (
            <p className="qard-muted qard-small">
              Adds {cards.length} new cards in the same note, deck and topic. The original is paused
              with its history preserved. New cards start with fresh review histories.
            </p>
          ) : (
            <>
              <p className="qard-muted qard-small">
                Keeps this card’s identity and review history. Wording changes keep its schedule.
              </p>
              <label className="qard-improvement-check">
                <input
                  type="checkbox"
                  checked={answerChanged}
                  disabled={busy || !!draft.applying}
                  onChange={(e) => setAnswerChanged(e.target.checked)}
                />
                The correct answer changed — make the card due for a fresh review
              </label>
            </>
          )}
          {draft.applying && (
            <p role="status">
              This improvement has started saving. Finish saving to complete it safely.
            </p>
          )}
          <div className="qard-actions">
            <button
              className="qard-primary"
              disabled={busy || cards.length === 0}
              onClick={() => void apply()}
            >
              {draft.applying
                ? 'Finish saving'
                : draft.kind === 'split'
                  ? 'Add cards and pause original'
                  : 'Apply improvement'}
            </button>
            <button disabled={busy || !!draft.applying} onClick={() => void discard()}>
              Discard draft
            </button>
          </div>
        </>
      )}
      {(error || snapshot.error) && (
        <p className="qard-error" role="alert">
          {error || snapshot.error}
        </p>
      )}
    </section>
  );
}
