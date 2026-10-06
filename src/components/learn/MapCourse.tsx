import { DeleteLearnItem } from './DeleteLearnItem';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Folder } from 'lucide-react';
import { studyNotes } from '../../vault-access';
import { testFolders } from '../../tests/test-sources';
import type { QardServices } from '../../views/services';
import { InlineMarkdown } from '../Markdown';
import { Check, JobError } from '../common/FeedbackStatus';
import { StateChip } from './learning-status';
import { useLearn } from './useLearn';
import { type LearnNav } from '../../views/navigation';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';

export function MapCourse({
  services,
  nav,
  initialFolder,
}: {
  services: QardServices;
  nav: LearnNav;
  initialFolder?: string;
}) {
  const { job } = useLearn(services);
  const [folder, setFolder] = useState<string | undefined>(initialFolder),
    [query, setQuery] = useState(''),
    [request, setRequest] = useState('');
  const hold = useHold();
  const [keep, setKeep] = useState<string[]>(),
    [error, setError] = useState('');
  const folders = useMemo(() => {
    const q = query.toLowerCase().trim();
    return testFolders(
      studyNotes(services.app, [services.reviews.getSnapshot().settings.tests.folder]).map(
        (f) => f.path,
      ),
    )
      .map((f) => f.path)
      .filter((path) => !q || path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [services, query]);
  const mapping = folder ? job(folder, 'map-course') : undefined,
    proposal = folder ? services.learn.proposal(folder) : undefined;
  useEffect(() => {
    if (proposal && !keep) {
      setKeep(proposal.objectives.map((o) => o.id));
    }
  }, [proposal, keep]);
  if (folder && ((mapping && !mapping.error) || hold.held)) {
    return (
      <div className="qard-wait-shell">
        <div className="qard-actions">
          <DeleteLearnItem services={services} kind="mapping" path={folder} deleted={nav.learn} />
        </div>
        <WhileYouWait
          services={services}
          title={`Mapping ${folder.split('/').pop()}…`}
          detail="The writer is reading the course notes; the objectives wait under Learn for you to review."
          job={mapping}
          ready={!!proposal}
          readyLabel="The objectives are ready to review"
          onEngage={hold.engage}
          onContinue={hold.release}
          context={{ kind: 'mapping' }}
          cancel={() => services.learn.cancel(folder, 'map-course')}
        />
      </div>
    );
  }
  if (folder && proposal && keep) {
    return (
      <article className="qard-doc">
        <div className="qard-actions">
          <DeleteLearnItem services={services} kind="mapping" path={folder} deleted={nav.learn} />
        </div>
        <header>
          <span className="qard-muted">Proposed objectives</span>
          <h1>{proposal.course}</h1>
          <p className="qard-muted">
            {proposal.objectives.length} objectives from {folder}. Untick any you don't need; you
            can edit the file later.
          </p>
        </header>
        <section>
          {proposal.objectives.map((o) => (
            <button
              key={o.id}
              className="qard-doc-row qard-row-button"
              aria-pressed={keep.includes(o.id)}
              onClick={() =>
                setKeep(keep.includes(o.id) ? keep.filter((x) => x !== o.id) : [...keep, o.id])
              }
            >
              <Check on={keep.includes(o.id)} />
              <span>
                <InlineMarkdown text={o.title} path={folder} services={services} />
              </span>
              <span className="qard-muted">{o.notes.slice(0, 2).join(', ')}</span>
              <StateChip state={o.state} />
            </button>
          ))}
        </section>
        {error && (
          <p className="qard-error" role="alert">
            {error}
          </p>
        )}
        <div className="qard-doc-footer is-end">
          <button
            className="qard-text-button"
            onClick={() => {
              void services.learn.discardProposal(folder);
              setKeep(undefined);
            }}
          >
            Start over
          </button>
          <button
            className="qard-primary"
            disabled={!keep.length}
            onClick={() =>
              void services.learn
                .acceptCourse(folder, keep)
                .then(nav.course, (e) => setError((e as Error).message))
            }
          >
            Create mastery file
            <ArrowRight size={15} />
          </button>
        </div>
      </article>
    );
  }
  return (
    <div className="qard-new-test">
      <h1>Which folder holds the course?</h1>
      <div className="qard-composer">
        {folder ? (
          <span className="qard-chip is-on">
            <Folder size={13} />
            {folder}
            <button
              className="qard-chip-x"
              aria-label="Choose another folder"
              onClick={() => setFolder(undefined)}
            >
              ×
            </button>
          </span>
        ) : (
          <>
            <input
              type="search"
              aria-label="Find a folder"
              placeholder="Find a folder…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="qard-folder-list">
              {folders.map((f) => (
                <button key={f} className="qard-popover-item" onClick={() => setFolder(f)}>
                  <Folder size={14} />
                  <span>{f}</span>
                </button>
              ))}
              {!folders.length && <p className="qard-muted">No matching folders.</p>}
            </div>
          </>
        )}
        {folder && (
          <textarea
            aria-label="Anything to add"
            rows={2}
            placeholder="Optional, e.g. focus on the A1 syllabus"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        )}
        <div className="qard-composer-bar">
          <span className="qard-muted qard-small">
            The writer lists the objectives it finds. Nothing is saved until you accept.
          </span>
          <button
            className="qard-primary"
            disabled={!folder}
            onClick={() => {
              setKeep(undefined);
              void services.learn.mapCourse(folder!, request);
            }}
          >
            Map course
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
      {folder && (
        <>
          <JobError job={mapping} retry={() => void services.learn.mapCourse(folder, request)} />
          {mapping?.error && (
            <DeleteLearnItem services={services} kind="mapping" path={folder} deleted={nav.learn} />
          )}
        </>
      )}
    </div>
  );
}
