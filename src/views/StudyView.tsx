import { failureDays, needsRepair } from '../review/card-repair';
import type { ReviewUndo } from '../review/review-store';
import type { SavedSession, SessionStep } from '../review/saved-session';
import {
  completedReviewCount,
  pendingLearning,
  type LearningReview,
} from '../review/learning-queue';
import { reviewIntervals } from '../review/fsrs-scheduler';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  RotateCcw,
  CheckCircle2,
  Undo2,
  SkipForward,
  Pause,
} from 'lucide-react';
import { CardEditor } from '../components/CardEditor';
import { CardRepairActions } from '../components/CardRepairActions';
import { siblingIds } from '../cards/siblings';
import { isBuried } from '../review/scheduler';
import { StudyCard } from '../components/StudyCard';
import { SessionDifficultyChart } from '../components/SessionDifficultyChart';
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
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, QardCard>>({});
  cards = cards.map((card) => edits[card.id] ?? card);
  const cram = style === 'cram';
  const saved = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [learning, setLearning] = useState<LearningReview | undefined>(() =>
    session?.repeatLearning
      ? pendingLearning(session, saved.states).find((entry) => entry.due <= Date.now())
      : undefined,
  );
  const [clock, setClock] = useState(Date.now());
  const [position, setPosition] = useState(session?.position ?? 0),
    [revealed, setRevealed] = useState(false),
    [focus, setFocus] = useState(saved.settings.autoFocus);
  const [results, setResults] = useState<SessionResult[]>(session?.results ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recording, setRecording] = useState(false);
  const [undo, setUndo] = useState<{
    review: ReviewUndo;
    position: number;
    learning?: LearningReview;
    deferred: string[];
    undoLapse?: () => Promise<void>;
  }>();
  const [deferred, setDeferred] = useState<string[]>(session?.deferredIds ?? []);
  const [skipped, setSkipped] = useState<string[]>(session?.skippedIds ?? []);
  const [courseUndo, setCourseUndo] = useState<{ run: () => Promise<void> }>();
  const canUndo = services.reviews.canUndoReview(undo?.review);
  const repairDays = useMemo(
    () => failureDays(saved.history, saved.states),
    [saved.history, saved.states],
  );
  const repairCount = cards.filter((c) =>
    needsRepair(saved.states[c.id], repairDays.get(c.id)),
  ).length;
  const activeCards = cards.filter(
    (c) => !saved.states[c.id]?.paused && (cram || !isBuried(saved.states[c.id])),
  );
  const [confirmExit, setConfirmExit] = useState(false);
  const lock = useRef(false),
    surface = useRef<HTMLDivElement>(null),
    mounted = useRef(true),
    start = useRef(Date.now());
  const navigationLock = useRef(false);
  const currentSession = session ? saved.sessions.find((s) => s.id === session.id) : undefined;
  const learningEnabled = !cram && saved.settings.scheduling && saved.settings.scheduler === 'fsrs';
  const pending = learningEnabled ? pendingLearning(currentSession, saved.states) : [];
  const completed = completedReviewCount(
    {
      results,
      cardIds: cards.map((c) => c.id),
      repeatLearning: learningEnabled && session?.repeatLearning ? true : undefined,
      skippedIds: skipped,
      deferredIds: deferred,
    },
    saved.states,
  );
  const currentLearning = learningEnabled && currentSession?.repeatLearning ? learning : undefined;
  const card = currentLearning
    ? cards.find((c) => c.id === currentLearning.cardId)
    : cards[position];
  const waiting = !card && pending.length > 0;
  const step: SessionStep | undefined = session
    ? { id: session.id, position, ...(currentLearning ? { learningDue: currentLearning.due } : {}) }
    : undefined;
  function nextCard() {
    setClock(Date.now());
    const data = services.reviews.getSnapshot();
    const next = session ? data.sessions.find((s) => s.id === session.id) : undefined;
    let nextPosition = next?.position ?? (currentLearning ? position : position + 1);
    const newlyDeferred = [...(next?.deferredIds ?? deferred)];
    if (!cram && data.settings.scheduling) {
      while (nextPosition < cards.length && isBuried(data.states[cards[nextPosition]!.id])) {
        newlyDeferred.push(cards[nextPosition++]!.id);
      }
    }
    setDeferred([...new Set(newlyDeferred)]);
    setPosition(nextPosition);
    setLearning(
      learningEnabled
        ? pendingLearning(next, data.states).find((entry) => entry.due <= Date.now())
        : undefined,
    );
  }
  const buried = !!card && !cram && saved.settings.scheduling && isBuried(saved.states[card.id]);
  const paused = !!card && !!saved.states[card.id]?.paused;
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
    if (services.isActive()) {
      surface.current?.focus();
    }
  }, [position, currentLearning]);
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    if (!waiting || busy || confirmExit || courseUndo) {
      return;
    }
    const ready = pending.find((entry) => entry.due <= Date.now());
    if (ready) {
      setLearning(ready);
      setRevealed(false);
    }
  }, [waiting, clock, saved, busy, confirmExit, courseUndo]);
  useEffect(() => {
    const off = services.app.workspace.on('active-leaf-change', () => {
      if (!services.isActive()) {
        setFocus(false);
      }
    });
    return () => services.app.workspace.offref(off);
  }, [services]);
  async function rate(rating: Rating) {
    if (
      cram ||
      !card ||
      paused ||
      buried ||
      !revealed ||
      lock.current ||
      recording ||
      confirmExit ||
      courseUndo ||
      editing
    ) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const review = await services.reviews.review(
        card.id,
        rating,
        Date.now(),
        step,
        siblingIds(
          card,
          services.index?.getSnapshot().cards.length ? services.index.getSnapshot().cards : cards,
        ),
      );
      // Two lapses on a card made for a mastered objective mark it as slipping.
      const undoLapse =
        rating === 1
          ? await services.learn?.cardLapse?.(card.id).catch(() => undefined)
          : undefined;
      if (mounted.current) {
        setUndo({ review, position, learning: currentLearning, deferred, undoLapse });
        setResults((old) => [...old, { cardId: card.id, rating }]);
        nextCard();
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
      paused ||
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
  async function undoLast() {
    if (!undo || !canUndo || lock.current || recording || confirmExit) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await services.reviews.undoReview(undo.review);
      if (mounted.current) {
        setPosition(undo.position);
        setLearning(undo.learning);
        setDeferred(undo.deferred);
        setResults((old) => old.slice(0, -1));
        setRevealed(false);
        setUndo(undefined);
      }
      try {
        await undo.undoLapse?.();
      } catch (e) {
        if (mounted.current && undo.undoLapse) {
          setCourseUndo({ run: undo.undoLapse });
          setError(
            `Rating undone. The linked course could not be restored: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message || 'Could not undo your review. Try again.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  async function retryCourseUndo() {
    if (!courseUndo || lock.current || recording || confirmExit) {
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await courseUndo.run();
      if (mounted.current) {
        setCourseUndo(undefined);
        setError('');
      }
    } catch (e) {
      if (mounted.current) {
        setError(`Rating undone. The linked course could not be restored: ${(e as Error).message}`);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  async function skip(pause = false) {
    if (!card || lock.current || navigationLock.current || recording || confirmExit || courseUndo) {
      return;
    }
    navigationLock.current = true;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (session) {
        await services.reviews.skipCard(step!, card.id, pause);
      } else if (pause) {
        await services.reviews.setPaused(card.id, true);
      }
      if (mounted.current) {
        setSkipped((old) => [...new Set([...old, card.id])]);
        setUndo(undefined);
        setRevealed(false);
        nextCard();
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
  }
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
  async function finishLearning() {
    if (!session || lock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await services.reviews.discardSession(session.id);
      if (mounted.current) {
        setLearning(undefined);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message || 'Could not finish this session. Try again.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  function editCard() {
    if (!card || lock.current || recording || confirmExit || courseUndo || card.duplicateId) {
      return;
    }
    setFocus(false);
    setEditing(true);
  }
  const onRepairBusy = useCallback((value: boolean) => {
    lock.current = value;
    setBusy(value);
  }, []);
  const actions = useRef({
    rate,
    editCard,
    editing,
    advance,
    undoLast,
    skip,
    focus,
    revealed,
    recording,
    confirmExit,
  });
  actions.current = {
    rate,
    editCard,
    editing,
    advance,
    undoLast,
    skip,
    focus,
    revealed,
    recording,
    confirmExit,
  };
  useEffect(() => {
    const doc = services.host.ownerDocument;
    const handler = (event: KeyboardEvent) => {
      if (!services.isActive() || ignoresStudyKey(event)) {
        return;
      }
      const current = actions.current;
      if (current.editing) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (current.focus) {
          setFocus(false);
        } else if (card || waiting) {
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
        event.key.toLowerCase() === 'u' &&
        !current.recording &&
        !current.confirmExit &&
        !lock.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        void current.undoLast();
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
      if (key === 'e') {
        event.preventDefault();
        event.stopPropagation();
        current.editCard();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        event.stopPropagation();
        void current.skip();
        return;
      }
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
  }, [services, card, exit, cram, waiting]);
  const onRecording = useCallback((value: boolean) => setRecording(value), []);
  if (editing && card) {
    return (
      <div className="qard-study-editor" data-qard-keyboard-ignore>
        <CardEditor
          services={services}
          card={card}
          cancel={() => {
            setEditing(false);
            window.setTimeout(() => {
              if (mounted.current && services.isActive()) {
                surface.current?.focus();
              }
            }, 0);
          }}
          saved={(next) => {
            setEdits((old) => ({ ...old, [next.id]: next }));
            const current = services.reviews
              .getSnapshot()
              .sessions.find((s) => s.id === session?.id)
              ?.learning?.find((entry) => entry.cardId === next.id);
            if (currentLearning) {
              setLearning(current);
            }
            setRevealed(false);
            setEditing(false);
            setUndo(undefined);
            window.setTimeout(() => {
              if (mounted.current && services.isActive()) {
                surface.current?.focus();
              }
            }, 0);
          }}
        />
      </div>
    );
  }
  if (waiting) {
    const minutes = Math.max(1, Math.ceil((pending[0]!.due - clock) / 60000));
    return (
      <div className="qard-summary">
        <h1>Learning cards return soon</h1>
        <p>
          {completed} / {cards.length} completed
        </p>
        <p role="status">
          {pending.length} learning {pending.length === 1 ? 'card remains' : 'cards remain'}. The
          next card returns in {minutes} {minutes === 1 ? 'minute' : 'minutes'}. Keep this session
          open to continue when ready.
        </p>
        <div className="qard-actions">
          {canUndo && (
            <button disabled={busy || !!courseUndo} onClick={() => void undoLast()}>
              Undo last rating{saved.settings.keyboardHints && <kbd>U</kbd>}
            </button>
          )}
          <button className="qard-primary" disabled={busy} onClick={exit}>
            Save and leave
          </button>
          <button disabled={busy || !!courseUndo} onClick={() => void finishLearning()}>
            Finish session
          </button>
        </div>
        <p className="qard-muted">Finishing keeps your reviews and scheduled due dates.</p>
        {confirmExit && (
          <div className="qard-confirm" role="alert">
            <p>Your learning cards are saved. Resume this session whenever you are ready.</p>
            <button onClick={() => setConfirmExit(false)}>Keep studying</button>
            <button disabled={busy} onClick={exit}>
              Leave session
            </button>
          </div>
        )}
        {error && (
          <p className="qard-error" role="alert">
            {error}
          </p>
        )}
        {courseUndo && (
          <button disabled={busy} onClick={() => void retryCourseUndo()}>
            Retry course restoration
          </button>
        )}
        <button onClick={() => setFocus(false)} hidden={!focus}>
          Exit focus mode
        </button>
      </div>
    );
  }
  if (!card) {
    return (
      <div className="qard-summary">
        <CheckCircle2 size={32} />
        <h1>{cram ? 'Cram session complete' : 'Session complete'}</h1>
        <div className="qard-summary-stats">
          <div>
            <strong>
              {cram ? position - skipped.length : new Set(results.map((r) => r.cardId)).size} /{' '}
              {cards.length}
            </strong>
            <span>{cram ? 'cards viewed' : 'cards reviewed'}</span>
          </div>
          <div>
            <strong>{Math.max(1, Math.round((Date.now() - start.current) / 60000))} min</strong>
            <span>this visit</span>
          </div>
        </div>
        {!cram && <SessionDifficultyChart results={results} />}
        {!!repairCount && (
          <p className="qard-muted">
            {repairCount} {repairCount === 1 ? 'card needs' : 'cards need'} attention. Find them
            with the Needs fixing filter in your library.
          </p>
        )}
        {!cram && results.length > new Set(results.map((r) => r.cardId)).size && (
          <p className="qard-muted">{results.length} reviews, including learning repeats</p>
        )}
        {!!deferred.length && (
          <p className="qard-muted">
            {deferred.length} related {deferred.length === 1 ? 'card deferred' : 'cards deferred'}{' '}
            until tomorrow · available in cram
          </p>
        )}
        {!!skipped.length && (
          <p className="qard-muted">
            {skipped.length} {skipped.length === 1 ? 'card skipped' : 'cards skipped'} · not counted
            as reviews
          </p>
        )}
        <div className="qard-actions">
          {canUndo && (
            <button disabled={busy} onClick={() => void undoLast()}>
              <Undo2 size={16} />
              Undo last rating{saved.settings.keyboardHints && <kbd>U</kbd>}
            </button>
          )}
          {activeCards.some((c) => skipped.includes(c.id)) && (
            <button
              disabled={busy}
              onClick={() => void repeatSaved(activeCards.filter((c) => skipped.includes(c.id)))}
            >
              <RotateCcw size={16} />
              Review skipped cards
            </button>
          )}
          {cram && (
            <button
              disabled={busy || !activeCards.length}
              onClick={() => void repeatSaved(activeCards)}
            >
              <RotateCcw size={16} />
              Cram again
            </button>
          )}
          {activeCards.some((c) => results.some((r) => r.cardId === c.id && r.rating < 3)) && (
            <button
              disabled={busy}
              onClick={() =>
                void repeatSaved(
                  activeCards.filter((c) => results.some((r) => r.cardId === c.id && r.rating < 3)),
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
            {courseUndo && (
              <button
                disabled={busy || recording || confirmExit}
                onClick={() => void retryCourseUndo()}
              >
                Retry course restoration
              </button>
            )}
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
            {cram ? (
              <>
                {position + 1} <span>/ {cards.length}</span>
              </>
            ) : (
              <>
                {currentLearning && 'Learning review · '}
                {completed} <span>/ {cards.length} completed</span>
              </>
            )}
            {!!pending.length && ` · ${pending.length} learning`}
          </span>
        </div>
        <progress
          max={cards.length}
          value={cram ? position : completed}
          aria-label={cram ? 'Cards viewed' : 'Cards completed'}
        />
        {!cram && saved.states[card.id]?.needsContentCheck && (
          <p className="qard-muted qard-small">
            This answer changed. Check what you remember before rating it.
          </p>
        )}
        {paused && (
          <p className="qard-muted" role="status">
            This card is paused. Skip it here, or resume it from its card preview.
          </p>
        )}
        {!cram && isBuried(saved.states[card.id]) && (
          <p role="status" className="qard-muted">
            This related card is deferred until tomorrow. Skip it here, or use cram to study it
            today.
          </p>
        )}
        <StudyCard key={card.id} card={card} revealed={revealed} services={services} />
        {saved.settings.audioEnabled && <VoiceAnswer key={card.id} onBusy={onRecording} />}
        {error && (
          <p className="qard-error" role="alert">
            {error}
            {courseUndo && (
              <button
                disabled={busy || recording || confirmExit}
                onClick={() => void retryCourseUndo()}
              >
                Retry course restoration
              </button>
            )}
          </p>
        )}
        <div className="qard-study-controls">
          {revealed && cram ? (
            <button
              className="qard-primary qard-reveal"
              disabled={busy || recording || confirmExit || paused || buried || !!courseUndo}
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
                    disabled={busy || recording || confirmExit || paused || buried || !!courseUndo}
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
              disabled={busy || recording || confirmExit || !!courseUndo}
              onClick={() => setRevealed(true)}
            >
              Reveal answer {saved.settings.keyboardHints && <kbd>Space</kbd>}
            </button>
          )}
        </div>
        <div className="qard-study-foot">
          <CardRepairActions
            key={`repair-${card.id}`}
            card={card}
            services={services}
            edit={editCard}
            disabled={busy || recording || confirmExit || !!courseUndo}
            onBusy={onRepairBusy}
            shortcut
          >
            {!cram && (
              <button
                disabled={busy || recording || confirmExit || !canUndo}
                title="Restore the last rating and its schedule"
                onClick={() => void undoLast()}
              >
                <Undo2 size={14} />
                Undo{saved.settings.keyboardHints && <kbd>U</kbd>}
              </button>
            )}
            <button
              disabled={busy || recording || confirmExit || !!courseUndo}
              title="Skip for this session without changing the schedule"
              onClick={() => void skip()}
            >
              <SkipForward size={14} />
              Skip{saved.settings.keyboardHints && <kbd>S</kbd>}
            </button>
            <button
              disabled={busy || recording || confirmExit || paused || buried || !!courseUndo}
              title="Keep this card out of study sessions until you resume it in its preview"
              onClick={() => void skip(true)}
            >
              <Pause size={14} />
              Pause card
            </button>
          </CardRepairActions>
          <span role="status">{busy ? 'Saving…' : ''}</span>
        </div>
      </div>
    </div>
  );
}
