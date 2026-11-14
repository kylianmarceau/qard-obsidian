import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QardServices } from '../../views/services';
import type { AnswerState, Confidence, Question, QuestionMark } from '../../tests/test-types';
import { blankAnswer } from '../../tests/test-types';
import { AnswerFeedback, MarkScheme } from './AnswerFeedback';
import { InlineMarkdown, Markdown } from '../Markdown';
import { scoreTone } from './FeedbackStatus';

const CONFIDENCE: { id: Confidence; label: string }[] = [
  { id: 'sure', label: 'Sure' },
  { id: 'unsure', label: 'Unsure' },
  { id: 'guess', label: 'Guess' },
];

/** A question with its answer box, confidence and "I don't know". */
export function AnswerInput({
  services,
  question: q,
  answer,
  onChange,
  locked,
  path,
  label,
}: {
  services: QardServices;
  question: Question;
  answer?: AnswerState;
  onChange: (patch: Partial<AnswerState>) => void;
  locked: boolean;
  path: string;
  label: string;
}) {
  const unknown = !!answer?.unknown;
  return (
    <article className="qard-q">
      <div className="qard-q-meta">
        <span>{label}</span>
        <span>
          {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
        </span>
      </div>
      {q.type === 'cloze' && <p className="qard-label">Fill in the blanks</p>}
      {q.type === 'cloze' ? (
        <ClozePrompt
          services={services}
          question={q}
          answer={answer}
          path={path}
          label={label}
          locked={locked || unknown}
          onChange={onChange}
        />
      ) : (
        <div className="qard-q-prompt">
          <Markdown text={q.prompt} path={path} services={services} />
        </div>
      )}
      {q.type === 'mcq' ? (
        <div className="qard-options" role="radiogroup" aria-label={`${label} options`}>
          {q.options?.map((o, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={answer?.choice === i}
              disabled={locked || unknown}
              className={'qard-option' + (answer?.choice === i ? ' is-on' : '')}
              onClick={() => onChange({ choice: i })}
            >
              <span className="qard-radio" aria-hidden="true" />
              <Markdown text={o} path={path} services={services} />
            </button>
          ))}
        </div>
      ) : q.type !== 'cloze' ? (
        <textarea
          className="qard-answer-input"
          aria-label={`Answer to ${label.toLowerCase()}`}
          rows={q.type === 'long' ? 5 : q.type === 'calc' ? 3 : 2}
          value={answer?.text ?? ''}
          readOnly={locked}
          disabled={unknown}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      ) : null}
      <div className="qard-q-tools">
        <button
          className={'qard-conf qard-dont-know' + (unknown ? ' is-on' : '')}
          aria-pressed={unknown}
          disabled={locked}
          onClick={() =>
            onChange(
              unknown
                ? { unknown: false }
                : { unknown: true, choice: undefined, confidence: undefined },
            )
          }
        >
          I don't know
        </button>
        <span className="qard-spacer" />
        {CONFIDENCE.map((c) => (
          <button
            key={c.id}
            className={'qard-conf' + (answer?.confidence === c.id ? ' is-on' : '')}
            aria-pressed={answer?.confidence === c.id}
            disabled={locked || unknown}
            onClick={() => onChange({ confidence: answer?.confidence === c.id ? undefined : c.id })}
          >
            {c.label}
          </button>
        ))}
      </div>
    </article>
  );
}

export const answered = (q: Question, a?: AnswerState) =>
  !!a &&
  (a.unknown ||
    (q.type === 'mcq'
      ? a.choice !== undefined
      : q.type === 'cloze'
        ? !!q.blanks?.length && q.blanks.every((blank) => !!blankAnswer(a, blank.id).trim())
        : !!a.text?.trim()));

/** A marked answer: underlines linked to the marker's notes, the mark scheme, and the model answer on request. */
export function MarkedAnswer({
  services,
  question: q,
  answer,
  mark,
  path,
}: {
  services: QardServices;
  question: Question;
  answer?: AnswerState;
  mark: QuestionMark;
  path: string;
}) {
  const [model, setModel] = useState(false);
  return (
    <div className="qard-marked">
      <div className="qard-marked-head">
        <span className="qard-muted">
          <InlineMarkdown text={mark.feedback} path={path} services={services} />
        </span>
        <span className={'qard-review-score ' + scoreTone(mark.score, q.marks)}>
          {mark.score}/{q.marks}
        </span>
      </div>
      {q.type === 'mcq' ? (
        <section className="qard-answer-surface">
          <div className="qard-label">Your answer</div>
          {answer?.unknown ? (
            <p className="qard-muted">You said you didn't know.</p>
          ) : (
            q.options?.map((option, i) => (
              <div key={i} className={'qard-mcq-row' + (answer?.choice === i ? ' is-chosen' : '')}>
                <span
                  className={i === q.answer ? 'is-full' : answer?.choice === i ? 'is-zero' : ''}
                >
                  {i === q.answer ? '✓' : answer?.choice === i ? '✕' : ''}
                </span>
                <Markdown text={option} path={path} services={services} />
              </div>
            ))
          )}
        </section>
      ) : q.type === 'cloze' ? (
        <ClozePrompt
          services={services}
          question={q}
          answer={answer}
          path={path}
          label="Your answer"
          locked
          mark={mark}
        />
      ) : (
        <AnswerFeedback services={services} answer={answer} mark={mark} path={path} />
      )}
      {q.type !== 'mcq' && <MarkScheme services={services} question={q} mark={mark} path={path} />}
      <button className="qard-text-button" aria-expanded={model} onClick={() => setModel(!model)}>
        {model ? 'Hide model answer' : 'Model answer'}
      </button>
      {model && (
        <div className="qard-panel">
          <Markdown text={q.model} path={path} services={services} />
        </div>
      )}
    </div>
  );
}

type ClozePromptProps = {
  services: QardServices;
  question: Question;
  answer?: AnswerState;
  path: string;
  label: string;
  locked: boolean;
  onChange?: (patch: Partial<AnswerState>) => void;
  mark?: QuestionMark;
};

/** Each question owns its Markdown DOM and portals, including during asynchronous renders. */
export function ClozePrompt(props: ClozePromptProps) {
  const { question: q, path } = props;
  return <ClozePromptContent key={JSON.stringify([q.id, q.prompt, q.blanks, path])} {...props} />;
}

/** Keep Obsidian's full Markdown render, placing controls only at the named gaps. */
function ClozePromptContent({
  services,
  question: q,
  answer,
  path,
  label,
  locked,
  onChange,
  mark,
}: ClozePromptProps) {
  let prefix = 'QARDCLOZESLOT';
  while (q.prompt.includes(prefix)) {
    prefix += 'X';
  }
  const tokenPattern = new RegExp(`${prefix}(\\d+)END`, 'g');
  const text = q.prompt.replace(/\{\{([^{}]+)\}\}/g, (token, id: string) => {
    const index = q.blanks?.findIndex((blank) => blank.id === id) ?? -1;
    return index < 0 ? token : `${prefix}${index}END`;
  });
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ id: string; target: HTMLElement }[]>([]);
  useEffect(() => {
    const host = ref.current;
    if (!host) {
      return;
    }
    let targets: { id: string; target: HTMLElement }[] = [];
    const place = () => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.parentElement?.closest('.qard-cloze-slot') && node.data.includes(prefix)) {
          nodes.push(node);
        }
      }
      for (const node of nodes) {
        const fragment = createFragment();
        let end = 0;
        for (const match of node.data.matchAll(tokenPattern)) {
          const blank = q.blanks?.[Number(match[1])];
          if (!blank) {
            continue;
          }
          fragment.append(node.data.slice(end, match.index));
          const target = host.createSpan({ cls: 'qard-cloze-slot' });
          fragment.append(target);
          targets.push({ id: blank.id, target });
          end = match.index + match[0].length;
        }
        if (end) {
          fragment.append(node.data.slice(end));
          node.replaceWith(fragment);
        }
      }
      targets = targets.filter(({ target }) => host.contains(target));
      setSlots((previous) =>
        previous.length === targets.length &&
        previous.every((slot, i) => slot.target === targets[i]?.target)
          ? previous
          : [...targets],
      );
    };
    const observer = new MutationObserver(place);
    observer.observe(host, { childList: true, subtree: true });
    place();
    return () => observer.disconnect();
  }, [text, prefix]);
  return (
    <div className="qard-q-prompt" ref={ref}>
      <Markdown text={text} path={path} services={services} />
      {slots.map(({ id, target }, i) => {
        const index = q.blanks!.findIndex((blank) => blank.id === id);
        const blank = q.blanks?.[index];
        if (!blank || !ref.current?.contains(target)) {
          return null;
        }
        const correct = !!mark?.awarded[index];
        return createPortal(
          mark ? (
            <span className={correct ? 'is-full' : 'is-zero'}>
              <strong>
                {answer?.unknown ? "I didn't know" : blankAnswer(answer, id) || 'No answer'}
              </strong>
              <span> — {correct ? 'Correct' : 'Incorrect'}</span>
            </span>
          ) : (
            <input
              className="qard-cloze-input"
              aria-label={`${label}: blank ${index + 1}`}
              value={blankAnswer(answer, id)}
              disabled={locked}
              autoComplete="off"
              onChange={(event) => {
                if (!locked && ref.current?.contains(target)) {
                  onChange?.({ blanks: { ...answer?.blanks, [id]: event.target.value } });
                }
              }}
            />
          ),
          target,
          `${id}-${i}`,
        );
      })}
    </div>
  );
}
