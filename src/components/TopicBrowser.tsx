import { useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Plus, Play } from 'lucide-react';
import { DeleteItem } from './DeleteItem';
import type { Deck, QardCard } from '../cards/card-types';
export function TopicBrowser({
  deck,
  select,
  study,
  create,
  generate,
  removeDeck,
  removeTopic,
}: {
  deck: Deck;
  select: (card: QardCard) => void;
  study: (topic?: string) => void;
  create: () => void;
  generate?: () => void;
  removeDeck?: () => Promise<void>;
  removeTopic?: (topic: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  return (
    <>
      <div className="qard-heading">
        <div>
          <h1>{deck.name}</h1>
          <p>{deck.cards.length} cards</p>
        </div>
        <div className="qard-actions">
          {removeDeck && (
            <DeleteItem
              label={`Delete deck ${deck.name}`}
              description="All flashcards in this deck, across every note, will be removed. Other note content stays. This cannot be undone from Qard."
              remove={removeDeck}
            />
          )}
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
        </div>
      </div>
      <div className="qard-topics">
        {deck.topics.map((topic) => {
          const open = expanded.includes(topic.name),
            limit = limits[topic.name] || 60;
          return (
            <section className="qard-topic" key={topic.name}>
              <div className="qard-topic-heading">
                <button
                  aria-expanded={open}
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
                <div className="qard-question-list">
                  {topic.cards.slice(0, limit).map((card) => (
                    <button
                      key={`${card.sourceFile}:${card.sourcePosition.start}`}
                      className="qard-question-row"
                      onClick={() => select(card)}
                    >
                      <span>{card.frontMarkdown.split('\n')[0]}</span>
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
    </>
  );
}
