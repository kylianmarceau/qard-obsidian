import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Confidence, Question, SectionStatus } from '../../tests/test-types';
import { scoreOf } from '../../tests/test-types';
import { Markdown } from '../Markdown';
import { JobError, Waiting, useTestFolder, type TestNav } from './common';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';
import { AgentLabel } from '../jobs/AgentLabel';

const CONFIDENCE: { id: Confidence; label: string }[] = [{ id: 'sure', label: 'Sure' }, { id: 'unsure', label: 'Unsure' }, { id: 'guess', label: 'Guess' }];

export function TakeTest({ services, nav, folder }: { services: QardServices; nav: TestNav; folder: string }) {
  const { entry, error, job } = useTestFolder(services, folder);
  const test = entry?.test, attempt = entry?.attempt;
  const [index, setIndex] = useState<number>();
  const hold = useHold();
  const marking = services.reviews.getSnapshot().settings.tests.marking;
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (test && index === undefined) { const next = test.sections.findIndex(s => (attempt?.sections[s.id]?.status ?? 'open') === 'open'); setIndex(next < 0 ? test.sections.length - 1 : next); } }, [test, attempt, index]);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }); }, [index]);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  const writing = job('generate');
  if (!entry) return <Waiting text="Loading…"/>;
  if (!test && writing?.error) return <div className="qard-doc"><JobError job={writing} retry={() => void services.tests.generate({ folder })}/></div>;
  if (!test || hold.held) return <WhileYouWait services={services} title="Writing your test…" job={writing} ready={!!test} readyLabel="Your test is ready" onEngage={hold.engage} onContinue={hold.release}
    context={{ kind: 'test', avoid: { files: [...(entry?.request?.sources ?? []), ...(entry?.plan?.sources.map(x => x.path) ?? [])] } }}/>;
  if (index === undefined) return null;
  const section = test.sections[index]!, status: SectionStatus = attempt?.sections[section.id]?.status ?? 'open';
  // Exam mode keeps every answer editable until Finish; section mode locks a section once submitted.
  const last = index === test.sections.length - 1, submitted = marking === 'section' && status !== 'open';
  // One status line for background marking: what's running, what failed, or what just finished.
  const busy = test.sections.find(s => attempt?.sections[s.id]?.status === 'marking');
  const failed = test.sections.find(s => attempt?.sections[s.id]?.status === 'error');
  const done = [...test.sections].reverse().find(s => attempt?.sections[s.id]?.status === 'marked' && s.questions.some(q => q.type !== 'mcq'));
  const doneScore = done && scoreOf(test, attempt, done);
  return <div className="qard-test" ref={top}>
    <div className="qard-test-steps" aria-label="Sections">{test.sections.map((s, i) => { const st = attempt?.sections[s.id]?.status ?? 'open'; return <button key={s.id} className={i === index ? 'is-current' : st === 'marked' && marking === 'section' ? 'is-done' : ''} onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined}>{s.title}{marking === 'section' && st === 'marked' ? ' ✓' : st === 'marking' ? ' · marking' : ''}</button>; })}</div>
    {failed ? <div className="qard-toast is-error" role="alert"><span>Couldn't mark {failed.title}: {attempt?.sections[failed.id]?.error}</span><button className="qard-text-button" onClick={() => void services.tests.mark(folder, [failed.id])}>Try again</button></div>
      : busy ? <div className="qard-toast" role="status"><span className="qard-dot" aria-hidden="true"/>Marking {busy.title}…<AgentLabel services={services} role="marker"/></div>
      : marking === 'section' && done && doneScore ? <div className="qard-toast" role="status"><span className="qard-dot is-done" aria-hidden="true"/>{done.title} marked · {doneScore.score} / {doneScore.marks}<button className="qard-text-button" onClick={() => nav.review(folder, done.questions[0]?.id)}>Review</button></div> : null}
    <div className="qard-test-heading"><h1>{section.title}</h1><span className="qard-muted">{section.questions.length} {section.questions.length === 1 ? 'question' : 'questions'} · {section.questions.reduce((n, q) => n + q.marks, 0)} marks</span></div>
    {section.questions.map((q, i) => <QuestionBlock key={q.id} services={services} folder={folder} question={q} number={test.sections.slice(0, index).reduce((n, s) => n + s.questions.length, 0) + i + 1} locked={submitted}/>)}
    <div className="qard-test-footer">
      {index > 0 && <button className="qard-text-button" onClick={() => setIndex(index - 1)}>← {test.sections[index - 1]!.title}</button>}
      <span className="qard-spacer"/>
      {!submitted && marking === 'section' && <span className="qard-muted">Marked in the background, so you can keep going.</span>}
      {!submitted && !last && <button className="qard-primary" onClick={() => { if (marking === 'section') void services.tests.submit(folder, section.id); setIndex(index + 1); }}>{marking === 'section' ? 'Submit section' : 'Next section'}</button>}
      {submitted && !last && <button className="qard-primary" onClick={() => setIndex(index + 1)}>Next section →</button>}
      {last && <button className="qard-primary" onClick={() => { void services.tests.finish(folder); nav.results(folder); }}>{attempt?.finishedAt ? 'See results' : 'Finish test'}</button>}
    </div>
  </div>;
}

