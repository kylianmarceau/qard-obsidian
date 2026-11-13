import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, RefreshCw, Square } from 'lucide-react';
import type { SourceChange, SourceSyncService } from '../cards/source-sync-service';
import type { QardServices } from '../views/services';
import { InlineMarkdown, Markdown } from './Markdown';
import { useAi } from '../views/use-ai';

export function SourceUpdatesRow({
  service,
  open,
}: {
  service: SourceSyncService;
  open: () => void;
}) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  if (!state.changes.length && !state.error) {
    return null;
  }
  return (
    <button className="qard-resume qard-row-update" onClick={open}>
      <span className="qard-resume-copy">
        <span className="qard-muted qard-resume-label">Source updates</span>
        <strong className="qard-resume-title">
          {state.error
            ? 'Check source tracking'
            : `${state.changes.length} ${state.changes.length === 1 ? 'card may' : 'cards may'} need updating`}
        </strong>
      </span>
      <span className="qard-muted">Review changes</span>
      <ChevronRight size={16} />
    </button>
  );
}

export function SourceUpdates({ services, back }: { services: QardServices; back: () => void }) {
  const service = services.sourceSync!;
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const ai = useAi(services);
  const [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const current = state.changes.find((c) => c.card.id === selected) ?? state.changes[0];
  useEffect(() => {
    void service.refresh();
  }, [service]);
  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="qard-heading">
        <div>
          <h1>Source updates</h1>
          <p>
            Your notes changed. Review the affected cards and their explanations before accepting
            edits.
          </p>
        </div>
        <div className="qard-actions">
          <button disabled={state.scanning || state.loading} onClick={() => void service.refresh()}>
            <RefreshCw size={15} />
            {state.scanning ? 'Checking…' : 'Check notes'}
          </button>
          <button onClick={back}>Done</button>
        </div>
      </div>
      {(error || state.error) && (
        <p role="alert" className="qard-error">
          {error || state.error}
        </p>
      )}
      {state.loading ? (
        <p className="qard-muted">Loading source links…</p>
      ) : !current ? (
        <div className="qard-empty">
          <h2>No source updates to review</h2>
          <p>
            Generated cards track their source notes automatically. For an older or handwritten
            card, open its preview and choose Link a source note.
          </p>
        </div>
      ) : (
        <>
          {state.changes.length > 1 && (
            <BatchUpdates
              changes={state.changes}
              service={service}
              ai={ai}
              busy={state.busy}
              report={setError}
            />
          )}
          <div className="qard-source-workspace">
            <nav className="qard-source-list" aria-label="Affected cards">
              {state.changes.map((change) => (
                <button
                  key={`${change.card.id}:${change.card.sourceFile}`}
                  className={change === current ? 'is-selected' : ''}
                  aria-current={change === current ? 'true' : undefined}
                  onClick={() => {
                    setSelected(change.card.id);
                    setError('');
                  }}
                >
                  <strong>
                    <InlineMarkdown
                      text={change.card.frontMarkdown.split('\n')[0] ?? ''}
                      path={change.card.sourceFile}
                      services={services}
                    />
                  </strong>
                  <small>
                    {change.card.deck} › {change.card.topic}
                  </small>
                  <small>
                    {change.applying
                      ? 'Update needs finishing'
                      : change.sources.some((s) => s.after === null)
                        ? 'Source missing'
                        : `${change.sources.length} changed ${change.sources.length === 1 ? 'note' : 'notes'}`}
                  </small>
                </button>
              ))}
            </nav>
            <section className="qard-source-detail" aria-label="Card update">
              <div className="qard-panel">
                <span className="qard-eyebrow">Current card</span>
                <Markdown
                  text={current.card.frontMarkdown}
                  path={current.card.sourceFile}
                  services={services}
                />
                <hr />
                <Markdown
                  text={current.card.backMarkdown}
                  path={current.card.sourceFile}
                  services={services}
                />
                <button
                  className="qard-text-button"
                  onClick={() => void run(() => services.openSource(current.card))}
                >
                  Open card note
                </button>
              </div>
              {current.card.duplicateId && (
                <p className="qard-error">
                  This ID is shared by multiple cards. Fix the copied ID in the card note before
                  updating it.
                </p>
              )}
              {current.sources.map((source) => (
                <SourceDifference key={source.path} source={source} services={services} />
              ))}
              {current.applying ? (
                <div className="qard-panel">
                  <h2>Finish this update</h2>
                  <p>
                    The update was interrupted. Qard will finish saving its source link and review
                    flag without adding another card.
                  </p>
                  <div className="qard-actions">
                    <button
                      disabled={state.busy.includes(current.card.id) || current.card.duplicateId}
                      className="qard-primary"
                      onClick={() => void run(() => service.accept(current.card.id, '', '', false))}
                    >
                      Finish update
                    </button>
                    <button
                      disabled={state.busy.includes(current.card.id)}
                      onClick={() => void run(() => service.discardUpdate(current.card.id))}
                    >
                      Cancel unsaved update
                    </button>
                  </div>
                </div>
              ) : current.proposal ? (
                <Suggestion
                  key={JSON.stringify(current.proposal)}
                  change={current}
                  services={services}
                  busy={state.busy.includes(current.card.id)}
                  run={run}
                />
              ) : (
                <div className="qard-actions">
                  {ai && (
                    <button
                      className="qard-primary"
                      disabled={
                        state.busy.includes(current.card.id) ||
                        current.card.duplicateId ||
                        current.sources.some((s) => s.after === null)
                      }
                      onClick={() => void run(() => service.suggest(current.card.id))}
                    >
                      {state.busy.includes(current.card.id)
                        ? 'Preparing suggestion…'
                        : 'Suggest an update'}
                    </button>
                  )}
                  {state.busy.includes(current.card.id) && (
                    <button
                      className="qard-icon-button qard-jobs-cancel"
                      aria-label="Cancel suggestion"
                      title="Cancel suggestion"
                      onClick={() => service.cancel(current.card.id)}
                    >
                      <Square size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    disabled={state.busy.includes(current.card.id) || current.card.duplicateId}
                    onClick={() => void run(() => service.keep(current.card.id))}
                  >
                    Keep card as is
                  </button>
                </div>
              )}
              <p className="qard-muted qard-small">
                {ai
                  ? 'Suggestions use your Writer connection. Note changes are detected locally; an AI request runs only when you choose Suggest an update.'
                  : 'Note changes are detected locally. Edit the card from the library, or keep it as is.'}
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Act on every affected card at once: acknowledge them all, prepare every suggestion, or apply the
 * suggestions already prepared. Each card still goes through the same checks as a single update.
 */
function BatchUpdates({
  changes,
  service,
  ai,
  busy,
  report,
}: {
  changes: SourceChange[];
  service: SourceSyncService;
  ai: boolean;
  busy: string[];
  report: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState<'keep' | 'apply'>(),
    [progress, setProgress] = useState<{ label: string; done: number; total: number }>(),
    [status, setStatus] = useState('');
  const stopped = useRef(false),
    current = useRef<string | undefined>(undefined);
  const open = changes.filter((c) => !c.applying && !c.card.duplicateId);
  const ready = open.filter((c) => c.proposal);
  const waiting = open.filter((c) => !c.proposal && !c.sources.some((s) => s.after === null));
  const working = !!progress || busy.length > 0;
  const count = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;
  async function each(
    label: string,
    list: SourceChange[],
    work: (c: SourceChange) => Promise<unknown>,
  ) {
    stopped.current = false;
    setConfirm(undefined);
    setStatus('');
    report('');
    let done = 0;
    const failed: string[] = [];
    for (const change of list) {
      if (stopped.current) {
        break;
      }
      setProgress({ label, done, total: list.length });
      current.current = change.card.id;
      try {
        await work(change);
        done++;
      } catch (e) {
        if (!stopped.current) {
          failed.push((e as Error).message);
        }
      }
    }
    current.current = undefined;
    setProgress(undefined);
    return { done, failed };
  }
  const summary = (verb: string, done: number, failed: string[]) => {
    setStatus(
      `${verb} ${count(done)}.` +
        (stopped.current ? ' Stopped before the rest.' : '') +
        (failed.length ? ` ${count(failed.length)} could not be updated: ${failed[0]}` : ''),
    );
  };
  async function keepAll() {
    setConfirm(undefined);
    setStatus('');
    report('');
    setProgress({ label: 'Keeping cards', done: 0, total: open.length });
    try {
      const kept = await service.keepMany(open.map((c) => c.card.id));
      setStatus(`Kept ${count(kept)} as they are.`);
    } catch (e) {
      report((e as Error).message);
    } finally {
      setProgress(undefined);
    }
  }
  async function suggestAll() {
    const { done, failed } = await each('Preparing suggestions', waiting, (c) =>
      service.suggest(c.card.id),
    );
    summary('Prepared suggestions for', done, failed);
  }
  async function applyAll() {
    const { done, failed } = await each('Applying suggestions', ready, (c) => {
      const p = c.proposal!;
      return p.change === 'none' ||
        (p.front.trim() === c.card.frontMarkdown && p.back.trim() === c.card.backMarkdown)
        ? service.keep(c.card.id)
        : service.accept(c.card.id, p.front, p.back, p.change === 'meaning');
    });
    summary('Applied suggestions to', done, failed);
  }
  return (
    <section className="qard-panel qard-source-batch" aria-label="Update all cards">
      <p>
        <strong>{count(changes.length)}</strong> to review
        {ready.length
          ? ` · ${ready.length} ${ready.length === 1 ? 'suggestion' : 'suggestions'} ready`
          : ''}
      </p>
      {progress ? (
        <div className="qard-actions">
          <span role="status">
            {progress.label}… {progress.done} of {progress.total}
          </span>
          {progress.label !== 'Keeping cards' && (
            <button
              className="qard-icon-button qard-jobs-cancel"
              aria-label="Stop updating cards"
              title="Stop updating cards"
              onClick={() => {
                stopped.current = true;
                if (current.current) {
                  service.cancel(current.current);
                }
              }}
            >
              <Square size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : confirm ? (
        <div className="qard-actions">
          <span>
            {confirm === 'keep'
              ? `Keep ${count(open.length)} as they are and accept the note changes?`
              : `Apply ${ready.length} prepared ${ready.length === 1 ? 'suggestion' : 'suggestions'}? Cards whose answer changed become due for a fresh review.`}
          </span>
          <button
            className="qard-primary"
            onClick={() => void (confirm === 'keep' ? keepAll() : applyAll())}
          >
            {confirm === 'keep' ? 'Keep all' : 'Apply all'}
          </button>
          <button onClick={() => setConfirm(undefined)}>Cancel</button>
        </div>
      ) : (
        <div className="qard-actions">
          {ai && waiting.length > 0 && (
            <button disabled={working} onClick={() => void suggestAll()}>
              Suggest updates for {count(waiting.length)}
            </button>
          )}
          {ready.length > 0 && (
            <button className="qard-primary" disabled={working} onClick={() => setConfirm('apply')}>
              Apply {ready.length} {ready.length === 1 ? 'suggestion' : 'suggestions'}
            </button>
          )}
          {open.length > 0 && (
            <button disabled={working} onClick={() => setConfirm('keep')}>
              Keep all as they are
            </button>
          )}
        </div>
      )}
      {status && (
        <p className="qard-muted" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

function Suggestion({
  change,
  services,
  busy,
  run,
}: {
  change: SourceChange;
  services: QardServices;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const proposal = change.proposal!;
  const [front, setFront] = useState(proposal.front),
    [back, setBack] = useState(proposal.back),
    [substantive, setSubstantive] = useState(proposal.change === 'meaning');
  const ai = useAi(services);
  const edited =
    front.trim() !== change.card.frontMarkdown || back.trim() !== change.card.backMarkdown;
  return (
    <div className="qard-panel qard-source-suggestion">
      <h2>{proposal.change === 'none' ? 'No card edit needed' : 'Suggested update'}</h2>
      <Markdown text={proposal.reason} path={change.card.sourceFile} services={services} />
      <label>
        Question
        <textarea
          aria-label="Updated question"
          rows={3}
          disabled={busy}
          value={front}
          onChange={(e) => setFront(e.target.value)}
        />
      </label>
      <label>
        Answer
        <textarea
          aria-label="Updated answer"
          rows={5}
          disabled={busy}
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
      </label>
      <details>
        <summary>Preview update</summary>
        <Markdown text={front} path={change.card.sourceFile} services={services} />
        <hr />
        <Markdown text={back} path={change.card.sourceFile} services={services} />
      </details>
      {edited && (
        <label className="qard-source-check">
          <input
            type="checkbox"
            disabled={busy}
            checked={substantive}
            onChange={(e) => setSubstantive(e.target.checked)}
          />
          The correct answer changed — make this card due for a fresh review.
        </label>
      )}
      <p className="qard-muted qard-small">
        {edited && substantive
          ? 'Your review history stays saved. The updated answer will be checked in your next normal review.'
          : 'Your review history and schedule stay the same.'}
      </p>
      <div className="qard-actions">
        <button
          className="qard-primary"
          disabled={busy || !front.trim() || !back.trim() || change.card.duplicateId}
          onClick={() =>
            void run(() =>
              edited
                ? services.sourceSync!.accept(change.card.id, front, back, substantive)
                : services.sourceSync!.keep(change.card.id),
            )
          }
        >
          {busy ? 'Saving…' : edited ? 'Apply update' : 'Keep card and acknowledge changes'}
        </button>
        <button
          disabled={busy}
          onClick={() => void run(() => services.sourceSync!.keep(change.card.id))}
        >
          Keep card as is
        </button>
        {ai && (
          <button
            disabled={busy}
            onClick={() => void run(() => services.sourceSync!.suggest(change.card.id))}
          >
            Suggest again
          </button>
        )}
      </div>
    </div>
  );
}

/** Show changed lines with nearby context, rather than making the learner scan entire notes. */
export function changedPassage(before: string | null, after: string | null) {
  const old = (before ?? '').split('\n'),
    next = (after ?? '').split('\n');
  let start = 0,
    suffix = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) {
    start++;
  }
  while (
    suffix < old.length - start &&
    suffix < next.length - start &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const from = Math.max(0, start - 2);
  return {
    before: old.slice(from, Math.min(old.length, old.length - suffix + 2)).join('\n'),
    after: next.slice(from, Math.min(next.length, next.length - suffix + 2)).join('\n'),
  };
}
function SourceDifference({
  source,
  services,
}: {
  source: SourceChange['sources'][number];
  services: QardServices;
}) {
  const excerpt = changedPassage(source.before, source.after);
  return (
    <div className="qard-source-difference">
      <h3>
        <button
          className="qard-link"
          onClick={() => void services.app.workspace.openLinkText(source.path, '', true)}
        >
          {source.path}
        </button>
      </h3>
      {source.after === null && (
        <p className="qard-error">
          This source note is missing. Restore it or keep the card as it is.
        </p>
      )}
      <div className="qard-source-columns">
        <div>
          <span className="qard-eyebrow">Previous passage</span>
          <pre>{excerpt.before || '(No previous passage)'}</pre>
        </div>
        <div>
          <span className="qard-eyebrow">Current passage</span>
          <pre>{excerpt.after || '(Passage removed)'}</pre>
        </div>
      </div>
      <details>
        <summary>Full note versions</summary>
        <div className="qard-source-columns">
          <pre>{source.before ?? '(Source was missing)'}</pre>
          <pre>{source.after ?? '(Source missing)'}</pre>
        </div>
      </details>
    </div>
  );
}
