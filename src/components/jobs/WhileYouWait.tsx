import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check as CheckIcon } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { QardCard } from '../../cards/card-types';
import type { Rating } from '../../review/scheduler';
import { scheduler } from '../../review/scheduler';
import { questions } from '../../tests/test-types';
import { timeLeft } from '../../jobs/job-clock';
import { InlineMarkdown, Markdown } from '../Markdown';
import { Waiting, useTestFolder } from '../tests/common';
import { CheckView } from '../learn/CheckView';
import { useTick } from './RunningJobs';
import { AgentLabel } from './AgentLabel';
import { roleOf } from '../../jobs/job-clock';

/**
 * What the wait is for, which decides what is worth doing meanwhile:
 * - lesson: warm up on what it builds on (prefer those notes and objectives);
 * - test / marking: anything except the test's own material (avoid its notes), so warming up doesn't inflate the score
 *   or show answers you are about to review;
 * - mapping: anything due.
 */
export interface WaitContext { kind: 'lesson' | 'test' | 'marking' | 'mapping'; prefer?: { files?: string[]; objectives?: string[] }; avoid?: { files?: string[] } }
type Activity = 'cards' | 'check' | 'retry' | 'notes';
interface Options { cards: QardCard[]; warmup: boolean; check?: { path: string; title: string }; retry?: { folder: string; question: string } }

/** Keeps the waiting screen up once the student has started something, until they choose to move on. */
export function useHold() {
  const [held, setHeld] = useState(false);
  return { held, engage: () => setHeld(true), release: () => setHeld(false) };
}

/** Cards to review while waiting: due ones, filtered and ranked for the context. */
export function cardsFor(services: QardServices, context: WaitContext, now = Date.now()): { cards: QardCard[]; warmup: boolean } {
  const { states, links } = services.reviews.getSnapshot(), all = services.index.getSnapshot().cards.filter(c => c.stable && !c.duplicateId);
  const avoid = new Set(context.avoid?.files ?? []);
  const due = all.filter(c => !avoid.has(c.sourceFile) && (states[c.id]?.reviewCount ?? 0) > 0 && scheduler.isDue(states[c.id], now)).sort((a, b) => (states[a.id]?.due ?? 0) - (states[b.id]?.due ?? 0));
  if (context.kind === 'lesson' && context.prefer) {
    const files = new Set(context.prefer.files ?? []), objectives = new Set(context.prefer.objectives ?? []);
    // Warm-up may include cards that aren't due yet: recalling prerequisites just before a lesson is the point.
    const warm = all.filter(c => files.has(c.sourceFile) || objectives.has(links[c.id]?.objective ?? '')).sort((a, b) => Number(scheduler.isDue(states[b.id], now)) - Number(scheduler.isDue(states[a.id], now)));
    if (warm.length) return { cards: warm.slice(0, 8), warmup: true };
  }
  return { cards: due.slice(0, 12), warmup: false };
}

async function findRetry(services: QardServices, context: WaitContext): Promise<Options['retry']> {
  const avoid = new Set(context.avoid?.files ?? []);
  for (const t of (await services.tests.list()).filter(t => t.status === 'marked').slice(0, 3)) {
    const entry = await services.tests.load(t.folder).catch(() => undefined), test = entry?.test, attempt = entry?.attempt;
    if (!test || !attempt) continue;
    const q = questions(test).find(x => x.type !== 'mcq' && (attempt.marks[x.id]?.score ?? x.marks) < x.marks && !attempt.review[x.id]?.retry && !avoid.has(x.source?.path ?? ''));
    if (q) return { folder: t.folder, question: q.id };
  }
  return undefined;
}

