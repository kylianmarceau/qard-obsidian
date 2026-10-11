import { useMemo, useState } from 'react';
import type { QardServices } from '../../views/services';
import type { AnnotationKind, AnswerState, Question, QuestionMark } from '../../tests/test-types';
import { placeAnnotations } from '../../tests/annotate';
import { InlineMarkdown, Markdown } from '../Markdown';

const KIND: Record<AnnotationKind, string> = {
  correct: 'Correct',
  wrong: 'Incorrect',
  vague: 'Too vague',
  missing: 'Missing',
  insight: 'Good insight',
};

/** Shared by practice reviews, lesson feedback and course checks. */
export function AnswerFeedback({
  services,
  answer,
  mark,
  path,
}: {
  services: QardServices;
  answer?: AnswerState;
  mark: QuestionMark;
  path: string;
}) {
  const placed = useMemo(
    () => placeAnnotations(answer?.text ?? '', mark.annotations),
    [answer?.text, mark.annotations],
  );
  const [selected, setSelected] = useState<number>();
  const select = (note: number | undefined) => setSelected(selected === note ? undefined : note);
  return (
    <section className="qard-review-answer">
      <div className="qard-answer-surface">
        <div className="qard-label">Your answer</div>
        {answer?.unknown ? (
          <p className="qard-muted">You said you didn't know.</p>
        ) : answer?.text?.trim() ? (
          <div className="qard-marked-text">
            {placed.segments.map((segment, i) =>
              segment.kind ? (
                <span key={i}>
                  {segment.text && (
                    <span
                      className={
                        `qard-seg qard-seg-${segment.kind}` +
                        (selected === segment.note ? ' is-selected' : '')
                      }
                    >
                      {segment.text}
                    </span>
                  )}
                  <button
                    className={`qard-pin qard-pin-${segment.kind}`}
                    aria-label={`Note ${segment.note}: ${KIND[segment.kind]}`}
                    aria-pressed={selected === segment.note}
                    onClick={() => select(segment.note)}
                  >
                    {segment.kind === 'missing' ? '+' : ''}
                    {segment.note}
                  </button>
                </span>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </div>
        ) : (
          <p className="qard-muted">(No answer)</p>
        )}
      </div>
      {placed.notes.length > 0 && (
        <div>
          <div className="qard-label">Feedback</div>
          <div className="qard-notes">
            {placed.notes.map((note) => (
              <button
                key={note.n}
                className={
                  `qard-note qard-note-${note.kind}` + (selected === note.n ? ' is-selected' : '')
                }
                aria-pressed={selected === note.n}
                onClick={() => select(note.n)}
              >
                <span className="qard-note-kind">
                  {note.n} · {KIND[note.kind]}
                </span>
                <Markdown text={note.note} path={path} services={services} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function MarkScheme({
  services,
  question,
  mark,
  path,
}: {
  services: QardServices;
  question: Question;
  mark: QuestionMark;
  path: string;
}) {
  return (
    <section className="qard-rubric">
      <div className="qard-label">Mark scheme</div>
      {question.rubric.map((point, i) => (
        <div key={i} className="qard-rubric-row">
          <span
            className={mark.awarded[i] ? 'is-full' : 'is-zero'}
            aria-label={mark.awarded[i] ? 'Awarded' : 'Not awarded'}
          >
            {mark.awarded[i] ? '✓' : '✕'}
          </span>
          <span className={mark.awarded[i] ? 'qard-muted' : ''}>
            <InlineMarkdown text={point.point} path={path} services={services} />
          </span>
          <span className="qard-muted">
            {mark.awarded[i] ? point.marks : 0}/{point.marks}
          </span>
        </div>
      ))}
    </section>
  );
}
