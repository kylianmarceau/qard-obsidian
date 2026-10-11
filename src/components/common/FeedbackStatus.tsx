import type { ReactNode } from 'react';

/** children: an optional quiet tag after the text, e.g. who is working on it. */
export function Waiting({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <p className="qard-waiting" role="status">
      <span className="qard-dot" aria-hidden="true" />
      <span className="qard-waiting-text">{text}</span>
      {children}
    </p>
  );
}

export function JobError({
  job,
  retry,
  dismiss,
}: {
  job?: { error?: string };
  retry?: () => void;
  dismiss?: () => void;
}) {
  if (!job?.error) {
    return null;
  }
  return (
    <div className="qard-error" role="alert">
      <span>{job.error}</span>
      {retry && (
        <button className="qard-text-button" onClick={retry}>
          Try again
        </button>
      )}
      {dismiss && (
        <button className="qard-text-button" onClick={dismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Check({ on }: { on: boolean }) {
  return (
    <span className={'qard-check' + (on ? ' is-on' : '')} aria-hidden="true">
      {on ? '✓' : ''}
    </span>
  );
}

export const scoreTone = (score: number, marks: number) =>
  score >= marks ? 'is-full' : score <= 0 ? 'is-zero' : 'is-partial';
