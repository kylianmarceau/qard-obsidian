import { plural } from '../common/labels';
import { teach } from './lesson-navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowRight, ChevronRight, Play } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { InlineMarkdown } from '../Markdown';
import type { Today, TodayItem } from '../../learn/learn-types';
import { JobError, Waiting } from '../common/FeedbackStatus';
import { StateChip } from './learning-status';
import { useLearn } from './useLearn';
import { todayDueCards } from '../../review/today-cards';
import { buildDecks } from '../../decks/deck-index';
import { type LearnNav } from '../../views/navigation';
import { newAllowance, introductionsToday } from '../../review/pacing';
import { scheduler } from '../../review/scheduler';

/** Loads Today and reloads it whenever the learn service changes. */
function useToday(services: QardServices) {
  const { revision } = useLearn(services);
  const [today, setToday] = useState<Today>();
  useEffect(() => {
    let live = true;
    services.learn.todayList().then(
      (t) => {
        if (live) {
          setToday(t);
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [services, revision]);
  return today;
}

/** The home-page summary: what is due today, one click to start. */
export function TodayRow({
  services,
  nav,
  includeCards = true,
}: {
  services: QardServices;
  nav: LearnNav;
  includeCards?: boolean;
}) {
  const today = useToday(services);
  if (!today || (!today.checks.length && !today.lessons.length && !(includeCards && today.cards))) {
    return null;
  }
  const parts = [
    today.checks.length && plural(today.checks.length, 'check'),
    includeCards && today.cards && plural(today.cards, 'card'),
    today.lessons.length && plural(today.lessons.length, 'lesson'),
  ].filter(Boolean);
  return (
    <button className="qard-resume qard-today-row" onClick={nav.today}>
      <strong>Today</strong>
      <span className="qard-muted">{parts.join(' · ')}</span>
      <ChevronRight size={16} />
    </button>
  );
}

export function TodayView({ services, nav }: { services: QardServices; nav: LearnNav }) {
  const today = useToday(services),
    { job } = useLearn(services),
    [error, setError] = useState('');
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const reviews = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const due = useMemo(() => todayDueCards(index.cards, reviews.states), [index, reviews.states]);
  const decks = useMemo(() => buildDecks(due), [due]);
  const newDecks = buildDecks(
    index.cards.filter(
      (card) =>
        !card.duplicateId &&
        !reviews.states[card.id]?.reviewCount &&
        scheduler.isDue(reviews.states[card.id], Date.now()),
    ),
  );
  const allowance = newAllowance(reviews);
  useEffect(() => {
    if (today) {
      services.learn.prepare(today);
    }
  }, [services, today]);
  if (!today || index.loading) {
    return <Waiting text="Loading…" />;
  }
  const minutes = Math.max(1, Math.round(today.checks.length * 2 + due.length / 6));
  const first = today.checks.find((c) => c.check);
  const start = () => first && nav.check(first.check!);
  const nothing =
    !today.checks.length &&
    !due.length &&
    !today.lessons.length &&
    !(reviews.settings.newCardsPerDay && newDecks.length);
  const suggestion = due.length
    ? `Choose a deck or topic to review${today.checks.length ? ' or start with your checks' : ''}.`
    : today.checks.length
      ? 'Start with your checks.'
      : reviews.settings.newCardsPerDay && newDecks.length
        ? allowance > 0
          ? 'Choose a deck to learn new cards.'
          : 'Your new-card allowance is complete for today.'
        : 'Choose a lesson to keep learning.';
  const open = (item: TodayItem) => (item.check ? nav.check(item.check) : undefined);
  return (
    <div className="qard-doc">
      <header>
        <h1>Today</h1>
        <p className="qard-muted">
          {nothing
            ? 'Nothing is due. Map a course or make a test to keep going.'
            : `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. ${suggestion}`}
        </p>
      </header>
      {today.checks.length > 0 && (
        <section>
          <h2>Checks</h2>
          {today.checks.map((c) => {
            const writing = job(`${c.mastery}#${c.objective}`, 'check-write');
            return (
              <div key={c.mastery + c.objective}>
                <button
                  className="qard-doc-row qard-row-button"
                  disabled={!c.check}
                  onClick={() => open(c)}
                >
                  <span>
                    <InlineMarkdown text={c.title} path={c.mastery} services={services} />
                  </span>
                  <span className="qard-muted">{c.course}</span>
                  <StateChip state={c.state} />
                  {c.check ? (
                    <ChevronRight size={15} />
                  ) : (
                    <span className="qard-muted">{writing?.error ? '' : 'Writing…'}</span>
                  )}
                </button>
                <JobError
                  job={writing}
                  retry={() => void services.learn.ensureCheck(c.mastery, c.objective)}
                />
              </div>
            );
          })}
        </section>
      )}
      {due.length > 0 && (
        <section className="qard-today-decks">
          <h2>Cards</h2>
          <p className="qard-muted qard-small">
            {plural(due.length, 'due card')} · {plural(decks.length, 'deck')}
          </p>
          {decks.map((deck) => (
            <div key={deck.name} className="qard-today-deck-group">
              <button
                className="qard-doc-row qard-row-button qard-today-deck"
                aria-label={`Study ${deck.name}: ${plural(deck.cards.length, 'due card')}`}
                onClick={() => nav.studyDue(deck.name)}
              >
                <span className="qard-today-deck-copy">
                  <strong>{deck.name}</strong>
                  <small>{plural(deck.cards.length, 'card')} due for review</small>
                </span>
                <span className="qard-today-deck-action">
                  <Play size={14} /> Study all
                </span>
              </button>
              <ul className="qard-today-topics" aria-label={`Due topics in ${deck.name}`}>
                {deck.topics.map((topic) => (
                  <li key={topic.name}>
                    <button
                      className="qard-row-button qard-today-topic"
                      aria-label={`Study ${topic.name} in ${deck.name}: ${plural(topic.cards.length, 'due card')}`}
                      onClick={() => nav.studyDue(deck.name, topic.name)}
                    >
                      <span className="qard-today-topic-copy">
                        <span>{topic.name}</span>
                        <small>{plural(topic.cards.length, 'due card')}</small>
                      </span>
                      <span className="qard-today-deck-action">
                        <Play size={14} /> Study
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {reviews.settings.newCardsPerDay > 0 && newDecks.length > 0 && nav.studyNew && (
        <section>
          <h2>New cards</h2>
          <p className="qard-muted qard-small">
            {introductionsToday(reviews.history)} / {reviews.settings.newCardsPerDay} introduced
            today · {allowance} remaining in your allowance
          </p>
          {newDecks.map((deck) => (
            <button
              key={deck.name}
              className="qard-doc-row qard-row-button"
              disabled={allowance === 0}
              onClick={() => nav.studyNew!(deck.name)}
            >
              <strong>{deck.name}</strong>
              <span>{Math.min(deck.cards.length, allowance)} new cards available</span>
              <Play size={14} />
            </button>
          ))}
          {allowance === 0 && (
            <p className="qard-muted qard-small">
              Your allowance is complete. The study builder lets you choose extra new cards today.
            </p>
          )}
        </section>
      )}
      {today.lessons.length > 0 && (
        <section>
          <h2>Lessons</h2>
          <p className="qard-muted qard-small">
            Optional. These objectives need teaching before they can be checked.
          </p>
          {today.lessons.map((l) => (
            <button
              key={l.mastery + l.objective}
              className="qard-doc-row qard-row-button"
              onClick={() =>
                void teach(services, nav, l).catch((e) => setError((e as Error).message))
              }
            >
              <span>
                <InlineMarkdown text={l.title} path={l.mastery} services={services} />
              </span>
              <span className="qard-muted">{l.course}</span>
              <StateChip state={l.state} />
              <span className="qard-link">Teach</span>
            </button>
          ))}
          {today.moreLessons > 0 && (
            <button
              className="qard-doc-row qard-row-button"
              onClick={() => nav.course(today.lessons[0]!.mastery)}
            >
              <span className="qard-muted">
                {plural(today.moreLessons, 'more objective')} to teach
              </span>
              <ChevronRight size={15} />
            </button>
          )}
        </section>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      {first && (
        <div className="qard-doc-footer is-end">
          <button className="qard-primary" onClick={start}>
            Start checks
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
