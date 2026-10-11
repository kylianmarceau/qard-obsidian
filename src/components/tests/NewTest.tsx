import { studyNotes } from '../../vault-access';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowRight, FileText, Folder, X } from 'lucide-react';
import {
  folderNotes,
  resolveTestNotes,
  testFolders,
  testNotePaths,
} from '../../tests/test-sources';
import type { QardServices } from '../../views/services';
import { Check } from '../common/FeedbackStatus';
import { type TestNav } from '../../views/navigation';

/** One prompt box. Sources are optional: flashcard decks, notes and whole course folders. */
export function NewTest({
  services,
  nav,
  initialPrompt,
}: {
  services: QardServices;
  nav: TestNav;
  initialPrompt?: string;
}) {
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const settings = services.reviews.getSnapshot().settings.tests;
  const [prompt, setPrompt] = useState(initialPrompt ?? ''),
    [useCards, setUseCards] = useState(false),
    [decks, setDecks] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]),
    [planFirst, setPlanFirst] = useState(settings.planFirst);
  const [folders, setFolders] = useState<string[]>([]);
  const [open, setOpen] = useState<'decks' | 'notes' | 'folders' | null>(null),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const files = useMemo(() => {
    const candidates = studyNotes(services.app);
    const allowed = new Set(
      testNotePaths(
        candidates.map((f) => f.path),
        settings.folder,
      ),
    );
    return candidates.filter((f) => allowed.has(f.path));
  }, [services, settings.folder, index.revision]);
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const covered = useMemo(() => new Set(folderNotes(paths, folders)), [paths, folders]);
  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    return files
      .filter(
        (f) =>
          !notes.includes(f.path) &&
          !covered.has(f.path) &&
          (!q || f.path.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 6);
  }, [query, notes, files, covered]);
  const matchingFolders = useMemo(() => {
    const q = query.toLowerCase().trim();
    return testFolders(paths)
      .filter((f) => !folders.includes(f.path) && (!q || f.path.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [paths, folders, query]);
  const attached = resolveTestNotes(paths, notes, folders);
  const chosenDecks = useCards ? decks : [];
  const empty = !chosenDecks.length && !attached.length;
  async function start() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    const deckFiles = index.decks
      .filter((d) => chosenDecks.includes(d.name))
      .flatMap((d) => d.files);
    const latest = testNotePaths(
      studyNotes(services.app).map((f) => f.path),
      settings.folder,
    );
    const selected = resolveTestNotes(latest, notes, folders);
    const request = {
      prompt: prompt.trim(),
      decks: chosenDecks,
      notes: selected,
      ...(folders.length ? { folders } : {}),
      sources: [...new Set([...deckFiles, ...selected])],
    };
    try {
      if (!request.prompt && !request.sources.length) {
        throw new Error(
          'The selected sources no longer contain any Markdown notes. Choose another source or enter a prompt.',
        );
      }
      planFirst
        ? nav.plan(await services.tests.plan(request))
        : nav.take(await services.tests.generate({ request }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="qard-new-test">
      <h1>What should this test cover?</h1>
      <div className="qard-composer">
        <textarea
          aria-label="Test prompt"
          rows={3}
          value={prompt}
          placeholder="e.g. HMM inference, exam style. Focus on what I got wrong last time."
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="qard-composer-bar">
          <div className="qard-sources">
            <button
              className={'qard-chip' + (useCards ? ' is-on' : '')}
              aria-pressed={useCards}
              onClick={() => {
                setUseCards(!useCards);
                setOpen(!useCards && !decks.length ? 'decks' : null);
              }}
            >
              <Check on={useCards} />
              Flashcards
            </button>
            {useCards && (
              <button
                className="qard-chip"
                aria-expanded={open === 'decks'}
                onClick={() => setOpen(open === 'decks' ? null : 'decks')}
              >
                {decks.length === 0
                  ? 'Choose decks'
                  : decks.length === 1
                    ? decks[0]
                    : `${decks.length} decks`}
                {' ▾'}
              </button>
            )}
            {notes.map((path) => (
              <span key={path} className="qard-chip is-on">
                <FileText size={13} />
                {path.split('/').pop()!.replace(/\.md$/, '')}
                <button
                  className="qard-chip-x"
                  aria-label={`Remove ${path}`}
                  onClick={() => setNotes(notes.filter((n) => n !== path))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {folders.map((path) => (
              <span key={path} className="qard-chip qard-folder-chip is-on" title={path}>
                <Folder size={13} />
                <span>{path.split('/').pop()}</span>
                <small>
                  {folderNotes(paths, [path]).length}{' '}
                  {folderNotes(paths, [path]).length === 1 ? 'note' : 'notes'}
                </small>
                <button
                  className="qard-chip-x"
                  aria-label={`Remove folder ${path}`}
                  onClick={() => setFolders(folders.filter((f) => f !== path))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button
              className="qard-chip"
              aria-expanded={open === 'notes'}
              onClick={() => {
                setOpen(open === 'notes' ? null : 'notes');
                setQuery('');
              }}
            >
              + Note
            </button>
            <button
              className="qard-chip"
              aria-expanded={open === 'folders'}
              onClick={() => {
                setOpen(open === 'folders' ? null : 'folders');
                setQuery('');
              }}
            >
              + Folder
            </button>
            {open === 'decks' && (
              <div className="qard-popover">
                {index.decks.length ? (
                  index.decks.map((d) => (
                    <button
                      key={d.name}
                      className="qard-popover-item"
                      aria-pressed={decks.includes(d.name)}
                      onClick={() =>
                        setDecks(
                          decks.includes(d.name)
                            ? decks.filter((x) => x !== d.name)
                            : [...decks, d.name],
                        )
                      }
                    >
                      <Check on={decks.includes(d.name)} />
                      <span>{d.name}</span>
                      <small>{d.cards.length} cards</small>
                    </button>
                  ))
                ) : (
                  <p className="qard-muted">No decks yet.</p>
                )}
              </div>
            )}
            {open === 'notes' && (
              <div className="qard-popover">
                <input
                  type="search"
                  autoFocus
                  aria-label="Find a note"
                  placeholder="Find a note…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {matches.map((f) => (
                  <button
                    key={f.path}
                    className="qard-popover-item"
                    onClick={() => {
                      setNotes([...notes, f.path]);
                      setOpen(null);
                      setQuery('');
                    }}
                  >
                    <span>{f.basename}</span>
                    <small>{f.parent?.path === '/' ? '' : f.parent?.path}</small>
                  </button>
                ))}
                {!matches.length && <p className="qard-muted">No matching notes.</p>}
              </div>
            )}
            {open === 'folders' && (
              <div className="qard-popover qard-folder-picker">
                <input
                  type="search"
                  autoFocus
                  aria-label="Find a course folder"
                  placeholder="Find a course folder…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <p className="qard-muted qard-small">Includes Markdown notes in subfolders.</p>
                {matchingFolders.map((f) => (
                  <button
                    key={f.path}
                    className="qard-popover-item"
                    title={f.path}
                    aria-label={`Attach folder ${f.path}, ${f.count} ${f.count === 1 ? 'note' : 'notes'}`}
                    onClick={() => {
                      setFolders([...folders, f.path]);
                      setOpen(null);
                      setQuery('');
                    }}
                  >
                    <Folder size={14} />
                    <span>{f.path}</span>
                    <small>
                      {f.count} {f.count === 1 ? 'note' : 'notes'}
                    </small>
                  </button>
                ))}
                {!matchingFolders.length && (
                  <p className="qard-muted">No matching folders with Markdown notes.</p>
                )}
              </div>
            )}
          </div>
          <div className="qard-composer-go">
            <button
              className="qard-chip qard-plain"
              aria-pressed={planFirst}
              onClick={() => setPlanFirst(!planFirst)}
            >
              <Check on={planFirst} />
              Plan first
            </button>
            <button
              className="qard-primary"
              disabled={busy || (!prompt.trim() && empty)}
              onClick={() => void start()}
            >
              Start
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
      {attached.length > 0 && (
        <p className="qard-muted qard-hint" role="status">
          {attached.length} {attached.length === 1 ? 'note' : 'notes'} attached
          {folders.length > 0 ? ', including subfolders' : ''}.
        </p>
      )}
      <p className="qard-muted qard-hint">
        {empty
          ? 'No sources selected. The agent will find the relevant notes itself.'
          : planFirst
            ? 'The agent drafts a short plan for you to check before it writes the test.'
            : 'The agent writes the test straight away.'}
      </p>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
