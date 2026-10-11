import { useState } from 'react';

/** Scratch recall stays in this visit; revealing never grades or uploads the answer. */
export function TypedRecall({
  revealed,
  reveal,
  disabled,
  cram = false,
}: {
  revealed: boolean;
  reveal: () => void;
  disabled: boolean;
  cram?: boolean;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <label className="qard-typed-recall">
      Your answer
      <textarea
        aria-label="Your answer"
        value={answer}
        readOnly={revealed}
        disabled={disabled}
        rows={2}
        placeholder="Write what you remember…"
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            !event.repeat &&
            !revealed &&
            !disabled
          ) {
            event.preventDefault();
            reveal();
          }
        }}
      />
      <small className="qard-muted">
        {revealed
          ? cram
            ? 'Compare with the card answer, then continue.'
            : 'Compare with the card answer, then choose your rating.'
          : 'Reveal when ready · Ctrl/⌘ + Enter'}
      </small>
    </label>
  );
}
