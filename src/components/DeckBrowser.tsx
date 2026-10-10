import { DeleteItem } from './DeleteItem';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronRight, ClipboardCheck, Plus, Search, Play } from 'lucide-react';
import type { Deck } from '../cards/card-types';
import { DeckBadge } from './DeckBadge';
import { LibraryTabs } from './library/LibraryHeader';
export function DeckBrowser({
  decks,
  search,
  onSearch,
  open,
  create,
  study,
  loading,
  tests,
  newTest,
  resume,
  learn,
  plans,
  remove,
  repairFilter,
  hideNavigation = false,
  dueCount = 0,
  reviewToday,
  viewToday,
}: {
  repairFilter?: { active: boolean; count: number; toggle: () => void };
  decks: Deck[];
  search: string;
  onSearch: (v: string) => void;
  open: (deck: string) => void;
  create: () => void;
  study: () => void;
  loading: boolean;
  tests?: () => void;
  newTest?: () => void;
  resume?: ReactNode;
  learn?: () => void;
  plans?: () => void;
  remove?: (deck: string) => Promise<void>;
  hideNavigation?: boolean;
  dueCount?: number;
  reviewToday?: () => void;
  viewToday?: () => void;
}) {
  return (
    <>
      {!hideNavigation && (
        <LibraryTabs active="decks" decks={() => {}} tests={tests} learn={learn} plans={plans} />
      )}
      <div className="qard-study-desk">
        <section className="qard-desk-library" aria-label="Deck library">
          <div className="qard-heading qard-desk-heading">
            <div>
              <h1>Your decks</h1>
              <p>
                {decks.length} {decks.length === 1 ? 'deck' : 'decks'} ·{' '}
                {decks.reduce((count, deck) => count + deck.cards.length, 0).toLocaleString()} cards
              </p>
            </div>
          </div>
          {resume}
          <div className="qard-library-toolbar">
            <span>{search || repairFilter?.active ? 'Matching decks' : 'All decks'}</span>
            <label className="qard-search qard-library-search">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search decks, topics, questions, or tags"
                placeholder="Find decks or cards"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
              />
            </label>
          </div>
          {repairFilter && (repairFilter.count > 0 || repairFilter.active) && (
            <button
              className="qard-repair-filter"
              aria-pressed={repairFilter.active}
              onClick={repairFilter.toggle}
            >
              Needs fixing · {repairFilter.count}
            </button>
          )}
          {loading && (
            <p className="qard-muted" role="status">
              Loading cards…
            </p>
          )}
          <div className="qard-deck-list">
            {decks.map((deck) => (
              <div key={deck.name} className="qard-deletable-row qard-deck-row">
                <button className="qard-deck" onClick={() => open(deck.name)}>
                  <DeckBadge name={deck.name} />
                  <span className="qard-deck-name">
                    <strong>{deck.name}</strong>
                    <small>
                      {deck.cards.length} cards · {deck.topics.length}{' '}
                      {deck.topics.length === 1 ? 'topic' : 'topics'}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
                {remove && (
                  <DeleteItem
                    label={`Delete deck ${deck.name}`}
                    description="All flashcards in this deck, across every note, will be removed. Other note content stays. This cannot be undone from Qard."
                    remove={() => remove(deck.name)}
                  />
                )}
              </div>
            ))}
          </div>
          {!loading && !decks.length && (
            <div className="qard-empty">
              <p>
                {repairFilter?.active
                  ? 'No cards need fixing.'
                  : search
                    ? 'No matching cards.'
                    : 'No cards yet.'}
              </p>
              {repairFilter?.active ? (
                <button onClick={repairFilter.toggle}>Show all cards</button>
              ) : search ? (
                <button onClick={() => onSearch('')}>Clear search</button>
              ) : (
                <button onClick={create}>Create a card</button>
              )}
            </div>
          )}
        </section>
        <aside className="qard-desk-review" aria-label="Study controls">
          <section className="qard-desk-review-main">
            <h2>Today’s review</h2>
            <div className="qard-desk-due" aria-live="polite">
              <strong>{loading ? '…' : dueCount.toLocaleString()}</strong>
              <span>{dueCount === 1 ? 'card due' : 'cards due'}</span>
            </div>
            <button
              className="qard-primary"
              disabled={loading || !dueCount || !reviewToday}
              onClick={reviewToday}
            >
              Start review <ArrowRight size={16} />
            </button>
            {viewToday && (
              <button className="qard-text-button qard-desk-today-link" onClick={viewToday}>
                View today’s cards
              </button>
            )}
          </section>
          <section className="qard-desk-create">
            <h2>Create & study</h2>
            <button onClick={create}>
              <Plus size={16} />
              New card
            </button>
            {newTest && (
              <button onClick={newTest}>
                <ClipboardCheck size={16} />
                Practice test
              </button>
            )}
            <button onClick={study}>
              <Play size={16} />
              Study
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
