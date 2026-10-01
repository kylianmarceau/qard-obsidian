import type { QardServices } from '../../views/services';
import { overdue } from '../../jobs/job-clock';
import { useTick } from './RunningJobs';

/**
 * Under a waiting screen: Cancel while the job runs, a warning once it's well past its usual time, and a way to
 * start again when nothing is running at all (the job was lost, say to a reload before it saved anything).
 */
export function JobControls({ services, job, cancel, start }: {
  services: QardServices; job?: { kind: string; startedAt?: number; error?: string }; cancel?: () => void; start?: () => void;
}) {
  const now = useTick(!!job && !job.error);
  if (!job) return start ? <div className="qard-job-controls is-stuck" role="status"><span>Nothing is working on this right now.</span><button className="qard-primary" onClick={start}>Start again</button></div> : null;
  if (job.error || !cancel) return null;
  const stuck = overdue(services.jobs?.estimate(job.kind), job.startedAt, now);
  const minutes = job.startedAt ? Math.floor((now - job.startedAt) / 60_000) : 0;
  return <div className={`qard-job-controls${stuck ? ' is-stuck' : ''}`} role={stuck ? 'status' : undefined}>
    {stuck && <span>This has taken {minutes} min, much longer than usual, so it may be stuck. Cancel it and try again.</span>}
    <button className={stuck ? 'qard-primary' : 'qard-text-button'} onClick={cancel}>Cancel</button>
  </div>;
}
