import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Lesson } from '../../learn/learn-types';
import type { Objective } from '../../learn/mastery';
import { isoDay } from '../../learn/mastery';
import { InlineMarkdown, Markdown } from '../Markdown';
import { AgentLabel } from '../jobs/AgentLabel';
import { AskThread, type CardTarget } from '../common/AskThread';
import { JobError, Waiting } from '../tests/common';
import { AnswerInput, MarkedAnswer, StateChip, TutorHint, answered, relativeDay, useLearn, type LearnNav } from './common';
import { WhileYouWait, useHold, type WaitContext } from '../jobs/WhileYouWait';

/** Where the lesson sits: course › topic › objective, each opening the course map at that place. */
function LessonTrail({ services, nav, lesson }: { services: QardServices; nav: LearnNav; lesson: Lesson }) {
  const { revision } = useLearn(services);
  const [objective, setObjective] = useState<Objective>();
  useEffect(() => {
    if (!lesson.mastery || !lesson.objective) return;
    let live = true; services.learn.course(lesson.mastery).then(m => { if (live) setObjective(m.objectives.find(o => o.id === lesson.objective)); }, () => {});
    return () => { live = false; };
  }, [services, lesson.mastery, lesson.objective, revision]);
  if (!lesson.mastery) return null;
  const open = () => nav.course(lesson.mastery!, lesson.objective);
  return <nav className="qard-lesson-trail" aria-label="Where this lesson sits in the course">
    <button className="qard-link" onClick={() => nav.course(lesson.mastery!)}>{lesson.course ?? 'Course'}</button>
    {objective?.group && <><span aria-hidden="true">›</span><button className="qard-link" onClick={open}>{objective.group}</button></>}
    {objective && <><span aria-hidden="true">›</span><button className="qard-link" onClick={open}>{objective.label || objective.title}</button><StateChip state={objective.state}/></>}
    <button className="qard-text-button qard-lesson-trail-map" onClick={open}>Show on map</button>
  </nav>;
}

/** Cards from a lesson go into the deck of its first note when that note has cards, else a deck named after the course. */
function lessonCardTarget(services: QardServices, lesson: Lesson): CardTarget {
  const noteCards = services.index.getSnapshot().cards.filter(c => lesson.notes.includes(c.sourceFile));
  const topic = lesson.map?.title ?? lesson.topic;
  return noteCards.length ? { deck: noteCards[0]!.deck, topic, sourceFile: noteCards[0]!.sourceFile } : { deck: lesson.course ?? lesson.topic, topic };
}

export function LessonView({ services, nav, path }: { services: QardServices; nav: LearnNav; path: string }) {
  const { job } = useLearn(services);
  const [error, setError] = useState(''), [warmup, setWarmup] = useState<WaitContext['prefer']>();
  const hold = useHold();
  useEffect(() => { services.learn.openLesson(path).then(() => services.learn.warmupFor(path)).then(setWarmup, e => setError((e as Error).message)); }, [services, path]);
  const lesson = services.learn.lessonAt(path);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  if (!lesson) return <Waiting text="Loading…"/>;
  const trail = <LessonTrail services={services} nav={nav} lesson={lesson}/>;
  const context: WaitContext = { kind: 'lesson', prefer: warmup };
  if (lesson.finishedAt) return <>{trail}<LessonClose services={services} nav={nav} path={path} lesson={lesson}/></>;
  if (lesson.accepted) return <>{trail}<LessonSteps services={services} path={path} lesson={lesson} context={context}/></>;
  // While the tutor finds where to start and plans, warm up on what the lesson builds on.
  const probing = job(path, 'probe'), planning = job(path, 'map');
  const waitingProbe = !lesson.probe && !probing?.error, waitingPlan = !!lesson.probe?.submitted && !lesson.map && !planning?.error;
  if (waitingProbe || waitingPlan || hold.held) return <>{trail}<WhileYouWait services={services} title={lesson.map || waitingPlan ? 'Planning the lesson…' : 'Finding where to start…'} job={waitingProbe ? probing : planning}
    ready={!waitingProbe && !waitingPlan} readyLabel={lesson.map ? 'Your lesson plan is ready' : 'A few quick questions are ready'} onEngage={hold.engage} onContinue={hold.release} context={context}/><TutorHint services={services}/></>;
  if (lesson.map) return <>{trail}<LessonMapView services={services} path={path} lesson={lesson}/></>;
  return <>{trail}<LessonProbe services={services} path={path} lesson={lesson}/></>;
}

