import { useState, useId, type SyntheticEvent } from 'react';
import { Check } from 'lucide-react';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
export function CardEditor({ services, card, initial, cancel, saved, compact = false }: { services: QardServices; card?: QardCard; initial?: Partial<CardDraft>; cancel: () => void; saved: (card: QardCard) => void; compact?: boolean }) {
  const [front, setFront] = useState(card?.frontMarkdown || initial?.front || ''), [back, setBack] = useState(card?.backMarkdown || initial?.back || '');
  const [deck, setDeck] = useState(card?.deck || initial?.deck || ''), [topic, setTopic] = useState(card?.topic || initial?.topic || 'General');
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId(), path = card?.sourceFile || initial?.sourceFile || `${services.reviews.getSnapshot().settings.cardFolder}/Cards.md`;
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result = card ? await services.writer.edit(card, front, back) : await services.writer.create({ deck, topic, front, back, folder: services.reviews.getSnapshot().settings.cardFolder, sourceFile: initial?.sourceFile });
      saved(result);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className={'qard-editor ' + (compact ? 'qard-editor-compact' : '')}><div className="qard-heading"><h1>{card ? 'Edit card' : 'New card'}</h1></div>
    <form onSubmit={e => void submit(e)}><fieldset disabled={busy}>
      <div className="qard-editor-meta"><label>Deck<input required value={deck} readOnly={!!card} onChange={e => setDeck(e.target.value)} list={id + '-decks'} placeholder="e.g. Computer Networks" maxLength={200}/></label><datalist id={id + '-decks'}>{services.index.getSnapshot().decks.map(d => <option key={d.name} value={d.name}/>)}</datalist><label>Topic<input required value={topic} readOnly={!!card} onChange={e => setTopic(e.target.value)} placeholder="e.g. Transport Layer" maxLength={200}/></label></div>
      {card && <p className="qard-muted">To change deck or topic, edit the source note.</p>}
      <div className="qard-editor-sides"><label>Front<textarea required value={front} onChange={e => setFront(e.target.value)} rows={compact ? 3 : 5} placeholder="Question…"/></label><label>Back<textarea required value={back} onChange={e => setBack(e.target.value)} rows={compact ? 5 : 7} placeholder="Answer…"/></label></div>
      <button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? 'Hide' : 'Show'} preview</button>
      {preview && <div className="qard-editor-rendered"><div><span className="qard-eyebrow">FRONT</span><Markdown text={front} path={path} services={services}/></div><div><span className="qard-eyebrow">BACK</span><Markdown text={back} path={path} services={services}/></div></div>}
      <p className="qard-muted">{initial?.sourceFile ? `Source: ${initial.sourceFile}` : card ? card.sourceFile : `Folder: ${services.reviews.getSnapshot().settings.cardFolder || 'vault root'}`}</p>
      {error && <p role="alert" className="qard-error">{error}</p>}<div className="qard-form-actions"><button type="button" onClick={cancel}>Cancel</button><button className="qard-primary" type="submit"><Check size={17}/>{busy ? 'Saving…' : card ? 'Save changes' : 'Create card'}</button></div>
    </fieldset></form></div>;
}
