import { failureDays, needsRepair } from '../review/card-repair';
import type { Screen } from './navigation';
import { SavedSessions } from '../components/SavedSessions';
import { ExamPlanner } from '../components/ExamPlanner';
import { SourceUpdates, SourceUpdatesRow } from '../components/SourceUpdates';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronRight, AlertCircle, BarChart3 } from 'lucide-react';
import { QardLogo } from '../components/QardLogo';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { Selection, SessionStyle, StudyMode } from '../review/session';
import { hasRemainingSession } from '../review/saved-session';
import { buildDecks, matchesSearch, topicKey } from '../decks/deck-index';
import { DeckBrowser } from '../components/DeckBrowser';
import { TopicBrowser } from '../components/TopicBrowser';
import { CardPreview } from '../components/CardPreview';
import { GenerateFlashcards } from '../components/GenerateFlashcards';
import { ResumeFlashcards } from '../components/ResumeFlashcards';
import { CardEditor } from '../components/CardEditor';
import { StudySessionBuilder } from '../components/StudySessionBuilder';
import { StudyView } from './StudyView';
import { ResumeTest, TestsBrowser } from '../components/tests/TestsBrowser';
import { NewTest } from '../components/tests/NewTest';
import { DeleteLearnItem } from '../components/learn/DeleteLearnItem';
import { DeleteTest } from '../components/tests/DeleteTest';
import { PlanView } from '../components/tests/PlanView';
import { TakeTest } from '../components/tests/TakeTest';
import { TestResults } from '../components/tests/TestResults';
import { ReviewAnswers } from '../components/tests/ReviewAnswers';
import { SuggestedCards } from '../components/tests/SuggestedCards';
import type { TestNav } from './navigation';
import { CourseView } from '../components/learn/CourseView';
import { LearnBrowser } from '../components/learn/LearnBrowser';
import { MapCourse } from '../components/learn/MapCourse';
import { TodayRow, TodayView } from '../components/learn/TodayView';
import { CheckView } from '../components/learn/CheckView';
import { LessonView } from '../components/learn/LessonView';
import type { LearnNav } from './navigation';
import { todayDueCards } from '../review/today-cards';
import { ignoresStudyKey } from '../review/keyboard';
import { RunningJobs } from '../components/jobs/RunningJobs';
import { StatisticsView } from '../components/statistics/StatisticsView';
import { UsageView } from '../components/usage/UsageView';
import type { QardServices } from './services';
import type { UiRequest } from './navigation';
const LEARN_SCREENS = ['today', 'learn', 'map-course', 'course', 'check', 'lesson'];
const TEST_LABEL: Record<string, string> = {
  plan: 'Plan',
  take: '',
  results: 'Results',
  review: 'Review',
  'test-cards': 'Suggested cards',
};
export function QardApp({ services, request }: { services: QardServices; request?: UiRequest }) {
  const reviews = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [screen, setScreen] = useState<Screen>({ kind: 'library' }),
    [search, setSearch] = useState('');
  const [issues, setIssues] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  useEffect(() => {
    if (!request) {
      return;
    }
    if (request.kind === 'builder') {
      setScreen({
        kind: 'builder',
        selection: request.selection || { decks: [], topics: [], cards: [] },
      });
    } else if (request.kind === 'create') {
      setScreen({ kind: 'editor', draft: request.draft });
    } else if (request.kind === 'new-test') {
      setScreen({ kind: 'new-test', serial: request.serial });
    } else if (request.kind === 'tests') {
      setScreen({ kind: 'tests' });
    } else if (
      request.kind === 'today' ||
      request.kind === 'learn' ||
      request.kind === 'usage' ||
      request.kind === 'statistics' ||
      request.kind === 'source-updates'
    ) {
      setScreen({ kind: request.kind });
    } else if (request.kind === 'lesson' && request.path) {
      setScreen({ kind: 'lesson', path: request.path });
    } else {
      setScreen({ kind: 'library' });
    }
  }, [request]);
  const [repairOnly, setRepairOnly] = useState(false);
  const repairDays = useMemo(
    () => failureDays(reviews.history, reviews.states),
    [reviews.history, reviews.states],
  );
  const repairCount = index.cards.filter((c) =>
    needsRepair(reviews.states[c.id], repairDays.get(c.id)),
  ).length;
  const filtered = useMemo(
    () =>
      search.trim() || repairOnly
        ? buildDecks(
            index.cards.filter(
              (c) =>
                matchesSearch(c, search) &&
                (!repairOnly || needsRepair(reviews.states[c.id], repairDays.get(c.id))),
            ),
          )
        : index.decks,
    [index, search, repairOnly, reviews.states, repairDays],
  );
  const activeDeck =
    screen.kind === 'deck' ? screen.deck : screen.kind === 'card' ? screen.card.deck : '';
  const deck = filtered.find((d) => d.name === activeDeck);
  const generateCards = (draft?: Partial<CardDraft>) =>
    setScreen({ kind: 'generate-cards', draft });
  const library = () => {
    setScreen({ kind: 'library' });
  };
  const plans = () => setScreen({ kind: 'exams' });
  const builder = (selection: Selection = { decks: [], topics: [], cards: [] }) =>
    setScreen({ kind: 'builder', selection });
  const start = useCallback(
    async (
      cards: QardCard[],
      style: SessionStyle = 'normal',
      examId?: string,
      mode?: StudyMode,
    ) => {
      if (!cards.length) {
        throw new Error('No cards are available for this session.');
      }
      const ready = await services.writer.ensureStable(cards);
      const session = await services.reviews.startSession(ready, style, examId, mode);
      setSessionMessage('');
      setScreen({ kind: 'study', cards: ready, serial: Date.now(), style, session });
    },
    [services],
  );
  const resume = async (id: string) => {
    if (services.index.getSnapshot().loading) {
      throw new Error('Wait for your cards to finish loading.');
    }
    const result = await services.reviews.resumeSession(id, services.index.getSnapshot().cards);
    const notice = result.skipped
      ? `${result.skipped} unavailable, paused, deferred or ambiguous cards were skipped. Your remaining card order is preserved.`
      : '';
    if (!hasRemainingSession(result.session)) {
      setSessionMessage(
        'This session has no remaining available cards. Completed reviews are saved.',
      );
      library();
      return;
    }
    setSessionMessage('');
    setScreen({
      kind: 'study',
      cards: result.cards,
      serial: Date.now(),
      style: result.session.style,
      session: result.session,
      notice,
    });
  };
  const study = screen.kind === 'study';
  useEffect(() => {
    // StudyView owns focus and its shortcuts during a card session.
    if (study) {
      return;
    }
    const doc = services.host.ownerDocument;
    let focused = false;
    const setFocus = (enabled: boolean) => {
      focused = enabled;
      services.setFocus(enabled);
    };
    const handler = (event: KeyboardEvent) => {
      if (!services.isActive() || ignoresStudyKey(event)) {
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setFocus(!focused);
      } else if (event.key === 'Escape' && focused) {
        event.preventDefault();
        event.stopPropagation();
        setFocus(false);
      }
    };
    const off = services.app.workspace.on('active-leaf-change', () => {
      if (!services.isActive()) {
        setFocus(false);
      }
    });
    doc.addEventListener('keydown', handler, true);
    return () => {
      doc.removeEventListener('keydown', handler, true);
      services.app.workspace.offref(off);
      setFocus(false);
    };
  }, [services, study]);
  const nav = useMemo<TestNav>(
    () => ({
      library: () => setScreen({ kind: 'library' }),
      tests: () => setScreen({ kind: 'tests' }),
      newTest: (prompt) => setScreen({ kind: 'new-test', prompt, serial: Date.now() }),
      plan: (folder) => setScreen({ kind: 'plan', folder }),
      take: (folder) => setScreen({ kind: 'take', folder }),
      results: (folder) => setScreen({ kind: 'results', folder }),
      review: (folder, question) => setScreen({ kind: 'review', folder, question }),
      cards: (folder) => setScreen({ kind: 'test-cards', folder }),
    }),
    [],
  );
  const learnNav = useMemo<LearnNav>(
    () => ({
      library: () => setScreen({ kind: 'library' }),
      today: () => setScreen({ kind: 'today' }),
      learn: () => setScreen({ kind: 'learn' }),
      mapCourse: (folder) => setScreen({ kind: 'map-course', folder }),
      usage: () => setScreen({ kind: 'usage' }),
      course: (path, objective) =>
        setScreen({ kind: 'course', path, objective, serial: Date.now() }),
      check: (path) => setScreen({ kind: 'check', path }),
      lesson: (path) => setScreen({ kind: 'lesson', path }),
      // Today reviews only cards already in rotation, most overdue first.
      studyDue: (deck, topic) => {
        void start(
          todayDueCards(
            services.index.getSnapshot().cards,
            services.reviews.getSnapshot().states,
          ).filter((card) => card.deck === deck && (topic === undefined || card.topic === topic)),
          'normal',
          undefined,
          'due',
        ).catch((e) => setSessionMessage((e as Error).message));
      },
    }),
    [services, start],
  );
  const onLearn = LEARN_SCREENS.includes(screen.kind);
  const learnPath = 'path' in screen ? screen.path : '';
  const learnLabel =
    screen.kind === 'today'
      ? 'Today'
      : screen.kind === 'map-course'
        ? 'Map a course'
        : screen.kind === 'course'
          ? learnPath
              .split('/')
              .pop()!
              .replace(/\.md$/, '')
              .replace(/ mastery$/i, '')
          : screen.kind === 'check'
            ? 'Check'
            : screen.kind === 'lesson'
              ? 'Lesson'
              : '';
  const testFolder = 'folder' in screen ? screen.folder : '';
  const testEntry = testFolder ? services.tests.get(testFolder) : undefined;
  const testTitle = testEntry?.test?.title || testEntry?.plan?.title || '';
  const onTests = ['tests', 'new-test', 'plan', 'take', 'results', 'review', 'test-cards'].includes(
    screen.kind,
  );
  return (
    <div className={'qard-app ' + (study ? 'qard-is-studying' : '')}>
      <main className="qard-main">
        {!study && (
          <header className="qard-topbar">
            <nav className="qard-breadcrumb" aria-label="Breadcrumb">
              <button className="qard-wordmark" onClick={library} aria-label="Qard — all decks">
                <QardLogo size={19} />
                Qard
              </button>
              {onLearn ? (
                <>
                  <ChevronRight size={14} />
                  <button onClick={learnNav.learn}>Learn</button>
                  {learnLabel && (
                    <>
                      <ChevronRight size={14} />
                      <span>{learnLabel}</span>
                    </>
                  )}
                </>
              ) : onTests ? (
                <>
                  <ChevronRight size={14} />
                  <button onClick={nav.tests}>Tests</button>
                  {screen.kind === 'new-test' && (
                    <>
                      <ChevronRight size={14} />
                      <span>New</span>
                    </>
                  )}
                  {testFolder && (
                    <>
                      <ChevronRight size={14} />
                      {screen.kind === 'take' ? (
                        <span>{testTitle || 'Test'}</span>
                      ) : (
                        <button
                          onClick={() =>
                            testEntry?.test ? nav.results(testFolder) : nav.plan(testFolder)
                          }
                        >
                          {testTitle || 'Test'}
                        </button>
                      )}
                      {TEST_LABEL[screen.kind] && (
                        <>
                          <ChevronRight size={14} />
                          <span>{TEST_LABEL[screen.kind]}</span>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : activeDeck ? (
                <>
                  <ChevronRight size={14} />
                  <button onClick={() => setScreen({ kind: 'deck', deck: activeDeck })}>
                    {activeDeck}
                  </button>
                  {screen.kind === 'card' && (
                    <>
                      <ChevronRight size={14} />
                      <span>{screen.card.topic}</span>
                    </>
                  )}
                </>
              ) : (
                screen.kind !== 'library' && (
                  <>
                    <ChevronRight size={14} />
                    <span>
                      {screen.kind === 'exams'
                        ? 'Exam plans'
                        : screen.kind === 'source-updates'
                          ? 'Source updates'
                          : screen.kind === 'builder'
                            ? 'Study'
                            : screen.kind === 'statistics'
                              ? 'Statistics'
                              : screen.kind === 'usage'
                                ? 'Token usage'
                                : screen.kind === 'generate-cards'
                                  ? 'Generate flashcards'
                                  : 'New card'}
                    </span>
                  </>
                )
              )}
            </nav>
            <div className="qard-topbar-actions">
              <button
                className="qard-statistics-link"
                aria-label="Study statistics"
                aria-current={screen.kind === 'statistics' ? 'page' : undefined}
                onClick={() => setScreen({ kind: 'statistics' })}
              >
                <BarChart3 size={16} />
                <span>Statistics</span>
              </button>
              {onTests && testFolder && (
                <DeleteTest
                  key={testFolder}
                  services={services}
                  folder={testFolder}
                  deleted={nav.tests}
                />
              )}
              {onLearn && ['course', 'lesson', 'check'].includes(screen.kind) && (
                <DeleteLearnItem
                  key={learnPath}
                  services={services}
                  kind={screen.kind as 'course' | 'lesson' | 'check'}
                  path={learnPath}
                  deleted={learnNav.learn}
                />
              )}
              <RunningJobs
                services={services}
                nav={nav}
                learnNav={learnNav}
                flashcards={() => generateCards()}
              />
            </div>
          </header>
        )}
        <div
          className={
            study
              ? 'qard-study-container'
              : screen.kind === 'review'
                ? 'qard-page qard-page-review'
                : screen.kind === 'source-updates'
                  ? 'qard-page qard-page-wide'
                  : ['library', 'tests', 'learn', 'exams'].includes(screen.kind)
                    ? 'qard-page qard-page-library'
                    : 'qard-page'
          }
        >
          {!study && sessionMessage && <p role="status">{sessionMessage}</p>}
          {!study &&
            !onTests &&
            !onLearn &&
            screen.kind !== 'statistics' &&
            index.issues.length > 0 && (
              <div className="qard-index-issues">
                <button onClick={() => setIssues(!issues)} aria-expanded={issues}>
                  <AlertCircle size={16} />
                  {index.issues.length} note {index.issues.length === 1 ? 'issue' : 'issues'} to
                  check
                </button>
                {issues && (
                  <ul>
                    {index.issues.slice(0, 50).map((issue, i) => (
                      <li key={i}>
                        <strong>
                          {issue.file}:{issue.line + 1}
                        </strong>
                        {' — '}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          {screen.kind === 'library' && (
            <DeckBrowser
              remove={(name) => services.writer.deleteGroup(name)}
              decks={filtered}
              repairFilter={{
                active: repairOnly,
                count: repairCount,
                toggle: () => setRepairOnly((v) => !v),
              }}
              search={search}
              onSearch={setSearch}
              open={(name) => setScreen({ kind: 'deck', deck: name })}
              create={() => setScreen({ kind: 'editor' })}
              study={() => builder()}
              loading={index.loading}
              tests={nav.tests}
              newTest={() => nav.newTest()}
              learn={learnNav.learn}
              plans={plans}
              resume={
                !search.trim() && (
                  <>
                    <SavedSessions services={services} resume={resume} />
                    {services.sourceSync && (
                      <SourceUpdatesRow
                        service={services.sourceSync}
                        open={() => setScreen({ kind: 'source-updates' })}
                      />
                    )}
                    <TodayRow services={services} nav={learnNav} />
                    <ResumeTest services={services} nav={nav} />
                    {services.flashcards && (
                      <ResumeFlashcards
                        service={services.flashcards}
                        open={() => generateCards()}
                      />
                    )}
                  </>
                )
              }
            />
          )}
          {screen.kind === 'deck' &&
            (deck ? (
              <>
                <SavedSessions services={services} resume={resume} deck={deck.name} />
                <TopicBrowser
                  states={reviews.states}
                  repairDays={repairDays}
                  key={deck.name}
                  deck={deck}
                  removeDeck={async () => {
                    await services.writer.deleteGroup(deck.name);
                    setSearch('');
                    library();
                  }}
                  removeTopic={(topic) => services.writer.deleteGroup(deck.name, topic)}
                  select={(card) => setScreen({ kind: 'card', card })}
                  study={(topic) =>
                    builder(
                      topic
                        ? { decks: [], topics: [topicKey(deck.name, topic)], cards: [] }
                        : { decks: [deck.name], topics: [], cards: [] },
                    )
                  }
                  create={() => setScreen({ kind: 'editor', draft: { deck: deck.name } })}
                  generate={
                    services.flashcards ? () => generateCards({ deck: deck.name }) : undefined
                  }
                />
              </>
            ) : (
              <div className="qard-empty">
                <h2>No cards in this deck.</h2>
                <p>The notes may have changed, or your search excludes them.</p>
                <button
                  onClick={() => {
                    setSearch('');
                    library();
                  }}
                >
                  Back to all decks
                </button>
              </div>
            ))}
          {screen.kind === 'card' && (
            <CardPreview
              key={screen.card.id}
              card={screen.card}
              services={services}
              back={() => setScreen({ kind: 'deck', deck: screen.card.deck })}
              study={() => builder({ decks: [], topics: [], cards: [screen.card.id] })}
              changed={(card) => setScreen({ kind: 'card', card })}
            />
          )}
          {screen.kind === 'editor' && (
            <CardEditor
              key={JSON.stringify(screen.draft)}
              services={services}
              initial={screen.draft}
              generate={services.flashcards ? generateCards : undefined}
              cancel={library}
              saved={(card) => {
                setSearch('');
                setScreen({ kind: 'card', card });
              }}
            />
          )}
          {screen.kind === 'generate-cards' && services.flashcards && (
            <GenerateFlashcards
              services={services}
              initial={screen.draft}
              back={library}
              openDeck={(deck) => {
                setSearch('');
                setScreen({ kind: 'deck', deck });
              }}
            />
          )}
          {screen.kind === 'source-updates' && services.sourceSync && (
            <SourceUpdates services={services} back={library} />
          )}
          {screen.kind === 'builder' && (
            <StudySessionBuilder
              key={JSON.stringify(screen.selection)}
              services={services}
              cards={index.cards}
              decks={index.decks}
              initial={screen.selection}
              start={(cards, style, mode) => start(cards, style, undefined, mode)}
              back={library}
            />
          )}
          {screen.kind === 'exams' && (
            <ExamPlanner
              services={services}
              back={library}
              tests={nav.tests}
              learn={learnNav.learn}
              start={(cards, examId) => start(cards, 'normal', examId)}
              resume={resume}
              test={nav.newTest}
            />
          )}
          {screen.kind === 'tests' && (
            <TestsBrowser services={services} nav={nav} learn={learnNav.learn} plans={plans} />
          )}
          {screen.kind === 'today' && <TodayView services={services} nav={learnNav} />}
          {screen.kind === 'statistics' && (
            <StatisticsView
              services={services}
              back={library}
              study={(deck) => builder(deck ? { decks: [deck], topics: [], cards: [] } : undefined)}
            />
          )}
          {screen.kind === 'usage' && <UsageView services={services} />}
          {screen.kind === 'learn' && (
            <LearnBrowser services={services} nav={learnNav} testNav={nav} plans={plans} />
          )}
          {screen.kind === 'map-course' && (
            <MapCourse
              key={screen.folder ?? ''}
              services={services}
              nav={learnNav}
              initialFolder={screen.folder}
            />
          )}
          {screen.kind === 'course' && (
            <CourseView
              key={screen.path + screen.serial}
              services={services}
              nav={learnNav}
              path={screen.path}
              objective={screen.objective}
            />
          )}
          {screen.kind === 'check' && (
            <CheckView key={screen.path} services={services} nav={learnNav} path={screen.path} />
          )}
          {screen.kind === 'lesson' && (
            <LessonView key={screen.path} services={services} nav={learnNav} path={screen.path} />
          )}
          {screen.kind === 'new-test' && (
            <NewTest
              key={screen.serial}
              services={services}
              nav={nav}
              initialPrompt={screen.prompt}
            />
          )}
          {screen.kind === 'plan' && (
            <PlanView key={screen.folder} services={services} nav={nav} folder={screen.folder} />
          )}
          {screen.kind === 'take' && (
            <TakeTest key={screen.folder} services={services} nav={nav} folder={screen.folder} />
          )}
          {screen.kind === 'results' && (
            <TestResults key={screen.folder} services={services} nav={nav} folder={screen.folder} />
          )}
          {screen.kind === 'review' && (
            <ReviewAnswers
              key={screen.folder + (screen.question ?? '')}
              services={services}
              nav={nav}
              folder={screen.folder}
              initial={screen.question}
            />
          )}
          {screen.kind === 'test-cards' && (
            <SuggestedCards
              key={screen.folder}
              services={services}
              nav={nav}
              folder={screen.folder}
            />
          )}
          {screen.kind === 'study' && (
            <StudyView
              key={screen.serial}
              services={services}
              cards={screen.cards}
              style={screen.style}
              session={screen.session}
              notice={screen.notice}
              exit={library}
              repeat={(cards) => start(cards, screen.style)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