function LessonProbe({ services, path, lesson }: { services: QardServices; path: string; lesson: Lesson }) {
  const { job } = useLearn(services);
  const probing = job(path, 'probe'), mapping = job(path, 'map'), probe = lesson.probe;
  if (!probe) return <div className="qard-doc">{probing?.error ? <JobError job={probing} retry={() => void services.learn.probe(path)}/> : <><Waiting text="Finding where to start…"><AgentLabel services={services} role="tutor"/></Waiting><p className="qard-muted">The tutor is checking your notes and what you already know about {lesson.topic}.</p><TutorHint services={services}/></>}</div>;
  if (probe.submitted) return <div className="qard-doc">{mapping?.error ? <JobError job={mapping} retry={() => void services.learn.submitProbe(path)}/> : <><Waiting text="Planning the lesson…"><AgentLabel services={services} role="tutor"/></Waiting><p className="qard-muted">Reading your answers to decide where to start.</p><TutorHint services={services}/></>}</div>;
  return <div className="qard-test">
    <div className="qard-test-heading"><div><span className="qard-muted">Lesson · {lesson.course ?? 'Before we start'}</span><h1><InlineMarkdown text={lesson.topic} path={lesson.notes[0] ?? path} services={services}/></h1></div></div>
    <p className="qard-muted">A few quick questions first, so the lesson starts from what you already know. Say "I don't know" rather than guessing.</p>
    {probe.questions.map((q, i) => <AnswerInput key={q.id} services={services} question={q} answer={probe.answers[q.id]} locked={false} path={lesson.notes[0] ?? path} label={`Question ${i + 1}`} onChange={patch => services.learn.answerProbe(path, q.id, patch)}/>)}
    <div className="qard-test-footer"><span className="qard-spacer"/><button className="qard-primary" disabled={!probe.questions.every(q => answered(q, probe.answers[q.id]))} onClick={() => void services.learn.submitProbe(path)}>Continue<ArrowRight size={15}/></button></div>
  </div>;
}

function LessonMapView({ services, path, lesson }: { services: QardServices; path: string; lesson: Lesson }) {
  const { job } = useLearn(services);
  const [change, setChange] = useState('');
  const map = lesson.map!, revising = job(path, 'revise'), busy = !!revising && !revising.error, probe = lesson.probe;
  const where = lesson.notes[0] ?? path;
  return <article className="qard-doc">
    <header><span className="qard-muted">Lesson plan{lesson.course ? ` · ${lesson.course}` : ''}</span><h1><InlineMarkdown text={map.title} path={where} services={services}/></h1>{probe?.findings && <div className="qard-lesson-findings"><Markdown text={probe.findings} path={where} services={services}/></div>}</header>
    {probe && probe.questions.length > 0 && <section className="qard-probe-results">{probe.questions.map(q => { const m = probe.marks?.[q.id]; const ok = !!m && m.score >= q.marks; return <div key={q.id} className="qard-doc-row"><span className={ok ? 'is-full' : 'is-zero'}>{ok ? '✓' : '✕'}</span><div className="qard-probe-prompt"><Markdown text={q.prompt.split(/\n\s*\n/)[0]!} path={where} services={services}/></div></div>; })}</section>}
    <section><h2>Plan</h2><div className="qard-doc-body"><Markdown text={map.plan} path={where} services={services}/></div></section>
    {map.mermaid.trim() && <section className="qard-lesson-map"><Markdown text={'```mermaid\n' + map.mermaid.replace(/^```(?:mermaid)?\s*|```\s*$/g, '').trim() + '\n```'} path={where} services={services}/></section>}
    <section><h2>Steps</h2>{map.steps.map((s, i) => <div key={i} className="qard-doc-section"><span className="qard-muted">{i + 1}</span><div><strong><InlineMarkdown text={s.title} path={where} services={services}/></strong><div className="qard-doc-why"><Markdown text={s.why} path={where} services={services}/></div></div><span/></div>)}</section>
    <JobError job={revising} dismiss={() => services.learn.dismiss(path, 'revise')}/>
    <form className="qard-doc-footer" onSubmit={e => { e.preventDefault(); if (change.trim()) { void services.learn.reviseMap(path, change); setChange(''); } }}>
      <input aria-label="Ask for changes to the plan" placeholder={busy ? 'Revising…' : 'Ask for changes, e.g. skip the proof'} value={change} disabled={busy} onChange={e => setChange(e.target.value)}/>
      <button type="submit" className="qard-text-button" disabled={busy || !change.trim()}>Revise</button>
      <button type="button" className="qard-primary" disabled={busy} onClick={() => void services.learn.acceptMap(path)}>Start lesson<ArrowRight size={15}/></button>
    </form>
  </article>;
}

