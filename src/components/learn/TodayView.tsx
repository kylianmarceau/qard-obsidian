import { plural } from '../common/labels';
import { teach } from './lesson-navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { InlineMarkdown } from '../Markdown';
import type { Today, TodayItem } from '../../learn/learn-types';
import { JobError, Waiting } from '../common/FeedbackStatus';
import { StateChip } from './learning-status';
import { useLearn } from './useLearn';
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
  useEffect(() => {
    if (today) {
      services.learn.prepare(today);
    }
  }, [services, today]);
  if (!today) {
    return <Waiting text="Loading…" />;
  }
  const minutes = Math.max(1, Math.round(today.checks.length * 2 + today.cards / 6));
  const first = today.checks.find((c) => c.check);
  const start = () => (first ? nav.check(first.check!) : today.cards ? nav.studyDue() : undefined);
  const nothing = !today.checks.length && !today.cards && !today.lessons.length;
  const open = (item: TodayItem) => (item.check ? nav.check(item.check) : undefined);
  return (
    <div className="qard-doc">
      <header>
        <h1>Today</h1>
        <p className="qard-muted">
          {nothing
            ? 'Nothing is due. Map a course or make a test to keep going.'
            : `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Checks first, then cards.`}
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
      {today.cards > 0 && (
        <section>
          <h2>Cards</h2>
          <button className="qard-doc-row qard-row-button" onClick={nav.studyDue}>
            <span>{plural(today.cards, 'card')} due for review</span>
            <ChevronRight size={15} />
          </button>
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
      {(first || today.cards > 0) && (
        <div className="qard-doc-footer is-end">
          <button className="qard-primary" onClick={start}>
            Start
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
