import { useState, useSyncExternalStore } from 'react';
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
      if (!stable) throw new Error('This card is no longer available.');
      const versions = await service.capture([path]);
      if (versions.some((s) => s.text === null))
        throw new Error('The note no longer exists. Choose it again.');
      const current = service.getSnapshot().links[stable.id];
      if (current?.sources.some((s) => s.path === path))
        throw new Error(
          'This source is already linked. Review its changes before updating the link.',
        );
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
  return (
    <section className="qard-card-sources">
      <span className="qard-eyebrow">Source notes</span>
      {link ? (
        <>
          <ul>
            {link.sources.map((s) => (
              <li key={s.path}>
                <button
                  className="qard-link"
                  onClick={() => void services.app.workspace.openLinkText(s.path, '', true)}
                >
                  {s.path}
                </button>{' '}
                <button
                  className="qard-text-button"
                  aria-label={`Remove source link to ${s.path}`}
                  disabled={busy || !!link.applying || state.busy.includes(card.id)}
                  onClick={() => void remove(s.path)}
                >
                  Remove link
                </button>
              </li>
            ))}
          </ul>
          {pending && <p className="qard-muted">Source changes are waiting in Source updates.</p>}
        </>
      ) : (
        <p className="qard-muted qard-small">
          Link a note to track changes to the material this card is based on.
        </p>
      )}
      <button
        disabled={busy || card.duplicateId || !!link?.applying || state.busy.includes(card.id)}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Cancel linking' : 'Link a source note'}
      </button>
      {open && (
        <div className="qard-panel">
          <label>
            Note
            <select
              aria-label="Source note to link"
              value={path}
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
          </label>
          <p className="qard-muted qard-small">
            Tracking starts from the current note version. Earlier changes cannot be recovered.
          </p>
          <button className="qard-primary" disabled={busy || !path} onClick={() => void add()}>
            {busy ? 'Linking…' : 'Start tracking'}
          </button>
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
