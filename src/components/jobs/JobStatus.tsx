import type { ReactNode } from 'react';
import type { QardServices } from '../../views/services';
import { roleOf, timeLeft } from '../../jobs/job-clock';
import { Waiting } from '../common/FeedbackStatus';
import { AgentLabel } from './AgentLabel';
import { JobControls } from './JobControls';
import { useTick } from './RunningJobs';

/** Shared status panel for background work and inline lesson tasks. */
export function JobStatus({
  services,
  title,
  job,
  cancel,
  start,
  hint,
  ready = false,
  heading,
  children,
}: {
  services: QardServices;
  title: string;
  job?: { kind: string; startedAt?: number; error?: string };
  cancel?: () => void;
  start?: () => void;
  hint?: ReactNode;
  ready?: boolean;
  heading?: ReactNode;
  children?: ReactNode;
}) {
  const now = useTick(!ready);
  const left = timeLeft(job ? services.jobs?.estimate(job.kind) : undefined, job?.startedAt, now);
  const seconds =
    job?.startedAt === undefined
      ? undefined
      : Math.max(0, Math.round((now - job.startedAt) / 1000));
  const elapsed =
    seconds === undefined
      ? 'Running'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed`;
  return (
    <div className="qard-wait-status qard-job-status">
      {!heading && job && (
        <div className="qard-jobs-meta qard-wait-meta">
          <AgentLabel services={services} role={roleOf(job.kind)} compact />
          <span className="qard-jobs-time qard-wait-estimate">
            {elapsed}
            {left ? ` · ${left}` : ''}
          </span>
        </div>
      )}
      <div className="qard-wait-head">
        <div className="qard-wait-heading">
          {heading ?? <Waiting text={title} />}
          {children}
        </div>
        {!ready && (
          <JobControls
            services={services}
            job={job}
            cancel={cancel}
            start={start}
            hint={hint}
            compact
          />
        )}
      </div>
    </div>
  );
}
