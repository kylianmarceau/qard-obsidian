import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { figureMarkdown, type Figure } from '../../learn/figures';
import { Markdown } from '../Markdown';
import { JobError, Waiting } from '../common/FeedbackStatus';
import { AgentLabel } from '../jobs/AgentLabel';
import { JobControls } from '../jobs/JobControls';

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
  if (running(job)) {
    return (
      <div className="qard-figure is-drawing">
        <Waiting text={figure ? 'Redrawing the figure…' : 'Drawing a figure…'}>
          <AgentLabel services={services} role="illustrator" />
        </Waiting>
        <JobControls services={services} job={job} cancel={cancel} />
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
              <button type="submit" className="qard-text-button">
                Redraw
              </button>
              <button type="button" className="qard-text-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
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
