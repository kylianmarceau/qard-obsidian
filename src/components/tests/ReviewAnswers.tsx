import { useEffect, useMemo, useRef, useState } from 'react';
import type { QardServices } from '../../views/services';
import type { AnnotationKind, Question } from '../../tests/test-types';
import { questions, sectionOf } from '../../tests/test-types';
import { placeAnnotations } from '../../tests/annotate';
import { ignoresStudyKey } from '../../review/keyboard';
import { InlineMarkdown, Markdown } from '../Markdown';
import { AgentLabel } from '../jobs/AgentLabel';
import { AskThread } from '../common/AskThread';
import { Check, JobError, Waiting, cardTarget, scoreTone, useTestFolder, type TestNav } from './common';

const KIND: Record<AnnotationKind, string> = { correct: 'Correct', wrong: 'Incorrect', vague: 'Too vague', missing: 'Missing', insight: 'Good insight' };
const MISTAKE: Record<string, string> = { misconception: 'Misconception', careless: 'Careless slip', imprecise: 'Imprecise', incomplete: 'Incomplete', unknown: "Didn't know" };
type Panel = 'retry' | 'model' | 'ask' | 'dispute' | 'card' | null;

export function ReviewAnswers({ services, nav, folder, initial }: { services: QardServices; nav: TestNav; folder: string; initial?: string }) {
  const { entry, error } = useTestFolder(services, folder);
  const test = entry?.test, attempt = entry?.attempt;
  const all = useMemo(() => test ? questions(test) : [], [test]);
  const lost = (q: Question) => (attempt?.marks[q.id]?.score ?? 0) < q.marks;
  const [onlyLost, setOnlyLost] = useState(true), [current, setCurrent] = useState(initial);
  const visible = all.filter(q => !onlyLost || lost(q) || q.id === current);
  const q = all.find(x => x.id === current) ?? visible[0] ?? all[0];
  const position = q ? visible.indexOf(q) : -1;
  const go = (id?: string) => { if (id) setCurrent(id); };
  const nav2 = useRef({ prev: () => {}, next: () => {} });
  nav2.current = { prev: () => go(visible[position - 1]?.id), next: () => go(visible[position + 1]?.id) };
  useEffect(() => {
    const doc = services.host.ownerDocument;
    const handler = (event: KeyboardEvent) => {
      if (!services.isActive() || ignoresStudyKey(event)) return;
      if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); nav2.current.next(); }
      if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); nav2.current.prev(); }
    };
    doc.addEventListener('keydown', handler, true); return () => doc.removeEventListener('keydown', handler, true);
  }, [services]);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  if (!test || !attempt || !q) return <Waiting text="Loading…"/>;
  return <div className="qard-review">
    <aside className="qard-review-rail" aria-label="Questions">
      <button className="qard-rail-toggle" aria-pressed={onlyLost} onClick={() => setOnlyLost(!onlyLost)}><Check on={onlyLost}/>Lost marks only</button>
      {test.sections.map(s => { const items = s.questions.filter(x => visible.includes(x)); return items.length ? <div key={s.id}><div className="qard-rail-section"><InlineMarkdown text={s.title} path={folder} services={services}/></div>{items.map(x => { const m = attempt.marks[x.id]; return <button key={x.id} className={'qard-rail-item' + (x.id === q.id ? ' is-current' : '')} aria-current={x.id === q.id} onClick={() => go(x.id)}><span className="qard-muted">{all.indexOf(x) + 1}</span><span className="qard-rail-title"><InlineMarkdown text={firstLine(x.prompt)} path={folder} services={services}/></span><span className={'qard-rail-score ' + scoreTone(m?.score ?? 0, x.marks)}>{m ? `${m.score}/${x.marks}` : '–'}</span></button>; })}</div> : null; })}
    </aside>
    <QuestionReview key={q.id} services={services} nav={nav} folder={folder} question={q} number={all.indexOf(q) + 1}
      prev={visible[position - 1] ? () => go(visible[position - 1]!.id) : undefined} next={visible[position + 1] ? () => go(visible[position + 1]!.id) : undefined}/>
  </div>;
}
const firstLine = (text: string) => text.replace(/[#>]/g, '').split('\n').find(l => l.trim())?.trim() ?? '';

function QuestionReview({ services, folder, question: q, number, prev, next }: { services: QardServices; nav: TestNav; folder: string; question: Question; number: number; prev?: () => void; next?: () => void }) {
  const { entry, job } = useTestFolder(services, folder);
  const test = entry!.test!, attempt = entry!.attempt!;
  const mark = attempt.marks[q.id], answer = attempt.answers[q.id], review = attempt.review[q.id];
  const section = sectionOf(test, q.id)!, path = q.source?.path || folder;
  const [selected, setSelected] = useState<number>(), [panel, setPanel] = useState<Panel>(null), [compare, setCompare] = useState(false);
  const [retryText, setRetryText] = useState(''), [disputeText, setDisputeText] = useState(''), [override, setOverride] = useState<boolean[]>();
  const target = cardTarget(services, q, test.title, section.title, test);
  const [front, setFront] = useState(''), [back, setBack] = useState(''), [cardError, setCardError] = useState(''), [saving, setSaving] = useState(false);
  const placed = useMemo(() => placeAnnotations(answer?.text ?? '', mark?.annotations ?? []), [answer?.text, mark?.annotations]);
  const lost = (mark?.score ?? 0) < q.marks, sure = lost && answer?.confidence === 'sure';
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);
  const openCard = () => {
    const suggestion = attempt.wrapup?.cards.find(c => c.questionId === q.id);
    setFront(suggestion?.front ?? q.prompt); setBack(suggestion?.back ?? q.model); toggle('card');
  };
  async function addCard() {
    setSaving(true); setCardError('');
    try { await services.writer.create({ ...target, front, back, folder: services.reviews.getSnapshot().settings.cardFolder }); await services.tests.cardState(folder, { question: q.id }, 'added'); setPanel(null); }
    catch (e) { setCardError((e as Error).message); } finally { setSaving(false); }
  }
  const retryJob = job('retry', q.id), askJob = job('ask', q.id), disputeJob = job('dispute', q.id);
  const running = (j?: { error?: string }) => !!j && !j.error;
  if (!mark) return <main className="qard-review-main"><p className="qard-muted">This answer hasn't been marked yet.</p></main>;
  return <main className="qard-review-main">
    <section className="qard-review-head">
      <div>
        <span className="qard-muted">Question {number} · <InlineMarkdown text={section.title} path={path} services={services}/></span>
        <div className="qard-review-prompt"><Markdown text={q.prompt} path={path} services={services}/></div>
        {(mark.mistake !== 'none' || sure) && <span className={'qard-review-tag' + (sure ? ' is-sure' : '')}>{[MISTAKE[mark.mistake], sure ? 'you were sure' : ''].filter(Boolean).join(' · ')}</span>}
      </div>
      <span className={'qard-review-score ' + scoreTone(mark.score, q.marks)}>{mark.score}/{q.marks}</span>
    </section>

    {q.type === 'mcq' ? <section><div className="qard-label">Your answer</div>{q.options?.map((o, i) => <div key={i} className={'qard-mcq-row' + (answer?.choice === i ? ' is-chosen' : '')}><span className={i === q.answer ? 'is-full' : answer?.choice === i ? 'is-zero' : ''}>{i === q.answer ? '✓' : answer?.choice === i ? '✕' : ''}</span><Markdown text={o} path={path} services={services}/></div>)}</section>
      : <section className="qard-review-answer">
        <div><div className="qard-label">Your answer</div>
          {answer?.unknown ? <p className="qard-muted">You said you didn't know.</p> : answer?.text?.trim() ? <div className="qard-marked-text">{placed.segments.map((s, i) => s.kind ? <span key={i}>{s.text && <span className={`qard-seg qard-seg-${s.kind}` + (selected === s.note ? ' is-selected' : '')}>{s.text}</span>}<button className={`qard-pin qard-pin-${s.kind}`} aria-label={`Note ${s.note}: ${KIND[s.kind]}`} onClick={() => setSelected(selected === s.note ? undefined : s.note)}>{s.kind === 'missing' ? '+' : ''}{s.note}</button></span> : <span key={i}>{s.text}</span>)}</div> : <p className="qard-muted">(No answer)</p>}
        </div>
        <div className="qard-notes">{placed.notes.map(n => <button key={n.n} className={`qard-note qard-note-${n.kind}` + (selected === n.n ? ' is-selected' : '')} aria-pressed={selected === n.n} onClick={() => setSelected(selected === n.n ? undefined : n.n)}><span className="qard-note-kind">{n.n} · {KIND[n.kind]}</span><Markdown text={n.note} path={path} services={services}/></button>)}
          {!placed.notes.length && mark.feedback && <div className="qard-muted"><Markdown text={mark.feedback} path={path} services={services}/></div>}</div>
      </section>}

    <section className="qard-rubric"><div className="qard-label">Mark scheme</div>{q.rubric.map((r, i) => <div key={i} className="qard-rubric-row"><span className={mark.awarded[i] ? 'is-full' : 'is-zero'} aria-label={mark.awarded[i] ? 'Awarded' : 'Not awarded'}>{mark.awarded[i] ? '✓' : '✕'}</span><span className={mark.awarded[i] ? 'qard-muted' : ''}><InlineMarkdown text={r.point} path={path} services={services}/></span><span className="qard-muted">{mark.awarded[i] ? r.marks : 0}/{r.marks}</span></div>)}</section>

    <section className="qard-review-actions">
      {lost && !review?.retry && panel !== 'retry' && panel !== 'model' && <button className="qard-primary" onClick={() => toggle('retry')}>Try again</button>}
      <button className={panel === 'model' ? 'is-on' : ''} onClick={() => toggle('model')}>Model answer</button>
      <span className="qard-spacer"/>
      <button className={panel === 'ask' ? 'is-on' : ''} onClick={() => toggle('ask')}>Ask</button>
      {q.type !== 'mcq' && <button className={panel === 'dispute' ? 'is-on' : ''} onClick={() => toggle('dispute')}>Dispute</button>}
      {lost && <button className={review?.card ? 'is-done' : panel === 'card' ? 'is-on' : ''} disabled={!!review?.card} onClick={openCard}>{review?.card ? '✓ Card added' : 'Make card'}</button>}
    </section>

    {(panel === 'retry' || review?.retry) && <section className="qard-panel">
      {review?.retry ? <><p className="qard-muted">Your second attempt: {review.retry.text}</p><div className="qard-feedback"><Markdown text={`${review.retry.feedback} (${review.retry.score}/${q.marks} together.)`} path={path} services={services}/></div></>
        : <form onSubmit={e => { e.preventDefault(); if (retryText.trim()) void services.tests.retry(folder, q.id, retryText); }}>
          <textarea aria-label="Second attempt" rows={3} autoFocus placeholder="Try the points you missed again…" value={retryText} disabled={running(retryJob)} onChange={e => setRetryText(e.target.value)}/>
          <div className="qard-panel-actions">{running(retryJob) ? <Waiting text="Checking…"><AgentLabel services={services} role="tutor"/></Waiting> : <button type="submit" className="qard-primary" disabled={!retryText.trim()}>Check</button>}</div>
        </form>}
      <JobError job={retryJob} dismiss={() => services.tests.dismiss(folder, 'retry', q.id)}/>
    </section>}

    {panel === 'model' && <section className="qard-panel">
      {compare ? <div className="qard-compare"><div><div className="qard-label">You wrote</div><p className="qard-plain">{q.type === 'mcq' ? q.options?.[answer?.choice ?? -1] ?? '(No answer)' : answer?.text || '(No answer)'}</p></div><div><div className="qard-label">Model answer</div><Markdown text={q.model} path={path} services={services}/></div></div> : <Markdown text={q.model} path={path} services={services}/>}
      <div className="qard-panel-actions is-split"><button className="qard-text-button" onClick={() => setCompare(!compare)}>{compare ? 'Model answer only' : 'Compare with mine'}</button>{q.source && <button className="qard-link" onClick={() => void services.app.workspace.openLinkText(q.source!.heading ? `${q.source!.path}#${q.source!.heading}` : q.source!.path, '', true)}>{q.source.path.split('/').pop()!.replace(/\.md$/, '')}{q.source.heading ? ` › ${q.source.heading}` : ''}</button>}</div>
    </section>}

    {panel === 'ask' && <section className="qard-panel qard-panel-ask">
      <AskThread services={services} path={path} items={review?.followups ?? []} busy={running(askJob)} error={askJob?.error} role="tutor" title="Questions" placeholder="Ask about this question…"
        ask={text => void services.tests.ask(folder, q.id, text)} dismiss={() => services.tests.dismiss(folder, 'ask', q.id)} cancel={() => services.tests.cancel(folder, 'ask', q.id)}
        card={target} onCard={() => void services.tests.cardState(folder, { question: q.id }, 'added')}/>
    </section>}

    {panel === 'dispute' && <section className="qard-panel">
      {review?.dispute && <div className="qard-followup"><strong>{review.dispute.text}</strong><Markdown text={review.dispute.reply} path={path} services={services}/></div>}
      {override ? <>{q.rubric.map((r, i) => <label key={i} className="qard-override"><input type="checkbox" checked={override[i]} onChange={() => setOverride(override.map((v, j) => j === i ? !v : v))}/><InlineMarkdown text={r.point} path={path} services={services}/> <span className="qard-muted">({r.marks})</span></label>)}
        <div className="qard-panel-actions"><button onClick={() => setOverride(undefined)}>Cancel</button><button className="qard-primary" onClick={() => { void services.tests.override(folder, q.id, override); setOverride(undefined); setPanel(null); }}>Save mark</button></div></>
        : <form onSubmit={e => { e.preventDefault(); if (disputeText.trim()) { void services.tests.dispute(folder, q.id, disputeText); setDisputeText(''); } }}>
          <textarea aria-label="Why should this get more marks?" rows={2} placeholder="Why should this get more marks?" value={disputeText} disabled={running(disputeJob)} onChange={e => setDisputeText(e.target.value)}/>
          <div className="qard-panel-actions"><button type="button" onClick={() => setOverride([...mark.awarded])}>Set mark myself</button>{running(disputeJob) ? <Waiting text="Re-marking…"><AgentLabel services={services} role="marker"/></Waiting> : <button type="submit" className="qard-primary" disabled={!disputeText.trim()}>Send</button>}</div>
        </form>}
      <JobError job={disputeJob} dismiss={() => services.tests.dismiss(folder, 'dispute', q.id)}/>
    </section>}

    {panel === 'card' && <section className="qard-panel">
      <span className="qard-muted">{target.deck} › {target.topic}</span>
      <textarea aria-label="Card question" rows={2} value={front} onChange={e => setFront(e.target.value)}/>
      <textarea aria-label="Card answer" rows={3} value={back} onChange={e => setBack(e.target.value)}/>
      {cardError && <p className="qard-error" role="alert">{cardError}</p>}
      <div className="qard-panel-actions"><button className="qard-primary" disabled={saving || !front.trim() || !back.trim()} onClick={() => void addCard()}>{saving ? 'Adding…' : 'Add card'}</button></div>
    </section>}

    <nav className="qard-review-nav" aria-label="Question navigation">
      <button className="qard-text-button" disabled={!prev} onClick={prev}>← Previous</button>
      <span className="qard-muted"><kbd>K</kbd> <kbd>J</kbd></span>
      <button className="qard-text-button" disabled={!next} onClick={next}>Next →</button>
    </nav>
  </main>;
}
