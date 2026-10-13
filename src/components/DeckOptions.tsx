import { useState } from 'react';
import { X } from 'lucide-react';
import { canonicalDeck, deckLineage } from '../decks/deck-index';
import { deckLimits, deckRetention, withDeckOptions } from '../decks/deck-options';
import type { DeckOptions as Options, QardSettings } from '../settings/settings';

/** Target retention and a daily new-card limit for one deck and the decks nested under it. */
export function DeckOptions({
  deck,
  settings,
  save,
  close,
}: {
  deck: string;
  settings: QardSettings;
  save: (deckOptions: Record<string, Options>) => Promise<void>;
  close: () => void;
}) {
  const name = canonicalDeck(deck),
    own = settings.deckOptions[name] ?? {};
  const [target, setTarget] = useState(
      own.desiredRetention === undefined ? '' : String(Math.round(own.desiredRetention * 100)),
    ),
    [limit, setLimit] = useState(own.newCardsPerDay ? String(own.newCardsPerDay) : ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  // What applies when this deck sets nothing of its own.
  const parent = deckLineage(name)[1];
  const inherited = deckRetention(settings, parent);
  const above = deckLimits(settings, parent);
  async function submit() {
    const retention = target.trim() ? Number(target) : undefined,
      perDay = limit.trim() ? Number(limit) : undefined;
    if (
      retention !== undefined &&
      (!Number.isFinite(retention) || retention < 70 || retention > 97)
    ) {
      setError('Choose a target retention between 70% and 97%, or leave it empty.');
      return;
    }
    if (perDay !== undefined && (!Number.isSafeInteger(perDay) || perDay < 1 || perDay > 10000)) {
      setError('Choose a whole number of new cards from 1 to 10,000, or leave it empty.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await save(
        withDeckOptions(settings.deckOptions, name, {
          ...(retention !== undefined ? { desiredRetention: retention / 100 } : {}),
          ...(perDay !== undefined ? { newCardsPerDay: perDay } : {}),
        }),
      );
      close();
    } catch {
      setError('Could not save these options. Please try again.');
      setBusy(false);
    }
  }
  return (
    <section className="qard-deck-options" aria-label={`Deck options for ${name}`}>
      <header>
        <h2>Deck options · {name}</h2>
        <button className="qard-icon-button" aria-label="Close deck options" onClick={close}>
          <X size={16} />
        </button>
      </header>
      <p className="qard-muted qard-small">
        These apply to this deck and the decks nested under it, unless a nested deck sets its own.
      </p>
      <label>
        <span>Target retention (%)</span>
        <input
          type="number"
          min={70}
          max={97}
          step={1}
          value={target}
          disabled={busy}
          placeholder={String(Math.round(inherited.value * 100))}
          onChange={(e) => setTarget(e.target.value)}
        />
        <small className="qard-muted">
          Empty uses {Math.round(inherited.value * 100)}% from{' '}
          {inherited.from ?? 'your Qard settings'}.
          {settings.scheduler === 'fsrs' ? '' : ' Only the FSRS scheduler uses this.'}
        </small>
      </label>
      <label>
        <span>New cards per day</span>
        <input
          type="number"
          min={1}
          max={10000}
          step={1}
          value={limit}
          disabled={busy}
          placeholder="No deck limit"
          onChange={(e) => setLimit(e.target.value)}
        />
        <small className="qard-muted">
          Shared by this deck and its subdecks.
          {above.length
            ? ` ${above.map((entry) => `${entry.deck} allows ${entry.limit}`).join('; ')} as well.`
            : ''}
          {settings.newCardsPerDay
            ? ` Your overall limit of ${settings.newCardsPerDay} still applies.`
            : ''}
        </small>
      </label>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      <div className="qard-actions">
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="qard-primary" disabled={busy} onClick={() => void submit()}>
          Save options
        </button>
      </div>
    </section>
  );
}
