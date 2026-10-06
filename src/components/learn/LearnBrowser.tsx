import { plural } from '../common/labels';
import { DeleteLearnItem } from './DeleteLearnItem';
import { useEffect, useState } from 'react';
import { ChevronRight, FileText, Plus } from 'lucide-react';
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
          <button className="qard-text-button" onClick={nav.usage}>
            Usage
          </button>
        )}
        <button onClick={nav.today}>Today</button>
        <button className="qard-primary" onClick={() => nav.mapCourse()}>
          <Plus size={16} />
          Map a course
        </button>
      </LibraryHeader>
      {!courses && (
        <p className="qard-muted" role="status">
          Loading courses…
        </p>
      )}
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
        <div key={p.folder} className="qard-deletable-row">
          <button className="qard-resume" onClick={() => nav.mapCourse(p.folder)}>
            <span className="qard-muted">Ready to review</span>
            <strong>
              {p.course} · {plural(p.objectives.length, 'objective')}
            </strong>
            <ChevronRight size={16} />
          </button>
          <DeleteLearnItem services={services} kind="mapping" path={p.folder} />
        </div>
      ))}
      {pending?.updates.map((u) => (
        <button key={u.mastery} className="qard-resume" onClick={() => nav.course(u.mastery)}>
          <span className="qard-muted">Update ready</span>
          <strong>{u.course}</strong>
          <ChevronRight size={16} />
        </button>
      ))}
      {open.map((l) => (
        <div key={l.path} className="qard-deletable-row">
          <button className="qard-resume" onClick={() => nav.lesson(l.path)}>
            <span className="qard-muted">Continue lesson</span>
            <strong>
              <InlineMarkdown text={l.title} path={l.path} services={services} />
            </strong>
            {l.course && <span className="qard-muted">{l.course}</span>}
            <ChevronRight size={16} />
          </button>
          <DeleteLearnItem services={services} kind="lesson" path={l.path} />
        </div>
      ))}
      <div className="qard-deck-list">
        {courses?.map((c) => {
          const mastered = c.objectives.filter((o) => o.state === 'mastered').length,
            due = c.objectives.filter((o) => o.state !== 'new' && o.due && o.due <= day).length;
          return (
            <div key={c.path} className="qard-deletable-row">
              <button className="qard-deck qard-test-row" onClick={() => nav.course(c.path)}>
                <span className="qard-deck-name">
                  <strong>{c.course}</strong>
                  <small>
                    {mastered} of {plural(c.objectives.length, 'objective')} mastered
                  </small>
                </span>
                <span className="qard-test-status">{due ? `${due} due` : ''}</span>
                <ChevronRight size={17} />
              </button>
              <DeleteLearnItem services={services} kind="course" path={c.path} />
            </div>
          );
        })}
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
          {recent.map((l) => (
            <div key={l.path} className="qard-deletable-row">
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
        </section>
      )}
    </>
  );
}
