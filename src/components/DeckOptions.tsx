import { useId, useMemo, useState } from 'react';
import { getIcon, getIconIds } from 'obsidian';
import { X } from 'lucide-react';
import { canonicalDeck, deckLineage } from '../decks/deck-index';
import { deckLimits, deckRetention, withDeckOptions } from '../decks/deck-options';
import {
  readDeckColor,
  readDeckIcon,
  type DeckOptions as Options,
  type QardSettings,
} from '../settings/settings';
import { DeckBadge } from './DeckBadge';

/** Scheduling overrides and independent appearance choices for one deck. */
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
      own.desiredRetention === undefined ? '' : String(own.desiredRetention * 100),
    ),
    [targetEdited, setTargetEdited] = useState(false),
    [limit, setLimit] = useState(own.newCardsPerDay ? String(own.newCardsPerDay) : ''),
    [icon, setIcon] = useState(own.icon ?? ''),
    [color, setColor] = useState(own.color ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const iconsId = useId();
  const icons = useMemo(() => getIconIds().sort(), []);
  const unavailable = !!icon.trim() && !getIcon(icon.trim());
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
    if (icon.trim() && (!readDeckIcon(icon) || (unavailable && icon.trim() !== own.icon))) {
      setError('Choose an available icon name, or leave it empty for an automatic icon.');
      return;
    }
    if (color.trim() && !readDeckColor(color)) {
      setError('Enter a six-digit hex color such as #729b88, or leave it empty.');
      return;
    }
    const desiredRetention = targetEdited
      ? retention === undefined
        ? undefined
        : retention / 100
      : own.desiredRetention;
    setBusy(true);
    setError('');
    try {
      await save(
        withDeckOptions(settings.deckOptions, name, {
          ...(desiredRetention !== undefined ? { desiredRetention } : {}),
          ...(perDay !== undefined ? { newCardsPerDay: perDay } : {}),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
          ...(color.trim() ? { color: color.trim() } : {}),
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
        <button
          className="qard-icon-button"
          aria-label="Close deck options"
          disabled={busy}
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <p className="qard-muted qard-small">
        Scheduling options apply to this deck and its subdecks, unless a subdeck sets its own.
      </p>
      <label>
        <span>Target retention (%)</span>
        <input
          type="number"
          min={70}
          max={97}
          step="any"
          value={target}
          disabled={busy}
          placeholder={String(inherited.value * 100)}
          onChange={(e) => {
            setTarget(e.target.value);
            setTargetEdited(true);
          }}
        />
        <small className="qard-muted">
          Empty uses {inherited.value * 100}% from {inherited.from ?? 'your Qard settings'}.
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
      <div className="qard-deck-appearance-preview">
        <DeckBadge name={name} icon={icon.trim()} color={color} />
        <span>Appearance for this deck only</span>
      </div>
      <div className="qard-deck-appearance-control">
        <label>
          <span>Icon</span>
          <input
            type="text"
            value={icon}
            list={iconsId}
            placeholder="Automatic"
            maxLength={100}
            disabled={busy}
            onChange={(e) => setIcon(e.target.value)}
          />
          <small className="qard-muted">
            {unavailable && icon.trim() === own.icon
              ? 'This icon is unavailable on this device; the automatic icon is shown.'
              : 'Choose a registered icon name, such as terminal or network.'}
          </small>
        </label>
        <datalist id={iconsId}>
          {icons.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button disabled={busy || !icon} onClick={() => setIcon('')}>
          Automatic icon
        </button>
      </div>
      <div className="qard-deck-appearance-control">
        <label>
          <span>Color</span>
          <input
            type="text"
            value={color}
            placeholder="Automatic"
            maxLength={7}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setColor(e.target.value)}
          />
          <small className="qard-muted">Six-digit hex color; empty uses the automatic color.</small>
        </label>
        <input
          type="color"
          aria-label="Choose a custom deck color"
          value={readDeckColor(color) ?? '#808080'}
          disabled={busy}
          onChange={(e) => setColor(e.target.value)}
        />
        <button disabled={busy || !color} onClick={() => setColor('')}>
          Automatic color
        </button>
      </div>
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
