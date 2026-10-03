import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Copy, Check as CheckIcon } from 'lucide-react';
import type { QardServices } from '../../views/services';
import type { AgentRole } from '../../agents/runner';
import { Markdown } from '../Markdown';
import { Waiting } from '../tests/common';
import { AgentLabel } from '../jobs/AgentLabel';

export interface AskItem { q: string; a: string }
export interface CardTarget { deck: string; topic: string; sourceFile?: string }
/** One line of an answer for the folded row: its first sentence-ish, without Markdown markers. */
const preview = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Questions and answers under a lesson step or a test question. Your question sits right-aligned and tinted; the
 * answer runs full width with an accent bar. Only the latest exchange is open; older ones fold to one line and open
 * on click. A question shows the moment it is sent, with "Thinking…" and who is answering; failures stay on its row.
 */
export function AskThread({ services, path, items, busy, error, role, placeholder, ask, dismiss, cancel, card, onCard, title = 'Questions' }: {
  services: QardServices; path: string; items: AskItem[]; busy: boolean; error?: string; role: AgentRole; placeholder: string;
  ask: (question: string) => void; dismiss: () => void; cancel?: () => void;
  /** Where "Make card" puts a card; onCard receives the new card's id (to link it to an objective). */
  card?: CardTarget; onCard?: (cardId: string) => void; title?: string;
}) {
  const [text, setText] = useState(''), [pending, setPending] = useState<string>(), [open, setOpen] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<number>(), [added, setAdded] = useState<Set<number>>(new Set()), [selecting, setSelecting] = useState<number>();
  // The answer has arrived once the list grows; the pending question then becomes part of it.
  useEffect(() => { setPending(undefined); setOpen({}); }, [items.length]);
  const isOpen = (i: number) => open[i] ?? (i === items.length - 1 && !pending);
  const send = (question: string) => { const q = question.trim(); if (!q || busy) return; setPending(q); setText(''); setOpen({}); ask(q); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } };
  const all = items.length > 1;
  return <section className="qard-ask">
    {(items.length > 0 || pending) && <div className="qard-ask-head"><span className="qard-label">{title} · {items.length + (pending ? 1 : 0)}</span>
      {all && <button className="qard-text-button" onClick={() => { const expand = items.some((_, i) => !isOpen(i)); setOpen(Object.fromEntries(items.map((_, i) => [i, expand]))); }}>{items.some((_, i) => !isOpen(i)) ? 'Expand all' : 'Collapse all'}</button>}</div>}
    <div className="qard-ask-list">
      {items.map((item, i) => isOpen(i) ? <div key={i} className="qard-ask-item is-open">
        <button className="qard-ask-q" aria-expanded="true" onClick={() => setOpen({ ...open, [i]: false })}>{item.q}</button>
        <div className="qard-ask-a">
          <Markdown text={item.a} path={path} services={services}/>
          <div className="qard-ask-tools">
            <AgentLabel services={services} role={role}/>
            <span className="qard-spacer"/>
            {card && (added.has(i) ? <span className="is-full qard-small"><CheckIcon size={13}/> Card added</span> : <button className="qard-text-button" onClick={() => setEditing(editing === i ? undefined : i)}>Make card</button>)}
            <button className="qard-text-button" aria-label="Select answer to copy" aria-expanded={selecting === i} onClick={() => setSelecting(selecting === i ? undefined : i)}><Copy size={13}/>Select answer</button>
          </div>
          {selecting === i && <AnswerSelection text={item.a}/>}
          {card && editing === i && <MakeCard services={services} item={item} target={card} done={id => { setAdded(new Set(added).add(i)); setEditing(undefined); if (id) onCard?.(id); }} cancel={() => setEditing(undefined)}/>}
        </div>
      </div> : <button key={i} className="qard-ask-item is-folded" aria-expanded="false" onClick={() => setOpen({ ...open, [i]: true })}>
        <ChevronRight size={14}/><span className="qard-ask-fold"><strong>{item.q}</strong><span className="qard-muted">{preview(item.a)}</span></span>
      </button>)}
      {pending && <div className="qard-ask-item is-open">
        <div className="qard-ask-q">{pending}</div>
        <div className="qard-ask-a">{error
          ? <div className="qard-error" role="alert"><span>{error}</span><button className="qard-text-button" onClick={() => { dismiss(); send(pending); }}>Try again</button><button className="qard-text-button" onClick={() => { dismiss(); setPending(undefined); }}>Dismiss</button></div>
          : <div className="qard-ask-thinking"><Waiting text="Thinking…"><AgentLabel services={services} role={role}/></Waiting>{cancel && <button className="qard-text-button" onClick={cancel}>Cancel</button>}</div>}</div>
      </div>}
    </div>
    <form className="qard-ask-input" onSubmit={e => { e.preventDefault(); send(text); }}>
      <textarea rows={1} aria-label={placeholder} placeholder={placeholder} value={text} disabled={busy} onChange={e => setText(e.target.value)} onKeyDown={onKey}/>
      <button type="submit" className="qard-primary" disabled={busy || !text.trim()}>Ask</button>
    </form>
  </section>;
}

function AnswerSelection({ text }: { text: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, [text]);
  return <div className="qard-answer-selection">
    <p className="qard-muted qard-small">Use your device’s Copy action, or press Ctrl+C / Cmd+C.</p>
    <textarea ref={field} aria-label="Answer to copy" rows={5} readOnly value={text} onFocus={e => e.currentTarget.select()}/>
  </div>;
}

/** A question you had to ask is usually a gap worth a card: front is the question, back the answer, both editable. */
function MakeCard({ services, item, target, done, cancel }: { services: QardServices; item: AskItem; target: CardTarget; done: (cardId?: string) => void; cancel: () => void }) {
  const [front, setFront] = useState(item.q), [back, setBack] = useState(item.a), [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function add() {
    setSaving(true); setError('');
    try { const created = await services.writer.create({ ...target, front, back, folder: services.reviews.getSnapshot().settings.cardFolder }); done(created.id); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  }
  return <div className="qard-panel qard-ask-card">
    <span className="qard-muted qard-small">{target.deck} › {target.topic}</span>
    <textarea aria-label="Card question" rows={2} value={front} onChange={e => setFront(e.target.value)}/>
    <textarea aria-label="Card answer" rows={3} value={back} onChange={e => setBack(e.target.value)}/>
    {error && <p className="qard-error" role="alert">{error}</p>}
    <div className="qard-panel-actions"><button className="qard-text-button" onClick={cancel}>Cancel</button><button className="qard-primary" disabled={saving || !front.trim() || !back.trim()} onClick={() => void add()}>{saving ? 'Adding…' : 'Add card'}</button></div>
  </div>;
}