function QuestionBlock({ services, folder, question: q, number, locked }: { services: QardServices; folder: string; question: Question; number: number; locked: boolean }) {
  const answer = services.tests.get(folder)?.attempt?.answers[q.id];
  const set = (patch: Parameters<typeof services.tests.answer>[2]) => services.tests.answer(folder, q.id, patch);
  const path = q.source?.path || folder;
  return <article className="qard-q">
    <div className="qard-q-meta"><span>Question {number}</span><span>{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span></div>
    <div className="qard-q-prompt"><Markdown text={q.prompt} path={path} services={services}/></div>
    {q.type === 'mcq' ? <div className="qard-options" role="radiogroup" aria-label={`Question ${number} options`}>{q.options?.map((o, i) => <button key={i} role="radio" aria-checked={answer?.choice === i} disabled={locked || !!answer?.unknown} className={'qard-option' + (answer?.choice === i ? ' is-on' : '')} onClick={() => set({ choice: i })}><span className="qard-radio" aria-hidden="true"/><Markdown text={o} path={path} services={services}/></button>)}</div>
      : <><textarea className="qard-answer-input" aria-label={`Answer to question ${number}`} rows={q.type === 'long' ? 6 : q.type === 'calc' ? 3 : 2} value={answer?.text ?? ''} readOnly={locked} disabled={!!answer?.unknown} onChange={e => set({ text: e.target.value })}/>
        {q.type === 'calc' && /\$|\\[a-z]/i.test(answer?.text ?? '') && <div className="qard-latex-preview"><Markdown text={/\$/.test(answer!.text!) ? answer!.text! : `$${answer!.text!}$`} path={path} services={services}/></div>}</>}
    <div className="qard-q-tools"><button className={'qard-conf qard-dont-know' + (answer?.unknown ? ' is-on' : '')} aria-pressed={!!answer?.unknown} disabled={locked} onClick={() => set(answer?.unknown ? { unknown: false } : { unknown: true, choice: undefined, confidence: undefined })}>I don't know</button><span className="qard-spacer"/>{CONFIDENCE.map(c => <button key={c.id} className={'qard-conf' + (answer?.confidence === c.id ? ' is-on' : '')} aria-pressed={answer?.confidence === c.id} disabled={locked || !!answer?.unknown} onClick={() => set({ confidence: answer?.confidence === c.id ? undefined : c.id })}>{c.label}</button>)}
      <button className={'qard-icon-button qard-flag' + (answer?.flagged ? ' is-on' : '')} aria-pressed={!!answer?.flagged} aria-label={`Flag question ${number}`} onClick={() => set({ flagged: !answer?.flagged })}><Flag size={14}/></button></div>
  </article>;
}
