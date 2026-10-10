import { plural } from '../common/labels';
import { UpdateCourse } from './UpdateCourse';
import { teach } from './lesson-navigation';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
  const [course, setCourse] = useState<Mastery>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string>();
  const [view, setView] = useState<'map' | 'list'>('map'),
    [filter, setFilter] = useState<Set<string>>(new Set()),
    [updating, setUpdating] = useState(false);
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
          <span className="qard-muted">Course</span>
          <h1>{course.course}</h1>
          <StudyTimeLine services={services} course={course.course} days={30} open={nav.time} />
        </div>
        <div className="qard-actions">
          <div className="qard-segmented" role="tablist">
            <button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>
              Map
            </button>
            <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
          </div>
          <button onClick={() => setUpdating(true)}>Update objectives</button>
          <button
            className="qard-text-button"
            onClick={() => void services.app.workspace.openLinkText(path, '', true)}
          >
            Open file
          </button>
        </div>
      </header>
      <CourseProgress course={course} filter={filter} toggle={toggle} />
      {changed.length > 0 && (
        <button className="qard-resume" onClick={() => setUpdating(true)}>
          <span>
            {plural(changed.length, 'note')} added or changed since {course.mapped!.slice(0, 10)}
          </span>
          <span className="qard-muted">Update objectives</span>
          <ChevronRight size={16} />
        </button>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      {view === 'map' ? (
        <CourseMap
          services={services}
          course={course}
          actions={mapActions}
          filter={filter}
          today={day}
          lessons={lessons}
          initial={objective}
        />
      ) : (
        <section>
          {course.objectives
            .filter((o) => !filter.size || filter.has(o.state))
            .map((o) => (
              <div key={o.id} className="qard-objective">
                <div className="qard-objective-main">
                  <strong>
                    <InlineMarkdown text={o.title} path={path} services={services} />
                  </strong>
                  <small className="qard-muted">{o.evidence.at(-1) ?? 'No evidence yet'}</small>
                </div>
                <StateChip state={o.state} />
                <span className="qard-muted qard-objective-due">
                  {o.due && !['new', 'planned'].includes(o.state) ? relativeDay(o.due, day) : ''}
                </span>
                {actions(o)}
              </div>
            ))}
        </section>
      )}
      {!course.objectives.length && (
        <p className="qard-muted">
          This mastery file has no objectives table. Open it and add rows, or update the objectives.
        </p>
      )}
    </article>
  );
}
