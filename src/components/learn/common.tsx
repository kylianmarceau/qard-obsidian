import { useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { AnswerState, Confidence, Question, QuestionMark } from '../../tests/test-types';
import type { MasteryState } from '../../learn/mastery';
import type { LearnJob, LearnJobKind } from '../../learn/learn-service';
import { AnswerFeedback, MarkScheme } from '../common/AnswerFeedback';
import { InlineMarkdown, Markdown } from '../Markdown';
import { scoreTone } from '../tests/common';

export type LearnNav = {
  library: () => void; today: () => void; learn: () => void; mapCourse: (folder?: string) => void;
  course: (path: string, objective?: string) => void; check: (path: string) => void; lesson: (path: string) => void;
  studyDue: () => void; usage?: () => void;
};
/** Re-renders when the learn service changes, and exposes its jobs. */
export function useLearn(services: QardServices) {
  const snapshot = useSyncExternalStore(services.learn.subscribe, services.learn.getSnapshot);
  return { revision: snapshot.revision, job: (target: string, kind: LearnJobKind, id = ''): LearnJob | undefined => services.learn.job(target, kind, id) };
}

/** Shown while waiting on a CLI tutor, which takes much longer per reply than an API. */
export function TutorHint({ services }: { services: QardServices }) {
  const provider = services.reviews.getSnapshot().settings.agents.roles.tutor.provider;
  if (provider !== 'claude-code' && provider !== 'codex') return null;
  return <p className="qard-muted qard-small">{provider === 'codex' ? 'Codex' : 'Claude Code'} can take 30 seconds or more per reply. For a faster tutor, choose an API connection in Settings → Qard → AI roles.</p>;
}
export const STATE_LABEL: Record<MasteryState, string> = { planned: 'Not covered yet', new: 'New', gap: 'Gap', misconception: 'Misconception', taught: 'Taught', shaky: 'Shaky', 'right once': 'Right once', mastered: 'Mastered', slipping: 'Slipping' };
export function StateChip({ state }: { state: MasteryState }) {
  return <span className={`qard-state qard-state-${state.replace(' ', '-')}`}>{STATE_LABEL[state]}</span>;
}
export function relativeDay(day: string, today: string) {
  if (day <= today) return day === today ? 'today' : 'overdue';
  const [y, m, d] = day.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((Date.UTC(y!, m! - 1, d) - Date.UTC(ty!, tm! - 1, td)) / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

const CONFIDENCE: { id: Confidence; label: string }[] = [{ id: 'sure', label: 'Sure' }, { id: 'unsure', label: 'Unsure' }, { id: 'guess', label: 'Guess' }];
/** A question with its answer box, confidence and "I don't know". */
export function AnswerInput({ services, question: q, answer, onChange, locked, path, label }: { services: QardServices; question: Question; answer?: AnswerState; onChange: (patch: Partial<AnswerState>) => void; locked: boolean; path: string; label: string }) {
  const unknown = !!answer?.unknown;
  return <article className="qard-q">
    <div className="qard-q-meta"><span>{label}</span><span>{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span></div>
    <div className="qard-q-prompt"><Markdown text={q.prompt} path={path} services={services}/></div>
    {q.type === 'mcq' ? <div className="qard-options" role="radiogroup" aria-label={`${label} options`}>{q.options?.map((o, i) => <button key={i} role="radio" aria-checked={answer?.choice === i} disabled={locked || unknown} className={'qard-option' + (answer?.choice === i ? ' is-on' : '')} onClick={() => onChange({ choice: i })}><span className="qard-radio" aria-hidden="true"/><Markdown text={o} path={path} services={services}/></button>)}</div>
      : <textarea className="qard-answer-input" aria-label={`Answer to ${label.toLowerCase()}`} rows={q.type === 'long' ? 5 : q.type === 'calc' ? 3 : 2} value={answer?.text ?? ''} readOnly={locked} disabled={unknown} onChange={e => onChange({ text: e.target.value })}/>}
    <div className="qard-q-tools">
      <button className={'qard-conf qard-dont-know' + (unknown ? ' is-on' : '')} aria-pressed={unknown} disabled={locked} onClick={() => onChange(unknown ? { unknown: false } : { unknown: true, choice: undefined, confidence: undefined })}>I don't know</button>
      <span className="qard-spacer"/>
      {CONFIDENCE.map(c => <button key={c.id} className={'qard-conf' + (answer?.confidence === c.id ? ' is-on' : '')} aria-pressed={answer?.confidence === c.id} disabled={locked || unknown} onClick={() => onChange({ confidence: answer?.confidence === c.id ? undefined : c.id })}>{c.label}</button>)}
    </div>
  </article>;
}
export const answered = (q: Question, a?: AnswerState) => !!a && (a.unknown || (q.type === 'mcq' ? a.choice !== undefined : !!a.text?.trim()));

/** A marked answer: underlines linked to the marker's notes, the mark scheme, and the model answer on request. */
export function MarkedAnswer({ services, question: q, answer, mark, path }: { services: QardServices; question: Question; answer?: AnswerState; mark: QuestionMark; path: string }) {
  const [model, setModel] = useState(false);
  return <div className="qard-marked">
    <div className="qard-marked-head"><span className="qard-muted"><InlineMarkdown text={mark.feedback} path={path} services={services}/></span><span className={'qard-review-score ' + scoreTone(mark.score, q.marks)}>{mark.score}/{q.marks}</span></div>
    {q.type === 'mcq' ? <section className="qard-answer-surface"><div className="qard-label">Your answer</div>{answer?.unknown ? <p className="qard-muted">You said you didn't know.</p> : q.options?.map((option, i) => <div key={i} className={'qard-mcq-row' + (answer?.choice === i ? ' is-chosen' : '')}><span className={i === q.answer ? 'is-full' : answer?.choice === i ? 'is-zero' : ''}>{i === q.answer ? '✓' : answer?.choice === i ? '✕' : ''}</span><Markdown text={option} path={path} services={services}/></div>)}</section>
      : <AnswerFeedback services={services} answer={answer} mark={mark} path={path}/>}
    {q.type !== 'mcq' && <MarkScheme services={services} question={q} mark={mark} path={path}/>}
    <button className="qard-text-button" aria-expanded={model} onClick={() => setModel(!model)}>{model ? 'Hide model answer' : 'Model answer'}</button>
    {model && <div className="qard-panel"><Markdown text={q.model} path={path} services={services}/></div>}
  </div>;
}
