import { useEffect, useState, useSyncExternalStore } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { examProgress, localDay, validDay, type ExamPlan } from '../exams/exam-plan';
import { topicKey } from '../decks/deck-index';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import type { Selection } from '../review/session';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function ExamPlanner({ services, start, resume, test, back }: { services: QardServices; start: (cards: QardCard[], examId: string) => Promise<void>; resume: (id: string) => Promise<void>; test: (prompt: string) => void; back: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [editing, setEditing] = useState<ExamPlan | 'new'>(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [deleting, setDeleting] = useState('');
  async function study(plan: ExamPlan, cards: QardCard[]) {
    setBusy(plan.id); setError('');
    try {
      const session = saved.sessions.find(s => s.examId === plan.id);
      if (session) await resume(session.id); else await start(cards, plan.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  async function remove(id: string) {
    setBusy(id); setError('');
    try { await services.reviews.deleteExam(id); setDeleting(''); } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  if (editing) return <ExamEditor key={editing === 'new' ? 'new' : editing.id} services={services} plan={editing === 'new' ? undefined : editing} done={() => setEditing(undefined)}/>;
  return <div className="qard-exam-workspace"><div className="qard-heading"><div><h1>Exam plans</h1><p>Plan your revision around the days you can study.</p></div><div className="qard-actions"><button onClick={back}>Back</button><button className="qard-primary" onClick={() => setEditing('new')}>New exam</button></div></div>
    {error && <p className="qard-error" role="alert">{error}</p>}
    {index.loading && <p role="status">Loading study material…</p>}
    {!saved.exams.length && <div className="qard-empty"><CalendarDays size={30}/><p>Add an exam date, choose your decks or topics, and set a daily review target.</p></div>}
    {saved.exams.slice().sort((a, b) => a.date.localeCompare(b.date)).map(plan => {
      const p = examProgress(plan, index.cards, saved.states, saved.history, now), session = saved.sessions.find(s => s.examId === plan.id);
      return <section className="qard-exam-plan" key={plan.id}><div className="qard-panel-heading"><h2>{plan.name}</h2><span>{new Date(`${plan.date}T12:00:00`).toLocaleDateString()}</span></div>
        <p className="qard-muted">{plan.weekdays.map(d => DAYS[d]!.slice(0, 3)).join(', ')} · Up to {plan.dailyLimit} reviews per study day</p>
        <progress max={Math.max(1, p.selected.length)} value={p.covered} aria-label={`${plan.name} coverage`}/>
        <p><strong>{p.covered} / {p.selected.length}</strong> cards reviewed since this plan began · {p.uncovered} remaining</p>
        <p className="qard-muted qard-small">Coverage measures cards you have reviewed, not predicted exam results. Due reviews are included in your daily workload.</p>
        {p.expired ? <p>The exam date has passed. Edit the date to plan another revision period.</p> : <>
          <p>{p.studyDays} study {p.studyDays === 1 ? 'day' : 'days'} left, including exam day when selected. {p.doneToday} reviews today.</p>
          {p.shortfall > 0 && <p className="qard-exam-warning" role="status">Your remaining study days and daily target leave {p.shortfall} cards uncovered, before repeat reviews. Increase your target or add study days.</p>}
          {!p.isStudyDay ? <p>Today is a rest day in this plan.</p> : <p>{p.queue.length ? `${p.queue.length} cards in today's session · ${Math.min(p.coverageToday, p.queue.length)} toward first-pass coverage.` : 'Your planned cards are complete for now. Due reviews appear here as they become ready.'}</p>}
        </>}
        {!p.selected.length && !index.loading && <p>No cards match this plan. Edit its decks or topics, or add cards to the selected material.</p>}
        <div className="qard-actions"><button className="qard-primary" disabled={!!busy || index.loading || (!session && !p.queue.length)} onClick={() => void study(plan, p.queue)}>{busy === plan.id ? 'Preparing…' : session ? 'Resume exam session' : "Study today's cards"}</button>
          <button disabled={!!busy || !p.selected.length || index.loading} onClick={() => test(`Prepare a practice test for ${plan.name}, exam date ${plan.date}. Focus on these Qard decks/topics: ${[...new Set(p.selected.map(c => `${c.deck} / ${c.topic}`))].join('; ')}. Use these source notes: ${[...new Set(p.selected.map(c => c.sourceFile))].join(', ')}.`)}>Create practice test</button>
          <button disabled={!!busy} onClick={() => setEditing(plan)}>Edit plan</button><button disabled={!!busy} onClick={() => setDeleting(plan.id)}>Delete</button></div>
        {deleting === plan.id && <div className="qard-confirm"><p>Delete this exam plan? Cards, reviews and saved sessions stay saved.</p><button disabled={!!busy} onClick={() => void remove(plan.id)}>Delete plan</button><button onClick={() => setDeleting('')}>Cancel</button></div>}
      </section>;
    })}
  </div>;
}
function ExamEditor({ services, plan, done }: { services: QardServices; plan?: ExamPlan; done: () => void }) {
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [name, setName] = useState(plan?.name ?? ''), [date, setDate] = useState(plan?.date ?? '');
  const [weekdays, setWeekdays] = useState(plan?.weekdays ?? [1, 2, 3, 4, 5]), [limit, setLimit] = useState(String(plan?.dailyLimit ?? 30));
  const [selection, setSelection] = useState<Selection>(plan?.selection ?? { decks: [], topics: [], cards: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  function toggle(key: 'decks' | 'topics', value: string) { setSelection(old => ({ ...old, [key]: old[key].includes(value) ? old[key].filter(v => v !== value) : [...old[key], value] })); }
  async function save() {
    setBusy(true); setError('');
    try {
      if (!validDay(date) || date < localDay()) throw new Error('Choose an exam date today or later.');
      await services.reviews.saveExam({ id: plan?.id ?? crypto.randomUUID(), name, date, weekdays, dailyLimit: Number(limit), selection, createdAt: plan?.createdAt ?? Date.now() }); done();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="qard-exam-workspace"><div className="qard-heading"><h1>{plan ? 'Edit exam plan' : 'New exam plan'}</h1><button disabled={busy} onClick={done}>Cancel</button></div>
    <form className="qard-exam-editor" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className="qard-exam-form"><section className="qard-exam-section" aria-label="Exam details"><div className="qard-exam-fields">
      <label className="qard-exam-name">Exam name<input required value={name} onChange={e => setName(e.target.value)} placeholder="Biology final"/></label>
      <label>Exam date<input required type="date" min={localDay()} value={date} onChange={e => setDate(e.target.value)}/></label>
      <label>Daily review target<input required type="number" min="1" max="1000" step="1" value={limit} onChange={e => setLimit(e.target.value)}/></label>
    </div></section><section className="qard-exam-section" aria-labelledby="qard-exam-days-heading"><div className="qard-exam-section-heading"><h2 id="qard-exam-days-heading">Study days</h2><p className="qard-muted">Choose the days you want to revise.</p></div><div className="qard-exam-days">{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} className={weekdays.includes(day) ? 'is-selected' : undefined}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => setWeekdays(old => old.includes(day) ? old.filter(d => d !== day) : [...old, day])}/><span>{DAYS[day]}</span></label>)}</div></section>
      <section className="qard-exam-section" aria-labelledby="qard-exam-material-heading"><div className="qard-exam-section-heading"><h2 id="qard-exam-material-heading">Study material</h2><p className="qard-muted">Select whole decks or individual topics. New cards in those decks and topics join the plan automatically.</p></div><div className="qard-exam-decks">
      {index.decks.map(deck => <details key={deck.name} className="qard-select-deck"><summary><ChevronRight size={15}/><label onClick={e => e.stopPropagation()}><input type="checkbox" checked={selection.decks.includes(deck.name)} onChange={() => toggle('decks', deck.name)}/><strong>{deck.name}</strong><small>{deck.cards.length} cards</small></label></summary>
        <div className="qard-exam-topics">{deck.topics.map(topic => <label key={topic.name}><input type="checkbox" checked={selection.decks.includes(deck.name) || selection.topics.includes(topicKey(deck.name, topic.name))} disabled={selection.decks.includes(deck.name)} onChange={() => toggle('topics', topicKey(deck.name, topic.name))}/><span>{topic.name}</span></label>)}</div>
      </details>)}
      {!index.decks.length && <p>No decks yet. Create some cards before planning an exam.</p>}</div></section>
      <div className="qard-exam-footer"><p className="qard-muted qard-small">The plan spreads a first pass over your selected days and uses remaining daily capacity for due reviews. It keeps your existing review schedule.</p>
      {error && <p className="qard-error" role="alert">{error}</p>}
      <button className="qard-primary" type="submit" disabled={index.loading}>{busy ? 'Saving…' : 'Save plan'}</button>
    </div></fieldset></form>
  </div>;
}
