import { masteryNodeClass as cls } from './course-map-style';
import { ORDER } from '../../learn/course-graph';
import type { Mastery } from '../../learn/mastery';
import { readyToLearn } from '../../learn/mastery';
import { STATE_LABEL } from './learning-status';

/** Counts per state as one stacked bar. Legend entries filter the map. */
export function CourseProgress({
  course,
  filter,
  toggle,
}: {
  course: Mastery;
  filter?: Set<string>;
  toggle?: (key: string) => void;
}) {
  const counts = ORDER.map(
    (s) => [s, course.objectives.filter((o) => o.state === s).length] as const,
  ).filter(([, n]) => n > 0);
  const total = course.objectives.length || 1,
    ready = readyToLearn(course).size;
  const chip = (key: string, label: string, className: string) =>
    toggle ? (
      <button
        key={key}
        className={className + (filter?.has(key) ? ' is-on' : '')}
        aria-pressed={!!filter?.has(key)}
        onClick={() => toggle(key)}
      >
        <i />
        {label}
      </button>
    ) : (
      <span key={key} className={className}>
        <i />
        {label}
      </span>
    );
  return (
    <div className="qard-progress">
      <div
        className="qard-progress-bar"
        role="img"
        aria-label={counts.map(([s, n]) => `${n} ${STATE_LABEL[s].toLowerCase()}`).join(', ')}
      >
        {counts.map(([s, n]) => (
          <span key={s} className={cls(s)} style={{ flexGrow: n / total }} />
        ))}
      </div>
      <div className="qard-progress-legend">
        {counts.map(([s, n]) => chip(s, `${n} ${STATE_LABEL[s].toLowerCase()}`, cls(s)))}
        {ready > 0 && chip('ready', `${ready} ready to learn`, 'is-ready')}
        {filter?.size ? (
          <button className="qard-link" onClick={() => [...filter].forEach((k) => toggle?.(k))}>
            Show all
          </button>
        ) : null}
      </div>
    </div>
  );
}
