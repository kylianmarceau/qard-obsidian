/** A small stack of study cards, shuffled while Qard works. The adjacent text names the task. */
export function LoadingIndicator() {
  return (
    <span className="qard-loading" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