function LessonSteps({ services, path, lesson, context }: { services: QardServices; path: string; lesson: Lesson; context: WaitContext }) {
  const hold = useHold();
  const { job } = useLearn(services);
  const [retry, setRetry] = useState('');
  const index = lesson.current, step = lesson.steps[index], st = lesson.state[index], plan = lesson.map!.steps[index];
  const writing = job(path, 'steps'), tutor = job(path, 'tutor', String(index)), retrying = job(path, 'tutor', `${index}-retry`), asking = job(path, 'ask', String(index));
  const running = (j?: { error?: string }) => !!j && !j.error;
  const where = lesson.notes[0] ?? path, last = index === lesson.steps.length - 1;
  useEffect(() => { setRetry(''); }, [index]);
  const explain = step && (!step.checkFirst || !!st?.mark);
  return <div className="qard-test qard-lesson">
    <div className="qard-test-steps" aria-label="Steps">{lesson.map!.steps.map((s, i) => <button key={i} className={i === index ? 'is-current' : lesson.state[i]?.mark ? 'is-done' : ''} disabled={!lesson.steps[i]} aria-current={i === index ? 'step' : undefined} onClick={() => void services.learn.go(path, i)}>{i + 1}. <InlineMarkdown text={s.title} path={where} services={services}/>{lesson.state[i]?.mark ? ' ✓' : ''}</button>)}</div>
    <div className="qard-test-heading"><div><span className="qard-muted">Step {index + 1} of {lesson.steps.length}</span><h1><InlineMarkdown text={step?.title ?? plan?.title ?? ''} path={where} services={services}/></h1></div></div>
    {plan && <div className="qard-lesson-why"><Markdown text={plan.why} path={where} services={services}/></div>}
    {!step && writing?.error ? <JobError job={writing} retry={() => void services.learn.writeSteps(path)}/>
      : !step || hold.held ? <WhileYouWait services={services} title="Writing this step…" job={writing} ready={!!step} readyLabel="This step is ready" onEngage={hold.engage} onContinue={hold.release} context={context}/> : <>
      {explain && <section className="qard-lesson-explain"><Markdown text={step.explain} path={where} services={services}/><p className="qard-muted">{step.connect}</p></section>}
      {!st?.mark ? <>
        {step.checkFirst && <p className="qard-label">Try this first. Work it out from what you know.</p>}
        <AnswerInput services={services} question={step.check} answer={st?.answer} locked={running(tutor)} path={where} label={step.checkFirst ? 'Before the explanation' : 'Check'} onChange={patch => services.learn.answerStep(path, patch)}/>
        <JobError job={tutor} retry={() => void services.learn.checkStep(path)}/>
        {running(tutor) && <TutorHint services={services}/>}
        <div className="qard-panel-actions">{running(tutor) ? <Waiting text="Checking…"><AgentLabel services={services} role="tutor"/></Waiting> : <button className="qard-primary" disabled={!answered(step.check, st?.answer)} onClick={() => void services.learn.checkStep(path)}>Check</button>}</div>
      </> : <section className="qard-lesson-feedback">
        {st.reply && <div className="qard-tutor"><Markdown text={st.reply} path={where} services={services}/></div>}
        <MarkedAnswer services={services} question={step.check} answer={st.answer} mark={st.mark} path={where}/>
        {st.reteach && <div className="qard-reteach"><div className="qard-label">Another way to see it</div><Markdown text={st.reteach} path={where} services={services}/></div>}
        {st.mark.score < step.check.marks && !st.answer?.unknown && (st.retry ? <div className="qard-panel"><p className="qard-muted">Second try ({st.retry.mark.score}/{step.check.marks}): {st.retry.text}</p><Markdown text={st.retry.reply} path={where} services={services}/></div>
          : <form className="qard-panel" onSubmit={e => { e.preventDefault(); if (retry.trim()) void services.learn.retryStep(path, retry); }}>
            <textarea aria-label="Second try" rows={2} placeholder="Try again with what you've just seen…" value={retry} disabled={running(retrying)} onChange={e => setRetry(e.target.value)}/>
            <JobError job={retrying} dismiss={() => services.learn.dismiss(path, 'tutor', `${index}-retry`)}/>
            <div className="qard-panel-actions">{running(retrying) ? <Waiting text="Checking…"><AgentLabel services={services} role="tutor"/></Waiting> : <button type="submit" disabled={!retry.trim()}>Try again</button>}</div>
          </form>)}
      </section>}
      <AskThread key={index} services={services} path={where} items={st?.asks ?? []} busy={running(asking)} error={asking?.error} role="tutor" title="Questions about this step" placeholder="Ask anything about this step…"
        ask={q => void services.learn.ask(path, q)} dismiss={() => services.learn.dismiss(path, 'ask', String(index))}
        card={lessonCardTarget(services, lesson)} onCard={id => { if (lesson.mastery && lesson.objective) void services.learn.linkCard(id, lesson.mastery, lesson.objective); }}/>
    </>}
    <div className="qard-test-footer">
      {index > 0 && <button className="qard-text-button" onClick={() => void services.learn.go(path, index - 1)}>← Previous</button>}
      <span className="qard-spacer"/>
      {!last ? <button className={st?.mark ? 'qard-primary' : ''} disabled={!lesson.steps[index + 1]} onClick={() => void services.learn.go(path, index + 1)}>{lesson.steps[index + 1] ? 'Next step' : 'Writing next step…'}<ArrowRight size={15}/></button>
        : <button className="qard-primary" disabled={!step} onClick={() => void services.learn.finishLesson(path)}>Finish lesson</button>}
    </div>
  </div>;
}

