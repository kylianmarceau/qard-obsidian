import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CalendarDays, ChevronDown, Plus } from 'lucide-react';
import { examProgress, localDay, type ExamPlan } from '../exams/exam-plan';
import { dayDistance, examTone } from '../exams/exam-calendar';
import { LibraryHeader } from './library/LibraryHeader';
import { ExamEditor } from './exams/ExamEditor';
import { ExamCalendar } from './exams/ExamCalendar';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function ExamPlanner({
  services,
  start,
  resume,
  test,
  back,
  tests,
  learn,
}: {
  services: QardServices;
  start: (cards: QardCard[], examId: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  test: (prompt: string) => void;
  back: () => void;
  tests?: () => void;
  learn?: () => void;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [editing, setEditing] = useState<ExamPlan | 'new'>(),
    [view, setView] = useState<'exams' | 'calendar'>('exams'),
    [expanded, setExpanded] = useState('');
  const [focusPlan, setFocusPlan] = useState('');
  useEffect(() => {
    if (view !== 'exams' || !focusPlan) {
      return;
    }
    const card = [
      ...(workspace.current?.querySelectorAll<HTMLElement>('[data-exam-id]') ?? []),
    ].find((item) => item.dataset.examId === focusPlan);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView?.({ block: 'nearest' });
    setFocusPlan('');
  }, [view, focusPlan]);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState('');
  const plans = saved.exams.slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = localDay(now);
  const progress = (plan: ExamPlan) =>
    examProgress(plan, index.cards, saved.states, saved.history, now);
  const session = (plan: ExamPlan) => saved.sessions.find((item) => item.examId === plan.id);
  const canStudy = (plan: ExamPlan) =>
    !index.loading && (!!session(plan) || progress(plan).queue.length > 0);
  async function study(plan: ExamPlan) {
    setBusy(plan.id);
    setError('');
    try {
      const active = session(plan);
      if (active) {
        await resume(active.id);
      } else {
        await start(progress(plan).queue, plan.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(id: string) {
    setBusy(id);
    setError('');
    try {
      await services.reviews.deleteExam(id);
      setDeleting('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const open = (plan: ExamPlan) => {
    setView('exams');
    setExpanded(plan.id);
    setFocusPlan(plan.id);
  };
  if (editing) {
    return (
      <ExamEditor
        key={editing === 'new' ? 'new' : editing.id}
        services={services}
        plan={editing === 'new' ? undefined : editing}
        done={() => setEditing(undefined)}
      />
    );
  }
  return (
    <div className="qard-exam-workspace" ref={workspace}>
      <LibraryHeader
        active="plans"
        decks={back}
        tests={tests}
        learn={learn}
        plans={() => setEditing(undefined)}
        title="Plans"
      >
        <button className="qard-primary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          New exam
        </button>
      </LibraryHeader>
      <div className="qard-plans-view" role="group" aria-label="Plan view">
        <button aria-pressed={view === 'exams'} onClick={() => setView('exams')}>
          Exams{plans.length > 0 && <span>{plans.length}</span>}
        </button>
        <button aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
          <CalendarDays size={15} />
          Calendar
        </button>
      </div>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      {index.loading && (
        <p className="qard-muted" role="status">
          Loading study material…
        </p>
      )}
      {view === 'calendar' ? (
        <ExamCalendar
          plans={plans}
          today={today}
          progress={progress}
          open={open}
          study={(plan) => void study(plan)}
          canStudy={canStudy}
          busy={!!busy}
        />
      ) : !plans.length ? (
        <div className="qard-plans-empty">
          <CalendarDays size={32} />
          <h2>No exam plans</h2>
          <p>Add an exam date and choose what to study.</p>
        </div>
      ) : (
        <div className="qard-exam-plan-list">
          {plans.map((plan) => {
            const p = progress(plan),
              active = session(plan),
              days = dayDistance(today, plan.date),
              examDate = new Date(`${plan.date}T12:00:00`);
            return (
              <section
                className={`qard-exam-plan qard-tone-${examTone(plan.id)}`}
                key={plan.id}
                aria-label={plan.name}
                data-exam-id={plan.id}
                tabIndex={-1}
              >
                <header className="qard-exam-plan-head">
                  <div className="qard-exam-date" aria-hidden="true">
                    <span>{examDate.toLocaleDateString(undefined, { month: 'short' })}</span>
                    <strong>{examDate.getDate()}</strong>
                  </div>
                  <div>
                    <h2>{plan.name}</h2>
                    <p>
                      {days < 0
                        ? 'Past exam'
                        : days === 0
                          ? 'Exam today'
                          : days === 1
                            ? 'Exam tomorrow'
                            : `Exam in ${days} days`}
                      {' · '}
                      {examDate.toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </header>
                <div className="qard-exam-coverage">
                  <div>
                    <span>Cards reviewed</span>
                    <strong>
                      {p.covered} / {p.selected.length}
                    </strong>
                  </div>
                  <progress
                    max={Math.max(1, p.selected.length)}
                    value={p.covered}
                    aria-label={`${plan.name} coverage`}
                  />
                </div>
                <div className="qard-exam-status">
                  <span>
                    {p.studyDays} study {p.studyDays === 1 ? 'day' : 'days'} left
                  </span>
                  <span>
                    {p.expired
                      ? 'Revision period ended'
                      : !p.isStudyDay
                        ? 'Rest day'
                        : p.queue.length
                          ? `${p.queue.length} cards ready today`
                          : 'Complete for today'}
                  </span>
                </div>
                {p.shortfall > 0 && (
                  <p className="qard-exam-warning" role="status">
                    {p.shortfall} cards may remain uncovered at this target.
                  </p>
                )}
                {!p.selected.length && !index.loading && (
                  <p className="qard-exam-warning">No current cards match this plan.</p>
                )}
                <div className="qard-actions">
                  <button
                    className="qard-primary"
                    disabled={!!busy || !canStudy(plan)}
                    onClick={() => void study(plan)}
                  >
                    {busy === plan.id
                      ? 'Preparing…'
                      : active
                        ? 'Resume exam session'
                        : "Study today's cards"}
                  </button>
                  <button
                    className="qard-text-button"
                    disabled={!!busy || !p.selected.length || index.loading}
                    onClick={() =>
                      test(
                        `Prepare a practice test for ${plan.name}, exam date ${plan.date}. Focus on these Qard decks/topics: ${[...new Set(p.selected.map((card) => `${card.deck} / ${card.topic}`))].join('; ')}. Use these source notes: ${[...new Set(p.selected.map((card) => card.sourceFile))].join(', ')}.`,
                      )
                    }
                  >
                    Create practice test
                  </button>
                </div>
                <button
                  className="qard-exam-details-toggle"
                  aria-expanded={expanded === plan.id}
                  onClick={() => setExpanded(expanded === plan.id ? '' : plan.id)}
                >
                  Plan details
                  <ChevronDown size={14} />
                </button>
                {expanded === plan.id && (
                  <div className="qard-exam-details">
                    <dl>
                      <div>
                        <dt>Study days</dt>
                        <dd>
                          {[1, 2, 3, 4, 5, 6, 0]
                            .filter((day) => plan.weekdays.includes(day))
                            .map((day) => DAYS[day])
                            .join(', ')}
                        </dd>
                      </div>
                      <div>
                        <dt>Daily target</dt>
                        <dd>Up to {plan.dailyLimit} reviews</dd>
                      </div>
                      <div>
                        <dt>Today</dt>
                        <dd>{p.doneToday} reviews completed</dd>
                      </div>
                    </dl>
                    <p className="qard-muted">
                      Coverage counts cards reviewed since this plan began. It includes due reviews.
                    </p>
                    <div className="qard-actions">
                      <button disabled={!!busy} onClick={() => setEditing(plan)}>
                        Edit plan
                      </button>
                      <button
                        className="qard-danger"
                        disabled={!!busy}
                        onClick={() => setDeleting(plan.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                {deleting === plan.id && (
                  <div className="qard-confirm">
                    <p>Delete this exam plan? Cards, reviews and saved sessions stay saved.</p>
                    <div className="qard-actions">
                      <button
                        className="qard-danger"
                        disabled={!!busy}
                        onClick={() => void remove(plan.id)}
                      >
                        Delete plan
                      </button>
                      <button onClick={() => setDeleting('')}>Cancel</button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
