import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { QardServices } from '../../views/services';

/** Available on every screen for a selected test, including generation and review. */
export function DeleteTest({ services, folder, deleted }: { services: QardServices; folder: string; deleted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try { await services.tests.remove(folder); deleted(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="qard-test-delete">
    <button className="qard-icon-button" title="Move test to trash" aria-label="Delete test" disabled={busy} onClick={() => void remove()}><Trash2 size={16}/></button>
    {error && <span className="qard-error" role="alert">{error}</span>}
  </div>;
}
