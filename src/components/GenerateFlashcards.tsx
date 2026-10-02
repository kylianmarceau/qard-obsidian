import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { FileText, Sparkles, X } from 'lucide-react';
import type { CardDraft } from '../cards/card-writer';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { AgentLabel } from './jobs/AgentLabel';
import { JobControls } from './jobs/JobControls';
import { Check, JobError, Waiting } from './tests/common';

export function GenerateFlashcards({ services, initial, back, openDeck }: { services: QardServices; initial?: Partial<CardDraft>; back: () => void; openDeck: (deck: string) => void }) {
  const service = services.flashcards!;
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [deck, setDeck] = useState(initial?.deck ?? ''), [topic, setTopic] = useState(initial?.topic ?? 'General');
  const [prompt, setPrompt] = useState('');
  const [notes, setNotes] = useState<string[]>(initial?.sourceFile ? [initial.sourceFile] : []);
  const [notesOpen, setNotesOpen] = useState(false), [query, setQuery] = useState(''), [starting, setStarting] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(false);
  const id = useId(), excluded = services.reviews.getSnapshot().settings.tests.folder.replace(/\/+$/, '');
  const matches = useMemo(() => services.app.vault.getMarkdownFiles().filter(f => !notes.includes(f.path) && !f.path.startsWith(excluded + '/') && f.path.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8), [services, notes, query, excluded]);
  const run = async () => {
    setStarting(true); setError('');
    try { await service.start({ deck, topic, prompt, notes }); }
    catch (e) { setError((e as Error).message); }
    finally { setStarting(false); }
  };
  const batch = state.batch, cards = batch?.cards ?? [], pending = cards.filter(c => c.selected && !c.added), added = cards.filter(c => c.added).length;
  const running = !!state.job && !state.job.error;
  const editRequest = async () => {
    if (batch) { setDeck(batch.request.deck); setTopic(batch.request.topic); setPrompt(batch.request.prompt); setNotes(batch.request.notes); }
    setError('');
    try { await service.clear(); } catch (e) { setError((e as Error).message); }
  };
  return <div className="qard-editor qard-generate">
    <div className="qard-heading"><div><h1>{cards.length ? 'Review flashcards' : 'Generate flashcards'}</h1><p>{cards.length ? `${batch!.request.deck} › ${batch!.request.topic} · ${added} of ${cards.length} added` : 'Describe what you want to remember, and let AI draft the cards.'}</p></div><button onClick={back}>Back to decks</button></div>
    {state.loading ? <Waiting text="Loading saved drafts…"/> : state.saving && !cards.length ? <Waiting text="Saving request…"/> : running ? <div className="qard-panel"><Waiting text="Generating flashcards…"><AgentLabel services={services} role="writer"/></Waiting><JobControls services={services} job={state.job} cancel={() => service.cancel()}/><p className="qard-muted">You can leave this screen and return from Decks → Generate with AI. Qard will tell you when the cards are ready.</p></div> : !cards.length && !batch ? <form onSubmit={e => { e.preventDefault(); void run(); }}><fieldset disabled={starting}>
      <div className="qard-editor-meta"><label>Deck<input required maxLength={200} value={deck} list={id + '-decks'} onChange={e => setDeck(e.target.value)} placeholder="e.g. Computer Networks"/></label><datalist id={id + '-decks'}>{index.decks.map(d => <option key={d.name} value={d.name}/>)}</datalist><label>Topic<input required maxLength={200} value={topic} onChange={e => setTopic(e.target.value)}/></label></div>
      <div className="qard-composer"><textarea aria-label="Flashcard prompt" maxLength={10000} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Focus on TCP congestion control. Include definitions and short examples."/>
        <div className="qard-composer-bar"><div className="qard-sources">{notes.map(path => <span key={path} className="qard-chip is-on"><FileText size={13}/>{path.split('/').pop()!.replace(/\.md$/, '')}<button type="button" className="qard-chip-x" aria-label={`Remove ${path}`} onClick={() => setNotes(notes.filter(n => n !== path))}><X size={12}/></button></span>)}<button type="button" className="qard-chip" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>+ Note</button>
          {notesOpen && <div className="qard-popover"><input type="search" autoFocus aria-label="Find a note" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)}/>{matches.map(f => <button type="button" key={f.path} className="qard-popover-item" onClick={() => { setNotes([...notes, f.path]); setNotesOpen(false); setQuery(''); }}><span>{f.basename}</span><small>{f.path}</small></button>)}{!matches.length && <p className="qard-muted">No matching notes.</p>}</div>}
        </div></div>
      </div><p className="qard-muted">{notes.length ? 'The writer reads your selected notes first.' : 'Without selected notes, the writer finds relevant notes in your vault.'} AI chooses how many cards the material needs. Review and edit them before adding.</p><AgentLabel services={services} role="writer"/>
      <div className="qard-form-actions"><button type="button" onClick={back}>Cancel</button><button type="submit" className="qard-primary" disabled={!deck.trim() || (!prompt.trim() && !notes.length)}><Sparkles size={16}/>{starting ? 'Starting…' : 'Generate cards'}</button></div>
    </fieldset></form> : null}
    <JobError job={state.job} retry={!cards.length ? () => void service.generate() : undefined}/>
    {!cards.length && batch && !running && <div className="qard-form-actions"><button disabled={starting || state.saving} onClick={() => void editRequest()}>Edit request</button></div>}
    {cards.length > 0 && <>
      <div className="qard-generation-tools"><button disabled={state.saving} onClick={() => { const on = pending.length !== cards.filter(c => !c.added).length; cards.filter(c => !c.added).forEach(c => service.updateCard(c.id, { selected: on })); }}>{pending.length === cards.filter(c => !c.added).length ? 'Deselect all' : 'Select all'}</button><button aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Edit cards' : 'Preview cards'}</button><span className="qard-spacer"/><button className="qard-primary" disabled={state.saving || !pending.length} onClick={() => void service.addSelected()}>{state.saving ? 'Adding…' : `Add selected (${pending.length})`}</button></div>
      {cards.map((c, i) => <article key={c.id} className={'qard-generation-card' + (!c.selected && !c.added ? ' is-skipped' : '')}>
        <div className="qard-generation-card-head"><button aria-label={`Select card ${i + 1}`} aria-pressed={c.selected} disabled={state.saving || c.added} onClick={() => service.updateCard(c.id, { selected: !c.selected })}><Check on={c.selected}/>Card {i + 1}</button>{c.added && <span className="qard-muted">✓ Added</span>}</div>
        {preview || c.added ? <div className="qard-editor-rendered"><div><span className="qard-eyebrow">FRONT</span><Markdown text={c.front} path={c.source} services={services}/></div><div><span className="qard-eyebrow">BACK</span><Markdown text={c.back} path={c.source} services={services}/></div></div> : <div className="qard-editor-sides"><label>Front<textarea aria-label={`Front of card ${i + 1}`} rows={3} value={c.front} disabled={state.saving} onChange={e => service.updateCard(c.id, { front: e.target.value })}/></label><label>Back<textarea aria-label={`Back of card ${i + 1}`} rows={4} value={c.back} disabled={state.saving} onChange={e => service.updateCard(c.id, { back: e.target.value })}/></label></div>}
        {c.source && <button className="qard-link qard-small" onClick={() => void services.app.workspace.openLinkText(c.source, '', true)}><FileText size={13}/>{c.source}</button>}
      </article>)}
      <div className="qard-form-actions"><button disabled={state.saving} onClick={() => void service.clear().catch(e => setError((e as Error).message))}>Generate another batch</button>{added > 0 && <button className="qard-primary" disabled={state.saving} onClick={() => openDeck(batch!.request.deck)}>Open deck</button>}</div>
    </>}
    {(error || state.error) && <p className="qard-error" role="alert">{error || state.error}</p>}
  </div>;
}
