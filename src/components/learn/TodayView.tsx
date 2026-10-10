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
import { type LearnNav } from '../../views/navigation';

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
export function TodayRow({ services, nav }: { services: QardServices; nav: LearnNav }) {
  const today = useToday(services);
  if (!today || (!today.checks.length && !today.lessons.length && !today.cards)) {
    return null;
  }
  const parts = [
    today.checks.length && plural(today.checks.length, 'check'),
    today.cards && plural(today.cards, 'card'),
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
  const decks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of due) {
      counts.set(card.deck, (counts.get(card.deck) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [due]);
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
  const nothing = !today.checks.length && !due.length && !today.lessons.length;
  const suggestion = due.length
    ? `Choose a deck to review${today.checks.length ? ' or start with your checks' : ''}.`
    : today.checks.length
      ? 'Start with your checks.'
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
          {decks.map(([deck, count]) => (
            <button
              key={deck}
              className="qard-doc-row qard-row-button qard-today-deck"
              aria-label={`Study ${deck}: ${plural(count, 'due card')}`}
              onClick={() => nav.studyDue(deck)}
            >
              <span className="qard-today-deck-copy">
                <strong>{deck}</strong>
                <small>{plural(count, 'card')} due for review</small>
              </span>
              <span className="qard-today-deck-action">
                <Play size={14} /> Study
              </span>
            </button>
          ))}
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