export function WhileYouWait({ services, title, detail, job, context, ready = false, readyLabel = 'Ready', onContinue, onEngage }: {
  services: QardServices; title: string; detail?: string; job?: { kind: string; startedAt?: number }; context: WaitContext;
  ready?: boolean; readyLabel?: string; onContinue?: () => void; onEngage?: () => void;
}) {
  const now = useTick(!ready);
  const [options, setOptions] = useState<Options>(), [activity, setActivity] = useState<Activity>(), [engaged, setEngaged] = useState(false);
  const left = timeLeft(job ? services.jobs?.estimate(job.kind) : undefined, job?.startedAt, now);
  const contextKey = JSON.stringify(context), latest = useRef(context); latest.current = context;
  useEffect(() => {
    let live = true;
    const ctx = latest.current, { cards, warmup } = cardsFor(services, ctx);
    void Promise.all([services.learn?.todayList().catch(() => undefined), findRetry(services, ctx).catch(() => undefined)]).then(([today, retry]) => {
      if (!live) return;
      const due = today?.checks.find(c => c.check);
      setOptions({ cards, warmup, retry, check: due ? { path: due.check!, title: due.title } : undefined });
    });
    return () => { live = false; };
  }, [services, contextKey]);
  // The default: a due check when there's time for one, then cards, a missed point, or the notes.
  const remaining = job?.startedAt && services.jobs?.estimate(job.kind) !== undefined ? services.jobs.estimate(job.kind)! - (Date.now() - job.startedAt) : undefined;
  const available = useMemo(() => {
    if (!options) return [];
    const list: { id: Activity; label: string }[] = [];
    if (options.check) list.push({ id: 'check', label: `Check · ${options.check.title}` });
    if (options.cards.length) list.push({ id: 'cards', label: `${options.warmup ? 'Warm-up' : 'Cards'} · ${options.cards.length}` });
    if (options.retry) list.push({ id: 'retry', label: 'Retry a missed point' });
    if (context.prefer?.files?.length) list.push({ id: 'notes', label: 'Read the notes' });
    return list;
  }, [options, context.prefer?.files?.length]);
  const fallback = options?.check && (remaining === undefined || remaining >= 60_000) ? 'check' : options?.cards.length ? 'cards' : options?.retry ? 'retry' : context.prefer?.files?.length ? 'notes' : undefined;
  const current = activity ?? fallback;
  const engage = () => { if (!engaged) { setEngaged(true); onEngage?.(); } };

  return <div className="qard-wait">
    {ready && engaged ? <div className="qard-wait-ready" role="status"><CheckIcon size={16}/><strong>{readyLabel}</strong><span className="qard-spacer"/><button className="qard-primary" onClick={onContinue}>Continue<ArrowRight size={15}/></button></div>
      : <div className="qard-wait-head"><Waiting text={title}>{job && <AgentLabel services={services} role={roleOf(job.kind)}/>}</Waiting>{left && <span className="qard-muted qard-small">{left}</span>}</div>}
    {!engaged && <p className="qard-muted qard-small">{detail ? `${detail} ` : ''}You can leave this screen; it keeps going, and Qard tells you when it's done.</p>}
    {options && (available.length ? <section className="qard-wait-body">
      <div className="qard-wait-tabs"><span className="qard-label">While you wait</span>{available.length > 1 && available.map(a => <button key={a.id} className={'qard-chip' + (current === a.id ? ' is-on' : '')} aria-pressed={current === a.id} onClick={() => setActivity(a.id)}>{a.label}</button>)}</div>
      {current === 'cards' && <MiniReview services={services} cards={options.cards} warmup={options.warmup} onEngage={engage}/>}
      {current === 'check' && options.check && <div className="qard-wait-check" onInput={engage} onClick={engage}><CheckView services={services} path={options.check.path} onFinish={() => setOptions({ ...options, check: undefined })}/></div>}
      {current === 'retry' && options.retry && <RetryPoint services={services} folder={options.retry.folder} question={options.retry.question} onEngage={engage}/>}
      {current === 'notes' && <div className="qard-wait-notes">{context.prefer!.files!.slice(0, 6).map(f => <button key={f} className="qard-link" onClick={() => { engage(); void services.app.workspace.openLinkText(f, '', 'split'); }}>{f.split('/').pop()!.replace(/\.md$/, '')}</button>)}</div>}
    </section> : <p className="qard-muted qard-small">Nothing is due right now.</p>)}
  </div>;
}

const RATINGS: { rating: Rating; label: string }[] = [{ rating: 1, label: 'Again' }, { rating: 2, label: 'Hard' }, { rating: 3, label: 'Good' }, { rating: 4, label: 'Easy' }];
/** A few flashcards inline, rated as usual so the time counts. */
function MiniReview({ services, cards, warmup, onEngage }: { services: QardServices; cards: QardCard[]; warmup: boolean; onEngage: () => void }) {
  const [index, setIndex] = useState(0), [revealed, setRevealed] = useState(false), [error, setError] = useState('');
  const card = cards[index];
  if (!card) return <p className="qard-wait-done"><CheckIcon size={15}/> {cards.length} {cards.length === 1 ? 'card' : 'cards'} reviewed.</p>;
  async function rate(rating: Rating) {
    setError('');
    try { await services.reviews.review(card!.id, rating); if (rating === 1) void services.learn?.cardLapse(card!.id).catch(() => {}); setIndex(i => i + 1); setRevealed(false); }
    catch (e) { setError((e as Error).message); }
  }
  return <div className="qard-wait-card">
    <div className="qard-muted qard-small">{warmup ? 'Warm-up on what this builds on' : card.deck} · {index + 1} of {cards.length}</div>
    <div className="qard-wait-front"><Markdown text={card.frontMarkdown} path={card.sourceFile} services={services}/></div>
    {revealed ? <>
      <div className="qard-wait-back"><Markdown text={card.backMarkdown} path={card.sourceFile} services={services}/></div>
      <div className="qard-wait-ratings">{RATINGS.map(r => <button key={r.rating} onClick={() => void rate(r.rating)}>{r.label}</button>)}</div>
    </> : <div className="qard-wait-ratings"><button className="qard-text-button" onClick={() => { setIndex(i => i + 1); }}>Skip</button><button className="qard-primary" onClick={() => { onEngage(); setRevealed(true); }}>Show answer</button></div>}
    {error && <p className="qard-error" role="alert">{error}</p>}
  </div>;
}

/** One question you lost marks on: try the missed points again, then see the feedback. */
function RetryPoint({ services, folder, question, onEngage }: { services: QardServices; folder: string; question: string; onEngage: () => void }) {
  const { entry, job } = useTestFolder(services, folder);
  const [text, setText] = useState('');
  const test = entry?.test, attempt = entry?.attempt, q = test ? questions(test).find(x => x.id === question) : undefined;
  if (!test || !attempt || !q) return <Waiting text="Loading…"/>;
  const mark = attempt.marks[q.id], retry = attempt.review[q.id]?.retry, running = job('retry', q.id);
  const path = q.source?.path || folder;
  return <div className="qard-wait-card">
    <div className="qard-muted qard-small">{test.title} · you scored {mark?.score ?? 0}/{q.marks}</div>
    <div className="qard-wait-front"><Markdown text={q.prompt} path={path} services={services}/></div>
    <div className="qard-small"><span className="qard-label">Missed</span><ul className="qard-wait-missed">{q.rubric.filter((_, i) => !mark?.awarded[i]).map((r, i) => <li key={i}><InlineMarkdown text={r.point} path={path} services={services}/></li>)}</ul></div>
    {retry ? <div className="qard-panel"><Markdown text={`${retry.feedback} (${retry.score}/${q.marks} together.)`} path={path} services={services}/></div>
      : <form className="qard-wait-retry" onSubmit={e => { e.preventDefault(); if (text.trim()) void services.tests.retry(folder, q.id, text); }}>
        <textarea aria-label="Try the missed points again" rows={3} placeholder="Try the missed points again…" value={text} disabled={!!running && !running.error} onChange={e => { onEngage(); setText(e.target.value); }}/>
        <div className="qard-wait-ratings">{running && !running.error ? <Waiting text="Checking…"><AgentLabel services={services} role="tutor"/></Waiting> : <button type="submit" className="qard-primary" disabled={!text.trim()}>Check</button>}</div>
      </form>}
  </div>;
}
