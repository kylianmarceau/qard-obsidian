import { intervalLabel, memoryStatistics } from '../../review/fsrs-scheduler';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { addDays, isoDay } from '../../learn/mastery';
import { cardStatistics, countRatings, currentStreak, ratingSummary, yearActivity, type ActivityDay } from '../../review/statistics';

const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: undefined, label: 'Saved history' }];
const RATINGS = ['Again', 'Hard', 'Good', 'Easy'];
const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (n: number | undefined) => n === undefined ? '—' : `${Math.round(n)}%`;
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function StatisticsView({ services, back, study }: { services: QardServices; back: () => void; study: (deck?: string) => void }) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [days, setDays] = useState<number | undefined>(30), [year, setYear] = useState(new Date().getFullYear());
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const today = isoDay(now), thisYear = Number(today.slice(0, 4));
  const stats = data.statistics;
  const summary = useMemo(() => ratingSummary(stats, today, days), [stats, today, days]);
  const previous = useMemo(() => days ? ratingSummary(stats, addDays(today, -days), days) : undefined, [stats, today, days]);
  const activity = useMemo(() => yearActivity(stats, year, today), [stats, year, today]);
  const cards = useMemo(() => cardStatistics(index.cards, data.states, stats, now, data.settings.scheduling), [index.cards, data.states, stats, now, data.settings.scheduling]);
  const memory = useMemo(() => memoryStatistics(index.cards, data.states, now, data.settings.desiredRetention), [index.cards, data.states, now, data.settings.desiredRetention]);
  const firstDay = Object.keys(stats.daily).filter(day => day <= today && countRatings(stats.daily[day]!)).sort()[0];
  const firstYear = Math.min(thisYear, Number(firstDay?.slice(0, 4) ?? thisYear));
  const change = summary.recall !== undefined && previous?.recall !== undefined ? summary.recall - previous.recall : undefined;
  const streak = currentStreak(stats, today), rangeLabel = days ? `Last ${days} days` : 'Saved history';
  return <div className="qard-statistics">
    <button className="qard-text-button qard-small" onClick={back}><ArrowLeft size={14}/>Back to decks</button>
    <div className="qard-heading"><div><span className="qard-stats-eyebrow"><BarChart3 size={15}/>Your study, over time</span><h1>Statistics</h1><p className="qard-muted">See what’s sticking, build a habit, and find where to focus next.</p></div><button className="qard-primary" onClick={() => study()}>Study cards</button></div>
    {!firstDay && <div className="qard-stats-intro"><strong>Your first review starts the story.</strong><p>Rate a flashcard to start recording activity and recall. Your current card collection is shown below.</p></div>}
    <div className="qard-stats-section-heading"><h2>Review performance</h2><div className="qard-segmented" role="group" aria-label="Review performance period">{RANGES.map(r => <button key={r.label} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>{r.label}</button>)}</div></div>
    <dl className="qard-stats-metrics">
      <Metric label="Reviews" value={number(summary.total)} detail={rangeLabel}/>
      <Metric label="Recall rate" value={percent(summary.recall)} detail={change === undefined ? 'Hard, Good or Easy' : `${change > 0 ? '+' : ''}${number(change)} percentage points vs previous ${days} days`}/>
      <Metric label="Days studied" value={number(summary.activeDays)} detail={days ? `Out of ${days} days` : 'With at least one review'}/>
      <Metric label="Current streak" value={`${streak} ${streak === 1 ? 'day' : 'days'}`} detail="Across all recorded activity"/>
    </dl>
    <section className="qard-stats-panel" aria-label="Study activity">
      <div className="qard-stats-section-heading"><div><h2>Study activity</h2><p className="qard-muted">Each square is a day. More reviews, deeper colour.</p></div><div className="qard-stats-year"><button aria-label="Previous year" disabled={year <= firstYear} onClick={() => setYear(year - 1)}><ChevronLeft size={16}/></button><select aria-label="Activity year" value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i).map(y => <option key={y} value={y}>{y}</option>)}</select><button aria-label="Next year" disabled={year >= thisYear} onClick={() => setYear(year + 1)}><ChevronRight size={16}/></button></div></div>
      <ActivityHeatmap key={year} days={activity.days} today={today}/>
      <dl className="qard-stats-year-summary"><Metric label="Reviews" value={number(activity.total)}/><Metric label="Active days" value={number(activity.activeDays)}/><Metric label="Reviews / active day" value={number(activity.average)}/><Metric label="Longest streak in this year" value={`${activity.longest} days`}/></dl>
      <p className="qard-muted qard-small">{streak > 0 ? <><Flame size={13}/> Your streak is still active if you studied today or yesterday.</> : 'A review today is all it takes to start a streak.'} Days use your device’s local time.</p>
    </section>
    {data.settings.scheduler === 'fsrs' ? <section className="qard-stats-panel qard-stats-memory" aria-label="FSRS memory estimates">
      <div className="qard-stats-section-heading"><div><h2>Memory estimates</h2><p className="qard-muted">FSRS · {percent(data.settings.desiredRetention * 100)} target retention · {number(memory.count)} cards</p></div><span className="qard-stats-pill">Adaptive scheduling</span></div>
      {memory.count ? <><dl className="qard-stats-year-summary">
        <Metric label="Predicted recall now" value={percent(memory.recall)} detail="Average across reviewed cards"/>
        <Metric label="Median stability" value={memory.medianStability === undefined ? '—' : intervalLabel(memory.medianStability)} detail="Time for predicted recall to reach 90%"/>
        <Metric label="Median difficulty" value={percent(memory.medianDifficulty)} detail="FSRS difficulty on a 0–100% scale"/>
        <Metric label="Below target recall" value={number(memory.belowTarget)} detail="Cards to consider revisiting"/>
      </dl><DifficultyChart bins={memory.bins} label="FSRS difficulty distribution"/><p className="qard-muted qard-small">Higher difficulty means slower memory growth. FSRS difficulty (1–10) is displayed as 0–100%. Stability and recall are model estimates that improve with honest ratings, rather than measured test results.{memory.estimated > 0 && ` ${number(memory.estimated)} cards started from older or imported schedules with incomplete history; their initial memory estimates are approximate.`}</p></>
        : <div className="qard-stats-chart-empty">Review a card to start building your memory estimates.</div>}
      {!data.settings.scheduling && <p className="qard-muted qard-small">Scheduling is off. Ratings still update memory estimates; current due dates stay unchanged.</p>}
    </section> : <div className="qard-stats-intro"><strong>Adaptive memory estimates with FSRS</strong><p>Choose FSRS in Settings → Qard → Study preferences to see predicted recall, stability and memory difficulty. Switching preserves your current due dates.</p></div>}
    <div className="qard-stats-grid">
      <section className="qard-stats-panel"><h2>Rating-based difficulty</h2><p className="qard-muted">How challenging your current cards have felt, based on your recorded ratings.</p>
        {cards.scores.length ? <><DifficultyChart bins={cards.bins}/><div className="qard-stats-chart-summary"><strong>{percent(cards.median)}</strong><span>Median difficulty · {number(cards.scores.length)} rated cards</span></div></> : <div className="qard-stats-chart-empty">Review a card to see its difficulty here.</div>}
        <p className="qard-muted qard-small">Average rating per card: Easy = 0%, Good = 33%, Hard = 67%, Again = 100%. This is an observed difficulty score; a single rating is only an early signal. Unrated cards are excluded.</p>
      </section>
      <section className="qard-stats-panel"><h2>Your ratings</h2><p className="qard-muted">{rangeLabel} · {number(summary.total)} reviews</p><div className="qard-stats-rating-list">{summary.ratings.map((count, i) => <div key={RATINGS[i]}><div><span><i className={`qard-stats-rating-dot qard-rating-tone-${i}`}/>{RATINGS[i]}</span><strong>{number(count)} <small>{summary.total ? percent(count / summary.total * 100) : '—'}</small></strong></div><div className="qard-stats-rating-track"><span className={`qard-rating-tone-${i}`} style={{ width: `${summary.total ? count / summary.total * 100 : 0}%` }}/></div></div>)}</div><p className="qard-muted qard-small">Recall rate counts Hard, Good and Easy as recalled. These are your own ratings, rather than a test score. Repeated attempts each count as a review.</p></section>
    </div>
    <section className="qard-stats-panel"><div className="qard-stats-section-heading"><div><h2>Your collection</h2><p className="qard-muted">Current cards, including any imported schedules.</p></div><span className="qard-stats-pill">{number(cards.total)} cards</span></div><dl className="qard-stats-year-summary"><Metric label="Reviewed at least once" value={number(cards.reviewed)}/><Metric label="Not yet reviewed" value={number(cards.total - cards.reviewed)}/><Metric label="Collection coverage" value={cards.total ? percent(cards.reviewed / cards.total * 100) : '—'}/><Metric label="Due now" value={data.settings.scheduling ? number(cards.due) : 'Off'} detail={data.settings.scheduling ? 'Reviewed cards only' : 'Scheduling is disabled'}/></dl>
      {data.settings.scheduling && cards.reviewed > 0 && <><h3>Upcoming reviews</h3><p className="qard-muted">Current due dates for the next 7 days. Today includes overdue cards; dates change as you review.</p><div className="qard-stats-forecast">{cards.forecast.map((count, i) => <div key={i}><strong>{number(count)}</strong><span>{i === 0 ? 'Today' : new Date(`${addDays(today, i)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span></div>)}</div></>}
    </section>
    {cards.decks.length > 0 && <section className="qard-stats-panel"><h2>By deck</h2><p className="qard-muted">Find a deck to revisit. Recall uses all saved ratings for its current cards.</p><div className="qard-stats-table-wrap"><table className="qard-stats-table"><thead><tr><th scope="col">Deck</th><th scope="col">Reviewed</th><th scope="col">Recall</th><th scope="col">Due</th><th scope="col"><span className="qard-muted">Study</span></th></tr></thead><tbody>{cards.decks.map(deck => {
      const reviews = countRatings(deck.ratings);
      return <tr key={deck.name}><th scope="row">{deck.name}</th><td>{number(deck.reviewed)} / {number(deck.total)}</td><td>{percent(reviews ? (reviews - deck.ratings[0]) / reviews * 100 : undefined)}</td><td>{data.settings.scheduling ? number(deck.due) : '—'}</td><td><button className="qard-text-button" aria-label={`Study ${deck.name}`} onClick={() => study(deck.name)}><ChevronRight size={16}/></button></td></tr>;
    })}</tbody></table></div></section>}
    <p className="qard-muted qard-small">{firstDay ? `Recorded activity since ${dateLabel(firstDay)}. ` : ''}{stats.partialHistory ? 'Older reviews may be missing because previous versions kept only the latest 10,000 reviews. ' : ''}Daily totals are kept locally in Qard’s plugin data. Imported schedules contribute to collection counts, but cannot recreate past ratings or study days. Deleted cards remain in activity totals and are excluded from collection and difficulty charts.</p>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd>{detail && <span>{detail}</span>}</div>;
}

function ActivityHeatmap({ days, today }: { days: ActivityDay[]; today: string }) {
  const [selected, setSelected] = useState(days.find(d => d.day === today)?.day ?? days[Math.max(0, days.filter(d => !d.future).length - 1)]?.day ?? days[0]!.day);
  const offset = new Date(`${days[0]!.day}T12:00:00`).getDay(), weeks = Math.ceil((days.length + offset) / 7);
  const peak = Math.max(1, ...days.map(d => d.count));
  const level = (count: number) => count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(count / peak * 4)));
  const detail = days.find(d => d.day === selected)!;
  return <>
    <div className="qard-stats-heat-scroll"><div className="qard-stats-heat" style={{ '--qard-heat-weeks': weeks } as CSSProperties}>
      <div className="qard-stats-months">{days.filter(d => d.day.endsWith('-01')).map(d => <span key={d.day} style={{ gridColumn: Math.floor((days.indexOf(d) + offset) / 7) + 1 }}>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span>)}</div>
      <div className="qard-stats-weekdays"><span>Mon</span><span>Wed</span><span>Fri</span></div>
      <div className="qard-stats-cells" role="group" aria-label="Daily review activity. Use arrow keys to move between days.">{days.map((d, i) => {
        const label = `${dateLabel(d.day)}: ${d.future ? 'Future day' : `${number(d.count)} ${d.count === 1 ? 'review' : 'reviews'}`}`;
        return <button key={d.day} className={`qard-stats-cell qard-heat-${level(d.count)}${d.future ? ' is-future' : ''}${d.day === today ? ' is-today' : ''}`} style={{ gridColumn: Math.floor((i + offset) / 7) + 1, gridRow: (i + offset) % 7 + 1 }} title={label} aria-label={label} aria-pressed={selected === d.day} disabled={d.future} tabIndex={d.day === selected ? 0 : -1} data-day={d.day} onClick={() => setSelected(d.day)} onFocus={() => setSelected(d.day)} onKeyDown={e => {
          const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -i, End: days.length - 1 - i }[e.key];
          if (delta === undefined) return;
          e.preventDefault();
          const target = days[Math.max(0, Math.min(days.filter(day => !day.future).length - 1, i + delta))];
          if (target) e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-day="${target.day}"]`)?.focus();
        }}/>;
      })}</div>
    </div></div>
    <div className="qard-stats-heat-footer"><span aria-live="polite">{dateLabel(detail.day)} · {number(detail.count)} {detail.count === 1 ? 'review' : 'reviews'}</span><div className="qard-stats-heat-legend" aria-label="Colour intensity increases with review count"><span>Less</span>{[0, 1, 2, 3, 4].map(n => <i key={n} className={`qard-heat-${n}`}/>)}<span>More</span></div></div>
  </>;
}

