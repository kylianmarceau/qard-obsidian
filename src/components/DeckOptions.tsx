import { useId, useMemo, useState } from 'react';
import { getIcon, getIconIds } from 'obsidian';
import { Info, X } from 'lucide-react';
import { canonicalDeck, deckLineage, deckPath } from '../decks/deck-index';
import { deckLimits, deckRetention, withDeckOptions } from '../decks/deck-options';
import {
  readDeckColor,
  readDeckIcon,
  type DeckOptions as Options,
  type QardSettings,
} from '../settings/settings';
import { DeckAppearance } from './DeckAppearance';

/** Scheduling overrides and independent appearance choices for one deck. */
export function DeckOptions({
  deck,
  badgeName,
  settings,
  save,
  close,
}: {
  deck: string;
  badgeName?: string;
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
    [iconDraft, setIcon] = useState<string>(),
    [colorDraft, setColor] = useState<string>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const icon = iconDraft ?? own.icon ?? '',
    color = colorDraft ?? own.color ?? '';
  const id = useId();
  const icons = useMemo(() => getIconIds().sort(), []);
  const availableIcons = useMemo(() => new Set(icons), [icons]);
  const iconId = icon.trim();
  const unavailable = useMemo(
    () =>
      !!iconId &&
      !availableIcons.has(iconId) &&
      !availableIcons.has(`lucide-${iconId}`) &&
      // Legacy aliases accepted by getIcon are not all listed in getIconIds.
      !getIcon(iconId),
    [availableIcons, iconId],
  );
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
        <div>
          <h2>Deck options</h2>
          <p className="qard-deck-options-name">{name}</p>
        </div>
        <button
          className="qard-icon-button"
          aria-label="Close deck options"
          disabled={busy}
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <fieldset className="qard-deck-settings-section">
        <legend>Scheduling</legend>
        <div className="qard-deck-setting">
          <div className="qard-deck-setting-copy">
            <label htmlFor={`${id}-retention`}>Target retention (%)</label>
            <p className="qard-muted" id={`${id}-retention-help`}>
              Empty uses {inherited.value * 100}% from {inherited.from ?? 'your Qard settings'}.
              {settings.scheduler === 'fsrs' ? '' : ' Only the FSRS scheduler uses this.'}
            </p>
          </div>
          <input
            id={`${id}-retention`}
            aria-describedby={`${id}-retention-help`}
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
        </div>
        <div className="qard-deck-setting">
          <div className="qard-deck-setting-copy">
            <label htmlFor={`${id}-limit`}>New cards per day</label>
            <p className="qard-muted" id={`${id}-limit-help`}>
              Shared by this deck and its subdecks.
              {above.length
                ? ` ${above.map((entry) => `${entry.deck} allows ${entry.limit}`).join('; ')} as well.`
                : ''}
              {settings.newCardsPerDay
                ? ` Your overall limit of ${settings.newCardsPerDay} still applies.`
                : ''}
            </p>
          </div>
          <input
            id={`${id}-limit`}
            aria-describedby={`${id}-limit-help`}
            type="number"
            min={1}
            max={10000}
            step={1}
            value={limit}
            disabled={busy}
            placeholder="No deck limit"
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
      </fieldset>
      <DeckAppearance
        name={badgeName ?? deckPath(name).at(-1) ?? name}
        icon={icon}
        color={color}
        unavailable={unavailable}
        busy={busy}
        onIcon={setIcon}
        onColor={setColor}
      />
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      <footer className="qard-actions qard-deck-options-footer">
        <span
          className="qard-deck-options-info"
          title="Scheduling applies to this deck and nested decks unless they set their own options. Appearance applies only to this deck."
          aria-label="Scheduling applies to this deck and nested decks unless they set their own options. Appearance applies only to this deck."
        >
          <Info size={16} />
        </span>
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="qard-primary" disabled={busy} onClick={() => void submit()}>
          Save options
        </button>
      </footer>
    </section>
  );
}