function LessonClose({ services, nav, path, lesson }: { services: QardServices; nav: LearnNav; path: string; lesson: Lesson }) {
  const { job, revision } = useLearn(services);
  const [objective, setObjective] = useState<Objective>(), [busy, setBusy] = useState<number>(), [error, setError] = useState('');
  useEffect(() => {
    if (!lesson.mastery || !lesson.objective) return;
    let live = true; services.learn.course(lesson.mastery).then(m => { if (live) setObjective(m.objectives.find(o => o.id === lesson.objective)); }, () => {});
    return () => { live = false; };
  }, [services, lesson.mastery, lesson.objective, revision]);
  const closing = job(path, 'close'), close = lesson.close, where = lesson.notes[0] ?? path;
  if (!close) return <div className="qard-doc">{closing?.error ? <JobError job={closing} retry={() => void services.learn.close(path)}/> : <><Waiting text="Wrapping up…"><AgentLabel services={services} role="writer"/></Waiting><p className="qard-muted">Saving the lesson, suggesting cards and writing your next check.</p></>}</div>;
  const target = lessonCardTarget(services, lesson);
  async function add(i: number) {
    setBusy(i); setError('');
    try { const card = await services.writer.create({ ...target, front: close!.cards[i]!.front, back: close!.cards[i]!.back, folder: services.reviews.getSnapshot().settings.cardFolder }); await services.learn.lessonCard(path, i, 'added', card.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  }
  const edit = close.noteEdit;
  return <article className="qard-doc">
    <header><span className="qard-muted">Lesson complete</span><h1><InlineMarkdown text={lesson.map?.title ?? lesson.topic} path={where} services={services}/></h1>
      {objective && <p className="qard-check-outcome"><StateChip state={objective.state}/><span className="qard-muted">{objective.due ? `First check ${relativeDay(objective.due, isoDay(Date.now()))}. Getting it right straight after a lesson doesn't count yet.` : ''}</span></p>}</header>
    <section><h2>Summary</h2><div className="qard-doc-body"><Markdown text={close.summary} path={where} services={services}/></div></section>
    {close.cards.length > 0 && <section><h2>Suggested cards</h2>{close.cards.map((c, i) => { const state = close.cardState[i]; return <article key={i} className={'qard-suggestion' + (state === 'skipped' ? ' is-skipped' : '')}>
      <div className="qard-suggestion-body"><strong><Markdown text={c.front} path={where} services={services}/></strong><Markdown text={c.back} path={where} services={services}/><small className="qard-muted">{target.deck} › {target.topic}</small></div>
      <div className="qard-suggestion-actions">{!state ? <><button className="qard-text-button" onClick={() => void services.learn.lessonCard(path, i, 'skipped')}>Skip</button><button disabled={busy !== undefined} onClick={() => void add(i)}>{busy === i ? 'Adding…' : 'Add'}</button></> : state === 'added' ? <span className="is-full">✓ Added</span> : <button className="qard-text-button" onClick={() => void services.learn.lessonCard(path, i, undefined)}>Undo</button>}</div>
    </article>; })}</section>}
    {edit && <section><h2>Add to your notes</h2><p className="qard-muted">{edit.path.split('/').pop()!.replace(/\.md$/, '')}{edit.heading ? ` › ${edit.heading}` : ''}</p>
      <div className="qard-note-edit"><Markdown text={edit.text} path={where} services={services}/></div>
      {close.noteState ? <p className="qard-muted">{close.noteState === 'accepted' ? '✓ Added to the note.' : 'Skipped.'}</p>
        : <div className="qard-panel-actions"><button className="qard-text-button" onClick={() => void services.learn.noteEdit(path, false)}>Skip</button><button className="qard-primary" onClick={() => void services.learn.noteEdit(path, true).catch(e => setError((e as Error).message))}>Add to note</button></div>}</section>}
    {error && <p className="qard-error" role="alert">{error}</p>}
    <div className="qard-doc-footer is-end">{close.note && <button className="qard-text-button" onClick={() => void services.app.workspace.openLinkText(close.note!, '', true)}>Open lesson note</button>}{lesson.mastery && <button onClick={() => nav.course(lesson.mastery!)}>Course</button>}<button className="qard-primary" onClick={nav.today}>Done</button></div>
  </article>;
}
