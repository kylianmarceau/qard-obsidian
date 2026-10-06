import type { SavedSession } from '../review/saved-session';
import { reviewIntervals } from '../review/fsrs-scheduler';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  RotateCcw,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { StudyCard } from '../components/StudyCard';
import { VoiceAnswer } from '../audio/VoiceAnswer';
import type { QardCard } from '../cards/card-types';
import type { Rating } from '../review/scheduler';
import type { SessionResult, SessionStyle } from '../review/session';
import type { QardServices } from './services';
import { ignoresStudyKey } from '../review/keyboard';
const ratings: { rating: Rating; name: string; hint: string }[] = [
  { rating: 1, name: 'Again', hint: 'I forgot the answer' },
  { rating: 2, name: 'Hard', hint: 'I recalled it with effort' },
  { rating: 3, name: 'Good', hint: 'I recalled it' },
  { rating: 4, name: 'Easy', hint: 'I recalled it immediately' },
];
export function StudyView({
  cards,
  services,
  exit,
  repeat,
  style = 'normal',
  session,
  notice,
}: {
  cards: QardCard[];
  services: QardServices;
  exit: () => void;
  repeat: (cards: QardCard[]) => void | Promise<void>;
  style?: SessionStyle;
  session?: SavedSession;
  notice?: string;
}) {
  const cram = style === 'cram';
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [position, setPosition] = useState(session?.position ?? 0),
    [revealed, setRevealed] = useState(false),
    [focus, setFocus] = useState(saved.settings.autoFocus);
  const [results, setResults] = useState<SessionResult[]>(session?.results ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recording, setRecording] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const lock = useRef(false),
    surface = useRef<HTMLDivElement>(null),
    mounted = useRef(true),
    start = useRef(Date.now());
  const navigationLock = useRef(false);
  const card = cards[position];
  const intervals = useMemo(
    () =>
      !cram && card && revealed && saved.settings.scheduling && saved.settings.scheduler === 'fsrs'
        ? reviewIntervals(
            card.id,
            saved.states[card.id],
            Date.now(),
            saved.settings.desiredRetention,
          )
        : undefined,
    [card, revealed, saved, cram],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      services.setFocus(false);
    };
  }, [services]);
  useEffect(() => {
    services.setFocus(focus);
    return () => services.setFocus(false);
  }, [focus, services]);
  useEffect(() => {
    navigationLock.current = false;
    surface.current?.focus();
  }, [position]);
  useEffect(() => {
    const off = services.app.workspace.on('active-leaf-change', () => {
      if (!services.isActive()) {
        setFocus(false);
      }
    });
    return () => services.app.workspace.offref(off);
  }, [services]);
  async function rate(rating: Rating) {
    if (cram || !card || !revealed || lock.current || recording) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await services.reviews.review(
        card.id,
        rating,
        Date.now(),
        session ? { id: session.id, position } : undefined,
      );
      // Two lapses on a card made for a mastered objective mark it as slipping.
      if (rating === 1) {
        void services.learn?.cardLapse(card.id).catch(() => {});
      }
      if (mounted.current) {
        setResults((old) => [...old, { cardId: card.id, rating }]);
        setPosition((i) => i + 1);
        setRevealed(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message || 'Could not save your review. Try again.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  const advance = async () => {
    if (
      !card ||
      !actions.current.revealed ||
      recording ||
      confirmExit ||
      navigationLock.current ||
      lock.current
    ) {
      return;
    }
    navigationLock.current = true;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (session) {
        await services.reviews.advanceCram({ id: session.id, position }, card.id);
      }
      if (mounted.current) {
        actions.current.revealed = false;
        setRevealed(false);
        setPosition((i) => i + 1);
      }
    } catch (e) {
      navigationLock.current = false;
      if (mounted.current) {
        setError((e as Error).message || 'Could not save your position. Try again.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  async function repeatSaved(next: QardCard[]) {
    setBusy(true);
    setError('');
    try {
      await repeat(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const actions = useRef({ rate, advance, focus, revealed, recording, confirmExit });
  actions.current = { rate, advance, focus, revealed, recording, confirmExit };
  useEffect(() => {
    const doc = services.host.ownerDocument;
    const handler = (event: KeyboardEvent) => {
      if (!services.isActive() || ignoresStudyKey(event)) {
        return;
      }
      const current = actions.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (current.focus) {
          setFocus(false);
        } else if (card) {
          setConfirmExit((v) => !v);
        } else {
          exit();
        }
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setFocus((v) => !v);
        return;
      }
      if (
        !card ||
        current.recording ||
        current.confirmExit ||
        lock.current ||
        navigationLock.current
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === ' ' || (!cram && ['1', '2', '3', '4'].includes(key))) {
        event.preventDefault();
        event.stopPropagation();
        if (key === ' ') {
          if (cram && current.revealed) {
            void current.advance();
          } else if (cram) {
            current.revealed = true;
            setRevealed(true);
          } else {
            setRevealed((v) => !v);
          }
        } else if (current.revealed) {
          void current.rate(Number(key) as Rating);
        }
      }
    };
    doc.addEventListener('keydown', handler, true);
    return () => doc.removeEventListener('keydown', handler, true);
  }, [services, card, exit, cram]);
  const onRecording = useCallback((value: boolean) => setRecording(value), []);
  if (!card) {
    return (
      <div className="qard-summary">
        <CheckCircle2 size={32} />
        <h1>{cram ? 'Cram session complete' : 'Session complete'}</h1>
        <div className="qard-summary-stats">
          <div>
            <strong>
              {cram ? position : results.length} / {cards.length}
            </strong>
            <span>{cram ? 'cards viewed' : 'cards reviewed'}</span>
          </div>
          <div>
            <strong>{Math.max(1, Math.round((Date.now() - start.current) / 60000))} min</strong>
            <span>this visit</span>
          </div>
        </div>
        {!cram && (
          <div className="qard-summary-ratings">
            {ratings.map((r) => (
              <div key={r.rating}>
                <strong>{results.filter((x) => x.rating === r.rating).length}</strong>
                <span>{r.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="qard-actions">
          {cram && (
            <button disabled={busy} onClick={() => void repeatSaved(cards)}>
              <RotateCcw size={16} />
              Cram again
            </button>
          )}
          {results.some((r) => r.rating < 3) && (
            <button
              disabled={busy}
              onClick={() =>
                void repeatSaved(
                  cards.filter((c) => results.some((r) => r.cardId === c.id && r.rating < 3)),
                )
              }
            >
              <RotateCcw size={16} />
              Review difficult cards
            </button>
          )}
          <button className="qard-primary" disabled={busy} onClick={exit}>
            Done
          </button>
        </div>
        {error && (
          <p className="qard-error" role="alert">
            {error}
          </p>
        )}
        <button onClick={() => setFocus(false)} hidden={!focus}>
          Exit focus mode
        </button>
      </div>
    );
  }
  return (
    <div className={'qard-study ' + (focus ? 'is-focused' : '')} ref={surface} tabIndex={-1}>
      <div className="qard-study-toolbar">
        <button
          onClick={() => {
            if (focus) {
              setFocus(false);
            }
            setConfirmExit(true);
          }}
        >
          <ArrowLeft size={16} />
          {session ? 'Save and leave' : 'End session'}
        </button>
        <span>
          {cram && 'Cram · '}
          {card.deck} <span>/</span> {card.topic}
        </span>
        <button
          aria-label={focus ? 'Exit focus mode' : 'Enter focus mode'}
          onClick={() => setFocus(!focus)}
        >
          {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          {saved.settings.keyboardHints && <kbd>F</kbd>}
        </button>
      </div>
      {confirmExit && (
        <div className="qard-confirm" role="alert">
          <p>
            {session
              ? 'Your position is saved automatically. Resume this session from Qard whenever you are ready.'
              : cram
                ? 'Leave this cram session?'
                : `Leave this session? Your ${results.length} completed reviews are saved.`}
          </p>
          <button onClick={() => setConfirmExit(false)}>Keep studying</button>
          <button disabled={busy} onClick={exit}>
            Leave session
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="qard-study-area">
        <div className="qard-study-progress">
          <span>
            {position + 1} <span>/ {cards.length}</span>
          </span>
        </div>
        <progress
          max={cards.length}
          value={position}
          aria-label={cram ? 'Cards viewed' : 'Cards reviewed'}
        />
        {!cram && saved.states[card.id]?.needsContentCheck && (
          <p className="qard-muted qard-small">
            This answer changed. Check what you remember before rating it.
          </p>
        )}
        <StudyCard key={card.id} card={card} revealed={revealed} services={services} />
        {saved.settings.audioEnabled && <VoiceAnswer key={card.id} onBusy={onRecording} />}
        {error && (
          <p className="qard-error" role="alert">
            {error}
          </p>
        )}
        <div className="qard-study-controls">
          {revealed && cram ? (
            <button
              className="qard-primary qard-reveal"
              disabled={busy || recording || confirmExit}
              onClick={() => void advance()}
            >
              Next card {saved.settings.keyboardHints && <kbd>Space</kbd>}
            </button>
          ) : revealed ? (
            <>
              <div className="qard-ratings">
                {ratings.map((r) => (
                  <button
                    key={r.rating}
                    className={
                      'qard-rating qard-rating-' + r.rating + (intervals ? ' with-interval' : '')
                    }
                    title={r.hint}
                    disabled={busy || recording || confirmExit}
                    onClick={() => void rate(r.rating)}
                  >
                    <strong>{r.name}</strong>
                    {intervals && (
                      <small
                        className="qard-rating-interval"
                        aria-label={`Next review in ${intervals[r.rating - 1]}`}
                      >
                        {intervals[r.rating - 1]}
                      </small>
                    )}
                    {saved.settings.keyboardHints && <kbd>{r.rating}</kbd>}
                  </button>
                ))}
              </div>
              <button
                className="qard-hide-answer"
                onClick={() => setRevealed(false)}
                disabled={recording}
              >
                Hide answer {saved.settings.keyboardHints && <kbd>Space</kbd>}
              </button>
            </>
          ) : (
            <button
              className="qard-primary qard-reveal"
              disabled={recording || confirmExit}
              onClick={() => setRevealed(true)}
            >
              Reveal answer {saved.settings.keyboardHints && <kbd>Space</kbd>}
            </button>
          )}
        </div>
        <div className="qard-study-foot">
          <span>{busy ? 'Saving…' : ''}</span>
          <button
            onClick={() => {
              setFocus(false);
              void services.openSource(card).catch((e) => setError((e as Error).message));
            }}
          >
            <ExternalLink size={14} />
            Open source
          </button>
        </div>
      </div>
    </div>
  );
}
