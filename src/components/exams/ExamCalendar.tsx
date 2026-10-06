import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { localDay, type ExamPlan, type examProgress } from '../../exams/exam-plan';
import { examMonth, examTone, monthDays, plansOnDay, shiftMonth } from '../../exams/exam-calendar';

const formatDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
export function ExamCalendar({
  plans,
  today,
  progress,
  open,
  study,
  canStudy,
  busy,
}: {
  plans: ExamPlan[];
  today: string;
  progress: (plan: ExamPlan) => ReturnType<typeof examProgress>;
  open: (plan: ExamPlan) => void;
  study: (plan: ExamPlan) => void;
  canStudy: (plan: ExamPlan) => boolean;
  busy: boolean;
}) {
  const initial = examMonth(plans, today);
  const [month, setMonth] = useState(initial),
    [selected, setSelected] = useState(
      today.startsWith(initial)
        ? today
        : (plans.find((plan) => plan.date.startsWith(initial))?.date ?? `${initial}-01`),
    );
  const grid = useRef<HTMLDivElement>(null);
  const events = plansOnDay(plans, selected);
  const openMonth = (value: string, day = `${value}-01`) => {
    setMonth(value);
    setSelected(day);
  };
  const examDates = plans.filter((plan) => plan.date.startsWith(month));
  return (
    <div className="qard-calendar-layout">
      <section className="qard-calendar" aria-label="Exam calendar">
        <div className="qard-calendar-heading">
          <div className="qard-calendar-month">
            <button
              className="qard-icon-button"
              aria-label="Previous month"
              onClick={() => openMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <h2>
              {new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </h2>
            <button
              className="qard-icon-button"
              aria-label="Next month"
              onClick={() => openMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="qard-actions">
            <button
              className="qard-text-button"
              onClick={() => openMonth(today.slice(0, 7), today)}
            >
              Today
            </button>
            {plans.length > 0 && (
              <button
                className="qard-text-button"
                onClick={() => {
                  const target = examMonth(plans, today);
                  openMonth(target, plans.find((plan) => plan.date.startsWith(target))?.date);
                }}
              >
                Exam month
              </button>
            )}
          </div>
        </div>
        <p className="qard-calendar-count">
          {examDates.length} {examDates.length === 1 ? 'exam' : 'exams'} this month
        </p>
        <div className="qard-calendar-weekdays" aria-hidden="true">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="qard-calendar-grid" ref={grid}>
          {monthDays(month).map((day) => {
            const { exams, revision } = plansOnDay(plans, day);
            return (
              <button
                key={day}
                data-day={day}
                className={
                  'qard-calendar-day' +
                  (!day.startsWith(month) ? ' is-outside' : '') +
                  (day === today ? ' is-today' : '')
                }
                aria-pressed={day === selected}
                aria-current={day === today ? 'date' : undefined}
                tabIndex={day === selected ? 0 : -1}
                aria-label={`${formatDay(day)}${day === today ? ', today' : ''}${exams.length ? ', exams: ' + exams.map((plan) => plan.name).join(', ') : ''}${revision.length ? `, ${revision.length} planned revision ${revision.length === 1 ? 'session' : 'sessions'}` : ''}`}
                onClick={() => openMonth(day.slice(0, 7), day)}
                onKeyDown={(event) => {
                  const delta =
                    event.key === 'ArrowRight'
                      ? 1
                      : event.key === 'ArrowLeft'
                        ? -1
                        : event.key === 'ArrowDown'
                          ? 7
                          : event.key === 'ArrowUp'
                            ? -7
                            : undefined;
                  if (delta === undefined) return;
                  event.preventDefault();
                  const next = new Date(`${day}T12:00:00`);
                  next.setDate(next.getDate() + delta);
                  const target = localDay(next);
                  openMonth(target.slice(0, 7), target);
                  window.setTimeout(
                    () =>
                      grid.current
                        ?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)
                        ?.focus(),
                    0,
                  );
                }}
              >
                <span className="qard-calendar-number">
                  {Number(day.slice(-2))}
                  {exams.length > 1 && <small>{exams.length} exams</small>}
                </span>
                {exams.slice(0, 2).map((plan) => (
                  <span
                    key={plan.id}
                    className={`qard-calendar-exam qard-tone-${examTone(plan.id)}`}
                    title={plan.name}
                  >
                    <span aria-hidden="true">◆</span>
                    {plan.name}
                  </span>
                ))}
                <span className="qard-calendar-dots" aria-hidden="true">
                  {revision.slice(0, 4).map((plan) => (
                    <i key={plan.id} className={`qard-tone-${examTone(plan.id)}`} />
                  ))}
                  {revision.length > 4 && <small>+{revision.length - 4}</small>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="qard-calendar-legend">
          <span>◆ Exam</span>
          <span>● Planned revision</span>
        </div>
      </section>
      <aside className="qard-calendar-agenda" aria-label="Day agenda">
        <header>
          <span className="qard-muted">{selected === today ? 'Today' : 'Selected day'}</span>
          <h2>{formatDay(selected)}</h2>
        </header>
        {events.exams.length > 0 && (
          <section>
            <h3>Exams</h3>
            {events.exams.map((plan) => (
              <div key={plan.id} className={`qard-agenda-event qard-tone-${examTone(plan.id)}`}>
                <strong>{plan.name}</strong>
                <button className="qard-text-button" onClick={() => open(plan)}>
                  View plan
                </button>
              </div>
            ))}
          </section>
        )}
        {events.revision.length > 0 && (
          <section>
            <h3>Revision</h3>
            {events.revision.map((plan) => {
              const p = selected === today ? progress(plan) : undefined;
              return (
                <div key={plan.id} className={`qard-agenda-event qard-tone-${examTone(plan.id)}`}>
                  <strong>{plan.name}</strong>
                  <span className="qard-muted">
                    {p
                      ? `${p.doneToday} reviewed · ${p.queue.length} ready`
                      : `Up to ${plan.dailyLimit} reviews`}
                  </span>
                  {selected === today ? (
                    <button disabled={busy || !canStudy(plan)} onClick={() => study(plan)}>
                      Study
                    </button>
                  ) : (
                    <button className="qard-text-button" onClick={() => open(plan)}>
                      View plan
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}
        {!events.exams.length && !events.revision.length && (
          <div className="qard-calendar-free">
            <CalendarDays size={24} />
            <p>No exams or revision scheduled.</p>
          </div>
        )}
        <p className="qard-calendar-footnote">
          Revision follows each plan’s study days. Card counts update when you study.
        </p>
      </aside>
    </div>
  );
}
