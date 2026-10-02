import { useState, useId, useRef, type SyntheticEvent } from 'react';
import { Check, Sparkles } from 'lucide-react';
import type { CardFormat, ImageMask, QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { CardContent } from './CardContent';
import { ImageOcclusion, imageExtensions } from './ImageOcclusion';
export function CardEditor({ services, card, initial, cancel, saved, compact = false, generate }: { services: QardServices; card?: QardCard; initial?: Partial<CardDraft>; cancel: () => void; saved: (card: QardCard) => void; compact?: boolean; generate?: (draft: Partial<CardDraft>) => void }) {
  const [front, setFront] = useState(card?.frontMarkdown || initial?.front || ''), [back, setBack] = useState(card?.backMarkdown || initial?.back || '');
  const [deck, setDeck] = useState(card?.deck || initial?.deck || ''), [topic, setTopic] = useState(card?.topic || initial?.topic || 'General');
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const initialFormat = card?.format || initial?.format;
  const [kind, setKind] = useState<'basic' | 'cloze' | 'occlusion'>(initialFormat?.type || 'basic');
  const [image, setImage] = useState(initialFormat?.type === 'occlusion' ? initialFormat.image : '');
  const [masks, setMasks] = useState<ImageMask[]>(initialFormat?.type === 'occlusion' ? initialFormat.masks : []);
  const frontInput = useRef<HTMLTextAreaElement>(null);
  const format: CardFormat | undefined = kind === 'cloze' ? { type: 'cloze' } : kind === 'occlusion' ? { type: 'occlusion', image, masks } : undefined;
  const images = kind === 'occlusion' ? services.app.vault.getFiles().filter(f => imageExtensions.test(f.path)).sort((a, b) => a.path.localeCompare(b.path)) : [];
  const id = useId(), path = card?.sourceFile || initial?.sourceFile || `${services.reviews.getSnapshot().settings.cardFolder}/Cards.md`;
  function markBlank() {
    const input = frontInput.current;
    if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd;
    const answer = front.slice(start, end) || 'answer';
    setFront(front.slice(0, start) + `{{${answer}}}` + front.slice(end));
    input.focus();
    input.ownerDocument.defaultView?.requestAnimationFrame(() => input.setSelectionRange(start + 2, start + 2 + answer.length));
  }
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result = card ? await services.writer.edit(card, front, back, format ?? null) : await services.writer.create({ deck, topic, front, back, format, folder: services.reviews.getSnapshot().settings.cardFolder, sourceFile: initial?.sourceFile });
      saved(result);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className={'qard-editor ' + (compact ? 'qard-editor-compact ' : '') + (kind === 'occlusion' ? 'qard-editor-occlusion' : '')}><div className="qard-heading"><h1>{card ? 'Edit card' : 'New card'}</h1>{!card && generate && kind !== 'occlusion' && <button disabled={busy} type="button" onClick={() => generate({ deck, topic, ...(format ? { format } : {}), sourceFile: initial?.sourceFile })}><Sparkles size={16}/>Generate with AI</button>}</div>
    <form onSubmit={e => void submit(e)}><fieldset disabled={busy}>
      <div className="qard-editor-meta"><label>Deck<input required value={deck} readOnly={!!card} onChange={e => setDeck(e.target.value)} list={id + '-decks'} placeholder="e.g. Computer Networks" maxLength={200}/></label><datalist id={id + '-decks'}>{services.index.getSnapshot().decks.map(d => <option key={d.name} value={d.name}/>)}</datalist><label>Topic<input required value={topic} readOnly={!!card} onChange={e => setTopic(e.target.value)} placeholder="e.g. Transport Layer" maxLength={200}/></label></div>
      {card && <p className="qard-muted">To change deck or topic, edit the source note.</p>}
      <label className="qard-card-kind">Card type<select value={kind} onChange={e => { const next = e.target.value as typeof kind; setKind(next); setError(''); if (next === 'occlusion' && !front.trim()) setFront('Identify the hidden parts.'); }}><option value="basic">Question and answer</option><option value="cloze">Cloze (fill in the blanks)</option><option value="occlusion">Image occlusion</option></select></label>
      {kind === 'cloze' && <p className="qard-muted">Select text and choose Mark as blank, or type {'{{answer}}'}. Add a hint with {'{{answer::hint}}'}. All blanks on this card are revealed and reviewed together. Works in formulas and code too.</p>}
      <div className="qard-editor-sides"><label>{kind === 'cloze' ? 'Text with blanks' : kind === 'occlusion' ? 'Question' : 'Front'}<textarea ref={frontInput} required value={front} onChange={e => setFront(e.target.value)} rows={kind === 'occlusion' ? 2 : compact ? 3 : 5} placeholder={kind === 'cloze' ? 'TCP provides {{reliable}} delivery.' : 'Question…'}/></label><label>{kind === 'basic' ? 'Back' : 'Explanation (optional)'}<textarea required={kind === 'basic'} value={back} onChange={e => setBack(e.target.value)} rows={kind === 'occlusion' ? 2 : compact ? 5 : 7} placeholder={kind === 'basic' ? 'Answer…' : 'Add context after the answer is revealed…'}/></label></div>
      {kind === 'cloze' && <button type="button" onClick={markBlank}>Mark as blank</button>}
      {kind === 'occlusion' && <div className="qard-occlusion-editor">
        <label>Vault image<select value={image} onChange={e => { setImage(e.target.value); setMasks([]); }}><option value="">Choose an image…</option>{image && !images.some(f => f.path === image) && <option value={image}>{image}</option>}{images.map(f => <option value={f.path} key={f.path}>{f.path}</option>)}</select></label>
        {!images.length && <p className="qard-muted">Add a diagram or screenshot to your vault, then return to this editor.</p>}
        {image && <><p className="qard-muted">Drag over labels to hide them. You can also add a mask and adjust its position and size below. All masks reveal together.</p><ImageOcclusion image={image} masks={masks} path={path} services={services} addMask={mask => setMasks([...masks, mask])}/>
          <button type="button" disabled={masks.length >= 100} onClick={() => setMasks([...masks, { x: 40, y: 40, width: 20, height: 10 }])}>Add mask</button>
          <div className="qard-mask-list">{masks.map((mask, i) => <fieldset key={i} className="qard-mask-row"><legend>Mask {i + 1}</legend>{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} (%)<input aria-label={`Mask ${i + 1} ${key}`} type="number" min={key === 'width' || key === 'height' ? 0.1 : 0} max={100} step="any" required value={Number.isNaN(mask[key]) ? '' : mask[key]} onChange={e => setMasks(masks.map((m, n) => n === i ? { ...m, [key]: e.target.value === '' ? NaN : Number(e.target.value) } : m))}/></label>)}<button type="button" aria-label={`Remove mask ${i + 1}`} onClick={() => setMasks(masks.filter((_, n) => n !== i))}>Remove</button></fieldset>)}</div>
        </>}
      </div>}
      <button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? 'Hide' : 'Show'} preview</button>
      {preview && <div className="qard-editor-rendered"><div><span className="qard-eyebrow">FRONT</span><CardContent front={front} back={back} format={format} revealed={false} path={path} services={services}/></div><div><span className="qard-eyebrow">BACK</span>{format ? <CardContent front={front} back={back} format={format} revealed path={path} services={services}/> : <Markdown text={back} path={path} services={services}/>}</div></div>}
      <p className="qard-muted">{initial?.sourceFile ? `Source: ${initial.sourceFile}` : card ? card.sourceFile : `Folder: ${services.reviews.getSnapshot().settings.cardFolder || 'vault root'}`}</p>
      {error && <p role="alert" className="qard-error">{error}</p>}<div className="qard-form-actions"><button type="button" onClick={cancel}>Cancel</button><button className="qard-primary" type="submit"><Check size={17}/>{busy ? 'Saving…' : card ? 'Save changes' : 'Create card'}</button></div>
    </fieldset></form></div>;
}
