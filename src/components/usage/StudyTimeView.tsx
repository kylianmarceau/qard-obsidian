import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import { ACTIVITIES, duration, studyReport } from '../../time/study-time';
import { addDays, isoDay } from '../../learn/mastery';

type Range = 'today' | 'week' | 'month' | 'all';
const RANGES: { id: Range; label: string; days?: number }[] = [{ id: 'today', label: 'Today', days: 1 }, { id: 'week', label: '7 days', days: 7 }, { id: 'month', label: '30 days', days: 30 }, { id: 'all', label: 'All time' }];
const short = (seconds: number) => { const m = Math.round(seconds / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; };

/** Time spent studying in Qard: a daily chart by activity, and a breakdown by course. */
export function StudyTimeView({ services }: { services: QardServices }) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [range, setRange] = useState<Range>('week'), [confirm, setConfirm] = useState(false), [courses, setCourses] = useState<string[]>([]);
  // Card time is recorded by deck; decks named after a course ("DS346 A1") count towards it.
  useEffect(() => { let live = true; services.learn.courses().then(list => { if (live) setCourses(list.map(m => m.course)); }, () => {}); return () => { live = false; }; }, [services]);
  const today = isoDay(Date.now()), days = RANGES.find(r => r.id === range)!.days;
  const report = useMemo(() => studyReport(data.study ?? {}, days ? addDays(today, 1 - days) : undefined, courses), [data.study, days, today, courses]);
  const bars = useMemo(() => {
    if (!days || days === 1) return [];
    const byDay = new Map(report.daily.map(d => [d.day, d]));
    return Array.from({ length: days }, (_, i) => { const day = addDays(today, i + 1 - days); return { day, row: byDay.get(day) }; });
  }, [report, days, today]);
  const peak = Math.max(60, ...bars.map(b => b.row?.total ?? 0));
  const used = ACTIVITIES.filter(a => report.byActivity.some(r => r.byActivity[a.id]));
  const empty = report.total < 30;
  return <div className="qard-usage qard-time">
    <div className="qard-heading"><div><h1>Study time</h1><p className="qard-muted">Time you spend actively studying in Qard, by course and activity.</p></div>
      <div className="qard-segmented" role="tablist">{RANGES.map(r => <button key={r.id} role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}</div></div>
    {empty ? <div className="qard-empty"><p>No study time {range === 'all' ? 'yet' : 'in this period'}.</p><p className="qard-muted">Time is recorded from the moment this version of Qard is installed.</p></div> : <>
      <section className="qard-usage-summary">
        <div className="qard-usage-total"><strong>{duration(report.total)}</strong><span className="qard-muted">{range === 'today' ? 'today' : range === 'all' ? 'in total' : `in the last ${days} days`}{days && days > 1 ? ` · ${duration(report.total / days)} a day on average` : ''}</span></div>
        <dl className="qard-usage-stats">{report.byActivity.map(r => <div key={r.label}><dt>{r.label}</dt><dd>{duration(r.total)}</dd></div>)}</dl>
      </section>
      {bars.length > 0 && <section className="qard-usage-chart" aria-label="Study time per day">{bars.map(b => {
        const total = b.row?.total ?? 0;
        return <div key={b.day} className="qard-usage-day" title={`${b.day}: ${duration(total)}${b.row ? ` (${used.filter(a => b.row!.byActivity[a.id]).map(a => `${a.label} ${duration(b.row!.byActivity[a.id]!)}`).join(', ')})` : ''}`}>
          <div className="qard-usage-bar">{b.row && used.map(a => b.row!.byActivity[a.id] ? <span key={a.id} className={`is-${a.id}`} style={{ height: `${(b.row!.byActivity[a.id]! / peak) * 100}%` }}/> : null)}</div>
          <small>{b.day.slice(8)}</small>
        </div>;
      })}</section>}
      {bars.length > 0 && <div className="qard-usage-legend">{used.map(a => <span key={a.id} className={`is-${a.id}`}><i/>{a.label}</span>)}</div>}
      <section><div className="qard-label">By course</div>
        <table className="qard-usage-table"><thead><tr><th/><th>Total</th>{used.map(a => <th key={a.id}>{a.label}</th>)}</tr></thead>
          <tbody>{report.byCourse.map(r => <tr key={r.label}><td><strong>{r.label}</strong></td><td>{short(r.total)}</td>{used.map(a => <td key={a.id}>{r.byActivity[a.id] ? short(r.byActivity[a.id]!) : '—'}</td>)}</tr>)}</tbody>
        </table></section>
    </>}
    <p className="qard-muted qard-small">Time counts while Qard is the tab in front, Obsidian has focus, and you've typed, clicked or scrolled in the last 2 minutes. Card reviews count towards their deck, or the course a deck is named after. Kept for a year in Qard's plugin data, on this device only.</p>
    {!empty && (confirm ? <p className="qard-small">Clear all recorded study time? <button className="qard-text-button" onClick={() => { void services.reviews.resetStudy(); setConfirm(false); }}>Clear</button><button className="qard-text-button" onClick={() => setConfirm(false)}>Cancel</button></p>
      : <button className="qard-text-button qard-small" onClick={() => setConfirm(true)}>Clear study time</button>)}
  </div>;
}

/** "25 min studied today" or "6 h 20 min on DS346 in the last 30 days", opening the study time page. */
export function StudyTimeLine({ services, course, days, open }: { services: QardServices; course?: string; days: number; open?: () => void }) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const today = isoDay(Date.now());
  const seconds = useMemo(() => {
    const report = studyReport(data.study ?? {}, addDays(today, 1 - days), course ? [course] : []);
    return course ? report.byCourse.find(r => r.label === course)?.total ?? 0 : report.total;
  }, [data.study, today, days, course]);
  if (seconds < 60) return null;
  const text = `${duration(seconds)} ${course ? `on ${course} ` : 'studied '}${days === 1 ? 'today' : `in the last ${days} days`}`;
  return <p className="qard-muted qard-small qard-time-line">{open ? <button className="qard-text-button" onClick={open}>{text}</button> : text}</p>;
}
