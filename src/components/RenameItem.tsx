import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';

/** Rename a deck or topic in place. The new name is saved to every note that uses it. */
export function RenameItem({
  label,
  current,
  description,
  rename,
  renamed,
  children,
}: {
  label: string;
  current: string;
  description: string;
  rename: (name: string) => Promise<void>;
  renamed?: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(current),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    locked = useRef(false);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    }
  }, [open]);
  function close() {
    setOpen(false);
    setError('');
    trigger.current?.focus();
  }
  async function commit() {
    if (locked.current || !name.trim() || name.trim() === current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await rename(name.trim());
      close();
      renamed?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="qard-delete-item">
      <button
        ref={trigger}
        className={children ? 'qard-text-button' : 'qard-icon-button'}
        title={label}
        aria-label={label}
        onClick={() => {
          setName(current);
          setOpen(true);
        }}
      >
        <Pencil size={15} />
        {children}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="qard-delete-dialog qard-rename-dialog"
          aria-label={label}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              close();
            }
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <h2>{label}</h2>
            <label>
              New name
              <input
                autoFocus
                value={name}
                maxLength={200}
                disabled={busy}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p className="qard-muted">{description}</p>
            {error && (
              <p className="qard-error" role="alert">
                {error}
              </p>
            )}
            <div className="qard-actions">
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                className="qard-primary"
                disabled={busy || !name.trim() || name.trim() === current}
              >
                {busy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
