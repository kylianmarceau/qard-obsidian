import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { JobError, Waiting, useTestFolder, type TestNav } from './common';

export function PlanView({ services, nav, folder }: { services: QardServices; nav: TestNav; folder: string }) {
  const { entry, error, job } = useTestFolder(services, folder);
  const [change, setChange] = useState('');
  const planning = job('plan'), writing = job('generate');
  useEffect(() => { if (entry?.test) nav.take(folder); }, [entry?.test, folder, nav]);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  const plan = entry?.plan;
  if (writing && !writing.error) return <div className="qard-doc"><Waiting text="Writing your test…"/><p className="qard-muted">This usually takes a minute or two. You can leave this screen; the test appears under Tests when it is ready.</p></div>;
  if (!plan) return <div className="qard-doc">{planning?.error ? <JobError job={planning} dismiss={() => services.tests.dismiss(folder, 'plan')}/> : <><Waiting text="Planning your test…"/><p className="qard-muted">Reading your prompt and looking for the right notes.</p></>}</div>;
  const revising = !!planning && !planning.error;
  return <article className="qard-doc">
    <header><span className="qard-muted">Test plan</span><h1>{plan.title}</h1><p className="qard-muted">{plan.questionCount} questions · {plan.totalMarks} marks · about {plan.minutes} minutes · marked {services.reviews.getSnapshot().settings.tests.marking === 'end' ? 'at the end' : 'after each section'}</p></header>
    <section><h2>Goal</h2><p className="qard-doc-body">{plan.goal}</p></section>
    <section><h2>Sources</h2>{plan.sources.length ? plan.sources.map(s => <div key={s.path} className="qard-doc-row"><button className="qard-link" onClick={() => void services.app.workspace.openLinkText(s.path, '', true)}>{s.path.split('/').pop()!.replace(/\.md$/, '')}</button><span className="qard-muted">{s.reason}</span><button className="qard-icon-button" aria-label={`Remove ${s.path}`} disabled={revising} onClick={() => void services.tests.removeSource(folder, s.path)}><X size={14}/></button></div>) : <p className="qard-muted">None. The agent will write from general knowledge.</p>}</section>
    <section><h2>Sections</h2>{plan.sections.map((s, i) => <div key={i} className="qard-doc-section"><span className="qard-muted">{String.fromCharCode(65 + i)}</span><div><strong>{s.title}</strong><p>{s.focus}</p><small className="qard-muted">{s.questions}</small></div><span className="qard-muted">{s.marks} marks</span></div>)}</section>
    <JobError job={planning} dismiss={() => services.tests.dismiss(folder, 'plan')}/><JobError job={writing} retry={() => void services.tests.generate({ folder })}/>
    <form className="qard-doc-footer" onSubmit={e => { e.preventDefault(); if (change.trim()) { void services.tests.revise(folder, change); setChange(''); } }}>
      <input aria-label="Ask for changes to the plan" placeholder={revising ? 'Revising…' : 'Ask for changes, e.g. more calculation questions'} value={change} disabled={revising} onChange={e => setChange(e.target.value)}/>
      <button type="submit" className="qard-text-button" disabled={revising || !change.trim()}>Revise</button>
      <button type="button" className="qard-primary" disabled={revising} onClick={() => void services.tests.generate({ folder })}>Generate test<ArrowRight size={15}/></button>
    </form>
  </article>;
}
