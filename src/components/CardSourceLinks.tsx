import { useState, useSyncExternalStore } from 'react';
import { FileText, Link2, X } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import { studyNotes } from '../vault-access';
export function CardSourceLinks({
  card,
  services,
  changed,
}: {
  card: QardCard;
  services: QardServices;
  changed: (card: QardCard) => void;
}) {
  const service = services.sourceSync!;
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const link = state.links[card.id],
    pending = state.changes.some((c) => c.card.id === card.id);
  // The same search as attaching a note to a practice test: recent notes first, filtered as you type.
  const q = query.toLowerCase().trim();
  const matches = open
    ? studyNotes(services.app, [services.reviews.getSnapshot().settings.tests.folder])
        .filter(
          (f) =>
            !link?.sources.some((s) => s.path === f.path) &&
            (!q || f.path.toLowerCase().includes(q)),
        )
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 6)
    : [];
  async function add(path: string) {
    setBusy(true);
    setError('');
    try {
      const [stable] = await services.writer.ensureStable([card]);
      if (!stable) {
        throw new Error('This card is no longer available.');
      }
      const versions = await service.capture([path]);
      if (versions.some((s) => s.text === null)) {
        throw new Error('The note no longer exists. Choose it again.');
      }
      const current = service.getSnapshot().links[stable.id];
      if (current?.sources.some((s) => s.path === path)) {
        throw new Error(
          'This source is already linked. Review its changes before updating the link.',
        );
      }
      await service.track(stable.id, [...(current?.sources ?? []), ...versions], true);
      await service.refresh();
      changed(stable);
      setOpen(false);
      setQuery('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(path: string) {
    setBusy(true);
    setError('');
    try {
      await service.removeSource(card.id, path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!link?.applying || state.busy.includes(card.id);
  return (
    <section className="qard-card-sources" aria-label="Source notes">
      <header>
        <div>
          <h3>Source notes</h3>
          <p className="qard-muted">
            {link
              ? 'Qard suggests edits to this card when these notes change.'
              : 'Link a note to track changes to the material this card is based on.'}
          </p>
        </div>
        <div className="qard-source-search">
          <button
            className="qard-source-add"
            aria-expanded={open}
            disabled={locked || card.duplicateId}
            onClick={() => {
              setOpen(!open);
              setQuery('');
            }}
          >
            <Link2 size={14} />
            Link a source note
          </button>
          {open && (
            <div className="qard-popover">
              <input
                type="search"
                autoFocus
                aria-label="Find a note to link"
                placeholder="Find a note…"
                value={query}
                disabled={busy}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setOpen(false);
                  } else if (e.key === 'Enter' && matches[0] && !busy) {
                    void add(matches[0].path);
                  }
                }}
              />
              {matches.map((f) => (
                <button
                  key={f.path}
                  className="qard-popover-item"
                  title={f.path}
                  disabled={busy}
                  onClick={() => void add(f.path)}
                >
                  <span>{f.basename}</span>
                  <small>{f.parent?.path === '/' ? '' : f.parent?.path}</small>
                </button>
              ))}
              {!matches.length && <p className="qard-muted">No matching notes.</p>}
              <p className="qard-muted qard-source-caveat">
                Tracking starts from the note as it is now.
              </p>
            </div>
          )}
        </div>
      </header>
      {link && (
        <ul>
          {link.sources.map((s) => (
            <li key={s.path}>
              <FileText size={14} />
              <button
                className="qard-link"
                onClick={() => void services.app.workspace.openLinkText(s.path, '', true)}
              >
                {s.path}
              </button>
              <button
                className="qard-icon-button"
                aria-label={`Remove source link to ${s.path}`}
                title="Remove link"
                disabled={locked}
                onClick={() => void remove(s.path)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {link && pending && (
        <p className="qard-source-pending" role="status">
          Source changes are waiting in Source updates.
        </p>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
