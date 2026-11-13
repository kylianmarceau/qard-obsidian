import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { SessionResult } from '../review/session';

const labels = ['Again', 'Hard', 'Good', 'Easy'] as const;
const plotLabels = ['Skipped', ...labels];
const baseline = 148;
const top = 28;
const xFor = (index: number) => (index + 0.5) * (480 / plotLabels.length);

function DifficultyMeta({ peak, repeatMessage }: { peak: number; repeatMessage?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const scale = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = row.current,
      label = text.current,
      count = scale.current;
    if (!element || !label || !count) {
      return;
    }
    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      setCompact(
        count.getBoundingClientRect().width + label.scrollWidth + gap > element.clientWidth,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(label);
    return () => observer.disconnect();
  }, [peak, repeatMessage]);
  return (
    <div className="qard-difficulty-meta" ref={row}>
      <span className="qard-difficulty-scale" ref={scale}>
        {peak} {peak === 1 ? 'card' : 'cards'}
      </span>
      {repeatMessage && (
        <span
          className={`qard-difficulty-reviews${compact ? ' is-compact' : ''}`}
          title={compact ? repeatMessage : undefined}
          aria-label={compact ? repeatMessage : undefined}
        >
          <span className="qard-difficulty-review-text" ref={text} aria-hidden={compact}>
            {repeatMessage}
          </span>
          {compact && <Info size={14} aria-hidden="true" />}
        </span>
      )}
    </div>
  );
}

/** Session outcome frequencies, aligned with their five summary cells. */
export function SessionDifficultyChart({
  results,
  skipped = 0,
}: {
  results: SessionResult[];
  skipped?: number;
}) {
  const id = useId();
  if (!results.length && !skipped) {
    return null;
  }
  const counts = labels.map((_, index) => results.filter((r) => r.rating === index + 1).length);
  const plotCounts = [skipped, ...counts];
  const total = results.length + skipped;
  const sorted = results.map((r) => r.rating).sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)] ?? 1;
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const median =
    lower === upper ? labels[lower - 1] : `${labels[lower - 1]} / ${labels[upper - 1]}`;
  const medianX = xFor((lower + upper) / 2);
  const peak = Math.max(...plotCounts);
  const points = plotCounts.map((count, index) => ({
    x: xFor(index),
    y: baseline - (count / (peak || 1)) * (baseline - top),
  }));
  // Horizontal control points keep the curve inside the actual counts, including zeroes.
  const line =
    points.reduce((path, point, index) => {
      if (!index) {
        return `M 0 ${point.y} H ${point.x}`;
      }
      const previous = points[index - 1]!;
      const middle = (previous.x + point.x) / 2;
      return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
    }, '') + ' H 480';
  const description = `${results.length} rated ${results.length === 1 ? 'card' : 'cards'}. ${plotLabels.map((label, i) => `${label}: ${plotCounts[i]}`).join(', ')}.${results.length ? ` Median: ${median}.` : ''}`;

  return (
    <figure className="qard-difficulty" aria-labelledby={`${id}-title`}>
      <figcaption className="qard-difficulty-heading">
        <h2 id={`${id}-title`}>{results.length ? 'Recall difficulty' : 'Session outcomes'}</h2>
        <p>{results.length ? 'Your ratings this session' : 'No cards rated this session'}</p>
      </figcaption>
      <DifficultyMeta
        peak={peak}
        repeatMessage={
          results.length > new Set(results.map((result) => result.cardId)).size
            ? `${results.length} reviews, including repeats`
            : undefined
        }
      />
      <svg
        className="qard-difficulty-plot"
        viewBox="0 22 480 132"
        role="img"
        aria-label={description}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
          <marker
            id={`${id}-arrow`}
            markerWidth="6"
            markerHeight="12"
            viewBox="0 -1 6 12"
            refX="5"
            refY="5"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path className="qard-difficulty-axis-tip" d="M 0 0 L 5 5 L 0 10" />
          </marker>
        </defs>
        <path className="qard-difficulty-grid" d={`M 0 ${top} H 480`} />
        <path d={`${line} L 480 ${baseline} L 0 ${baseline} Z`} fill={`url(#${id}-fill)`} />
        <path
          className="qard-difficulty-axis"
          d={`M 0 ${baseline} H 480`}
          markerStart={`url(#${id}-arrow)`}
          markerEnd={`url(#${id}-arrow)`}
        />
        {results.length > 0 && (
          <path className="qard-difficulty-marker" d={`M ${medianX} ${top} V ${baseline}`}>
            <title>Median: {median}</title>
          </path>
        )}
        <path className="qard-difficulty-line" d={line} />
        {points.map((point, index) => (
          <circle
            className={`qard-difficulty-point${index === 0 ? ' is-skipped' : ''}`}
            key={plotLabels[index]}
            cx={point.x}
            cy={point.y}
            r="3.5"
          >
            <title>
              {plotLabels[index]}: {plotCounts[index]}
            </title>
          </circle>
        ))}
        {results.length > 0 && (
          <circle className="qard-difficulty-median-point" cx={medianX} cy={baseline} r="3" />
        )}
      </svg>
      <div className="qard-difficulty-direction" aria-hidden="true">
        <span>Harder</span>
        <span>Easier</span>
      </div>
      <div className="qard-summary-ratings qard-difficulty-ratings">
        <div title="Skipped cards are not counted as reviews">
          <span>Skipped</span>
          <strong>
            {skipped} <small>{Math.round((skipped / total) * 100)}%</small>
          </strong>
        </div>
        {labels.map((label, index) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {counts[index]} <small>{Math.round((counts[index]! / total) * 100)}%</small>
            </strong>
          </div>
        ))}
      </div>
    </figure>
  );
}
