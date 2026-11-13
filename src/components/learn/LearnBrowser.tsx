import { plural } from '../common/labels';
import { DeleteLearnItem } from './DeleteLearnItem';
import { useEffect, useRef, useState } from 'react';
import { ChartColumn, ChevronRight, Clock, FileText, Plus } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Mastery } from '../../learn/mastery';
import { InlineMarkdown } from '../Markdown';
import { isoDay } from '../../learn/mastery';
import type { LessonSummary } from '../../learn/learn-types';
import { Waiting } from '../common/FeedbackStatus';
import { LibraryHeader } from '../library/LibraryHeader';
import type { TestNav } from '../../views/navigation';
import { useLearn } from './useLearn';
import { type LearnNav } from '../../views/navigation';
import { AgentLabel } from '../jobs/AgentLabel';

export function LearnBrowser({
  services,
  nav,
  testNav,
  plans,
}: {
  services: QardServices;
  nav: LearnNav;
  testNav: TestNav;
  plans?: () => void;
}) {
  const { revision } = useLearn(services);
  const [courses, setCourses] = useState<Mastery[]>(),
    [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof services.learn.pending>>>();
  useEffect(() => {
    let live = true;
    void Promise.all([
      services.learn.courses(),
      services.learn.listLessons(),
      services.learn.pending(),
    ]).then(
      ([c, l, p]) => {
        if (live) {
          setCourses(c);
          setLessons(l);
          setPending(p);
        }
      },
      () => {
        if (live) {
          setCourses([]);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [services, revision]);
  const day = isoDay(Date.now());
  const open = lessons.filter((l) => !l.finished),
    recent = lessons.filter((l) => l.finished).slice(0, 5);
  return (
    <>
      <LibraryHeader
        active="learn"
        decks={testNav.library}
        tests={testNav.tests}
        learn={nav.learn}
        plans={plans}
        title="Your learning"
        description="Build understanding one topic at a time, with lessons and checks."
      >
        {nav.usage && (
          <button className="qard-icon-button" aria-label="Usage" title="Usage" onClick={nav.usage}>
            <ChartColumn size={16} />
          </button>
        )}
        {nav.time && (
          <button
            className="qard-icon-button"
            aria-label="Study time"
            title="Study time"
            onClick={nav.time}
          >
            <Clock size={16} />
          </button>
        )}
        <button onClick={nav.today}>Today</button>
        <button className="qard-primary qard-learn-map-action" onClick={() => nav.mapCourse()}>
          <Plus size={16} />
          Map a course
        </button>
      </LibraryHeader>
      {!courses && (
        <p className="qard-muted" role="status">
          Loading courses…
        </p>
      )}
      <div className="qard-row-stack qard-learn-rows">
        {pending?.mapping.map((f) => (
          <div key={f} className="qard-resume is-static">
            <Waiting text={`Mapping ${f.split('/').pop()}…`}>
              <AgentLabel services={services} role="writer" />
            </Waiting>
            <DeleteLearnItem services={services} kind="mapping" path={f} />
          </div>
        ))}
        {pending?.failed.map((f) => (
          <div key={f.kind + f.target} className="qard-error" role="alert">
            <span>
              {f.kind === 'map' ? 'Mapping' : 'Updating'}{' '}
              {f.target.split('/').pop()!.replace(/\.md$/, '')} failed: {f.error}
            </span>
            <button
              className="qard-text-button"
              onClick={() =>
                void (f.kind === 'map'
                  ? services.learn.mapCourse(f.target, f.request)
                  : services.learn.updateCourse(f.target, f.request))
              }
            >
              Try again
            </button>
            <button
              className="qard-text-button"
              onClick={() => void services.learn.dismissFailure(f.kind, f.target)}
            >
              Dismiss
            </button>
            {f.kind === 'map' && (
              <DeleteLearnItem services={services} kind="mapping" path={f.target} />
            )}
          </div>
        ))}
        {pending?.proposals.map((p) => (
          <div key={p.folder} className="qard-deletable-row qard-summary-row qard-row-update">
            <button className="qard-resume" onClick={() => nav.mapCourse(p.folder)}>
              <span className="qard-resume-copy">
                <span className="qard-muted qard-resume-label">Ready to review</span>
                <strong className="qard-resume-title">
                  {p.course} · {plural(p.objectives.length, 'objective')}
                </strong>
              </span>
            </button>
            <DeleteLearnItem services={services} kind="mapping" path={p.folder} />
            <ChevronRight size={16} aria-hidden="true" />
          </div>
        ))}
        {pending?.updates.map((u) => (
          <button
            key={u.mastery}
            className="qard-resume qard-row-update"
            onClick={() => nav.course(u.mastery)}
          >
            <span className="qard-resume-copy">
              <span className="qard-muted qard-resume-label">Update ready</span>
              <strong className="qard-resume-title">{u.course}</strong>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {open.map((l) => (
          <div key={l.path} className="qard-deletable-row qard-summary-row qard-row-lesson">
            <button className="qard-resume" onClick={() => nav.lesson(l.path)}>
              <ResumeLessonCopy lesson={l} services={services} />
            </button>
            <DeleteLearnItem services={services} kind="lesson" path={l.path} />
            <ChevronRight size={16} aria-hidden="true" />
          </div>
        ))}
        <div className="qard-deck-list">
          {courses?.map((c) => {
            const mastered = c.objectives.filter((o) => o.state === 'mastered').length,
              due = c.objectives.filter((o) => o.state !== 'new' && o.due && o.due <= day).length;
            return (
              <div key={c.path} className="qard-deletable-row qard-summary-row qard-row-course">
                <button className="qard-deck qard-test-row" onClick={() => nav.course(c.path)}>
                  <span className="qard-deck-name">
                    <strong>{c.course}</strong>
                    <small>
                      {mastered} of {plural(c.objectives.length, 'objective')} mastered
                    </small>
                  </span>
                  <span className="qard-test-status">{due ? `${due} due` : ''}</span>
                </button>
                <DeleteLearnItem services={services} kind="course" path={c.path} />
                <ChevronRight size={16} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </div>
      {courses && !courses.length && (
        <div className="qard-empty">
          <p>No courses yet.</p>
          <p className="qard-muted">
            Map a course folder into objectives. Qard keeps one mastery file per course and uses it
            to choose what to teach, check and test.
          </p>
          <button onClick={() => nav.mapCourse()}>Map a course</button>
        </div>
      )}
      {recent.length > 0 && (
        <section className="qard-learn-recent">
          <div className="qard-label">Recent lessons</div>
          <div className="qard-doc-rows">
            {recent.map((l) => (
              <div key={l.path} className="qard-deletable-row qard-doc-item">
                <button className="qard-doc-row qard-row-button" onClick={() => nav.lesson(l.path)}>
                  <FileText size={14} />
                  <span>
                    <InlineMarkdown text={l.title} path={l.path} services={services} />
                  </span>
                  <span className="qard-muted">{new Date(l.created).toLocaleDateString()}</span>
                </button>
                <DeleteLearnItem services={services} kind="lesson" path={l.path} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Keep course context beside a short title, while long titles retain the full row. */
function ResumeLessonCopy({ lesson, services }: { lesson: LessonSummary; services: QardServices }) {
  const copy = useRef<HTMLSpanElement>(null);
  const [inline, setInline] = useState(false);
  useEffect(() => {
    const element = copy.current;
    if (!element || !lesson.course) {
      setInline(false);
      return;
    }
    const label = element.querySelector<HTMLElement>('.qard-resume-label .qard-resume-intrinsic')!,
      title = element.querySelector<HTMLElement>('.qard-resume-title .qard-resume-intrinsic')!,
      context = element.querySelector<HTMLElement>('.qard-resume-context .qard-resume-intrinsic')!;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const main = Math.max(
        label.scrollWidth,
        label.getBoundingClientRect().width,
        title.scrollWidth,
        title.getBoundingClientRect().width,
      );
      const contextWidth = Math.max(context.scrollWidth, context.getBoundingClientRect().width);
      setInline(width > 0 && main + contextWidth + gap <= width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    for (const target of [element, label, title, context]) {
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, [lesson.title, lesson.course, lesson.path]);
  return (
    <span ref={copy} className={`qard-resume-copy${inline ? ' is-inline' : ''}`}>
      <span className="qard-muted qard-resume-label">
        <span className="qard-resume-intrinsic">Continue lesson</span>
      </span>
      {lesson.course && (
        <span className="qard-muted qard-resume-context">
          <span className="qard-resume-intrinsic">{lesson.course}</span>
        </span>
      )}
      <strong className="qard-resume-title">
        <span className="qard-resume-intrinsic">
          <InlineMarkdown text={lesson.title} path={lesson.path} services={services} />
        </span>
      </strong>
    </span>
  );
}
