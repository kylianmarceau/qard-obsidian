import type { ReactNode } from 'react';
import { ChevronRight, ClipboardCheck, Layers, Plus, Search } from 'lucide-react';
import type { Deck } from '../cards/card-types';
import { LibraryTabs } from './tests/TestsBrowser';
export function DeckBrowser({ decks, search, onSearch, open, create, study, loading, tests, newTest, resume }: { decks: Deck[]; search: string; onSearch: (v: string) => void; open: (deck: string) => void; create: () => void; study: () => void; loading: boolean; tests?: () => void; newTest?: () => void; resume?: ReactNode }) {
  return <>
    <div className="qard-heading">{tests ? <LibraryTabs active="decks" decks={() => {}} tests={tests}/> : <h1>Decks</h1>}<div className="qard-actions"><button onClick={create}><Plus size={16}/>New card</button>{newTest && <button onClick={newTest}><ClipboardCheck size={16}/>Practice test</button>}<button className="qard-primary" onClick={study}>Study</button></div></div>
    {resume}
    <label className="qard-search"><Search size={17}/><input type="search" aria-label="Search decks, topics, questions, or tags" placeholder="Search…" value={search} onChange={e => onSearch(e.target.value)}/></label>
    {loading && <p className="qard-muted" role="status">Loading cards…</p>}
    <div className="qard-deck-list">{decks.map((deck, i) => <button key={deck.name} className="qard-deck" onClick={() => open(deck.name)}>
      <span className={`qard-deck-icon qard-tone-${i % 4}`}><Layers size={21} strokeWidth={1.6}/></span>
      <span className="qard-deck-name"><strong>{deck.name}</strong><small>{deck.cards.length} cards · {deck.topics.length} {deck.topics.length === 1 ? 'topic' : 'topics'}</small></span><ChevronRight size={17}/>
    </button>)}</div>
    {!loading && !decks.length && <div className="qard-empty"><p>{search ? 'No matching cards.' : 'No cards yet.'}</p>{search ? <button onClick={() => onSearch('')}>Clear search</button> : <button onClick={create}>Create a card</button>}</div>}
  </>;
}
