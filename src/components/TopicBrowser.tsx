import { isBuried } from '../review/scheduler';
import { REPAIR_FAILURE_DAYS } from '../review/card-repair';
import type { ReviewState } from '../review/scheduler';
import { BulkCardActions, type CardManagement } from './BulkCardActions';
import { matchesSearch } from '../decks/deck-index';
import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Sparkles, Plus, Play, Search } from 'lucide-react';
import { DeckBadge } from './DeckBadge';
import { DeleteItem } from './DeleteItem';
import type { Deck, QardCard } from '../cards/card-types';
import { cardTitle } from '../cards/card-format';
export function TopicBrowser({
  deck,
  select,
  study,
  create,
  generate,
  removeDeck,
  removeTopic,
  states = {},
  repairDays = new Map<string, number>(),
  back,
  resume,
  management,
}: {
  deck: Deck;
  management?: CardManagement;
  states?: Record<string, ReviewState>;
  repairDays?: Map<string, number>;
  select: (card: QardCard) => void;
  study: (topic?: string) => void;
  create: () => void;
  generate?: () => void;
  removeDeck?: () => Promise<void>;
  removeTopic?: (topic: string) => Promise<void>;
  back?: () => void;
  resume?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [collapsedSearch, setCollapsedSearch] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>({
    text: '',
    error: false,
  });
  const id = useId();
  const topics = search.trim()
    ? deck.topics
        .map((topic) => ({
          ...topic,
          cards: topic.cards.filter((card) => matchesSearch(card, search)),
        }))
        .filter((topic) => topic.cards.length)
    : deck.topics;
  const visible = topics.flatMap((topic) => topic.cards).filter((card) => !card.duplicateId);
  const selectedSet = new Set(selected);
  const chosen = deck.cards.filter((card) => selectedSet.has(card.id) && !card.duplicateId);
  const toggle = (cards: QardCard[]) => {
    const ids = cards.filter((card) => !card.duplicateId).map((card) => card.id);
    setSelected((previous) => {
      const current = new Set(previous);
      const remove = ids.every((key) => current.has(key));
      for (const key of ids) {
        if (remove) {
          current.delete(key);
        } else {
          current.add(key);
        }
      }
      return [...current];
    });
    setNotice({ text: '', error: false });
  };
  return (
    <div className="qard-deck-detail">
      {back && (
        <button className="qard-text-button qard-deck-back" disabled={busy} onClick={back}>
          <ArrowLeft size={14} />
          All decks
        </button>
      )}
      <div className="qard-heading qard-deck-heading">
        <div className="qard-deck-identity">
          <DeckBadge name={deck.name} />
          <div>
            <h1>{deck.name}</h1>
            <p>
              {deck.cards.length} cards · {deck.topics.length}{' '}
              {deck.topics.length === 1 ? 'topic' : 'topics'}
            </p>
          </div>
        </div>
        <div className="qard-actions">
          <button disabled={busy} onClick={create}>
            <Plus size={16} />
            New card
          </button>
          {generate && (
            <button disabled={busy} onClick={generate}>
              <Sparkles size={16} />
              Generate with AI
            </button>
          )}
          <button className="qard-primary" disabled={busy} onClick={() => study()}>
            <Play size={16} />
            Study
          </button>
          {removeDeck && !busy && (
            <DeleteItem
              label={`Delete deck ${deck.name}`}
              description="All flashcards in this deck, across every note, will be removed. Other note content stays. This cannot be undone from Qard."
              remove={removeDeck}
            />
          )}
        </div>
      </div>
      {resume}
      <div className="qard-library-toolbar">
        <span>Topics</span>
        {management && (
          <button
            className="qard-text-button"
            disabled={busy}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((value) => !value);
              setSelected([]);
              setNotice({ text: '', error: false });
            }}
          >
            {selecting ? 'Done selecting' : 'Select cards'}
          </button>
        )}
        <label className="qard-search qard-library-search">
          <Search size={15} />
          <input
            type="search"
            aria-label="Search topics, questions, answers, or tags"
            placeholder="Find topics or cards"
            value={search}
            disabled={busy}
            onChange={(event) => {
              setSearch(event.target.value);
              setCollapsedSearch([]);
              setSelected([]);
            }}
          />
        </label>
      </div>
      {selecting && management && (
        <div className="qard-selection-options">
          <button disabled={busy || !visible.length} onClick={() => toggle(visible)}>
            {visible.length && visible.every((card) => selectedSet.has(card.id))
              ? 'Deselect matching cards'
              : 'Select matching cards'}
          </button>
          <span className="qard-muted">
            {visible.length} selectable {visible.length === 1 ? 'card' : 'cards'}
            {search.trim() ? ' match this search' : ' in this deck'}
          </span>
        </div>
      )}
      {!!chosen.length && management && (
        <BulkCardActions
          cards={chosen}
          management={management}
          busy={busy}
          setBusy={setBusy}
          clear={() => setSelected([])}
          report={(text, error = false) => setNotice({ text, error })}
        />
      )}
      {notice.text && (
        <p
          className={notice.error ? 'qard-error' : 'qard-muted'}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      <div className="qard-topics">
        {topics.map((topic) => {
          const open = search.trim()
              ? !collapsedSearch.includes(topic.name)
              : expanded.includes(topic.name),
            limit = limits[topic.name] || 60;
          const contentId = `${id}-${deck.topics.findIndex((entry) => entry.name === topic.name)}`;
          return (
            <section className="qard-topic" key={topic.name}>
              <div className="qard-topic-heading">
                {selecting && (
                  <input
                    type="checkbox"
                    aria-label={`Select topic ${topic.name}`}
                    ref={(input) => {
                      if (input) {
                        const cards = topic.cards.filter((card) => !card.duplicateId);
                        input.indeterminate =
                          cards.some((card) => selectedSet.has(card.id)) &&
                          !cards.every((card) => selectedSet.has(card.id));
                      }
                    }}
                    disabled={busy || topic.cards.every((card) => card.duplicateId)}
                    checked={
                      topic.cards.filter((card) => !card.duplicateId).length > 0 &&
                      topic.cards
                        .filter((card) => !card.duplicateId)
                        .every((card) => selectedSet.has(card.id))
                    }
                    onChange={() => toggle(topic.cards)}
                  />
                )}
                <button
                  disabled={busy}
                  aria-expanded={open}
                  aria-controls={open ? contentId : undefined}
                  onClick={() => {
                    if (search.trim()) {
                      setCollapsedSearch(
                        open
                          ? [...collapsedSearch, topic.name]
                          : collapsedSearch.filter((name) => name !== topic.name),
                      );
                    }
                    setExpanded(
                      open ? expanded.filter((t) => t !== topic.name) : [...expanded, topic.name],
                    );
                  }}
                >
                  {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <strong>{topic.name}</strong>
                  <span>{topic.cards.length} cards</span>
                </button>
                <button
                  className="qard-icon-button"
                  aria-label={`Study ${topic.name}`}
                  disabled={busy}
                  onClick={() => study(topic.name)}
                >
                  <Play size={16} />
                </button>
                {removeTopic && !busy && (
                  <DeleteItem
                    label={`Delete topic ${topic.name}`}
                    description="All flashcards in this topic, across every note, will be removed. Other topics and note content stay. This cannot be undone from Qard."
                    remove={() => removeTopic(topic.name)}
                  />
                )}
              </div>
              {open && (
                <div className="qard-question-list" id={contentId}>
                  {topic.cards.slice(0, limit).map((card) => (
                    <div
                      className="qard-selectable-question"
                      key={`${card.sourceFile}:${card.sourcePosition.start}`}
                    >
                      {selecting && (
                        <input
                          type="checkbox"
                          disabled={busy || !!card.duplicateId}
                          aria-label={`Select card ${cardTitle(card.frontMarkdown)}`}
                          checked={selectedSet.has(card.id)}
                          onChange={() => toggle([card])}
                        />
                      )}
                      <button
                        disabled={busy}
                        className="qard-question-row"
                        onClick={() => select(card)}
                      >
                        <span>{cardTitle(card.frontMarkdown)}</span>
                        {states[card.id]?.paused && (
                          <span className="qard-paused-label">Paused</span>
                        )}
                        {states[card.id]?.needsFixing && (
                          <span className="qard-warning-label">Needs fixing</span>
                        )}
                        {(repairDays.get(card.id) ?? 0) >= REPAIR_FAILURE_DAYS && (
                          <span className="qard-warning-label">Often forgotten</span>
                        )}
                        {isBuried(states[card.id]) && (
                          <span className="qard-paused-label">Tomorrow</span>
                        )}
                        {card.duplicateId && (
                          <span className="qard-warning-label">Duplicate ID</span>
                        )}
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  ))}
                  {topic.cards.length > limit && (
                    <button onClick={() => setLimits({ ...limits, [topic.name]: limit + 60 })}>
                      Show next {Math.min(60, topic.cards.length - limit)} questions
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!topics.length && (
        <div className="qard-empty">
          <p>{search ? 'No matching cards.' : 'No topics in this deck.'}</p>
          {search && <button onClick={() => setSearch('')}>Clear search</button>}
        </div>
      )}
    </div>
  );
}