function DifficultyChart({ bins, label = 'Card difficulty distribution' }: { bins: number[]; label?: string }) {
  const peak = Math.max(1, ...bins), width = 360, height = 140;
  return <div className="qard-stats-distribution"><svg viewBox={`0 0 ${width} ${height + 42}`} role="img" aria-label={`${label}. ${bins.map((count, i) => `${i * 10} to ${(i + 1) * 10}%: ${count} cards`).join('. ')}`}>
    {[...new Set([0, Math.round(peak / 2), peak])].map(n => <g key={n}><line x1="30" x2={width} y1={height - n / peak * (height - 12)} y2={height - n / peak * (height - 12)} className="qard-stats-chart-line"/><text x="23" y={height - n / peak * (height - 12) + 4} textAnchor="end">{number(n)}</text></g>)}
    {bins.map((count, i) => { const barHeight = count / peak * (height - 12); return <rect key={i} x={34 + i * 32.3} y={height - barHeight} width="26" height={barHeight} rx="3" className={`qard-difficulty-${i}`}><title>{i * 10}–{(i + 1) * 10}%: {count} cards</title></rect>; })}
    {[0, 20, 40, 60, 80, 100].map(n => <text key={n} x={32 + n / 100 * 322} y={height + 20} textAnchor={n === 0 ? 'start' : n === 100 ? 'end' : 'middle'}>{n}%</text>)}
  </svg><div className="qard-stats-chart-axis"><span>Easier</span><span>Harder</span></div></div>;
}
