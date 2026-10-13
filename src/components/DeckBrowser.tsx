import { DeleteItem } from './DeleteItem';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Plus,
  Search,
  Play,
  Settings2,
} from 'lucide-react';
import type { Deck } from '../cards/card-types';
import { buildDeckTree, type DeckNode } from '../decks/deck-index';
import { DeckBadge } from './DeckBadge';
import { LibraryTabs } from './library/LibraryHeader';
export function DeckBrowser({
  decks,
  search,
  onSearch,
  open: openDeck,
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
  nested = false,
  studyDecks,
  options,
}: {
  /** Group decks named `Parent::Child` under their parents. Off while searching or filtering. */
  nested?: boolean;
  studyDecks?: (decks: string[]) => void;
  options?: (deck: string) => void;
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
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (name: string) =>
    setCollapsed((old) => (old.includes(name) ? old.filter((n) => n !== name) : [...old, name]));
  const count = (cards: number) => `${cards} ${cards === 1 ? 'card' : 'cards'}`;
  const row = (node: DeckNode): ReactNode => {
    const { deck } = node,
      parent = node.children.length > 0,
      open = !collapsed.includes(node.name);
    const below = node.cards - (deck?.cards.length ?? 0);
    return (
      <div key={node.name} className="qard-deck-node">
        <div className="qard-deletable-row qard-deck-row">
          {parent && (
            <button
              className="qard-deck-toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
              onClick={() => toggle(node.name)}
            >
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
          <button
            className="qard-deck"
            onClick={() => (deck ? openDeck(deck.name) : toggle(node.name))}
            {...(deck ? {} : { 'aria-expanded': open })}
          >
            <DeckBadge name={node.label} />
            <span className="qard-deck-name">
              <strong>{nested ? node.label : (deck?.name ?? node.label)}</strong>
              <small>
                {deck
                  ? `${deck.cards.length} cards · ${deck.topics.length} ${deck.topics.length === 1 ? 'topic' : 'topics'}`
                  : count(node.cards)}
                {deck && below > 0 ? ` · ${below} in subdecks` : ''}
              </small>
            </span>
            {deck && <ChevronRight size={17} />}
          </button>
          {parent && options && (
            <button
              className="qard-icon-button"
              aria-label={`Deck options for ${node.name}`}
              onClick={() => options(node.name)}
            >
              <Settings2 size={16} />
            </button>
          )}
          {parent && studyDecks && (
            <button
              className="qard-deck-study"
              aria-label={`Study ${node.name} and its subdecks`}
              onClick={() => studyDecks(node.decks)}
            >
              <Play size={15} />
              Study all
            </button>
          )}
          {remove && deck && (
            <DeleteItem
              label={`Delete deck ${deck.name}`}
              description="All flashcards in this deck, across every note, will be removed. Other note content stays. This cannot be undone from Qard."
              remove={() => remove(deck.name)}
            />
          )}
        </div>
        {parent && open && <div className="qard-deck-children">{node.children.map(row)}</div>}
      </div>
    );
  };
  const flat = (deck: Deck): DeckNode => ({
    name: deck.name,
    label: deck.name,
    deck,
    children: [],
    cards: deck.cards.length,
    decks: [deck.name],
  });
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
            {(nested ? buildDeckTree(decks) : decks.map(flat)).map(row)}
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
              disabled={loading || !dueCount || !viewToday}
              onClick={viewToday}
            >
              Start review <ArrowRight size={16} />
            </button>
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
