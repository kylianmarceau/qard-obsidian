import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getIconIds } from 'obsidian';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
import { readDeckColor } from '../settings/settings';
import { DeckBadge } from './DeckBadge';

export function DeckAppearance({
  name,
  icon,
  color,
  unavailable,
  busy,
  onIcon,
  onColor,
}: {
  name: string;
  icon: string;
  color: string;
  unavailable: boolean;
  busy: boolean;
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const icons = useMemo(
    () => [...new Set(getIconIds().map((icon) => icon.replace(/^lucide-/, '')))].sort(),
    [],
  );
  const matches = icons.filter((icon) => icon.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const element = anchor.current;
    if (!open || !element) {
      return;
    }
    const owner = element.ownerDocument;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(element)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    owner.addEventListener('pointerdown', outside);
    owner.addEventListener('keydown', escape);
    return () => {
      owner.removeEventListener('pointerdown', outside);
      owner.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <fieldset className="qard-deck-appearance">
      <legend>Appearance</legend>
      <div className="qard-deck-appearance-layout">
        <div className="qard-deck-appearance-preview">
          <DeckBadge name={name} icon={icon.trim()} color={color} />
        </div>
        <div className="qard-deck-appearance-fields">
          <div className="qard-deck-appearance-field">
            <label htmlFor={`${id}-icon`}>Icon</label>
            {unavailable && (
              <p className="qard-muted">
                This icon is unavailable on this device; the automatic icon is shown.
              </p>
            )}
            <div className="qard-deck-appearance-control">
              <div className="qard-deck-icon-anchor" ref={anchor}>
                <button
                  id={`${id}-icon`}
                  ref={trigger}
                  aria-label="Choose deck icon"
                  aria-expanded={open}
                  aria-controls={`${id}-picker`}
                  disabled={busy}
                  onClick={() => setOpen(!open)}
                >
                  <span>{icon || 'Automatic'}</span>
                  <ChevronDown size={16} />
                </button>
                {open && (
                  <div className="qard-deck-icon-picker" id={`${id}-picker`}>
                    <label className="qard-search">
                      <Search size={16} />
                      <input
                        ref={search}
                        type="search"
                        aria-label="Find icons"
                        placeholder="Find icons…"
                        value={query}
                        disabled={busy}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="qard-deck-icon-grid">
                      {matches.map((choice) => (
                        <button
                          key={choice}
                          className="qard-icon-button"
                          title={choice}
                          aria-label={`Use ${choice} icon`}
                          aria-pressed={icon.replace(/^lucide-/, '') === choice}
                          disabled={busy}
                          onClick={() => {
                            onIcon(choice);
                            setOpen(false);
                            trigger.current?.focus();
                          }}
                        >
                          <DeckBadge name={name} icon={choice} />
                        </button>
                      ))}
                    </div>
                    {!matches.length && (
                      <p className="qard-muted">No icons found. Try another name.</p>
                    )}
                  </div>
                )}
              </div>
              <button
                className="qard-icon-button"
                aria-label="Automatic icon"
                title="Automatic icon"
                disabled={busy || !icon}
                onClick={() => onIcon('')}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
          <div className="qard-deck-appearance-field">
            <label htmlFor={`${id}-color`}>Color</label>
            <div className="qard-deck-appearance-control">
              <input
                id={`${id}-color`}
                aria-label="Color"
                type="text"
                value={color}
                placeholder="Automatic"
                maxLength={7}
                spellCheck={false}
                disabled={busy}
                onChange={(e) => onColor(e.target.value)}
              />
              {color.trim() ? (
                <input
                  type="color"
                  aria-label="Choose a custom deck color"
                  value={readDeckColor(color) ?? '#808080'}
                  disabled={busy}
                  onChange={(e) => onColor(e.target.value)}
                />
              ) : (
                <button
                  className="qard-icon-button"
                  aria-label="Use custom color"
                  title="Use custom color"
                  disabled={busy}
                  onClick={() => onColor('#808080')}
                >
                  <span className="qard-deck-color-swatch" />
                </button>
              )}
              <button
                className="qard-icon-button"
                aria-label="Automatic color"
                title="Automatic color"
                disabled={busy || !color}
                onClick={() => onColor('')}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <p className="qard-muted">Six-digit hex color; empty uses the automatic color.</p>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
