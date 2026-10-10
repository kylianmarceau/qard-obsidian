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
import { paceCards, introductionsToday, type PacingOptions } from '../review/pacing';
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
  start: (
    cards: QardCard[],
    style?: SessionStyle,
    mode?: StudyMode,
    options?: PacingOptions,
  ) => void | Promise<void>;
  back: () => void;
}) {
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [chosen, setChosen] = useState(
    new Set(
      selectCards(cards, saved.states, {
        selection: initial,
        mode: 'all',
        order: 'note',
        includeBuried: true,
      }).map((c) => c.id),
    ),
  );
  const [mode, setMode] = useState<StudyMode>(saved.settings.defaultMode),
    [order, setOrder] = useState<CardOrder>(saved.settings.defaultOrder);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<SessionStyle>('normal');
  const [extraNew, setExtraNew] = useState(false);
  const selected = useMemo(
    () =>
      selectCards(cards, saved.states, {
        selection: { decks: [], topics: [], cards: [...chosen] },
        mode,
        includeBuried: style === 'cram' || !saved.settings.scheduling,
        order: 'note',
      }),
    [cards, saved.states, saved.settings.scheduling, chosen, mode, style],
  );
  const planned =
    style === 'cram'
      ? { batch: selected, remaining: [], heldNew: 0 }
      : paceCards(selected, saved, { extraNew });
  const reviewCount = planned.batch.filter((card) => !!saved.states[card.id]?.reviewCount).length;
  const newCount = planned.batch.length - reviewCount;
  const available = cards.filter((c) => !saved.states[c.id]?.paused);
  const eligible = (group: QardCard[]) => group.filter((c) => !saved.states[c.id]?.paused);
  const toggle = (group: QardCard[]) => {
    group = eligible(group);
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
      if (style === 'cram') {
        await start(ordered, style);
      } else if (extraNew || saved.settings.reviewBatchSize || saved.settings.newCardsPerDay) {
        await start(ordered, style, mode, { extraNew });
      } else if (mode !== 'all') {
        await start(ordered, style, mode);
      } else {
        await start(ordered);
      }
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
                  available.every((c) => chosen.has(c.id))
                    ? new Set()
                    : new Set(available.map((c) => c.id)),
                )
              }
            >
              {available.every((c) => chosen.has(c.id)) ? 'Clear' : 'Select all'}
            </button>
          </div>
          {decks.map((deck) => (
            <details key={deck.name} className="qard-select-deck">
              <summary>
                <ChevronRight size={15} />
                <label onClick={(e) => e.stopPropagation()}>
                  <MixedCheckbox
                    disabled={!eligible(deck.cards).length}
                    checked={
                      !!eligible(deck.cards).length &&
                      eligible(deck.cards).every((c) => chosen.has(c.id))
                    }
                    mixed={
                      eligible(deck.cards).some((c) => chosen.has(c.id)) &&
                      !eligible(deck.cards).every((c) => chosen.has(c.id))
                    }
                    onChange={() => toggle(deck.cards)}
                    label={deck.name}
                  />
                  <strong>{deck.name}</strong>
                  <span>
                    {eligible(deck.cards).filter((c) => chosen.has(c.id)).length} /{' '}
                    {deck.cards.length}
                  </span>
                </label>
              </summary>
              {deck.topics.map((topic) => (
                <details key={topicKey(deck.name, topic.name)} className="qard-select-topic">
                  <summary>
                    <ChevronRight size={14} />
                    <label onClick={(e) => e.stopPropagation()}>
                      <MixedCheckbox
                        disabled={!eligible(topic.cards).length}
                        checked={
                          !!eligible(topic.cards).length &&
                          eligible(topic.cards).every((c) => chosen.has(c.id))
                        }
                        mixed={
                          eligible(topic.cards).some((c) => chosen.has(c.id)) &&
                          !eligible(topic.cards).every((c) => chosen.has(c.id))
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
                          disabled={!!saved.states[card.id]?.paused}
                          checked={chosen.has(card.id) && !saved.states[card.id]?.paused}
                          onChange={() => toggle([card])}
                        />
                        <span>{cardTitle(card.frontMarkdown)}</span>
                        {saved.states[card.id]?.paused && (
                          <span className="qard-paused-label">Paused</span>
                        )}
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
          {cards.some((c) => saved.states[c.id]?.paused) && (
            <p className="qard-muted qard-small">
              Paused cards stay out of sessions. Open a card preview to resume it.
            </p>
          )}
          <div className="qard-session-start">
            <span aria-live="polite">
              {selected.length} {selected.length === 1 ? 'card' : 'cards'} selected
            </span>
            <button
              className="qard-primary"
              disabled={busy || !planned.batch.length || services.index.getSnapshot().loading}
              onClick={() => void begin()}
            >
              <Play size={16} />
              {busy ? 'Preparing…' : 'Start'}
            </button>
          </div>
          {style === 'normal' &&
            (saved.settings.reviewBatchSize > 0 || saved.settings.newCardsPerDay > 0) && (
              <div className="qard-pacing-summary">
                <p className="qard-muted qard-small">
                  {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'} · {newCount} new{' '}
                  {newCount === 1 ? 'card' : 'cards'}
                </p>
                <p className="qard-muted qard-small">
                  {planned.batch.length} in this batch · {planned.remaining.length} available
                  afterwards
                  {planned.heldNew > 0
                    ? ` · ${planned.heldNew} new cards held for another day`
                    : ''}
                </p>
                {saved.settings.newCardsPerDay > 0 && (
                  <>
                    <p className="qard-muted qard-small">
                      {introductionsToday(saved.history)} / {saved.settings.newCardsPerDay} new
                      cards introduced today
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={extraNew}
                        onChange={(event) => setExtraNew(event.target.checked)}
                      />
                      Study extra new cards today
                    </label>
                  </>
                )}
              </div>
            )}
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
  disabled,
}: {
  checked: boolean;
  mixed: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      disabled={disabled}
      checked={checked}
      ref={(el) => {
        if (el) {
          el.indeterminate = mixed;
        }
      }}
      onChange={onChange}
    />
  );
}
import { cardTitle } from '../cards/card-format';
