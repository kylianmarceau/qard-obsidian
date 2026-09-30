import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { InlineMarkdown, Markdown } from '../Markdown';
import { JobError, Waiting, useTestFolder, type TestNav } from './common';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';

export function PlanView({ services, nav, folder }: { services: QardServices; nav: TestNav; folder: string }) {
  const { entry, error, job } = useTestFolder(services, folder);
  const [change, setChange] = useState('');
  const hold = useHold();
  const planning = job('plan'), writing = job('generate');
  useEffect(() => { if (entry?.test && !hold.held) nav.take(folder); }, [entry?.test, folder, nav, hold.held]);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  const plan = entry?.plan;
  if (!entry) return <Waiting text="Loading…"/>;
  const waitingPlan = !plan && !planning?.error, waitingTest = !!writing && !writing.error;
  if (waitingPlan || waitingTest || hold.held) {
    // One waiting screen for both phases; once something is started it stays until the student continues.
    const forTest = waitingTest || !!entry?.test;
    return <WhileYouWait services={services} title={forTest ? 'Writing your test…' : 'Planning your test…'} job={forTest ? writing : planning} ready={forTest ? !!entry?.test : !!plan}
      readyLabel={forTest ? 'Your test is ready' : 'Your test plan is ready'} onEngage={hold.engage} onContinue={() => { hold.release(); if (entry?.test) nav.take(folder); }}
      context={{ kind: 'test', avoid: { files: [...(entry?.request?.sources ?? []), ...(plan?.sources.map(x => x.path) ?? [])] } }}
      cancel={() => services.tests.cancel(folder, forTest ? 'generate' : 'plan')}/>;
  }
  if (!plan) return <div className="qard-doc"><JobError job={planning} dismiss={() => services.tests.dismiss(folder, 'plan')}/></div>;
  const revising = !!planning && !planning.error;
  return <article className="qard-doc">
    <header><span className="qard-muted">Test plan</span><h1><InlineMarkdown text={plan.title} path={folder} services={services}/></h1><p className="qard-muted">{plan.questionCount} questions · {plan.totalMarks} marks · about {plan.minutes} minutes · marked {services.reviews.getSnapshot().settings.tests.marking === 'end' ? 'at the end' : 'after each section'}</p></header>
    <section><h2>Goal</h2><div className="qard-doc-body"><Markdown text={plan.goal} path={folder} services={services}/></div></section>
    <section><h2>Sources</h2>{plan.sources.length ? plan.sources.map(s => <div key={s.path} className="qard-doc-row"><button className="qard-link" onClick={() => void services.app.workspace.openLinkText(s.path, '', true)}>{s.path.split('/').pop()!.replace(/\.md$/, '')}</button><span className="qard-muted"><InlineMarkdown text={s.reason} path={folder} services={services}/></span><button className="qard-icon-button" aria-label={`Remove ${s.path}`} disabled={revising} onClick={() => void services.tests.removeSource(folder, s.path)}><X size={14}/></button></div>) : <p className="qard-muted">None. The agent will write from general knowledge.</p>}</section>
    <section><h2>Sections</h2>{plan.sections.map((s, i) => <div key={i} className="qard-doc-section"><span className="qard-muted">{String.fromCharCode(65 + i)}</span><div><strong><InlineMarkdown text={s.title} path={folder} services={services}/></strong><p><InlineMarkdown text={s.focus} path={folder} services={services}/></p><small className="qard-muted"><InlineMarkdown text={s.questions} path={folder} services={services}/></small></div><span className="qard-muted">{s.marks} marks</span></div>)}</section>
    <JobError job={planning} dismiss={() => services.tests.dismiss(folder, 'plan')}/><JobError job={writing} retry={() => void services.tests.generate({ folder })}/>
    <form className="qard-doc-footer" onSubmit={e => { e.preventDefault(); if (change.trim()) { void services.tests.revise(folder, change); setChange(''); } }}>
      <input aria-label="Ask for changes to the plan" placeholder={revising ? 'Revising…' : 'Ask for changes, e.g. more calculation questions'} value={change} disabled={revising} onChange={e => setChange(e.target.value)}/>
      <button type="submit" className="qard-text-button" disabled={revising || !change.trim()}>Revise</button>
      <button type="button" className="qard-primary" disabled={revising} onClick={() => void services.tests.generate({ folder })}>Generate test<ArrowRight size={15}/></button>
    </form>
  </article>;
}
