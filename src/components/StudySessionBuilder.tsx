import { useMemo, useState, useSyncExternalStore } from 'react';
import { Play, ChevronRight } from 'lucide-react';
import type { Deck, QardCard } from '../cards/card-types';
import {
  selectCards,
  type Selection,
  type StudyMode,
  type CardOrder,
  type SessionStyle,
} from '../review/session';
import type { QardServices } from '../views/services';
import { topicKey } from '../decks/deck-index';
const modes: { id: StudyMode; name: string; description: string }[] = [
  { id: 'all', name: 'All cards', description: 'Every selected card. No due-date restrictions.' },
  { id: 'due', name: 'Due cards', description: 'New cards and cards ready for another review.' },
  { id: 'new', name: 'New cards', description: 'Cards you have not reviewed yet.' },
  { id: 'difficult', name: 'Difficult cards', description: 'Cards last rated Again or Hard.' },
];
export function StudySessionBuilder({
  cards,
  decks,
  initial,
  services,
  start,
  back,
}: {
  cards: QardCard[];
  decks: Deck[];
  initial: Selection;
  services: QardServices;
  start: (cards: QardCard[], style?: SessionStyle) => void | Promise<void>;
  back: () => void;
}) {
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [chosen, setChosen] = useState(
    new Set(
      selectCards(cards, saved.states, { selection: initial, mode: 'all', order: 'note' }).map(
        (c) => c.id,
      ),
    ),
  );
  const [mode, setMode] = useState<StudyMode>(saved.settings.defaultMode),
    [order, setOrder] = useState<CardOrder>(saved.settings.defaultOrder);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<SessionStyle>('normal');
  const selected = useMemo(
    () =>
      selectCards(cards, saved.states, {
        selection: { decks: [], topics: [], cards: [...chosen] },
        mode,
        order: 'note',
      }),
    [cards, saved.states, chosen, mode],
  );
  const toggle = (group: QardCard[]) => {
    const next = new Set(chosen);
    const all = group.every((c) => next.has(c.id));
    group.forEach((c) => (all ? next.delete(c.id) : next.add(c.id)));
    setChosen(next);
  };
  async function begin() {
    setBusy(true);
    setError('');
    try {
      const ready = await services.writer.ensureStable(selected);
      const ordered =
        order === 'shuffle'
          ? selectCards(
              ready,
              {},
              {
                selection: { decks: [], topics: [], cards: ready.map((c) => c.id) },
                mode: 'all',
                order: 'shuffle',
              },
            )
          : ready;
      if (style === 'cram') await start(ordered, style);
      else await start(ordered);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="qard-heading">
        <h1>Study</h1>
        <button onClick={back}>Cancel</button>
      </div>
      <div className="qard-builder">
        <section className="qard-selection">
          <div className="qard-panel-heading">
            <h2>Decks</h2>
            <button
              className="qard-text-button"
              onClick={() =>
                setChosen(
                  chosen.size === cards.length ? new Set() : new Set(cards.map((c) => c.id)),
                )
              }
            >
              {chosen.size === cards.length ? 'Clear' : 'Select all'}
            </button>
          </div>
          {decks.map((deck) => (
            <details key={deck.name} className="qard-select-deck">
              <summary>
                <ChevronRight size={15} />
                <label onClick={(e) => e.stopPropagation()}>
                  <MixedCheckbox
                    checked={deck.cards.every((c) => chosen.has(c.id))}
                    mixed={
                      deck.cards.some((c) => chosen.has(c.id)) &&
                      !deck.cards.every((c) => chosen.has(c.id))
                    }
                    onChange={() => toggle(deck.cards)}
                    label={deck.name}
                  />
                  <strong>{deck.name}</strong>
                  <span>
                    {deck.cards.filter((c) => chosen.has(c.id)).length} / {deck.cards.length}
                  </span>
                </label>
              </summary>
              {deck.topics.map((topic) => (
                <details key={topicKey(deck.name, topic.name)} className="qard-select-topic">
                  <summary>
                    <ChevronRight size={14} />
                    <label onClick={(e) => e.stopPropagation()}>
                      <MixedCheckbox
                        checked={topic.cards.every((c) => chosen.has(c.id))}
                        mixed={
                          topic.cards.some((c) => chosen.has(c.id)) &&
                          !topic.cards.every((c) => chosen.has(c.id))
                        }
                        onChange={() => toggle(topic.cards)}
                        label={`${deck.name}: ${topic.name}`}
                      />
                      {topic.name}
                      <span>{topic.cards.length}</span>
                    </label>
                  </summary>
                  <div className="qard-individuals">
                    {topic.cards.map((card) => (
                      <label key={`${card.sourceFile}:${card.sourcePosition.start}`}>
                        <input
                          type="checkbox"
                          checked={chosen.has(card.id)}
                          onChange={() => toggle([card])}
                        />
                        <span>{card.frontMarkdown.split('\n')[0]}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </details>
          ))}
          {!cards.length && <p className="qard-muted">No cards yet.</p>}
        </section>
        <aside className="qard-session-options">
          <label>
            Session
            <select
              aria-label="Session type"
              value={style}
              disabled={busy}
              onChange={(e) => setStyle(e.target.value as SessionStyle)}
            >
              <option value="normal">Normal session</option>
              <option value="cram">Cram mode</option>
            </select>
          </label>
          <p className="qard-muted qard-small">
            {style === 'cram'
              ? 'Space reveals the answer; Space again moves to the next card. No ratings or schedule changes.'
              : 'Reveal each answer and rate how well you remembered it.'}
          </p>
          <label>
            Cards
            <select
              aria-label="Study mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as StudyMode)}
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order
            <select
              aria-label="Card order"
              value={order}
              onChange={(e) => setOrder(e.target.value as CardOrder)}
            >
              <option value="note">Note order</option>
              <option value="shuffle">Shuffle</option>
            </select>
          </label>
          <div className="qard-session-start">
            <span aria-live="polite">
              {selected.length} {selected.length === 1 ? 'card' : 'cards'} selected
            </span>
            <button
              className="qard-primary"
              disabled={busy || !selected.length || services.index.getSnapshot().loading}
              onClick={() => void begin()}
            >
              <Play size={16} />
              {busy ? 'Preparing…' : 'Start'}
            </button>
          </div>
          {error && (
            <p className="qard-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function MixedCheckbox({
  checked,
  mixed,
  onChange,
  label,
}: {
  checked: boolean;
  mixed: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = mixed;
      }}
      onChange={onChange}
    />
  );
}
