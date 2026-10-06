import { DeleteItem } from './DeleteItem';
import type { ReactNode } from 'react';
import { ChevronRight, ClipboardCheck, Plus, Search } from 'lucide-react';
import type { Deck } from '../cards/card-types';
import { DeckBadge } from './DeckBadge';
import { LibraryHeader } from './tests/TestsBrowser';
export function DeckBrowser({ decks, search, onSearch, open, create, study, loading, tests, newTest, resume, learn, plans, remove }: { decks: Deck[]; search: string; onSearch: (v: string) => void; open: (deck: string) => void; create: () => void; study: () => void; loading: boolean; tests?: () => void; newTest?: () => void; resume?: ReactNode; learn?: () => void; plans?: () => void; remove?: (deck: string) => Promise<void> }) {
  return <>
    <LibraryHeader active="decks" decks={() => {}} tests={tests} learn={learn} plans={plans} title="Your decks"><button onClick={create}><Plus size={16}/>New card</button>{newTest && <button onClick={newTest}><ClipboardCheck size={16}/>Practice test</button>}<button className="qard-primary" onClick={study}>Study</button></LibraryHeader>
    {resume}
    <label className="qard-search"><Search size={17}/><input type="search" aria-label="Search decks, topics, questions, or tags" placeholder="Search decks, topics or cards…" value={search} onChange={e => onSearch(e.target.value)}/></label>
    {loading && <p className="qard-muted" role="status">Loading cards…</p>}
    <div className="qard-deck-list">{decks.map(deck => <div key={deck.name} className="qard-deletable-row qard-deck-row"><button className="qard-deck" onClick={() => open(deck.name)}>
      <DeckBadge name={deck.name}/>
      <span className="qard-deck-name"><strong>{deck.name}</strong><small>{deck.cards.length} cards · {deck.topics.length} {deck.topics.length === 1 ? 'topic' : 'topics'}</small></span><ChevronRight size={17}/>
    </button>{remove && <DeleteItem label={`Delete deck ${deck.name}`} description="All flashcards in this deck, across every note, will be removed. Other note content stays. This cannot be undone from Qard." remove={() => remove(deck.name)}/>}</div>)}</div>
    {!loading && !decks.length && <div className="qard-empty"><p>{search ? 'No matching cards.' : 'No cards yet.'}</p>{search ? <button onClick={() => onSearch('')}>Clear search</button> : <button onClick={create}>Create a card</button>}</div>}
  </>;
}
