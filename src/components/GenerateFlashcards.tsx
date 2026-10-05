import { studyNotes } from '../vault-access';
import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowRight, FileText, Folder, X } from 'lucide-react';
import type { CardDraft } from '../cards/card-writer';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { AgentLabel } from './jobs/AgentLabel';
import { JobControls } from './jobs/JobControls';
import { Check, JobError, Waiting } from './tests/common';
import { folderNotes, resolveTestNotes, testFolders, testNotePaths } from '../tests/test-sources';
import { flashcardDestination, flashcardTopics } from '../cards/generation-service';

export function GenerateFlashcards({ services, initial, back, openDeck }: { services: QardServices; initial?: Partial<CardDraft>; back: () => void; openDeck: (deck: string) => void }) {
  const service = services.flashcards!;
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const [context, setContext] = useState({ deck: initial?.deck, topic: initial?.topic });
  const [prompt, setPrompt] = useState('');
  const [notes, setNotes] = useState<string[]>(initial?.sourceFile ? [initial.sourceFile] : []);
  const [folders, setFolders] = useState<string[]>([]);
  const [open, setOpen] = useState<'notes' | 'folders' | null>(null), [query, setQuery] = useState(''), [starting, setStarting] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(false);
  const id = useId(), excluded = services.reviews.getSnapshot().settings.tests.folder;
  const files = useMemo(() => {
    const all = studyNotes(services.app), allowed = new Set(testNotePaths(all.map(f => f.path), excluded));
    return all.filter(f => allowed.has(f.path));
  }, [services, excluded, index.revision]);
  const paths = useMemo(() => files.map(f => f.path), [files]);
  const attached = resolveTestNotes(paths, notes, folders), covered = new Set(folderNotes(paths, folders));
  const matches = files.filter(f => !notes.includes(f.path) && !covered.has(f.path) && f.path.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 6);
  const matchingFolders = testFolders(paths).filter(f => !folders.includes(f.path) && f.path.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  const run = async () => {
    if (starting) return;
    setStarting(true); setError('');
    try {
      const latest = testNotePaths(studyNotes(services.app).map(f => f.path), excluded);
      const selected = resolveTestNotes(latest, notes, folders);
      if (!prompt.trim() && !selected.length) throw new Error('The selected sources no longer contain any Markdown notes. Choose another source or describe the cards.');
      await service.start({ ...context, prompt, notes: selected, ...(folders.length ? { folders } : {}) });
    }
    catch (e) { setError((e as Error).message); }
    finally { setStarting(false); }
  };
  const batch = state.batch, cards = batch?.cards ?? [], pending = cards.filter(c => c.selected && !c.added), added = cards.filter(c => c.added).length;
  const destination = batch ? flashcardDestination(batch) : { deck: '', topic: '' };
  const topics = batch ? flashcardTopics(batch) : [];
  const sourceCount = new Set(cards.map(c => c.source).filter(Boolean)).size;
  const destinationLocked = !!batch?.destinationLocked || added > 0;
  const running = !!state.job && !state.job.error;
  const editRequest = async () => {
    if (batch) { setContext({ deck: batch.request.deck, topic: batch.request.topic }); setPrompt(batch.request.prompt); setNotes(batch.request.notes); setFolders(batch.request.folders ?? []); }
    setError('');
    try { await service.clear(); } catch (e) { setError((e as Error).message); }
  };
  const composing = !state.loading && !batch;
  return <div className={composing ? 'qard-new-test qard-new-flashcards' : 'qard-editor qard-generate'}>
    {composing ? <h1>What should these flashcards cover?</h1> : <div className="qard-heading"><div><h1>{cards.length ? 'Review flashcards' : 'Generate flashcards'}</h1>{cards.length > 0 && <p>{destination.deck} › {topics.length > 1 ? `${topics.length} topics` : topics[0] || destination.topic} · {added} of {cards.length} added</p>}</div><button onClick={back}>Back to decks</button></div>}
    {state.loading ? <Waiting text="Loading saved drafts…"/> : state.saving && !cards.length ? <Waiting text="Saving request…"/> : running ? <div className="qard-panel"><Waiting text="Generating flashcards…"><AgentLabel services={services} role="writer"/></Waiting><JobControls services={services} job={state.job} cancel={() => service.cancel()}/><p className="qard-muted">You can leave this screen and return from the Generating flashcards row on Decks. Qard will tell you when the cards are ready.</p></div> : !cards.length && !batch ? <form onSubmit={e => { e.preventDefault(); void run(); }}><fieldset className="qard-flashcard-request" disabled={starting}>
      <div className="qard-composer"><textarea aria-label="Flashcard prompt" maxLength={10000} rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. TCP congestion control. Focus on the key ideas and what I got wrong last time."/>
        <div className="qard-composer-bar"><div className="qard-sources">
          {notes.filter(path => !covered.has(path)).map(path => <span key={path} className="qard-chip is-on"><FileText size={13}/>{path.split('/').pop()!.replace(/\.md$/, '')}<button type="button" className="qard-chip-x" aria-label={`Remove ${path}`} onClick={() => setNotes(notes.filter(n => n !== path))}><X size={12}/></button></span>)}
          {folders.map(path => <span key={path} className="qard-chip qard-folder-chip is-on" title={path}><Folder size={13}/><span>{path.split('/').pop()}</span><small>{folderNotes(paths, [path]).length} notes</small><button type="button" className="qard-chip-x" aria-label={`Remove folder ${path}`} onClick={() => setFolders(folders.filter(f => f !== path))}><X size={12}/></button></span>)}
          <button type="button" className="qard-chip" aria-expanded={open === 'notes'} onClick={() => { setOpen(open === 'notes' ? null : 'notes'); setQuery(''); }}>+ Note</button>
          <button type="button" className="qard-chip" aria-expanded={open === 'folders'} onClick={() => { setOpen(open === 'folders' ? null : 'folders'); setQuery(''); }}>+ Folder</button>
          {open === 'notes' && <div className="qard-popover"><input type="search" autoFocus aria-label="Find a note" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)}/>{matches.map(f => <button type="button" key={f.path} className="qard-popover-item" onClick={() => { setNotes([...notes, f.path]); setOpen(null); setQuery(''); }}><span>{f.basename}</span><small>{f.parent?.path === '/' ? '' : f.parent?.path}</small></button>)}{!matches.length && <p className="qard-muted">No matching notes.</p>}</div>}
          {open === 'folders' && <div className="qard-popover qard-folder-picker"><input type="search" autoFocus aria-label="Find a course folder" placeholder="Find a course folder…" value={query} onChange={e => setQuery(e.target.value)}/><p className="qard-muted qard-small">Includes Markdown notes in subfolders.</p>{matchingFolders.map(f => <button type="button" key={f.path} className="qard-popover-item" aria-label={`Attach folder ${f.path}, ${f.count} ${f.count === 1 ? 'note' : 'notes'}`} onClick={() => { setFolders([...folders, f.path]); setOpen(null); setQuery(''); }}><Folder size={14}/><span>{f.path}</span><small>{f.count} {f.count === 1 ? 'note' : 'notes'}</small></button>)}{!matchingFolders.length && <p className="qard-muted">No matching folders with Markdown notes.</p>}</div>}
        </div><div className="qard-composer-go"><button type="submit" className="qard-primary" disabled={starting || (!prompt.trim() && !attached.length)}>{starting ? 'Starting…' : 'Start'}<ArrowRight size={15}/></button></div></div>
      </div>
      {attached.length > 0 && <p className="qard-muted qard-hint" role="status">{attached.length} {attached.length === 1 ? 'note' : 'notes'} attached{folders.length ? ', including subfolders' : ''}.</p>}
      <p className="qard-muted qard-hint">{attached.length ? 'The AI reads your selected notes first. Review the cards before adding them.' : 'No sources selected. The AI will find the relevant notes itself.'}</p>
    </fieldset></form> : null}
    <JobError job={state.job} retry={!cards.length ? () => void service.generate() : undefined}/>
    {!cards.length && batch && !running && <div className="qard-form-actions"><button disabled={starting || state.saving} onClick={() => void editRequest()}>Edit request</button></div>}
    {cards.length > 0 && <>
      <div className="qard-editor-meta"><label>Save to deck<input aria-label="Save to deck" maxLength={200} list={id + '-decks'} disabled={state.saving || destinationLocked} value={destination.deck} onChange={e => service.updateDestination({ deck: e.target.value })}/></label><datalist id={id + '-decks'}>{index.decks.map(d => <option key={d.name} value={d.name}/>)}</datalist><label>{topics.length > 1 ? 'Topic for all cards' : 'Topic'}<input aria-label="Topic" placeholder={topics.length > 1 ? 'Enter a name to combine topics' : undefined} maxLength={200} disabled={state.saving || destinationLocked} value={topics.length === 1 ? topics[0] : ''} onChange={e => service.updateDestination({ topic: e.target.value })}/></label></div>
      <p className="qard-muted qard-generation-destination-hint">{destinationLocked ? 'Deck and topics are fixed for this batch. You can still edit remaining questions and answers.' : 'Review the deck and each card’s topic before adding them.'}</p>
      <div className="qard-generation-tools">{sourceCount > 1 && <button disabled={state.saving || destinationLocked} onClick={() => service.useTopicsFromNotes()}>One topic per note</button>}<button disabled={state.saving} onClick={() => { const on = pending.length !== cards.filter(c => !c.added).length; cards.filter(c => !c.added).forEach(c => service.updateCard(c.id, { selected: on })); }}>{pending.length === cards.filter(c => !c.added).length ? 'Deselect all' : 'Select all'}</button><button aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Edit cards' : 'Preview cards'}</button><span className="qard-spacer"/><button className="qard-primary" disabled={state.saving || !pending.length} onClick={() => void service.addSelected()}>{state.saving ? 'Adding…' : `Add selected (${pending.length})`}</button></div>
      {cards.map((c, i) => <article key={c.id} className={'qard-generation-card' + (!c.selected && !c.added ? ' is-skipped' : '')}>
        <div className="qard-generation-card-head"><button aria-label={`Select card ${i + 1}`} aria-pressed={c.selected} disabled={state.saving || c.added} onClick={() => service.updateCard(c.id, { selected: !c.selected })}><Check on={c.selected}/>Card {i + 1}</button>{c.added && <span className="qard-muted">✓ Added</span>}</div>
        <label className="qard-generation-card-topic">Topic<input aria-label={`Topic of card ${i + 1}`} maxLength={200} disabled={state.saving || destinationLocked} value={c.topic ?? destination.topic} onChange={e => service.updateCard(c.id, { topic: e.target.value })}/></label>
        {preview || c.added ? <div className="qard-editor-rendered"><div><span className="qard-eyebrow">FRONT</span><Markdown text={c.front} path={c.source} services={services}/></div><div><span className="qard-eyebrow">BACK</span><Markdown text={c.back} path={c.source} services={services}/></div></div> : <div className="qard-editor-sides"><label>Front<textarea aria-label={`Front of card ${i + 1}`} rows={3} value={c.front} disabled={state.saving} onChange={e => service.updateCard(c.id, { front: e.target.value })}/></label><label>Back<textarea aria-label={`Back of card ${i + 1}`} rows={4} value={c.back} disabled={state.saving} onChange={e => service.updateCard(c.id, { back: e.target.value })}/></label></div>}
        {c.source && <button className="qard-link qard-small" onClick={() => void services.app.workspace.openLinkText(c.source, '', true)}><FileText size={13}/>{c.source}</button>}
      </article>)}
      <div className="qard-form-actions"><button disabled={state.saving} onClick={() => void service.clear().catch(e => setError((e as Error).message))}>Generate another batch</button>{added > 0 && <button className="qard-primary" disabled={state.saving} onClick={() => openDeck(destination.deck)}>Open deck</button>}</div>
    </>}
    {(error || state.error) && <p className="qard-error" role="alert">{error || state.error}</p>}
  </div>;
}
