import { plural } from '../common/labels';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { Mastery } from '../../learn/mastery';
import { InlineMarkdown } from '../Markdown';
import { Check, JobError } from '../common/FeedbackStatus';
import { StateChip } from './learning-status';
import { useLearn } from './useLearn';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';

/** Proposes objectives from notes added since the last mapping; only the ticked parts are applied. */
export function UpdateCourse({
  services,
  course,
  done,
}: {
  services: QardServices;
  course: Mastery;
  done: () => void;
}) {
  const { job } = useLearn(services);
  const path = course.path,
    running = job(path, 'map-course'),
    update = services.learn.update(path);
  const [request, setRequest] = useState(''),
    [error, setError] = useState('');
  const hold = useHold();
  const [added, setAdded] = useState<string[]>(),
    [extended, setExtended] = useState<string[]>(),
    [remove, setRemove] = useState<string[]>([]);
  useEffect(() => {
    if (update && !added) {
      setAdded(update.added.map((o) => o.id));
      setExtended(update.extended.map((e) => e.id));
    }
  }, [update, added]);
  const changed = services.learn.changedNotes(course);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  if ((running && !running.error) || hold.held) {
    return (
      <WhileYouWait
        services={services}
        title={`Reading ${course.course}'s notes…`}
        detail="The writer is looking for new objectives; existing ones and your progress stay as they are."
        job={running}
        ready={!!update}
        readyLabel="The update is ready to review"
        onEngage={hold.engage}
        onContinue={hold.release}
        context={{ kind: 'mapping' }}
        cancel={() => services.learn.cancel(course.path, 'map-course')}
      />
    );
  }
  if (update && added && extended) {
    const nothing = !update.added.length && !update.extended.length && !update.outdated.length;
    return (
      <article className="qard-doc">
        <header>
          <span className="qard-muted">Update objectives</span>
          <h1>{course.course}</h1>
          <p className="qard-muted">
            From {plural(update.notes.length, 'note')}
            {': '}
            {update.notes.map((n) => n.split('/').pop()!.replace(/\.md$/, '')).join(', ')}
          </p>
        </header>
        {nothing && <p>Nothing new to add. The objectives already cover these notes.</p>}
        {update.added.length > 0 && (
          <section>
            <h2>New objectives</h2>
            {update.added.map((o) => (
              <button
                key={o.id}
                className="qard-doc-row qard-row-button"
                aria-pressed={added.includes(o.id)}
                onClick={() => toggle(added, setAdded, o.id)}
              >
                <Check on={added.includes(o.id)} />
                <span>
                  <InlineMarkdown text={o.title} path={path} services={services} />
                </span>
                <span className="qard-muted">{o.notes.slice(0, 2).join(', ')}</span>
                <StateChip state={o.state} />
              </button>
            ))}
          </section>
        )}
        {update.extended.length > 0 && (
          <section>
            <h2>More material for existing objectives</h2>
            {update.extended.map((e) => (
              <button
                key={e.id}
                className="qard-doc-row qard-row-button"
                aria-pressed={extended.includes(e.id)}
                onClick={() => toggle(extended, setExtended, e.id)}
              >
                <Check on={extended.includes(e.id)} />
                <span>
                  <InlineMarkdown text={e.title} path={path} services={services} />
                </span>
                <span className="qard-muted">
                  {[
                    ...e.notes.map((n) => `+ ${n}`),
                    ...e.needs.map((n) => `builds on ${n}`),
                    ...(e.group ? [`group: ${e.group}`] : []),
                    ...(e.label ? [`label: ${e.label}`] : []),
                  ].join(' · ')}
                </span>
              </button>
            ))}
          </section>
        )}
        {update.outdated.length > 0 && (
          <section>
            <h2>Possibly outdated</h2>
            <p className="qard-muted qard-small">Tick to remove. Unticked objectives are kept.</p>
            {update.outdated.map((o) => (
              <button
                key={o.id}
                className="qard-doc-row qard-row-button"
                aria-pressed={remove.includes(o.id)}
                onClick={() => toggle(remove, setRemove, o.id)}
              >
                <Check on={remove.includes(o.id)} />
                <span>
                  <InlineMarkdown text={o.title} path={path} services={services} />
                </span>
                <span className="qard-muted">
                  <InlineMarkdown text={o.reason} path={path} services={services} />
                </span>
              </button>
            ))}
          </section>
        )}
        {error && (
          <p className="qard-error" role="alert">
            {error}
          </p>
        )}
        <div className="qard-doc-footer is-end">
          <button
            className="qard-text-button"
            onClick={() => {
              void services.learn.discardUpdate(path);
              setAdded(undefined);
              done();
            }}
          >
            Cancel
          </button>
          <button
            className="qard-primary"
            onClick={() =>
              void services.learn.acceptUpdate(path, { added, extended, remove }).then(
                () => {
                  setAdded(undefined);
                  done();
                },
                (e) => setError((e as Error).message),
              )
            }
          >
            {nothing ? 'Mark as up to date' : 'Update mastery file'}
            <ArrowRight size={15} />
          </button>
        </div>
      </article>
    );
  }
  return (
    <div className="qard-new-test">
      <h1>Update {course.course}</h1>
      <div className="qard-composer">
        <p className="qard-muted">
          {changed.length
            ? `${plural(changed.length, 'note')} added or changed since the last update: ${changed.map((n) => n.split('/').pop()!.replace(/\.md$/, '')).join(', ')}.`
            : 'The writer will reread the course notes and suggest objectives that are missing.'}
        </p>
        <textarea
          aria-label="Anything to add"
          rows={2}
          placeholder="Optional, e.g. week 6 covered Hadoop"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="qard-composer-bar">
          <button className="qard-text-button" onClick={done}>
            Cancel
          </button>
          <button
            className="qard-primary"
            onClick={() => void services.learn.updateCourse(path, request)}
          >
            Find new objectives
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <JobError job={running} retry={() => void services.learn.updateCourse(path, request)} />
    </div>
  );
}
