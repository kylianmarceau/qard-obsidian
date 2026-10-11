import { useId, useRef, useState } from 'react';
import type { Deck, QardCard } from '../cards/card-types';
import type { CardLocation } from '../cards/card-location';
export type BulkAction = 'pause' | 'resume' | 'repair';
export interface CardManagement {
  decks: Deck[];
  move: (cards: QardCard[], destination: CardLocation) => Promise<void>;
  update: (cards: QardCard[], action: BulkAction) => Promise<void>;
}
export function BulkCardActions({
  cards,
  management,
  busy,
  setBusy,
  clear,
  report,
}: {
  cards: QardCard[];
  management: CardManagement;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  clear: () => void;
  report: (message: string, error?: boolean) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [deck, setDeck] = useState(cards[0]?.deck ?? '');
  const [topic, setTopic] = useState(cards[0]?.topic ?? 'General');
  const locked = useRef(false);
  const id = useId();
  async function run(action: BulkAction | 'move') {
    if (locked.current || !cards.length) {
      return;
    }
    locked.current = true;
    setBusy(true);
    report('');
    try {
      if (action === 'move') {
        await management.move(cards, { deck, topic });
      } else {
        await management.update(cards, action);
      }
      const verb =
        action === 'pause'
          ? 'Paused'
          : action === 'resume'
            ? 'Resumed'
            : action === 'repair'
              ? 'Flagged for repair:'
              : 'Moved';
      report(`${verb} ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}.`);
      setMoving(false);
      clear();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="qard-bulk-actions" aria-label="Selected card actions" aria-busy={busy}>
      <div className="qard-actions">
        <strong aria-live="polite">{cards.length} selected</strong>
        <button disabled={busy} onClick={() => setMoving((value) => !value)}>
          Move…
        </button>
        <button disabled={busy} onClick={() => void run('pause')}>
          Pause
        </button>
        <button disabled={busy} onClick={() => void run('resume')}>
          Resume
        </button>
        <button disabled={busy} onClick={() => void run('repair')}>
          Needs fixing
        </button>
        <button disabled={busy} onClick={clear}>
          Clear selection
        </button>
      </div>
      {moving && (
        <form
          className="qard-bulk-move"
          onSubmit={(event) => {
            event.preventDefault();
            void run('move');
          }}
        >
          <label>
            Deck
            <input
              autoFocus
              list={`${id}-decks`}
              value={deck}
              disabled={busy}
              maxLength={200}
              onChange={(event) => setDeck(event.target.value)}
            />
          </label>
          <datalist id={`${id}-decks`}>
            {management.decks.map((entry) => (
              <option value={entry.name} key={entry.name} />
            ))}
          </datalist>
          <label>
            Topic
            <input
              list={`${id}-topics`}
              value={topic}
              disabled={busy}
              maxLength={200}
              onChange={(event) => setTopic(event.target.value)}
            />
          </label>
          <datalist id={`${id}-topics`}>
            {management.decks
              .find((entry) => entry.name === deck)
              ?.topics.map((entry) => (
                <option value={entry.name} key={entry.name} />
              ))}
          </datalist>
          <p className="qard-muted">
            Choose an existing name or enter a new one. Cards keep their history and stay in their
            source notes.
          </p>
          <div className="qard-actions">
            <button
              type="submit"
              className="qard-primary"
              disabled={busy || !deck.trim() || !topic.trim()}
            >
              {busy ? 'Saving…' : 'Move selected cards'}
            </button>
            <button type="button" disabled={busy} onClick={() => setMoving(false)}>
              Cancel move
            </button>
          </div>
        </form>
      )}
      {busy && <p role="status">Saving selected cards…</p>}
    </section>
  );
}
