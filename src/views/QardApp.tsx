import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Layers, ChevronRight, AlertCircle } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { Selection } from '../review/session';
import { buildDecks, matchesSearch, topicKey } from '../decks/deck-index';
import { DeckBrowser } from '../components/DeckBrowser';
import { TopicBrowser } from '../components/TopicBrowser';
import { CardPreview } from '../components/CardPreview';
import { GenerateFlashcards } from '../components/GenerateFlashcards';
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
import { CourseView, LearnBrowser, MapCourse, TodayRow, TodayView } from '../components/learn/LearnScreens';
import { CheckView } from '../components/learn/CheckView';
import { LessonView } from '../components/learn/LessonView';
import type { LearnNav } from '../components/learn/common';
import { scheduler } from '../review/scheduler';
import { RunningJobs } from '../components/jobs/RunningJobs';
import { UsageView } from '../components/usage/UsageView';
import type { QardServices, UiRequest } from './services';
type Screen = { kind: 'library' } | { kind: 'deck'; deck: string } | { kind: 'card'; card: QardCard } | { kind: 'editor' | 'generate-cards'; draft?: Partial<CardDraft> } | { kind: 'builder'; selection: Selection } | { kind: 'study'; cards: QardCard[]; serial: number }
  | { kind: 'tests' } | { kind: 'new-test'; prompt?: string; serial: number } | { kind: 'plan' | 'take' | 'results' | 'test-cards'; folder: string } | { kind: 'review'; folder: string; question?: string }
  | { kind: 'today' | 'learn' | 'usage' } | { kind: 'map-course'; folder?: string } | { kind: 'check' | 'lesson'; path: string } | { kind: 'course'; path: string; objective?: string; serial: number };
