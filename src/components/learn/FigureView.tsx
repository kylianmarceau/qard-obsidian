import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { figureMarkdown, type Figure } from '../../learn/figures';
import { Markdown } from '../Markdown';
import { JobError, Waiting } from '../common/FeedbackStatus';
import { AgentLabel } from '../jobs/AgentLabel';
import { JobControls } from '../jobs/JobControls';
import { useTick } from '../jobs/RunningJobs';
import { timeLeft } from '../../jobs/job-clock';

type Job = { kind: string; startedAt?: number; error?: string } | undefined;
const running = (job: Job) => !!job && !job.error;

/**
 * A drawn figure with its caption, or the illustrator at work, or what went wrong. Redraw takes a note on what
 * to change ("label the mode", "show α = 0.5 too").
 */
export function FigureView({
  services,
  path,
  figure,
  job,
  draw,
  cancel,
  dismiss,
}: {
  services: QardServices;
  path: string;
  figure?: Figure;
  job: Job;
  draw: (request?: string) => void;
  cancel: () => void;
  dismiss: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [change, setChange] = useState('');
  const now = useTick(running(job));
  if (job && running(job)) {
    const elapsedSeconds =
      job.startedAt === undefined
        ? undefined
        : Math.max(0, Math.round((now - job.startedAt) / 1000));
    const elapsed =
      elapsedSeconds === undefined
        ? 'Running'
        : `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')} elapsed`;
    const left = timeLeft(services.jobs?.estimate(job.kind), job.startedAt, now);
    return (
      <div className="qard-figure is-drawing">
        <div className="qard-jobs-meta qard-figure-meta">
          <AgentLabel services={services} role="illustrator" compact />
          <span className="qard-jobs-time">
            {elapsed}
            {left ? ` · ${left}` : ''}
          </span>
        </div>
        <div className="qard-figure-status">
          <Waiting text={figure ? 'Redrawing the figure…' : 'Drawing a figure…'} />
          <JobControls services={services} job={job} cancel={cancel} compact />
        </div>
      </div>
    );
  }
  return (
    <>
      <JobError job={job} retry={() => draw()} dismiss={dismiss} />
      {figure && (
        <figure className="qard-figure">
          <Markdown text={figureMarkdown(figure)} path={path} services={services} />
          {editing ? (
            <form
              className="qard-figure-redraw"
              onSubmit={(e) => {
                e.preventDefault();
                draw(change);
                setEditing(false);
                setChange('');
              }}
            >
              <input
                aria-label="What should change?"
                placeholder="What should change? e.g. label the peak"
                value={change}
                onChange={(e) => setChange(e.target.value)}
              />
              <div className="qard-figure-redraw-actions">
                <button type="submit" className="qard-text-button">
                  Redraw
                </button>
                <button
                  type="button"
                  className="qard-text-button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="qard-figure-tools">
              <button className="qard-text-button" onClick={() => setEditing(true)}>
                Redraw…
              </button>
            </div>
          )}
        </figure>
      )}
    </>
  );
}

/** "Draw this": asks the illustrator for a figure where there is none yet. */
export function DrawButton({ figure, job, draw }: { figure?: Figure; job: Job; draw: () => void }) {
  if (figure || running(job) || job?.error) {
    return null;
  }
  return (
    <button className="qard-text-button qard-draw" onClick={draw}>
      <ImagePlus size={13} /> Draw this
    </button>
  );
}
