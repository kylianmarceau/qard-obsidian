import { useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react';
import { examProgress, localDay, validDay, type ExamPlan } from '../../exams/exam-plan';
import { selectCards, type Selection } from '../../review/session';
import { topicKey } from '../../decks/deck-index';
import type { QardServices } from '../../views/services';
import { DeckBadge } from '../DeckBadge';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STEPS = ['Exam', 'Material', 'Routine'];
export function ExamEditor({ services, plan, done }: { services: QardServices; plan?: ExamPlan; done: () => void }) {
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [step, setStep] = useState(0), [name, setName] = useState(plan?.name ?? ''), [date, setDate] = useState(plan?.date ?? '');
  const [weekdays, setWeekdays] = useState(plan?.weekdays ?? [1, 2, 3, 4, 5]), [limit, setLimit] = useState(String(plan?.dailyLimit ?? 30));
  const [selection, setSelection] = useState<Selection>(plan?.selection ?? { decks: [], topics: [], cards: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = selectCards(index.cards, saved.states, { selection, mode: 'all', order: 'note' });
  const draft: ExamPlan = { id: plan?.id ?? 'draft', name, date, weekdays, dailyLimit: Number(limit), selection, createdAt: plan?.createdAt ?? Date.now() };
  const estimate = validDay(date) ? examProgress(draft, index.cards, saved.states, saved.history) : undefined;
  function toggle(key: 'decks' | 'topics', value: string) { setSelection(old => ({ ...old, [key]: old[key].includes(value) ? old[key].filter(v => v !== value) : [...old[key], value] })); setError(''); }
  function validate(part: number): string {
    if (part === 0) return !name.trim() ? 'Enter an exam name.' : !validDay(date) || date < localDay() ? 'Choose an exam date today or later.' : '';
    if (part === 1) return ![selection.decks, selection.topics, selection.cards].some(items => items.length) ? 'Choose at least one deck or topic.' : '';
    return !weekdays.length ? 'Choose at least one study day.' : !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1000 ? 'Enter a daily target from 1 to 1,000 reviews.' : '';
  }
  function go(next: number) {
    const issue = next > step ? validate(step) : '';
    if (issue) { setError(issue); return; }
    setError(''); setStep(next); window.setTimeout(() => heading.current?.focus(), 0);
  }
  async function submit() {
    if (step < 2) { go(step + 1); return; }
    for (let part = 0; part < 3; part++) { const issue = validate(part); if (issue) { setStep(part); setError(issue); return; } }
    setBusy(true); setError('');
    try { await services.reviews.saveExam({ ...draft, id: plan?.id ?? crypto.randomUUID(), name: name.trim() }); done(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="qard-exam-workspace"><div className="qard-heading"><h1>{plan ? 'Edit exam plan' : 'New exam plan'}</h1><button disabled={busy} onClick={done}>Cancel</button></div>
    <ol className="qard-exam-steps" aria-label="Plan setup">{STEPS.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Check size={13}/> : i + 1}</span>{label}</li>)}</ol>
    <form className="qard-exam-editor" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy}><div className="qard-exam-editor-layout"><section className="qard-exam-step">
      <header><h2 ref={heading} tabIndex={-1}>{['What are you preparing for?', 'Choose your study material', 'Set your study routine'][step]}</h2></header>
      {step === 0 && <div className="qard-exam-fields"><label className="qard-exam-name">Exam name<input autoFocus required value={name} onChange={event => { setName(event.target.value); setError(''); }} placeholder="Biology final"/></label><label className="qard-exam-name">Exam date<input required type="date" min={localDay()} value={date} onChange={event => { setDate(event.target.value); setError(''); }}/></label></div>}
      {step === 1 && <div className="qard-exam-materials">
        {index.loading && <p className="qard-muted" role="status">Loading decks…</p>}
        {index.decks.map(deck => <div key={deck.name} className="qard-exam-material"><label className="qard-exam-material-main"><input type="checkbox" aria-label={`Include ${deck.name}`} checked={selection.decks.includes(deck.name)} onChange={() => toggle('decks', deck.name)}/><DeckBadge name={deck.name}/><span><strong>{deck.name}</strong><small>{deck.cards.length} cards · {deck.topics.length} {deck.topics.length === 1 ? 'topic' : 'topics'}</small></span></label><details className="qard-exam-topic-picker"><summary>Choose individual topics<ChevronDown size={14}/></summary><div className="qard-exam-topics">{deck.topics.map(topic => <label key={topic.name}><input type="checkbox" checked={selection.decks.includes(deck.name) || selection.topics.includes(topicKey(deck.name, topic.name))} disabled={selection.decks.includes(deck.name)} onChange={() => toggle('topics', topicKey(deck.name, topic.name))}/><span>{topic.name}</span></label>)}</div></details></div>)}
        {!index.loading && !index.decks.length && <p className="qard-muted">Create some cards before planning an exam.</p>}
        {plan && selection.cards.length > 0 && <p className="qard-muted">{selection.cards.length} individually selected cards kept from this plan.</p>}
      </div>}
      {step === 2 && <div className="qard-exam-routine"><div><div className="qard-label">Study days</div><div className="qard-exam-days">{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} className={weekdays.includes(day) ? 'is-selected' : undefined}><input type="checkbox" aria-label={DAYS[day]} checked={weekdays.includes(day)} onChange={() => { setWeekdays(old => old.includes(day) ? old.filter(d => d !== day) : [...old, day]); setError(''); }}/><span aria-hidden="true">{DAYS[day]!.slice(0, 3)}</span></label>)}</div></div><div className="qard-exam-fields"><label className="qard-exam-name">Reviews per study day<input required type="number" min="1" max="1000" step="1" value={limit} onChange={event => { setLimit(event.target.value); setError(''); }}/></label></div><p className="qard-muted">This target includes new cards and due reviews.</p>
        {estimate && estimate.shortfall > 0 && <div className="qard-exam-warning" role="status">{estimate.shortfall} cards may remain uncovered. Add study days or raise your daily target.</div>}
      </div>}
      {error && <p className="qard-error" role="alert">{error}</p>}
    </section><aside className="qard-exam-summary" aria-label="Plan summary"><span className="qard-label">Your plan</span><h3>{name.trim() || 'Untitled exam'}</h3><p>{validDay(date) ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose an exam date'}</p><dl><div><dt>Material</dt><dd>{selected.length} cards selected</dd></div>{step === 2 && <><div><dt>Study days</dt><dd>{estimate?.studyDays ?? 0} remaining</dd></div><div><dt>Daily target</dt><dd>{Number(limit) > 0 ? limit : '—'} reviews</dd></div></>}</dl>{step === 2 && !selected.length && <p className="qard-exam-warning">No current cards match this selection.</p>}</aside></div>
      <div className="qard-exam-editor-footer"><button type="button" disabled={busy} onClick={() => step ? go(step - 1) : done()}><ArrowLeft size={15}/>{step ? 'Back' : 'Cancel'}</button><span className="qard-muted">{step + 1} of 3</span><button className="qard-primary" type="submit" disabled={index.loading}>{busy ? 'Saving…' : step === 2 ? 'Save plan' : 'Continue'}{step < 2 && <ArrowRight size={15}/>}</button></div>
    </fieldset></form>
  </div>;
}
