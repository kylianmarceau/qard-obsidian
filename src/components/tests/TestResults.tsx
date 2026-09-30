import { ArrowRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { questions, scoreOf } from '../../tests/test-types';
import { InlineMarkdown, Markdown } from '../Markdown';
import { AgentLabel } from '../jobs/AgentLabel';
import { JobError, Waiting, scoreTone, useTestFolder, type TestNav } from './common';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';

export function TestResults({ services, nav, folder }: { services: QardServices; nav: TestNav; folder: string }) {
  const { entry, error, job } = useTestFolder(services, folder);
  const hold = useHold();
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  const test = entry?.test, attempt = entry?.attempt;
  if (!test) return <Waiting text="Loading…"/>;
  const total = scoreOf(test, attempt);
  const failed = test.sections.filter(s => attempt?.sections[s.id]?.status === 'error');
  if (failed.length && !total.marked) return <div className="qard-results">{failed.map(s => <div key={s.id} className="qard-error" role="alert"><span>Couldn't mark {s.title}: {attempt?.sections[s.id]?.error}</span><button className="qard-text-button" onClick={() => void services.tests.mark(folder, [s.id])}>Try again</button></div>)}</div>;
  // While marking, review anything except this test's own material.
  if (!total.marked || hold.held) return <WhileYouWait services={services} title="Marking your answers…" job={services.tests.jobsFor(folder).find(j => j.kind === 'mark')} ready={total.marked} readyLabel="Your results are ready"
    onEngage={hold.engage} onContinue={hold.release} context={{ kind: 'marking', avoid: { files: questions(test).map(q => q.source?.path ?? '').filter(Boolean) } }}/>;
  const wrapup = attempt?.wrapup, summary = job('wrapup'), all = questions(test);
  const sure = new Set(all.filter(q => attempt?.answers[q.id]?.confidence === 'sure' && (attempt.marks[q.id]?.score ?? 0) < q.marks).map(q => q.id));
  const suggestions = wrapup?.cards.filter((_, i) => !attempt?.cards?.[i]).length ?? 0;
  return <div className="qard-results">
    <section className="qard-results-top">
      <div>
        <span className="qard-muted"><InlineMarkdown text={test.title} path={folder} services={services}/></span>
        <div className="qard-score-big">{total.score}<span>/{total.marks}</span><small>{Math.round(total.score / Math.max(1, total.marks) * 100)}%</small></div>
        <div className="qard-section-scores">{test.sections.map(s => { const r = scoreOf(test, attempt, s); return <span key={s.id}><InlineMarkdown text={s.title} path={folder} services={services}/> <strong className={scoreTone(r.score, r.marks)}>{r.score}/{r.marks}</strong></span>; })}</div>
      </div>
      <button className="qard-primary" onClick={() => nav.review(folder)}>Review answers<ArrowRight size={15}/></button>
    </section>
    <section>
      <h2 className="qard-label">To fix</h2>
      {wrapup ? wrapup.fixes.length ? wrapup.fixes.map(f => { const q = all.find(x => x.id === f.questionId); return <button key={f.questionId + f.title} className="qard-fix" onClick={() => nav.review(folder, f.questionId)}>
        <span className="qard-muted">Q{all.indexOf(q!) + 1}</span><span><strong>{f.title}</strong><Markdown text={f.body} path={q?.source?.path || folder} services={services}/></span>{sure.has(f.questionId) ? <span className="qard-sure">You were sure</span> : <span/>}
      </button>; }) : <p className="qard-muted">Nothing major. Well done.</p>
        : summary?.error ? <JobError job={summary} retry={() => void services.tests.wrapup(folder)}/> : <Waiting text="Writing your summary…"><AgentLabel services={services} role="writer"/></Waiting>}
    </section>
    {wrapup && <section className="qard-results-links">
      {wrapup.cards.length > 0 && <button className="qard-link" onClick={() => nav.cards(folder)}>{suggestions ? `${suggestions} suggested ${suggestions === 1 ? 'card' : 'cards'}` : 'Suggested cards'} →</button>}
      {wrapup.fixes.length > 0 && <button className="qard-link" onClick={() => nav.newTest(`Follow-up on my last test (${test.title}). Focus on: ${wrapup.fixes.map(f => f.title).join('; ')}.`)}>Follow-up test on these →</button>}
    </section>}
  </div>;
}
