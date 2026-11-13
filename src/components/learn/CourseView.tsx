import { plural } from '../common/labels';
import { UpdateCourse } from './UpdateCourse';
import { teach } from './lesson-navigation';
import { useEffect, useId, useState } from 'react';
import { ChevronRight, FileText, Info, List, Network } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Mastery, Objective } from '../../learn/mastery';
import { CourseMap } from './CourseMap';
import { CourseProgress } from './CourseProgress';
import { InlineMarkdown } from '../Markdown';
import { NEEDS_LESSON, isoDay } from '../../learn/mastery';
import type { LessonSummary } from '../../learn/learn-types';
import { Waiting } from '../common/FeedbackStatus';
import { StateChip, relativeDay } from './learning-status';
import { useLearn } from './useLearn';
import { type LearnNav } from '../../views/navigation';
import { StudyTimeLine } from '../usage/StudyTimeView';

export function CourseView({
  services,
  nav,
  path,
  objective,
}: {
  services: QardServices;
  nav: LearnNav;
  path: string;
  objective?: string;
}) {
  const { revision, job } = useLearn(services);
  const tabsId = useId();
  const [course, setCourse] = useState<Mastery>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string>();
  const [view, setView] = useState<'map' | 'list'>('map'),
    [filter, setFilter] = useState<Set<string>>(new Set()),
    [updating, setUpdating] = useState(false);
  const [evidence, setEvidence] = useState<string>();
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  useEffect(() => {
    let live = true;
    services.learn.course(path).then(
      (c) => {
        if (live) {
          setCourse(c);
        }
      },
      (e) => {
        if (live) {
          setError((e as Error).message);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [services, path, revision]);
  useEffect(() => {
    let live = true;
    services.learn.listLessons().then(
      (l) => {
        if (live) {
          setLessons(l.filter((x) => x.mastery === path));
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [services, path, revision]);
  if (error && !course) {
    return (
      <p className="qard-error" role="alert">
        {error}
      </p>
    );
  }
  if (!course) {
    return <Waiting text="Loading…" />;
  }
  if (updating || services.learn.update(path) || job(path, 'map-course')) {
    return <UpdateCourse services={services} course={course} done={() => setUpdating(false)} />;
  }
  const day = isoDay(Date.now()),
    changed = services.learn.changedNotes(course);
  async function check(id: string) {
    setBusy(id);
    setError('');
    try {
      const found = await services.learn.ensureCheck(path, id);
      if (found) {
        nav.check(found);
      } else {
        setError(
          services.learn.job(`${path}#${id}`, 'check-write')?.error ?? 'Could not write a check.',
        );
      }
    } finally {
      setBusy(undefined);
    }
  }
  const actions = (o: Objective) => {
    const writing = job(`${path}#${o.id}`, 'check-write'),
      lesson = NEEDS_LESSON.includes(o.state) || o.state === 'planned';
    return (
      <span className="qard-objective-actions">
        <button
          className={lesson && o.state !== 'planned' ? 'qard-primary' : ''}
          onClick={() =>
            void teach(services, nav, { mastery: path, objective: o.id, title: o.title }).catch(
              (e) => setError((e as Error).message),
            )
          }
        >
          Teach
        </button>
        {!lesson && (
          <button
            disabled={busy === o.id || (!!writing && !writing.error)}
            onClick={() => void check(o.id)}
          >
            {busy === o.id || (writing && !writing.error) ? 'Writing…' : 'Check'}
          </button>
        )}
      </span>
    );
  };
  const toggle = (key: string) =>
    setFilter((f) => {
      const next = new Set(f);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const objectives = course.objectives.filter((o) => !filter.size || filter.has(o.state));
  const selector = (
    <div className="qard-segmented qard-course-view" role="tablist" aria-label="Course view">
      {(['map', 'list'] as const).map((mode, index) => (
        <button
          key={mode}
          role="tab"
          aria-label={mode === 'map' ? 'Map' : 'List'}
          id={`${tabsId}-${mode}`}
          aria-controls={`${tabsId}-panel`}
          aria-selected={view === mode}
          tabIndex={view === mode ? 0 : -1}
          onClick={() => setView(mode)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight' || event.key === 'ArrowLeft'
                ? 1 - index
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : undefined;
            if (next === undefined) {
              return;
            }
            event.preventDefault();
            setView(next === 0 ? 'map' : 'list');
            const controls =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            controls?.[next]?.focus();
          }}
        >
          {mode === 'map' ? <Network size={16} /> : <List size={16} />}
          <span className="qard-course-view-label">{mode === 'map' ? 'Map' : 'List'}</span>
        </button>
      ))}
    </div>
  );
  const footer = (
    <footer className="qard-course-footer">
      <StudyTimeLine services={services} course={course.course} days={30} open={nav.time} />
    </footer>
  );
  const mapActions = {
    openLesson: (p: string) => nav.lesson(p),
    teach: (o: Objective) =>
      void teach(services, nav, { mastery: path, objective: o.id, title: o.title }).catch((e) =>
        setError((e as Error).message),
      ),
    check: (o: Objective) => void check(o.id),
    openNote: (n: string) => void services.app.workspace.openLinkText(n, path, true),
    busy: (id: string) =>
      busy === id ||
      (!!job(`${path}#${id}`, 'check-write') && !job(`${path}#${id}`, 'check-write')?.error),
  };
  return (
    <article className="qard-course">
      <header className="qard-course-head">
        <div>
          <h1>{course.course}</h1>
        </div>
        <div className="qard-course-toolbar">
          {selector}
          <div className="qard-actions">
            <button onClick={() => setUpdating(true)}>Update</button>
            <button
              className="qard-icon-button"
              aria-label="Open file"
              title="Open file"
              onClick={() => void services.app.workspace.openLinkText(path, '', true)}
            >
              <FileText size={16} />
            </button>
          </div>
        </div>
      </header>
      <CourseProgress course={course} filter={filter} toggle={toggle} />
      {changed.length > 0 && (
        <button className="qard-resume qard-row-update" onClick={() => setUpdating(true)}>
          <span>
            {plural(changed.length, 'note')} added or changed since {course.mapped!.slice(0, 10)}
          </span>
          <span className="qard-muted">
            <span className="qard-resume-label-full">Update objectives</span>
            <span className="qard-resume-label-compact">Update</span>
          </span>
          <ChevronRight size={16} />
        </button>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${view}`}
        tabIndex={0}
      >
        {view === 'map' ? (
          <CourseMap
            services={services}
            course={course}
            actions={mapActions}
            filter={filter}
            today={day}
            lessons={lessons}
            initial={objective}
            footer={footer}
          />
        ) : (
          <section>
            {objectives.map((o) => (
              <div key={o.id} className="qard-objective">
                <div className="qard-objective-meta">
                  <StateChip state={o.state} />
                  <span className="qard-muted qard-objective-due">
                    {o.due &&
                      !['new', 'planned'].includes(o.state) &&
                      relativeDay(o.due, day).replace(/^./, (first) => first.toUpperCase())}
                    <button
                      className="qard-icon-button qard-section-info qard-objective-evidence"
                      title={o.evidence.at(-1) ?? 'No evidence yet'}
                      aria-label={`Evidence for ${o.title}`}
                      aria-expanded={evidence === o.id}
                      aria-controls={`${tabsId}-evidence-${o.id}`}
                      onClick={() => setEvidence(evidence === o.id ? undefined : o.id)}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
                {evidence === o.id && (
                  <p
                    className="qard-muted qard-objective-evidence-details"
                    id={`${tabsId}-evidence-${o.id}`}
                  >
                    {o.evidence.at(-1) ?? 'No evidence yet'}
                  </p>
                )}
                <div className="qard-objective-main">
                  <strong className="qard-objective-title">
                    <span className="qard-objective-title-text">
                      <InlineMarkdown text={o.title} path={path} services={services} />
                    </span>
                  </strong>
                </div>
                {actions(o)}
              </div>
            ))}
          </section>
        )}
      </div>
      {view === 'list' && footer}
      {!course.objectives.length && (
        <p className="qard-muted">
          This mastery file has no objectives table. Open it and add rows, or update the objectives.
        </p>
      )}
    </article>
  );
}
