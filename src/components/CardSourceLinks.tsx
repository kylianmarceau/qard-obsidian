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
    [path, setPath] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const link = state.links[card.id],
    pending = state.changes.some((c) => c.card.id === card.id);
  const paths = studyNotes(services.app, [services.reviews.getSnapshot().settings.tests.folder])
    .map((f) => f.path)
    .sort();
  async function add() {
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
      setPath('');
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
        <button
          className="qard-source-add"
          aria-expanded={open}
          disabled={locked || card.duplicateId}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={14} /> : <Link2 size={14} />}
          {open ? 'Cancel linking' : 'Link a source note'}
        </button>
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
      {open && (
        <div className="qard-source-picker">
          <select
            aria-label="Source note to link"
            value={path}
            disabled={busy}
            onChange={(e) => setPath(e.target.value)}
          >
            <option value="">Choose a note</option>
            {paths
              .filter((p) => !link?.sources.some((s) => s.path === p))
              .map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
          </select>
          <button className="qard-primary" disabled={busy || !path} onClick={() => void add()}>
            {busy ? 'Linking…' : 'Start tracking'}
          </button>
          <p className="qard-muted">
            Tracking starts from the current note version. Earlier changes cannot be recovered.
          </p>
        </div>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
