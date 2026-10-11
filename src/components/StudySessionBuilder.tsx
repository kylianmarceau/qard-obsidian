import { useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Play, Pause, ChevronRight } from 'lucide-react';
import { DeckBadge } from './DeckBadge';
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
  const selectedDeckCount = new Set(selected.map((card) => card.deck)).size;
  const selectedTopicCount = new Set(selected.map((card) => topicKey(card.deck, card.topic))).size;
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
    <div className="qard-study-setup">
      <div className="qard-heading qard-setup-heading">
        <div>
          <h1>Study</h1>
          <p>Choose the decks and topics you want to study.</p>
        </div>
        <button className="qard-text-button" onClick={back} disabled={busy}>
          <ArrowLeft size={15} />
          Cancel
        </button>
      </div>
      <div className="qard-builder">
        <section className="qard-selection" aria-label="Decks and topics">
          <div className="qard-panel-heading">
            <h2>Decks & topics</h2>
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
              {available.every((c) => chosen.has(c.id)) ? 'Clear selection' : 'Select all'}
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
                  <DeckBadge name={deck.name} />
                  <span className="qard-selection-copy">
                    <strong>{deck.name}</strong>
                    <small>
                      {deck.cards.length} {deck.cards.length === 1 ? 'card' : 'cards'} ·{' '}
                      {deck.topics.length} {deck.topics.length === 1 ? 'topic' : 'topics'}
                    </small>
                  </span>
                  <span className="qard-selection-count">
                    {eligible(deck.cards).filter((c) => chosen.has(c.id)).length} /{' '}
                    {eligible(deck.cards).length}
                  </span>
                </label>
              </summary>
              <div className="qard-selection-topics">
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
                        <span className="qard-selection-topic-name">{topic.name}</span>
                        <span className="qard-selection-count">
                          {topic.cards.length} {topic.cards.length === 1 ? 'card' : 'cards'}
                        </span>
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
              </div>
            </details>
          ))}
          {!cards.length && <p className="qard-muted">No cards yet.</p>}
        </section>
        <aside className="qard-session-options" aria-label="Session settings">
          <h2>Session</h2>
          <div className="qard-session-type-field">
            <span>Session type</span>
            <div
              className="qard-segmented qard-session-type"
              role="group"
              aria-label="Session type"
            >
              <button
                type="button"
                aria-pressed={style === 'normal'}
                disabled={busy}
                onClick={() => setStyle('normal')}
              >
                Normal
              </button>
              <button
                type="button"
                aria-pressed={style === 'cram'}
                disabled={busy}
                onClick={() => setStyle('cram')}
              >
                Cram
              </button>
            </div>
          </div>
          <p className="qard-muted qard-small qard-session-description">
            {style === 'cram'
              ? 'Practise freely. No ratings or schedule changes.'
              : 'Reveal each answer, then rate how well you remembered.'}
          </p>
          <label>
            Cards
            <select
              aria-label="Study mode"
              value={mode}
              disabled={busy}
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
              disabled={busy}
              onChange={(e) => setOrder(e.target.value as CardOrder)}
            >
              <option value="note">Note order</option>
              <option value="shuffle">Shuffle</option>
            </select>
          </label>
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
                        disabled={busy}
                        onChange={(event) => setExtraNew(event.target.checked)}
                      />
                      Study extra new cards today
                    </label>
                  </>
                )}
              </div>
            )}
          <div className="qard-session-start">
            <div className="qard-session-counts" aria-live="polite">
              <strong>
                {selected.length} {selected.length === 1 ? 'card' : 'cards'} selected
              </strong>
              <small>
                {selected.length
                  ? `${selectedDeckCount} ${selectedDeckCount === 1 ? 'deck' : 'decks'} · ${selectedTopicCount} ${selectedTopicCount === 1 ? 'topic' : 'topics'}`
                  : 'Choose a deck or topic'}
              </small>
            </div>
            <button
              className="qard-primary"
              disabled={busy || !planned.batch.length || services.index.getSnapshot().loading}
              onClick={() => void begin()}
            >
              {busy ? 'Preparing…' : 'Start session'}
              <Play size={16} />
            </button>
          </div>
          {error && (
            <p className="qard-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
      {cards.some((c) => saved.states[c.id]?.paused) && (
        <p className="qard-selection-note">
          <Pause size={13} />
          Paused cards are excluded. Open a card to resume it.
        </p>
      )}
    </div>
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
