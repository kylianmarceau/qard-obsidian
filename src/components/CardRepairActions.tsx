import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Flag, MoreHorizontal, Pencil } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import { failureDays, REPAIR_FAILURE_DAYS } from '../review/card-repair';

export function CardRepairActions({
  card,
  services,
  edit,
  children,
  disabled = false,
  onBusy,
  changed,
  shortcut = false,
}: {
  card: QardCard;
  services: QardServices;
  edit: () => void;
  children?: ReactNode;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
  changed?: (card: QardCard) => void;
  shortcut?: boolean;
}) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const days = useMemo(
    () => failureDays(data.history, data.states).get(card.id) ?? 0,
    [data.history, data.states, card.id],
  );
  const flagged = !!data.states[card.id]?.needsFixing;
  const often = days >= REPAIR_FAILURE_DAYS;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) {
      return;
    }
    const doc = menu.current?.ownerDocument;
    action.current?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    doc?.addEventListener('pointerdown', outside);
    doc?.addEventListener('focusin', outside);
    doc?.addEventListener('keydown', escape, true);
    return () => {
      doc?.removeEventListener('pointerdown', outside);
      doc?.removeEventListener('focusin', outside);
      doc?.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  async function change(fixed: boolean) {
    if (busy || disabled) {
      return;
    }
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      const [stable] = card.stable ? [card] : await services.writer.ensureStable([card]);
      if (!stable) {
        throw new Error('This card is no longer available.');
      }
      if (fixed) {
        await services.reviews.markFixed(stable.id);
      } else {
        await services.reviews.setNeedsFixing(stable.id, !flagged);
      }
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
      if (stable.id !== card.id) {
        changed?.(stable);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <div className="qard-card-repair" data-qard-keyboard-ignore>
      {(often || flagged) && (
        <div className="qard-repair-notice" role="status">
          <Flag size={14} aria-hidden="true" />
          <div className="qard-repair-copy">
            <strong>{often ? 'Often forgotten' : 'Needs fixing'}</strong>
            {often && (
              <p>
                Forgotten on {days} study days. Try splitting the question or adding a short
                explanation.
              </p>
            )}
          </div>
          <button
            className="qard-repair-fixed"
            disabled={disabled || busy || card.duplicateId}
            onClick={() => void change(true)}
          >
            Mark fixed
          </button>
        </div>
      )}
      <div className="qard-repair-tools">
        {children}
        <button
          className="qard-repair-edit"
          disabled={disabled || busy || card.duplicateId}
          onClick={edit}
        >
          <Pencil size={14} />
          Edit{shortcut && data.settings.keyboardHints && <kbd>E</kbd>}
        </button>
        <div className="qard-card-more" ref={menu}>
          <button
            ref={trigger}
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            disabled={disabled || busy || card.duplicateId}
            onClick={() => setOpen(!open)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            More actions
          </button>
          {open && (
            <div id={menuId} className="qard-repair-menu" role="group" aria-label="Card actions">
              <button
                ref={action}
                disabled={disabled || busy || card.duplicateId}
                aria-pressed={flagged}
                onClick={() => void change(false)}
              >
                <Flag size={14} />
                {flagged ? 'Clear needs fixing' : 'Needs fixing'}
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
