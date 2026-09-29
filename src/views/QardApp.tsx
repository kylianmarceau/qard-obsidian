import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Layers, ChevronRight, AlertCircle } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { Selection } from '../review/session';
import { buildDecks, matchesSearch, topicKey } from '../decks/deck-index';
import { DeckBrowser } from '../components/DeckBrowser';
import { TopicBrowser } from '../components/TopicBrowser';
import { CardPreview } from '../components/CardPreview';
import { CardEditor } from '../components/CardEditor';
import { StudySessionBuilder } from '../components/StudySessionBuilder';
import { StudyView } from './StudyView';
import { ResumeTest, TestsBrowser } from '../components/tests/TestsBrowser';
import { NewTest } from '../components/tests/NewTest';
import { PlanView } from '../components/tests/PlanView';
import { TakeTest } from '../components/tests/TakeTest';
import { TestResults } from '../components/tests/TestResults';
import { ReviewAnswers } from '../components/tests/ReviewAnswers';
import { SuggestedCards } from '../components/tests/SuggestedCards';
import type { TestNav } from '../components/tests/common';
import type { QardServices, UiRequest } from './services';
type Screen = { kind: 'library' } | { kind: 'deck'; deck: string } | { kind: 'card'; card: QardCard } | { kind: 'editor'; draft?: Partial<CardDraft> } | { kind: 'builder'; selection: Selection } | { kind: 'study'; cards: QardCard[]; serial: number }
  | { kind: 'tests' } | { kind: 'new-test'; prompt?: string; serial: number } | { kind: 'plan' | 'take' | 'results' | 'test-cards'; folder: string } | { kind: 'review'; folder: string; question?: string };
