import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Deck, QardCard } from '../cards/card-types';

export function DeleteDeck({ deck, remove }: { deck: Deck; remove: (cards: QardCard[]) => Promise<void> }) {
  const [selection, setSelection] = useState<QardCard[]>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), trigger = useRef<HTMLButtonElement>(null);
  async function confirm() {
    if (!selection || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await remove(selection); setSelection(undefined); }
    catch (e) { setError((e as Error).message); setSelection(undefined); }
    finally { pending.current = false; setBusy(false); }
  }
  function cancel() { if (pending.current) return; setSelection(undefined); trigger.current?.focus(); }
  const noteCount = new Set(selection?.map(card => card.sourceFile)).size;
  return <div className="qard-deck-delete">
    {!selection && <button ref={trigger} className="qard-danger" disabled={busy} onClick={() => { setSelection([...deck.cards]); setError(''); }}><Trash2 size={15}/>Delete deck</button>}
    {selection && <div className="qard-confirm" role="group" aria-label="Confirm deck deletion" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }}>
      <div><strong>Delete “{deck.name}”?</strong><p>Remove all {selection.length} {selection.length === 1 ? 'card' : 'cards'} from {noteCount} Markdown {noteCount === 1 ? 'note' : 'notes'}. Notes and other content stay. This cannot be undone from Qard.</p></div>
      <button autoFocus disabled={busy} onClick={cancel}>Keep deck</button><button className="qard-danger" disabled={busy} onClick={() => void confirm()}>{busy ? 'Deleting…' : 'Delete deck'}</button>
    </div>}
    {error && <p className="qard-error" role="alert">{error}</p>}
  </div>;
}
