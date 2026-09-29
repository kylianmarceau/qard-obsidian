import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Maximize2, Minimize2, RotateCcw, CheckCircle2, ExternalLink } from 'lucide-react';
import { StudyCard } from '../components/StudyCard';
import { VoiceAnswer } from '../audio/VoiceAnswer';
import type { QardCard } from '../cards/card-types';
import type { Rating } from '../review/scheduler';
import type { SessionResult } from '../review/session';
import type { QardServices } from './services';
import { ignoresStudyKey } from '../review/keyboard';
const ratings: { rating: Rating; name: string }[] = [{ rating: 1, name: 'Again' }, { rating: 2, name: 'Hard' }, { rating: 3, name: 'Good' }, { rating: 4, name: 'Easy' }];
export function StudyView({ cards, services, exit, repeat }: { cards: QardCard[]; services: QardServices; exit: () => void; repeat: (cards: QardCard[]) => void }) {
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [position, setPosition] = useState(0), [revealed, setRevealed] = useState(false), [focus, setFocus] = useState(saved.settings.autoFocus);
  const [results, setResults] = useState<SessionResult[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [recording, setRecording] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const lock = useRef(false), surface = useRef<HTMLDivElement>(null), mounted = useRef(true), start = useRef(Date.now());
  const card = cards[position];
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; services.setFocus(false); }; }, [services]);
  useEffect(() => { services.setFocus(focus); return () => services.setFocus(false); }, [focus, services]);
  useEffect(() => { surface.current?.focus(); }, [position]);
  useEffect(() => { const off = services.app.workspace.on('active-leaf-change', () => { if (!services.isActive()) setFocus(false); }); return () => services.app.workspace.offref(off); }, [services]);
  async function rate(rating: Rating) {
    if (!card || !revealed || lock.current || recording) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await services.reviews.review(card.id, rating);
      if (mounted.current) { setResults(old => [...old, { cardId: card.id, rating }]); setPosition(i => i + 1); setRevealed(false); }
    } catch (e) { if (mounted.current) setError((e as Error).message || 'Could not save your review. Try again.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const actions = useRef({ rate, focus, revealed, recording, confirmExit }); actions.current = { rate, focus, revealed, recording, confirmExit };
  useEffect(() => {
    const doc = services.host.ownerDocument;
    const handler = (event: KeyboardEvent) => {
      if (!services.isActive() || ignoresStudyKey(event)) return;
      const current = actions.current;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (current.focus) setFocus(false); else if (card) setConfirmExit(v => !v); else exit(); return; }
      if (!card || current.recording || current.confirmExit || lock.current) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'f' || ['1','2','3','4'].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        if (key === ' ') setRevealed(v => !v);
        else if (key === 'f') setFocus(v => !v);
        else if (current.revealed) void current.rate(Number(key) as Rating);
      }
    };
    doc.addEventListener('keydown', handler, true); return () => doc.removeEventListener('keydown', handler, true);
  }, [services, card, exit]);
  const onRecording = useCallback((value: boolean) => setRecording(value), []);
  if (!card) return <div className="qard-summary"><CheckCircle2 size={32}/><h1>Session complete</h1><div className="qard-summary-stats"><div><strong>{results.length} / {cards.length}</strong><span>cards reviewed</span></div><div><strong>{Math.max(1, Math.round((Date.now() - start.current) / 60000))} min</strong><span>elapsed</span></div></div><div className="qard-summary-ratings">{ratings.map(r => <div key={r.rating}><strong>{results.filter(x => x.rating === r.rating).length}</strong><span>{r.name}</span></div>)}</div><div className="qard-actions">{results.some(r => r.rating < 3) && <button onClick={() => repeat(cards.filter(c => results.some(r => r.cardId === c.id && r.rating < 3)))}><RotateCcw size={16}/>Review difficult cards</button>}<button className="qard-primary" onClick={exit}>Done</button></div><button onClick={() => setFocus(false)} hidden={!focus}>Exit focus mode</button></div>;
  return <div className={'qard-study ' + (focus ? 'is-focused' : '')} ref={surface} tabIndex={-1}>
    <div className="qard-study-toolbar"><button onClick={() => { if (focus) setFocus(false); setConfirmExit(true); }}><ArrowLeft size={16}/>End session</button><span>{card.deck} <span>/</span> {card.topic}</span><button aria-label={focus ? 'Exit focus mode' : 'Enter focus mode'} onClick={() => setFocus(!focus)}>{focus ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}{saved.settings.keyboardHints && <kbd>F</kbd>}</button></div>
    {confirmExit && <div className="qard-confirm" role="alert"><p>Leave this session? Your {results.length} completed reviews are saved.</p><button onClick={() => setConfirmExit(false)}>Keep studying</button><button disabled={busy} onClick={exit}>Leave session</button></div>}
    <div className="qard-study-area"><div className="qard-study-progress"><span>{position + 1} <span>/ {cards.length}</span></span></div><progress max={cards.length} value={position} aria-label="Cards reviewed"/>
      <StudyCard key={card.id} card={card} revealed={revealed} services={services}/>
      {saved.settings.audioEnabled && <VoiceAnswer key={card.id} onBusy={onRecording}/>}
      {error && <p className="qard-error" role="alert">{error}</p>}
      <div className="qard-study-controls">{revealed ? <><div className="qard-ratings">{ratings.map(r => <button key={r.rating} className={'qard-rating qard-rating-' + r.rating} disabled={busy || recording || confirmExit} onClick={() => void rate(r.rating)}><strong>{r.name}</strong>{saved.settings.keyboardHints && <kbd>{r.rating}</kbd>}</button>)}</div><button className="qard-hide-answer" onClick={() => setRevealed(false)} disabled={recording}>Hide answer {saved.settings.keyboardHints && <kbd>Space</kbd>}</button></> : <button className="qard-primary qard-reveal" disabled={recording || confirmExit} onClick={() => setRevealed(true)}>Reveal answer {saved.settings.keyboardHints && <kbd>Space</kbd>}</button>}</div>
      <div className="qard-study-foot"><span>{busy ? 'Saving…' : ''}</span><button onClick={() => { setFocus(false); void services.openSource(card).catch(e => setError((e as Error).message)); }}><ExternalLink size={14}/>Open source</button></div>
    </div></div>;
}
