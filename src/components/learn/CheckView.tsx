import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Objective } from '../../learn/mastery';
import { isoDay } from '../../learn/mastery';
import { InlineMarkdown, Markdown } from '../Markdown';
import { AgentLabel } from '../jobs/AgentLabel';
import { JobControls } from '../jobs/JobControls';
import { JobError, Waiting, scoreTone } from '../tests/common';
import { AnswerInput, MarkedAnswer, StateChip, TutorHint, answered, relativeDay, useLearn, type LearnNav } from './common';

const GOAL: Record<string, string> = { recognise: 'Tell apart', recall: 'Recall', explain: 'Explain', apply: 'Apply' };

/** onFinish: shown inside another screen (while waiting), Next hands back instead of navigating. */
export function CheckView({ services, nav, path, onFinish }: { services: QardServices; nav?: LearnNav; path: string; onFinish?: () => void }) {
  const { revision, job } = useLearn(services);
  const [error, setError] = useState(''), [objective, setObjective] = useState<Objective>();
  useEffect(() => { services.learn.loadCheck(path).catch(e => setError((e as Error).message)); }, [services, path]);
  const record = services.learn.checkAt(path);
  useEffect(() => {
    if (!record?.finishedAt) return;
    let live = true; services.learn.course(record.mastery).then(m => { if (live) setObjective(m.objectives.find(o => o.id === record.objective)); }, () => {});
    return () => { live = false; };
  }, [services, record?.finishedAt, record?.mastery, record?.objective, revision]);
  if (error) return <p className="qard-error" role="alert">{error}</p>;
  if (!record) return <Waiting text="Loading…"/>;
  const marking = job(path, 'check-mark'), done = !!record.finishedAt, busy = !!marking && !marking.error;
  const score = record.questions.reduce((n, q) => n + (record.marks[q.id]?.score ?? 0), 0), marks = record.questions.reduce((n, q) => n + q.marks, 0);
  async function next() {
    if (onFinish || !nav) { onFinish?.(); return; }
    const today = await services.learn.todayList(), following = today.checks.find(c => c.check && c.check !== path);
    if (following) nav.check(following.check!); else if (today.cards) nav.studyDue(); else nav.today();
  }
  return <div className="qard-test">
    <div className="qard-test-heading"><div><span className="qard-muted">Check · {record.course} · {GOAL[record.goal] ?? record.goal}</span><h1><InlineMarkdown text={record.title} path={record.mastery} services={services}/></h1></div>
      {done && <span className={'qard-review-score ' + scoreTone(score, marks)}>{score}/{marks}</span>}</div>
    {done && objective && <p className="qard-check-outcome"><StateChip state={objective.state}/><span className="qard-muted">{objective.state === 'mastered' ? 'Mastered. Cards keep it fresh from here.' : objective.due ? `Next ${['gap', 'misconception'].includes(objective.state) ? 'lesson' : 'check'} ${relativeDay(objective.due, isoDay(Date.now()))}.` : ''}</span></p>}
    {record.questions.map((q, i) => done && record.marks[q.id]
      ? <article key={q.id} className="qard-q"><div className="qard-q-meta"><span>Question {i + 1}</span></div><div className="qard-q-prompt"><Markdown text={q.prompt} path={record.mastery} services={services}/></div><MarkedAnswer services={services} question={q} answer={record.answers[q.id]} mark={record.marks[q.id]!} path={record.mastery}/></article>
      : <AnswerInput key={q.id} services={services} question={q} answer={record.answers[q.id]} locked={busy || done} path={record.mastery} label={`Question ${i + 1}`} onChange={patch => services.learn.answerCheck(path, q.id, patch)}/>)}
    <JobError job={marking} retry={() => void services.learn.submitCheck(path)}/>
    {busy && <TutorHint services={services}/>}
    <div className="qard-test-footer">
      <span className="qard-spacer"/>
      {busy ? <><Waiting text="Marking…"><AgentLabel services={services} role="tutor"/></Waiting><JobControls services={services} job={marking} cancel={() => services.learn.cancel(path, 'check-mark')}/></> : done ? <button className="qard-primary" onClick={() => void next()}>Next<ArrowRight size={15}/></button>
        : <button className="qard-primary" disabled={!record.questions.every(q => answered(q, record.answers[q.id]))} onClick={() => void services.learn.submitCheck(path)}>Submit</button>}
    </div>
  </div>;
}
