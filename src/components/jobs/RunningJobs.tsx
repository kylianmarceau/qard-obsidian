import { useEffect, useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { TestNav } from '../tests/common';
import type { LearnNav } from '../learn/common';
import { overdue, roleOf, timeLeft } from '../../jobs/job-clock';
import { AgentLabel } from './AgentLabel';
import { InlineMarkdown } from '../Markdown';

export interface RunningJob { key: string; kind: string; label: string; detail: string; startedAt?: number; open: () => void; cancel: () => void }
const TEST_LABELS: Record<string, string> = { plan: 'Planning test', generate: 'Writing test', mark: 'Marking test', wrapup: 'Wrapping up test' };
const LEARN_LABELS: Record<string, string> = { probe: 'Preparing lesson', map: 'Planning lesson', steps: 'Writing lesson steps', close: 'Wrapping up lesson', 'map-course': 'Mapping course', 'check-write': 'Writing check' };
const name = (path: string) => path.split('/').pop()!.replace(/\.(md|json)$/, '').replace(/ mastery$/i, '');

/** The jobs worth showing: the long ones. Quick tutor replies and inline follow-ups are left out. */
export function useRunningJobs(services: QardServices, nav: TestNav, learnNav: LearnNav): RunningJob[] {
  const tests = useSyncExternalStore(services.tests.subscribe, services.tests.getSnapshot);
  const learn = useSyncExternalStore(services.learn.subscribe, services.learn.getSnapshot);
  const jobs: RunningJob[] = [];
  for (const [key, job] of Object.entries(tests.jobs)) {
    if (job.error || !TEST_LABELS[job.kind]) continue;
    const [folder = '', , id = ''] = key.split('|'), entry = services.tests.get(folder), cancel = () => services.tests.cancel(folder, job.kind, id);
    jobs.push({ key, kind: job.kind, label: TEST_LABELS[job.kind]!, detail: entry?.test?.title ?? entry?.plan?.title ?? name(folder), startedAt: job.startedAt, open: () => entry?.test ? job.kind === 'wrapup' || job.kind === 'mark' ? nav.results(folder) : nav.take(folder) : nav.plan(folder), cancel });
  }
  for (const [key, job] of Object.entries(learn.jobs)) {
    if (job.error || !LEARN_LABELS[job.kind]) continue;
    const [target = '', , id = ''] = key.split('|'), cancel = () => services.learn.cancel(target, job.kind, id);
    if (job.kind === 'map-course') {
      const update = target.endsWith('.md');
      jobs.push({ key, kind: job.kind, label: update ? 'Updating course' : 'Mapping course', detail: name(target), startedAt: job.startedAt, open: () => update ? learnNav.course(target) : learnNav.mapCourse(target), cancel });
    } else if (job.kind === 'check-write') {
      const [mastery, objective] = target.split('#');
      jobs.push({ key, kind: job.kind, label: 'Writing check', detail: objective ?? '', startedAt: job.startedAt, open: () => learnNav.course(mastery!, objective), cancel });
    } else {
      const lesson = services.learn.lessonAt(target);
      jobs.push({ key, kind: job.kind, label: LEARN_LABELS[job.kind]!, detail: lesson?.map?.title ?? lesson?.topic ?? name(target), startedAt: job.startedAt, open: () => learnNav.lesson(target), cancel });
    }
  }
  return jobs.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

/** Re-renders every second while shown, for elapsed times. */
export function useTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [active]);
  return now;
}
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** "● 2 running" in the header, opening a list of background jobs you can jump to. */
export function RunningJobs({ services, nav, learnNav }: { services: QardServices; nav: TestNav; learnNav: LearnNav }) {
  const jobs = useRunningJobs(services, nav, learnNav), [open, setOpen] = useState(false);
  const now = useTick(open && jobs.length > 0);
  useEffect(() => { if (!jobs.length) setOpen(false); }, [jobs.length]);
  if (!jobs.length) return null;
  return <div className="qard-jobs">
    <button className="qard-jobs-button" aria-expanded={open} onClick={() => setOpen(!open)}><span className="qard-dot" aria-hidden="true"/>{jobs.length} running</button>
    {open && <div className="qard-popover qard-jobs-list" role="list">{jobs.map(j => {
      const estimate = services.jobs?.estimate(j.kind), left = timeLeft(estimate, j.startedAt, now), stuck = overdue(estimate, j.startedAt, now);
      return <div key={j.key} role="listitem" className={`qard-jobs-row${stuck ? ' is-stuck' : ''}`}>
        <button className="qard-popover-item qard-jobs-item" onClick={() => { setOpen(false); j.open(); }}>
          <span><strong>{j.label}</strong><small className="qard-muted"><InlineMarkdown text={j.detail} path={''} services={services}/></small><AgentLabel services={services} role={roleOf(j.kind)}/></span>
          <small className={stuck ? 'qard-jobs-stuck' : 'qard-muted'}>{j.startedAt ? clock(now - j.startedAt) : ''}{left ? ` · ${left}` : ''}</small>
        </button>
        <button className="qard-text-button qard-jobs-cancel" aria-label={`Cancel ${j.label.toLowerCase()}`} onClick={j.cancel}>Cancel</button>
      </div>;
    })}<p className="qard-muted qard-small qard-jobs-note">These keep going if you leave. Qard lets you know when each is done. Cancel one that's stuck, then use Try again where it was.</p></div>}
  </div>;
}
