import { useId } from 'react';
import type { SessionResult } from '../review/session';

const labels = ['Again', 'Hard', 'Good', 'Easy'] as const;
const baseline = 148;
const top = 28;
const xFor = (index: number) => 60 + index * 120;

/** A smoothed frequency curve over the four ordered recall ratings. */
export function SessionDifficultyChart({ results }: { results: SessionResult[] }) {
  const id = useId();
  if (!results.length) {
    return null;
  }
  const counts = labels.map((_, index) => results.filter((r) => r.rating === index + 1).length);
  const sorted = results.map((r) => r.rating).sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)]!;
  const upper = sorted[Math.floor(sorted.length / 2)]!;
  const median =
    lower === upper ? labels[lower - 1] : `${labels[lower - 1]} / ${labels[upper - 1]}`;
  const medianX = xFor((lower + upper) / 2 - 1);
  const peak = Math.max(...counts);
  const points = counts.map((count, index) => ({
    x: xFor(index),
    y: baseline - (count / peak) * (baseline - top),
  }));
  // Horizontal control points keep the curve inside the actual counts, including zeroes.
  const line = points.reduce((path, point, index) => {
    if (!index) {
      return `M ${point.x} ${point.y}`;
    }
    const previous = points[index - 1]!;
    const middle = (previous.x + point.x) / 2;
    return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  const description = `${results.length} rated ${results.length === 1 ? 'card' : 'cards'}. ${labels.map((label, i) => `${label}: ${counts[i]}`).join(', ')}. Median: ${median}.`;

  return (
    <figure className="qard-difficulty" aria-labelledby={`${id}-title`}>
      <figcaption className="qard-difficulty-heading">
        <div>
          <h2 id={`${id}-title`}>Recall difficulty</h2>
          <p>Your ratings this session</p>
        </div>
        <span className="qard-difficulty-median">
          Median <strong>{median}</strong>
        </span>
      </figcaption>
      <svg
        className="qard-difficulty-plot"
        viewBox="0 0 480 176"
        role="img"
        aria-label={description}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path className="qard-difficulty-grid" d={`M 24 ${top} H 456`} />
        <text className="qard-difficulty-scale" x="24" y="18">
          {peak} {peak === 1 ? 'card' : 'cards'}
        </text>
        <path d={`${line} L 420 ${baseline} L 60 ${baseline} Z`} fill={`url(#${id}-fill)`} />
        <path className="qard-difficulty-axis" d={`M 24 ${baseline} H 456`} />
        <path className="qard-difficulty-marker" d={`M ${medianX} ${top} V ${baseline}`} />
        <path className="qard-difficulty-line" d={line} />
        {points.map((point, index) => (
          <circle
            className="qard-difficulty-point"
            key={labels[index]}
            cx={point.x}
            cy={point.y}
            r="3.5"
          />
        ))}
        <circle className="qard-difficulty-median-point" cx={medianX} cy={baseline} r="3" />
      </svg>
      <div className="qard-summary-ratings qard-difficulty-ratings">
        {labels.map((label, index) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {counts[index]} <small>{Math.round((counts[index]! / results.length) * 100)}%</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="qard-difficulty-direction" aria-hidden="true">
        <span>More difficult</span>
        <span>Easier</span>
      </div>
    </figure>
  );
}
