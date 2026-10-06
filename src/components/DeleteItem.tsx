import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

/** One reusable, explicit confirmation for deleting a group of study material. */
export function DeleteItem({
  label,
  description,
  remove,
  deleted,
}: {
  label: string;
  description: string;
  remove: () => Promise<void>;
  deleted?: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null),
    locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirm) {
      dialog.current?.showModal();
    }
  }, [confirm]);
  function close() {
    setConfirm(false);
    setError('');
    trigger.current?.focus();
  }
  async function commit() {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await remove();
      close();
      deleted?.();
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
        className="qard-icon-button"
        title={label}
        aria-label={label}
        onClick={() => setConfirm(true)}
      >
        <Trash2 size={16} />
      </button>
      {confirm && (
        <dialog
          ref={dialog}
          className="qard-delete-dialog"
          role="alertdialog"
          aria-label={label}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              close();
            }
          }}
        >
          <h2>{label}?</h2>
          <p>{description}</p>
          {error && (
            <p className="qard-error" role="alert">
              {error}
            </p>
          )}
          <div className="qard-actions">
            <button autoFocus disabled={busy} onClick={close}>
              Cancel
            </button>
            <button className="qard-danger" disabled={busy} onClick={() => void commit()}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
