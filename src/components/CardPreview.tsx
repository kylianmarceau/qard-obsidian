import { CardSourceLinks } from './CardSourceLinks';
import { useState } from 'react';
import { ExternalLink, Pencil, Trash2, Play } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { CardEditor } from './CardEditor';
export function CardPreview({ card, services, back, study, changed }: { card: QardCard; services: QardServices; back: () => void; study: () => void; changed: (card: QardCard) => void }) {
  const [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (editing) return <CardEditor services={services} card={card} cancel={() => setEditing(false)} saved={next => { changed(next); setEditing(false); }}/>;
  async function remove() { setBusy(true); try { await services.writer.delete(card); back(); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <><div className="qard-preview-toolbar"><div className="qard-actions"><button onClick={() => { void services.openSource(card).catch(e => setError((e as Error).message)); }} title={card.sourceFile}><ExternalLink size={15}/>Source</button><button disabled={card.duplicateId} onClick={() => setEditing(true)}><Pencil size={15}/>Edit</button><button className="qard-icon-button" aria-label="Delete card" title="Delete card" disabled={card.duplicateId} onClick={() => setConfirm(true)}><Trash2 size={16}/></button></div><button className="qard-primary" disabled={card.duplicateId} onClick={study}><Play size={15}/>Study</button></div>
    <div className="qard-card-preview">
      <div className="qard-preview-side"><span className="qard-eyebrow">Front</span><Markdown text={card.frontMarkdown} path={card.sourceFile} services={services}/></div><div className="qard-preview-side qard-preview-answer"><span className="qard-eyebrow">Back</span><Markdown text={card.backMarkdown} path={card.sourceFile} services={services}/></div>
    </div>
    {services.sourceSync && <CardSourceLinks card={card} services={services} changed={changed}/>}
    {card.duplicateId && <p className="qard-error">This card shares an ID with another card. Open the source and remove the copied ID to give it a fresh identity.</p>}
    {confirm && <div className="qard-confirm" role="alert"><div><strong>Delete this card from its Markdown note?</strong><p>Only this callout and its ID will be removed. This cannot be undone from Qard.</p></div><button disabled={busy} onClick={() => setConfirm(false)}>Keep card</button><button className="qard-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete card'}</button></div>}
    {error && <p role="alert" className="qard-error">{error}</p>}</>;
}
