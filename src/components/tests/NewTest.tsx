import { useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowRight, FileText, X } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { Check, type TestNav } from './common';

/** One prompt box. Sources are optional: flashcard decks and notes. */
export function NewTest({ services, nav, initialPrompt }: { services: QardServices; nav: TestNav; initialPrompt?: string }) {
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const settings = services.reviews.getSnapshot().settings.tests;
  const [prompt, setPrompt] = useState(initialPrompt ?? ''), [useCards, setUseCards] = useState(false), [decks, setDecks] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]), [planFirst, setPlanFirst] = useState(settings.planFirst);
  const [open, setOpen] = useState<'decks' | 'notes' | null>(null), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    return services.app.vault.getMarkdownFiles().filter(f => !notes.includes(f.path) && !f.path.startsWith(settings.folder + '/') && (!q || f.path.toLowerCase().includes(q))).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 6);
  }, [query, notes, services, settings.folder]);
  const chosenDecks = useCards ? decks : [];
  const empty = !chosenDecks.length && !notes.length;
  async function start() {
    setBusy(true); setError('');
    const deckFiles = index.decks.filter(d => chosenDecks.includes(d.name)).flatMap(d => d.files);
    const request = { prompt: prompt.trim(), decks: chosenDecks, notes, sources: [...new Set([...deckFiles, ...notes])] };
    try { planFirst ? nav.plan(await services.tests.plan(request)) : nav.take(await services.tests.generate({ request })); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="qard-new-test">
    <h1>What should this test cover?</h1>
    <div className="qard-composer">
      <textarea aria-label="Test prompt" rows={3} value={prompt} placeholder="e.g. HMM inference, exam style. Focus on what I got wrong last time." onChange={e => setPrompt(e.target.value)}/>
      <div className="qard-composer-bar">
        <div className="qard-sources">
          <button className={'qard-chip' + (useCards ? ' is-on' : '')} aria-pressed={useCards} onClick={() => { setUseCards(!useCards); setOpen(!useCards && !decks.length ? 'decks' : null); }}><Check on={useCards}/>Flashcards</button>
          {useCards && <button className="qard-chip" aria-expanded={open === 'decks'} onClick={() => setOpen(open === 'decks' ? null : 'decks')}>{decks.length === 0 ? 'Choose decks' : decks.length === 1 ? decks[0] : `${decks.length} decks`} ▾</button>}
          {notes.map(path => <span key={path} className="qard-chip is-on"><FileText size={13}/>{path.split('/').pop()!.replace(/\.md$/, '')}<button className="qard-chip-x" aria-label={`Remove ${path}`} onClick={() => setNotes(notes.filter(n => n !== path))}><X size={12}/></button></span>)}
          <button className="qard-chip" aria-expanded={open === 'notes'} onClick={() => setOpen(open === 'notes' ? null : 'notes')}>+ Note</button>
          {open === 'decks' && <div className="qard-popover">{index.decks.length ? index.decks.map(d => <button key={d.name} className="qard-popover-item" aria-pressed={decks.includes(d.name)} onClick={() => setDecks(decks.includes(d.name) ? decks.filter(x => x !== d.name) : [...decks, d.name])}><Check on={decks.includes(d.name)}/><span>{d.name}</span><small>{d.cards.length} cards</small></button>) : <p className="qard-muted">No decks yet.</p>}</div>}
          {open === 'notes' && <div className="qard-popover"><input type="search" autoFocus aria-label="Find a note" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)}/>{matches.map(f => <button key={f.path} className="qard-popover-item" onClick={() => { setNotes([...notes, f.path]); setOpen(null); setQuery(''); }}><span>{f.basename}</span><small>{f.parent?.path === '/' ? '' : f.parent?.path}</small></button>)}{!matches.length && <p className="qard-muted">No matching notes.</p>}</div>}
        </div>
        <div className="qard-composer-go">
          <button className="qard-chip qard-plain" aria-pressed={planFirst} onClick={() => setPlanFirst(!planFirst)}><Check on={planFirst}/>Plan first</button>
          <button className="qard-primary" disabled={busy || (!prompt.trim() && empty)} onClick={() => void start()}>Start<ArrowRight size={15}/></button>
        </div>
      </div>
    </div>
    <p className="qard-muted qard-hint">{empty ? 'No sources selected. The agent will find the relevant notes itself.' : planFirst ? 'The agent drafts a short plan for you to check before it writes the test.' : 'The agent writes the test straight away.'}</p>
    {error && <p className="qard-error" role="alert">{error}</p>}
  </div>;
}