const LEARN_SCREENS = ['today', 'learn', 'map-course', 'course', 'check', 'lesson'];
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
    else if (request.kind === 'today' || request.kind === 'learn' || request.kind === 'usage') setScreen({ kind: request.kind });
    else if (request.kind === 'lesson' && request.path) setScreen({ kind: 'lesson', path: request.path });
    else setScreen({ kind: 'library' });
  }, [request]);
  const filtered = useMemo(() => search.trim() ? buildDecks(index.cards.filter(c => matchesSearch(c, search))) : index.decks, [index, search]);
  const activeDeck = screen.kind === 'deck' ? screen.deck : screen.kind === 'card' ? screen.card.deck : '';
  const deck = filtered.find(d => d.name === activeDeck);
  const generateCards = (draft?: Partial<CardDraft>) => setScreen({ kind: 'generate-cards', draft });
  const library = () => { setScreen({ kind: 'library' }); };
  const builder = (selection: Selection = { decks: [], topics: [], cards: [] }) => setScreen({ kind: 'builder', selection });
  const start = (cards: QardCard[]) => { setScreen({ kind: 'study', cards, serial: Date.now() }); };
  const study = screen.kind === 'study';
  const nav = useMemo<TestNav>(() => ({
    library: () => setScreen({ kind: 'library' }), tests: () => setScreen({ kind: 'tests' }), newTest: prompt => setScreen({ kind: 'new-test', prompt, serial: Date.now() }),
    plan: folder => setScreen({ kind: 'plan', folder }), take: folder => setScreen({ kind: 'take', folder }), results: folder => setScreen({ kind: 'results', folder }),
    review: (folder, question) => setScreen({ kind: 'review', folder, question }), cards: folder => setScreen({ kind: 'test-cards', folder })
  }), []);
  const learnNav = useMemo<LearnNav>(() => ({
    library: () => setScreen({ kind: 'library' }), today: () => setScreen({ kind: 'today' }), learn: () => setScreen({ kind: 'learn' }), mapCourse: folder => setScreen({ kind: 'map-course', folder }), usage: () => setScreen({ kind: 'usage' }),
    course: (path, objective) => setScreen({ kind: 'course', path, objective, serial: Date.now() }), check: path => setScreen({ kind: 'check', path }), lesson: path => setScreen({ kind: 'lesson', path }),
    // Today reviews only cards already in rotation, most overdue first.
    studyDue: () => { const { states } = services.reviews.getSnapshot(), now = Date.now(); setScreen({ kind: 'study', serial: now, cards: services.index.getSnapshot().cards.filter(c => (states[c.id]?.reviewCount ?? 0) > 0 && scheduler.isDue(states[c.id], now)).sort((a, b) => (states[a.id]?.due ?? 0) - (states[b.id]?.due ?? 0)) }); }
  }), [services]);
  const onLearn = LEARN_SCREENS.includes(screen.kind);
  const learnPath = 'path' in screen ? screen.path : '';
  const learnLabel = screen.kind === 'today' ? 'Today' : screen.kind === 'map-course' ? 'Map a course' : screen.kind === 'course' ? learnPath.split('/').pop()!.replace(/\.md$/, '').replace(/ mastery$/i, '') : screen.kind === 'check' ? 'Check' : screen.kind === 'lesson' ? 'Lesson' : '';
  const testFolder = 'folder' in screen ? screen.folder : '';
  const testEntry = testFolder ? services.tests.get(testFolder) : undefined;
  const testTitle = testEntry?.test?.title || testEntry?.plan?.title || '';
  const onTests = ['tests', 'new-test', 'plan', 'take', 'results', 'review', 'test-cards'].includes(screen.kind);
  return <div className={'qard-app ' + (study ? 'qard-is-studying' : '')}>
    <main className="qard-main">{!study && <header className="qard-topbar"><nav className="qard-breadcrumb" aria-label="Breadcrumb"><button className="qard-wordmark" onClick={library} aria-label="Qard — all decks"><Layers size={19}/>Qard</button>{onLearn ? <><ChevronRight size={14}/><button onClick={learnNav.learn}>Learn</button>{learnLabel && <><ChevronRight size={14}/><span>{learnLabel}</span></>}</> : onTests ? <><ChevronRight size={14}/><button onClick={nav.tests}>Tests</button>{screen.kind === 'new-test' && <><ChevronRight size={14}/><span>New</span></>}{testFolder && <><ChevronRight size={14}/>{screen.kind === 'take' ? <span>{testTitle || 'Test'}</span> : <button onClick={() => testEntry?.test ? nav.results(testFolder) : nav.plan(testFolder)}>{testTitle || 'Test'}</button>}{TEST_LABEL[screen.kind] && <><ChevronRight size={14}/><span>{TEST_LABEL[screen.kind]}</span></>}</>}</> : activeDeck ? <><ChevronRight size={14}/><button onClick={() => setScreen({ kind: 'deck', deck: activeDeck })}>{activeDeck}</button>{screen.kind === 'card' && <><ChevronRight size={14}/><span>{screen.card.topic}</span></>}</> : screen.kind !== 'library' && <><ChevronRight size={14}/><span>{screen.kind === 'builder' ? 'Study' : screen.kind === 'usage' ? 'Token usage' : screen.kind === 'generate-cards' ? 'Generate flashcards' : 'New card'}</span></>}</nav><RunningJobs services={services} nav={nav} learnNav={learnNav} flashcards={() => generateCards()}/></header>}
      <div className={study ? 'qard-study-container' : screen.kind === 'review' ? 'qard-page qard-page-wide' : 'qard-page'}>
        {!study && !onTests && !onLearn && index.issues.length > 0 && <div className="qard-index-issues"><button onClick={() => setIssues(!issues)} aria-expanded={issues}><AlertCircle size={16}/>{index.issues.length} note {index.issues.length === 1 ? 'issue' : 'issues'} to check</button>{issues && <ul>{index.issues.slice(0, 50).map((issue, i) => <li key={i}><strong>{issue.file}:{issue.line + 1}</strong> — {issue.message}</li>)}</ul>}</div>}
        {screen.kind === 'library' && <DeckBrowser decks={filtered} search={search} onSearch={setSearch} open={name => setScreen({ kind: 'deck', deck: name })} create={() => setScreen({ kind: 'editor' })} generate={services.flashcards ? () => generateCards() : undefined} study={() => builder()} loading={index.loading} tests={nav.tests} newTest={() => nav.newTest()} learn={learnNav.learn} resume={!search.trim() && <><TodayRow services={services} nav={learnNav}/><ResumeTest services={services} nav={nav}/></>}/>}
        {screen.kind === 'deck' && (deck ? <><TopicBrowser key={deck.name} deck={deck} select={card => setScreen({ kind: 'card', card })} study={topic => builder(topic ? { decks: [], topics: [topicKey(deck.name, topic)], cards: [] } : { decks: [deck.name], topics: [], cards: [] })} create={() => setScreen({ kind: 'editor', draft: { deck: deck.name } })} generate={services.flashcards ? () => generateCards({ deck: deck.name }) : undefined}/></> : <div className="qard-empty"><h2>No cards in this deck.</h2><p>The notes may have changed, or your search excludes them.</p><button onClick={() => { setSearch(''); library(); }}>Back to all decks</button></div>)}
        {screen.kind === 'card' && <CardPreview key={screen.card.id} card={screen.card} services={services} back={() => setScreen({ kind: 'deck', deck: screen.card.deck })} study={() => builder({ decks: [], topics: [], cards: [screen.card.id] })} changed={card => setScreen({ kind: 'card', card })}/>}
        {screen.kind === 'editor' && <CardEditor key={JSON.stringify(screen.draft)} services={services} initial={screen.draft} generate={services.flashcards ? generateCards : undefined} cancel={library} saved={card => { setSearch(''); setScreen({ kind: 'card', card }); }}/>}
        {screen.kind === 'generate-cards' && services.flashcards && <GenerateFlashcards services={services} initial={screen.draft} back={library} openDeck={deck => { setSearch(''); setScreen({ kind: 'deck', deck }); }}/>}
        {screen.kind === 'builder' && <StudySessionBuilder key={JSON.stringify(screen.selection)} services={services} cards={index.cards} decks={index.decks} initial={screen.selection} start={start} back={library}/>}
        {screen.kind === 'tests' && <TestsBrowser services={services} nav={nav} learn={learnNav.learn}/>}
        {screen.kind === 'today' && <TodayView services={services} nav={learnNav}/>}
        {screen.kind === 'usage' && <UsageView services={services}/>}
        {screen.kind === 'learn' && <LearnBrowser services={services} nav={learnNav} testNav={nav}/>}
        {screen.kind === 'map-course' && <MapCourse key={screen.folder ?? ''} services={services} nav={learnNav} initialFolder={screen.folder}/>}
        {screen.kind === 'course' && <CourseView key={screen.path + screen.serial} services={services} nav={learnNav} path={screen.path} objective={screen.objective}/>}
        {screen.kind === 'check' && <CheckView key={screen.path} services={services} nav={learnNav} path={screen.path}/>}
        {screen.kind === 'lesson' && <LessonView key={screen.path} services={services} nav={learnNav} path={screen.path}/>}
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
