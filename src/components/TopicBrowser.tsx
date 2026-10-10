import { isBuried } from '../review/scheduler';
import { REPAIR_FAILURE_DAYS } from '../review/card-repair';
import type { ReviewState } from '../review/scheduler';
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
}: {
  deck: Deck;
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
  const id = useId();
  const topics = deck.topics.filter((topic) =>
    topic.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="qard-deck-detail">
      {back && (
        <button className="qard-text-button qard-deck-back" onClick={back}>
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
          <button onClick={create}>
            <Plus size={16} />
            New card
          </button>
          {generate && (
            <button onClick={generate}>
              <Sparkles size={16} />
              Generate with AI
            </button>
          )}
          <button className="qard-primary" onClick={() => study()}>
            <Play size={16} />
            Study
          </button>
          {removeDeck && (
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
        <label className="qard-search qard-library-search">
          <Search size={15} />
          <input
            type="search"
            aria-label="Find a topic"
            placeholder="Find a topic"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="qard-topics">
        {topics.map((topic) => {
          const open = expanded.includes(topic.name),
            limit = limits[topic.name] || 60;
          const contentId = `${id}-${deck.topics.indexOf(topic)}`;
          return (
            <section className="qard-topic" key={topic.name}>
              <div className="qard-topic-heading">
                <button
                  aria-expanded={open}
                  aria-controls={open ? contentId : undefined}
                  onClick={() =>
                    setExpanded(
                      open ? expanded.filter((t) => t !== topic.name) : [...expanded, topic.name],
                    )
                  }
                >
                  {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <strong>{topic.name}</strong>
                  <span>{topic.cards.length} cards</span>
                </button>
                <button
                  className="qard-icon-button"
                  aria-label={`Study ${topic.name}`}
                  onClick={() => study(topic.name)}
                >
                  <Play size={16} />
                </button>
                {removeTopic && (
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
                    <button
                      key={`${card.sourceFile}:${card.sourcePosition.start}`}
                      className="qard-question-row"
                      onClick={() => select(card)}
                    >
                      <span>{cardTitle(card.frontMarkdown)}</span>
                      {states[card.id]?.paused && <span className="qard-paused-label">Paused</span>}
                      {states[card.id]?.needsFixing && (
                        <span className="qard-warning-label">Needs fixing</span>
                      )}
                      {(repairDays.get(card.id) ?? 0) >= REPAIR_FAILURE_DAYS && (
                        <span className="qard-warning-label">Often forgotten</span>
                      )}
                      {isBuried(states[card.id]) && (
                        <span className="qard-paused-label">Tomorrow</span>
                      )}
                      {card.duplicateId && <span className="qard-warning-label">Duplicate ID</span>}
                      <ChevronRight size={15} />
                    </button>
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
          <p>{search ? 'No matching topics.' : 'No topics in this deck.'}</p>
          {search && <button onClick={() => setSearch('')}>Clear search</button>}
        </div>
      )}
    </div>
  );
}
