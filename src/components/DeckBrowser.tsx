import { DeleteItem } from './DeleteItem';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  Plus,
  Search,
  Play,
  Layers,
  Check,
} from 'lucide-react';
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
  viewToday?: () => void;
}) {
  return (
    <>
      {!hideNavigation && (
        <LibraryTabs active="decks" decks={() => {}} tests={tests} learn={learn} plans={plans} />
      )}
      <div className="qard-study-desk">
        <header className="qard-heading qard-desk-heading">
          <div>
            <h1>Your decks</h1>
            <p>
              {decks.length} {decks.length === 1 ? 'deck' : 'decks'} ·{' '}
              {decks.reduce((count, deck) => count + deck.cards.length, 0).toLocaleString()} cards
            </p>
          </div>
          <button className="qard-desk-new" onClick={create}>
            <Plus size={16} /> New card
          </button>
        </header>
        <section className="qard-desk-review-main" aria-label="Today’s review">
          <span className="qard-desk-review-icon" aria-hidden="true">
            {!loading && !dueCount ? <Check size={21} /> : <Layers size={21} />}
          </span>
          <div className="qard-desk-review-copy">
            <h2>{!loading && !dueCount ? 'All caught up' : 'Today’s review'}</h2>
            <p className="qard-desk-due" role="status">
              {loading ? (
                'Checking your review queue…'
              ) : dueCount ? (
                <>
                  <strong>{dueCount.toLocaleString()}</strong> {dueCount === 1 ? 'card' : 'cards'}{' '}
                  ready to revisit.
                </>
              ) : (
                'Nothing due today. Study at your own pace.'
              )}
            </p>
          </div>
          <button
            className={dueCount ? 'qard-primary' : 'qard-desk-review-action'}
            disabled={loading || (dueCount > 0 && !viewToday)}
            onClick={dueCount ? viewToday : study}
          >
            {dueCount || loading ? 'Start review' : 'Study'} <ArrowRight size={16} />
          </button>
        </section>
        <section className="qard-desk-library" aria-label="Deck library">
          {resume}
          <div className="qard-library-toolbar">
            <span>{search || repairFilter?.active ? 'Matching decks' : 'All decks'}</span>
            <label className="qard-search qard-library-search">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search decks, topics, questions, answers, or tags"
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
                      {deck.cards.length.toLocaleString()}{' '}
                      {deck.cards.length === 1 ? 'card' : 'cards'} · {deck.topics.length}{' '}
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
        <section className="qard-desk-create" aria-label="More ways to study">
          <button onClick={study}>
            <span className="qard-desk-tool-icon">
              <Play size={18} />
            </span>
            <span>
              <strong>Study</strong>
              <small>Choose your cards and pace</small>
            </span>
            <ArrowRight size={16} />
          </button>
          {newTest && (
            <button onClick={newTest}>
              <span className="qard-desk-tool-icon">
                <ClipboardCheck size={18} />
              </span>
              <span>
                <strong>Practice test</strong>
                <small>Put your knowledge to the test</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )}
        </section>
      </div>
    </>
  );
}