const TEST_LABEL: Record<string, string> = { plan: 'Plan', take: '', results: 'Results', review: 'Review', 'test-cards': 'Suggested cards' };
export function QardApp({ services, request }: { services: QardServices; request?: UiRequest }) {
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [screen, setScreen] = useState<Screen>({ kind: 'library' }), [search, setSearch] = useState('');
  const [issues, setIssues] = useState(false);
  useEffect(() => {
    if (!request) return;
    if (request.kind === 'builder') setScreen({ kind: 'builder', selection: request.selection || { decks: [], topics: [], cards: [] } });
    else if (request.kind === 'create') setScreen({ kind: 'editor', draft: request.draft });
    else if (request.kind === 'new-test') setScreen({ kind: 'new-test', serial: request.serial });
    else if (request.kind === 'tests') setScreen({ kind: 'tests' });
    else setScreen({ kind: 'library' });
  }, [request]);
  const filtered = useMemo(() => search.trim() ? buildDecks(index.cards.filter(c => matchesSearch(c, search))) : index.decks, [index, search]);
  const activeDeck = screen.kind === 'deck' ? screen.deck : screen.kind === 'card' ? screen.card.deck : '';
  const deck = filtered.find(d => d.name === activeDeck);
  const library = () => { setScreen({ kind: 'library' }); };
  const builder = (selection: Selection = { decks: [], topics: [], cards: [] }) => setScreen({ kind: 'builder', selection });
  const start = (cards: QardCard[]) => { setScreen({ kind: 'study', cards, serial: Date.now() }); };
  const study = screen.kind === 'study';
  const nav = useMemo<TestNav>(() => ({
    library: () => setScreen({ kind: 'library' }), tests: () => setScreen({ kind: 'tests' }), newTest: prompt => setScreen({ kind: 'new-test', prompt, serial: Date.now() }),
    plan: folder => setScreen({ kind: 'plan', folder }), take: folder => setScreen({ kind: 'take', folder }), results: folder => setScreen({ kind: 'results', folder }),
    review: (folder, question) => setScreen({ kind: 'review', folder, question }), cards: folder => setScreen({ kind: 'test-cards', folder })
  }), []);
  const testFolder = 'folder' in screen ? screen.folder : '';
  const testEntry = testFolder ? services.tests.get(testFolder) : undefined;
  const testTitle = testEntry?.test?.title || testEntry?.plan?.title || '';
  const onTests = ['tests', 'new-test', 'plan', 'take', 'results', 'review', 'test-cards'].includes(screen.kind);
  return <div className={'qard-app ' + (study ? 'qard-is-studying' : '')}>
    <main className="qard-main">{!study && <header className="qard-topbar"><nav className="qard-breadcrumb" aria-label="Breadcrumb"><button className="qard-wordmark" onClick={library} aria-label="Qard — all decks"><Layers size={19}/>Qard</button>{onTests ? <><ChevronRight size={14}/><button onClick={nav.tests}>Tests</button>{screen.kind === 'new-test' && <><ChevronRight size={14}/><span>New</span></>}{testFolder && <><ChevronRight size={14}/>{screen.kind === 'take' ? <span>{testTitle || 'Test'}</span> : <button onClick={() => testEntry?.test ? nav.results(testFolder) : nav.plan(testFolder)}>{testTitle || 'Test'}</button>}{TEST_LABEL[screen.kind] && <><ChevronRight size={14}/><span>{TEST_LABEL[screen.kind]}</span></>}</>}</> : activeDeck ? <><ChevronRight size={14}/><button onClick={() => setScreen({ kind: 'deck', deck: activeDeck })}>{activeDeck}</button>{screen.kind === 'card' && <><ChevronRight size={14}/><span>{screen.card.topic}</span></>}</> : screen.kind !== 'library' && <><ChevronRight size={14}/><span>{screen.kind === 'builder' ? 'Study' : 'New card'}</span></>}</nav></header>}
      <div className={study ? 'qard-study-container' : screen.kind === 'review' ? 'qard-page qard-page-wide' : 'qard-page'}>
        {!study && !onTests && index.issues.length > 0 && <div className="qard-index-issues"><button onClick={() => setIssues(!issues)} aria-expanded={issues}><AlertCircle size={16}/>{index.issues.length} note {index.issues.length === 1 ? 'issue' : 'issues'} to check</button>{issues && <ul>{index.issues.slice(0, 50).map((issue, i) => <li key={i}><strong>{issue.file}:{issue.line + 1}</strong> — {issue.message}</li>)}</ul>}</div>}
        {screen.kind === 'library' && <DeckBrowser decks={filtered} search={search} onSearch={setSearch} open={name => setScreen({ kind: 'deck', deck: name })} create={() => setScreen({ kind: 'editor' })} study={() => builder()} loading={index.loading} tests={nav.tests} newTest={() => nav.newTest()} resume={!search.trim() && <ResumeTest services={services} nav={nav}/>}/>}
        {screen.kind === 'deck' && (deck ? <><TopicBrowser key={deck.name} deck={deck} select={card => setScreen({ kind: 'card', card })} study={topic => builder(topic ? { decks: [], topics: [topicKey(deck.name, topic)], cards: [] } : { decks: [deck.name], topics: [], cards: [] })} create={() => setScreen({ kind: 'editor', draft: { deck: deck.name } })}/></> : <div className="qard-empty"><h2>No cards in this deck.</h2><p>The notes may have changed, or your search excludes them.</p><button onClick={() => { setSearch(''); library(); }}>Back to all decks</button></div>)}
        {screen.kind === 'card' && <CardPreview key={screen.card.id} card={screen.card} services={services} back={() => setScreen({ kind: 'deck', deck: screen.card.deck })} study={() => builder({ decks: [], topics: [], cards: [screen.card.id] })} changed={card => setScreen({ kind: 'card', card })}/>}
        {screen.kind === 'editor' && <CardEditor key={JSON.stringify(screen.draft)} services={services} initial={screen.draft} cancel={library} saved={card => { setSearch(''); setScreen({ kind: 'card', card }); }}/>} 
        {screen.kind === 'builder' && <StudySessionBuilder key={JSON.stringify(screen.selection)} services={services} cards={index.cards} decks={index.decks} initial={screen.selection} start={start} back={library}/>}
        {screen.kind === 'tests' && <TestsBrowser services={services} nav={nav}/>}
        {screen.kind === 'new-test' && <NewTest key={screen.serial} services={services} nav={nav} initialPrompt={screen.prompt}/>}
        {screen.kind === 'plan' && <PlanView key={screen.folder} services={services} nav={nav} folder={screen.folder}/>}
        {screen.kind === 'take' && <TakeTest key={screen.folder} services={services} nav={nav} folder={screen.folder}/>}
        {screen.kind === 'results' && <TestResults key={screen.folder} services={services} nav={nav} folder={screen.folder}/>}
        {screen.kind === 'review' && <ReviewAnswers key={screen.folder + (screen.question ?? '')} services={services} nav={nav} folder={screen.folder} initial={screen.question}/>}
        {screen.kind === 'test-cards' && <SuggestedCards key={screen.folder} services={services} nav={nav} folder={screen.folder}/>}
        {screen.kind === 'study' && <StudyView key={screen.serial} services={services} cards={screen.cards} exit={library} repeat={start}/>}
      </div>
    </main>
  </div>;
}
