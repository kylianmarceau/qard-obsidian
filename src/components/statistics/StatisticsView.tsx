import { intervalLabel, memoryStatistics } from '../../review/fsrs-scheduler';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { addDays, isoDay } from '../../learn/mastery';
import {
  cardStatistics,
  countRatings,
  currentStreak,
  ratingSummary,
  yearActivity,
  type ActivityDay,
} from '../../review/statistics';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: undefined, label: 'All time' },
];
const RATINGS = ['Again', 'Hard', 'Good', 'Easy'];
const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)}%`);
const dateLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function StatisticsView({
  services,
  back,
  study,
}: {
  services: QardServices;
  back: () => void;
  study: (deck?: string) => void;
}) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [days, setDays] = useState<number | undefined>(30);
  const [year, setYear] = useState(new Date().getFullYear());
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = isoDay(now),
    thisYear = Number(today.slice(0, 4));
  const stats = data.statistics;
  const summary = useMemo(() => ratingSummary(stats, today, days), [stats, today, days]);
  const previous = useMemo(
    () => (days ? ratingSummary(stats, addDays(today, -days), days) : undefined),
    [stats, today, days],
  );
  const activity = useMemo(() => yearActivity(stats, year, today), [stats, year, today]);
  const cards = useMemo(
    () => cardStatistics(index.cards, data.states, stats, now, data.settings.scheduling),
    [index.cards, data.states, stats, now, data.settings.scheduling],
  );
  const memory = useMemo(
    () => memoryStatistics(index.cards, data.states, now, data.settings.desiredRetention),
    [index.cards, data.states, now, data.settings.desiredRetention],
  );
  const firstDay = Object.keys(stats.daily)
    .filter((day) => day <= today && countRatings(stats.daily[day]!))
    .sort()[0];
  const firstYear = Math.min(thisYear, Number(firstDay?.slice(0, 4) ?? thisYear));
  const change =
    summary.recall !== undefined && previous?.recall !== undefined
      ? summary.recall - previous.recall
      : undefined;
  const streak = currentStreak(stats, today);
  const forecastPeak = Math.max(1, ...cards.forecast);
  const rangeLabel = days ? `Last ${days} days` : 'All recorded reviews';

  return (
    <div className="qard-statistics">
      <button className="qard-text-button qard-small" onClick={back}>
        <ArrowLeft size={14} /> Back to decks
      </button>
      <div className="qard-heading qard-stats-heading">
        <div>
          <h1>Statistics</h1>
          <p>
            {number(cards.total)} cards · {number(cards.decks.length)}{' '}
            {cards.decks.length === 1 ? 'deck' : 'decks'}
          </p>
        </div>
        <button className="qard-primary" onClick={() => study()}>
          Study cards <ArrowUpRight size={15} />
        </button>
      </div>

      <section aria-label="Review performance" className="qard-stats-performance">
        <div className="qard-stats-section-heading">
          <h2>{rangeLabel}</h2>
          <div className="qard-segmented" role="group" aria-label="Review performance period">
            {RANGES.map((r) => (
              <button key={r.label} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <dl className="qard-stats-metrics">
          <Metric
            label="Reviews"
            value={number(summary.total)}
            detail="Cards rated, including repeats"
          />
          <Metric
            label="Recall rate"
            value={percent(summary.recall)}
            detail={
              change === undefined
                ? 'Hard, Good or Easy ratings'
                : `${change > 0 ? '+' : ''}${number(change)} pp vs previous ${days} days`
            }
          />
          <Metric
            label="Days studied"
            value={days ? `${number(summary.activeDays)} / ${days}` : number(summary.activeDays)}
            detail="Days with at least one review"
          />
        </dl>
        {!summary.total && (
          <p className="qard-stats-empty">
            {firstDay
              ? 'No reviews in this period. Try a longer range.'
              : 'No reviews yet. Rate a card to start recording your progress.'}
          </p>
        )}
      </section>

      <section className="qard-stats-activity" aria-label="Study activity">
        <div className="qard-stats-section-heading">
          <div className="qard-stats-title-line">
            <h2>Study activity</h2>
            <span>
              {streak} {streak === 1 ? 'day' : 'days'} in your current streak
            </span>
          </div>
          <div className="qard-stats-year">
            <button
              aria-label="Previous year"
              disabled={year <= firstYear}
              onClick={() => setYear(year - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <select
              aria-label="Activity year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              aria-label="Next year"
              disabled={year >= thisYear}
              onClick={() => setYear(year + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <ActivityHeatmap key={year} days={activity.days} today={today} />
      </section>

      <div className="qard-stats-grid">
        <section aria-label="Rating breakdown" className="qard-stats-ratings">
          <div className="qard-stats-section-heading">
            <h2>Your ratings</h2>
            <span className="qard-stats-caption">{rangeLabel}</span>
          </div>
          <div
            className="qard-stats-rating-stack"
            role="img"
            aria-label={
              summary.total
                ? RATINGS.map(
                    (label, i) => `${label}: ${number(summary.ratings[i]!)} reviews`,
                  ).join(', ')
                : 'No ratings in this period'
            }
          >
            {summary.ratings.map(
              (count, i) =>
                count > 0 && (
                  <span
                    key={i}
                    className={`qard-rating-tone-${i}`}
                    style={{ width: `${(count / summary.total) * 100}%` }}
                  />
                ),
            )}
          </div>
          <dl className="qard-stats-rating-list">
            {RATINGS.map((label, i) => (
              <div key={label} className={`qard-rating-tone-${i}`}>
                <dt>
                  <i className="qard-stats-rating-dot" aria-hidden="true" />
                  {label}
                </dt>
                <dd>
                  {number(summary.ratings[i]!)}
                  <span>
                    {percent(
                      summary.total ? (summary.ratings[i]! / summary.total) * 100 : undefined,
                    )}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-label="Upcoming reviews" className="qard-stats-upcoming">
          <div className="qard-stats-section-heading">
            <h2>Upcoming reviews</h2>
            <span className="qard-stats-caption">Next 7 days</span>
          </div>
          {data.settings.scheduling ? (
            <>
              <div className="qard-stats-forecast" role="list" aria-label="Scheduled cards by day">
                {cards.forecast.map((count, i) => {
                  const day = addDays(today, i),
                    label =
                      i === 0
                        ? 'Today'
                        : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
                            weekday: 'short',
                          });
                  return (
                    <div
                      key={day}
                      role="listitem"
                      aria-label={`${dateLabel(day)}: ${count} scheduled ${count === 1 ? 'card' : 'cards'}${i === 0 ? ', including overdue cards' : ''}`}
                    >
                      <strong>{number(count)}</strong>
                      <div className="qard-stats-forecast-column">
                        <i
                          className={i === 0 ? 'is-today' : ''}
                          style={{ height: `${(count / forecastPeak) * 100}%` }}
                        />
                      </div>
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
              <p className="qard-stats-caption">
                Current schedule only. Today includes overdue cards.
              </p>
            </>
          ) : (
            <p className="qard-stats-empty">
              Scheduling is off. Enable it in Settings to see upcoming reviews.
            </p>
          )}
        </section>
      </div>

      <section className="qard-stats-decks" aria-label="Deck progress">
        <div className="qard-stats-section-heading">
          <h2>Your decks</h2>
          <span className="qard-stats-caption">Recall across saved history</span>
        </div>
        {cards.decks.length ? (
          <div className="qard-stats-deck-list">
            <div className="qard-stats-deck-head" aria-hidden="true">
              <span>Deck / cards studied</span>
              <span>Recall</span>
              <span>Due now</span>
              <span />
            </div>
            {cards.decks.map((deck) => {
              const reviews = countRatings(deck.ratings),
                coverage = deck.total ? (deck.reviewed / deck.total) * 100 : 0;
              return (
                <div className="qard-stats-deck" key={deck.name}>
                  <div className="qard-stats-deck-name">
                    <h3>{deck.name}</h3>
                    <span>
                      {number(deck.reviewed)} of {number(deck.total)} cards studied
                    </span>
                    <div className="qard-stats-deck-track" aria-hidden="true">
                      <i style={{ width: `${coverage}%` }} />
                    </div>
                  </div>
                  <div className="qard-stats-deck-value" role="group" aria-label="Recall">
                    <span>Recall</span>
                    <strong>
                      {percent(reviews ? ((reviews - deck.ratings[0]) / reviews) * 100 : undefined)}
                    </strong>
                  </div>
                  <div
                    role="group"
                    aria-label="Due now"
                    className={`qard-stats-deck-value${deck.due && data.settings.scheduling ? ' has-due' : ''}`}
                  >
                    <span>Due now</span>
                    <strong>{data.settings.scheduling ? number(deck.due) : '—'}</strong>
                  </div>
                  <button
                    className="qard-text-button"
                    aria-label={`Study ${deck.name}`}
                    onClick={() => study(deck.name)}
                  >
                    Study <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="qard-stats-empty">Create a card to see your decks here.</p>
        )}
      </section>

      {data.settings.scheduler === 'fsrs' && (
        <details className="qard-stats-details" aria-label="FSRS memory estimates">
          <summary>
            <span>
              Memory estimates <small>FSRS</small>
            </span>
            <span>{percent(memory.recall)} predicted recall</span>
            <ChevronRight size={15} />
          </summary>
          <div className="qard-stats-details-body">
            {memory.count ? (
              <dl className="qard-stats-memory-metrics">
                <Metric
                  label="Predicted recall now"
                  value={percent(memory.recall)}
                  detail={`Across ${number(memory.count)} reviewed cards`}
                />
                <Metric
                  label="Median stability"
                  value={
                    memory.medianStability === undefined
                      ? '—'
                      : intervalLabel(memory.medianStability)
                  }
                  detail="Time for predicted recall to reach 90%"
                />
                <Metric
                  label="Below target recall"
                  value={number(memory.belowTarget)}
                  detail={`${percent(data.settings.desiredRetention * 100)} target retention`}
                />
              </dl>
            ) : (
              <p className="qard-stats-empty">Review a card with FSRS to see memory estimates.</p>
            )}
            <p className="qard-stats-caption">
              These are model estimates, separate from your rating-based recall rate. Paused cards
              and cards awaiting a content check are excluded.
              {memory.estimated > 0 &&
                ` ${number(memory.estimated)} cards use approximate memory estimates from imported schedules or incomplete history.`}
              {!data.settings.scheduling && ' Scheduling is currently off.'}
            </p>
          </div>
        </details>
      )}
      <div className="qard-stats-footnote">
        <span>
          {firstDay ? `Recorded since ${dateLabel(firstDay)}` : 'Reviews are saved locally'}
          {stats.partialHistory && ' · Some older reviews are missing'}
        </span>
        <details>
          <summary>About this data</summary>
          <p>
            Review periods affect the totals and ratings above. The calendar uses the selected year;
            deck recall uses all saved ratings for current cards. Days follow your device’s local
            time. A streak remains active if you studied today or yesterday. Imported schedules do
            not create past activity. Deleted cards remain in activity totals; duplicate IDs are
            excluded from deck counts.
            {stats.partialHistory &&
              ' Earlier versions retained only the latest 10,000 reviews, so older activity may be incomplete.'}
          </p>
        </details>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function ActivityHeatmap({ days, today }: { days: ActivityDay[]; today: string }) {
  const [selected, setSelected] = useState(
    days.find((d) => d.day === today)?.day ??
      days[Math.max(0, days.filter((d) => !d.future).length - 1)]?.day ??
      days[0]!.day,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    const keepSelectedVisible = () => {
      const cell = scroll.querySelector<HTMLButtonElement>(`[data-day="${selected}"]`);
      if (!cell || !scroll.clientWidth) {
        return;
      }
      const bounds = scroll.getBoundingClientRect(),
        cellBounds = cell.getBoundingClientRect();
      if (cellBounds.left < bounds.left) {
        scroll.scrollLeft += cellBounds.left - bounds.left - 4;
      } else if (cellBounds.right > bounds.right) {
        scroll.scrollLeft += cellBounds.right - bounds.right + 4;
      }
    };
    keepSelectedVisible();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(keepSelectedVisible);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [selected]);
  const offset = new Date(`${days[0]!.day}T12:00:00`).getDay(),
    weeks = Math.ceil((days.length + offset) / 7);
  const peak = Math.max(1, ...days.map((d) => d.count));
  const level = (count: number) =>
    count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / peak) * 4)));
  const detail = days.find((d) => d.day === selected)!;
  return (
    <>
      <div className="qard-stats-heat-scroll" ref={scrollRef}>
        <div className="qard-stats-heat" style={{ '--qard-heat-weeks': weeks } as CSSProperties}>
          <div className="qard-stats-months">
            {days
              .filter((d) => d.day.endsWith('-01'))
              .map((d) => (
                <span
                  key={d.day}
                  style={{ gridColumn: Math.floor((days.indexOf(d) + offset) / 7) + 1 }}
                >
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })}
                </span>
              ))}
          </div>
          <div className="qard-stats-weekdays">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
          </div>
          <div
            className="qard-stats-cells"
            role="group"
            aria-label="Daily review activity. Use arrow keys to move between days."
          >
            {days.map((d, i) => {
              const label = `${dateLabel(d.day)}: ${d.future ? 'Future day' : `${number(d.count)} ${d.count === 1 ? 'review' : 'reviews'}`}`;
              return (
                <button
                  key={d.day}
                  className={`qard-stats-cell qard-heat-${level(d.count)}${d.future ? ' is-future' : ''}${d.day === today ? ' is-today' : ''}`}
                  style={{
                    gridColumn: Math.floor((i + offset) / 7) + 1,
                    gridRow: ((i + offset) % 7) + 1,
                  }}
                  title={label}
                  aria-label={label}
                  aria-pressed={selected === d.day}
                  disabled={d.future}
                  tabIndex={d.day === selected ? 0 : -1}
                  data-day={d.day}
                  onClick={() => setSelected(d.day)}
                  onFocus={() => setSelected(d.day)}
                  onKeyDown={(e) => {
                    const delta = {
                      ArrowUp: -1,
                      ArrowDown: 1,
                      ArrowLeft: -7,
                      ArrowRight: 7,
                      Home: -i,
                      End: days.length - 1 - i,
                    }[e.key];
                    if (delta === undefined) {
                      return;
                    }
                    e.preventDefault();
                    const target =
                      days[
                        Math.max(
                          0,
                          Math.min(days.filter((day) => !day.future).length - 1, i + delta),
                        )
                      ];
                    if (target) {
                      e.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(`[data-day="${target.day}"]`)
                        ?.focus();
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="qard-stats-heat-footer">
        <span aria-live="polite">
          {dateLabel(detail.day)} · {number(detail.count)}{' '}
          {detail.count === 1 ? 'review' : 'reviews'}
        </span>
        <div
          className="qard-stats-heat-legend"
          aria-label="Colour intensity increases with review count"
        >
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} className={`qard-heat-${n}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </>
  );
}
