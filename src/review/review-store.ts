import { readExams, validExam, type ExamPlan } from '../exams/exam-plan';
import {
  readSessions,
  resolveSession,
  stableId,
  hasRemainingSession,
  matchesSessionStep,
  type SavedSession,
  type SessionStep,
} from './saved-session';
import type { QardCard } from '../cards/card-types';
import type { SessionStyle, StudyMode } from './session';
import { learningReview } from './learning-queue';
import { initializeFsrs, migrateFsrs, reviewWithFsrs } from './fsrs-scheduler';
import { DEFAULT_SETTINGS, readSettings, type QardSettings } from '../settings/settings';
import { scheduler, type Rating, type ReviewEvent, type ReviewState } from './scheduler';
import { addToLog, type UsageLog } from '../agents/usage-report';
import type { Usage } from '../agents/usage';
import {
  emptyStatistics,
  readStatistics,
  recordReview,
  undoReviewStatistics,
  type StudyStatistics,
} from './statistics';
export interface ReviewUndo {
  id: string;
  cardId: string;
}
interface ReviewCheckpoint extends ReviewUndo {
  event: ReviewEvent;
  historyLength: number;
  before?: ReviewState;
  after: ReviewState;
  sessionBefore?: SavedSession;
  sessionAfter?: SavedSession;
  settings: QardSettings;
}
/** A card made for a mastery objective; lapses count Again ratings since the objective was last marked. */
export interface CardLink {
  mastery: string;
  objective: string;
  lapses: number;
}
export interface PluginData {
  version: 1;
  settings: QardSettings;
  states: Record<string, ReviewState>;
  history: ReviewEvent[];
  links: Record<string, CardLink>;
  timings: Record<string, number[]>;
  usage: UsageLog;
  statistics: StudyStatistics;
  sessions: SavedSession[];
  exams: ExamPlan[];
}
export class ReviewStore {
  private data: PluginData = {
    version: 1,
    settings: DEFAULT_SETTINGS,
    states: Object.create(null) as Record<string, ReviewState>,
    history: [],
    links: Object.create(null) as Record<string, CardLink>,
    timings: {},
    usage: {},
    statistics: emptyStatistics(),
    sessions: [],
    exams: [],
  };
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  /** One guarded checkpoint for the current visit, never a second copy of the review log. */
  private undo?: ReviewCheckpoint;
  constructor(private persist: (data: PluginData) => Promise<void>) {}
  load(raw: unknown) {
    this.undo = undefined;
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const value = raw as Partial<PluginData>;
    const states: Record<string, ReviewState> = Object.create(null) as Record<string, ReviewState>;
    for (const [id, state] of Object.entries(value.states || {})) {
      if (
        state &&
        typeof state === 'object' &&
        /^[A-Za-z0-9_-]+$/.test(id) &&
        Number.isSafeInteger(state.reviewCount) &&
        state.reviewCount >= 0 &&
        Number.isFinite(state.interval) &&
        state.interval >= 0 &&
        Number.isFinite(state.ease) &&
        state.ease > 0
      ) {
        const { paused, ...memory } = state;
        states[id] = { ...memory, cardId: id, ...(paused === true ? { paused: true } : {}) };
      }
    }
    const history = Array.isArray(value.history)
      ? value.history.filter(
          (e) =>
            e &&
            typeof e.cardId === 'string' &&
            [1, 2, 3, 4].includes(e.rating) &&
            Number.isFinite(new Date(e.at).getTime()),
        )
      : [];
    const links: Record<string, CardLink> = Object.create(null) as Record<string, CardLink>;
    for (const [id, link] of Object.entries(value.links || {})) {
      if (
        /^[A-Za-z0-9_-]+$/.test(id) &&
        link &&
        typeof link.mastery === 'string' &&
        typeof link.objective === 'string'
      ) {
        links[id] = {
          mastery: link.mastery,
          objective: link.objective,
          lapses: Number.isFinite(link.lapses) ? link.lapses : 0,
        };
      }
    }
    const timings: Record<string, number[]> = {};
    for (const [k, list] of Object.entries(value.timings || {})) {
      if (Array.isArray(list)) {
        timings[k] = list.filter((n) => Number.isFinite(n) && n > 0).slice(-9);
      }
    }
    const usage: UsageLog = {};
    for (const [day, entries] of Object.entries(value.usage || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && entries && typeof entries === 'object') {
        usage[day] = entries;
      }
    }
    const settings = readSettings(value.settings);
    // An existing vault opts in; a vault without saved plugin data starts with FSRS.
    if (!value.settings?.scheduler) {
      settings.scheduler = 'simple';
    }
    this.data = {
      version: 1,
      settings,
      states:
        settings.scheduler === 'fsrs'
          ? migrateFsrs(states, history, settings.desiredRetention)
          : states,
      history,
      links,
      timings,
      usage,
      statistics: readStatistics(value.statistics, history),
      sessions: readSessions(value.sessions),
      exams: readExams(value.exams),
    };
  }
  getSnapshot = () => this.data;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private change<T = void>(
    transform: (data: PluginData) => PluginData,
    committed?: (before: PluginData, after: PluginData) => T,
  ): Promise<T> {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const before = this.data;
        const next = transform(before);
        await this.persist(next); // A failed write must never advance the session's state.
        this.data = next;
        const result = committed?.(before, next);
        this.listeners.forEach((listener) => listener());
        return result as T;
      });
    this.queue = operation;
    return operation;
  }
  saveSettings(settings: QardSettings) {
    return this.change((data) => {
      const next = readSettings(settings);
      let states = data.states;
      if (next.scheduler !== data.settings.scheduler) {
        states =
          next.scheduler === 'fsrs'
            ? migrateFsrs(states, data.history, next.desiredRetention)
            : Object.assign(
                Object.create(null) as Record<string, ReviewState>,
                Object.fromEntries(
                  Object.entries(states).map(([id, state]) => {
                    const { fsrs: _memory, ...simple } = state;
                    return [id, simple];
                  }),
                ),
              );
      }
      const sessions =
        !next.scheduling || next.scheduler !== 'fsrs'
          ? data.sessions.flatMap((session) => {
              if (!session.repeatLearning) {
                return [session];
              }
              const { repeatLearning: _repeat, learning: _learning, ...singlePass } = session;
              return hasRemainingSession(singlePass) ? [singlePass] : [];
            })
          : data.sessions;
      return { ...data, settings: next, states, sessions };
    });
  }
  review(cardId: string, rating: Rating, now = Date.now(), step?: SessionStep) {
    if (!/^[A-Za-z0-9_-]+$/.test(cardId)) {
      return Promise.reject(new Error('A stable card ID is required before reviewing.'));
    }
    if (![1, 2, 3, 4].includes(rating) || !Number.isFinite(new Date(now).getTime())) {
      return Promise.reject(new Error('A valid rating and review date are required.'));
    }
    return this.change(
      (data) => {
        if (data.states[cardId]?.paused) {
          throw new Error('This card is paused. Resume it before reviewing.');
        }
        const previous = data.states[cardId];
        if (step?.learningDue !== undefined && previous?.due !== step.learningDue) {
          throw new Error(
            'This learning card changed in another view. Return to Qard and resume it.',
          );
        }
        const scheduled = data.settings.scheduling;
        const computed =
          data.settings.scheduler === 'fsrs'
            ? reviewWithFsrs(cardId, previous, rating, now, data.settings.desiredRetention)
            : scheduler.reviewCard(cardId, previous, rating, now);
        const state = scheduled
          ? computed
          : {
              ...computed,
              due: previous?.due,
              interval: previous?.interval ?? 0,
              ease: previous?.ease ?? 2.5,
            };
        const sessions = step
          ? this.advanceSession(
              data.sessions,
              step,
              cardId,
              rating,
              now,
              scheduled ? state : undefined,
            )
          : data.sessions;
        const event: ReviewEvent = {
          cardId,
          at: now,
          rating,
          scheduled,
          scheduler: data.settings.scheduler,
          ...(data.settings.scheduler === 'fsrs'
            ? { desiredRetention: data.settings.desiredRetention }
            : {}),
        };
        // Keep timestamped ratings for memory reconstruction and future personalization.
        return {
          ...data,
          sessions,
          states: Object.assign(Object.create(null) as Record<string, ReviewState>, data.states, {
            [cardId]: state,
          }),
          history: [...data.history, event],
          statistics: recordReview(data.statistics, cardId, rating, now),
        };
      },
      (before, after) => {
        this.undo = {
          id: crypto.randomUUID(),
          cardId,
          event: after.history[after.history.length - 1]!,
          historyLength: after.history.length,
          before: before.states[cardId],
          after: after.states[cardId]!,
          settings: before.settings,
          ...(step
            ? {
                sessionBefore: before.sessions.find((s) => s.id === step.id),
                sessionAfter: after.sessions.find((s) => s.id === step.id),
              }
            : {}),
        };
        return { id: this.undo.id, cardId };
      },
    );
  }
  canUndoReview(candidate: ReviewUndo | undefined): boolean {
    const checkpoint = this.undo,
      data = this.data;
    return (
      !!candidate &&
      !!checkpoint &&
      candidate.id === checkpoint.id &&
      candidate.cardId === checkpoint.cardId &&
      data.history.length === checkpoint.historyLength &&
      data.history[data.history.length - 1] === checkpoint.event &&
      data.states[checkpoint.cardId] === checkpoint.after &&
      data.settings.scheduler === checkpoint.settings.scheduler &&
      data.settings.scheduling === checkpoint.settings.scheduling &&
      data.settings.desiredRetention === checkpoint.settings.desiredRetention &&
      (!checkpoint.sessionBefore ||
        data.sessions.find((s) => s.id === checkpoint.sessionBefore!.id) ===
          checkpoint.sessionAfter)
    );
  }
  undoReview(candidate: ReviewUndo) {
    return this.change(
      (data) => {
        if (!this.canUndoReview(candidate)) {
          throw new Error('This review changed or a later card was reviewed. It cannot be undone.');
        }
        const checkpoint = this.undo!;
        const states = Object.assign(
          Object.create(null) as Record<string, ReviewState>,
          data.states,
        );
        if (checkpoint.before) {
          states[checkpoint.cardId] = checkpoint.before;
        } else {
          delete states[checkpoint.cardId];
        }
        const sessions = checkpoint.sessionBefore
          ? [
              ...data.sessions.filter((s) => s.id !== checkpoint.sessionBefore!.id),
              checkpoint.sessionBefore,
            ]
          : data.sessions;
        return {
          ...data,
          states,
          sessions,
          history: data.history.slice(0, -1),
          statistics: undoReviewStatistics(data.statistics, checkpoint.event),
        };
      },
      () => {
        this.undo = undefined;
      },
    );
  }
  setPaused(cardId: string, paused: boolean) {
    if (!stableId(cardId)) {
      return Promise.reject(new Error('A stable card ID is required before pausing.'));
    }
    return this.change((data) => ({
      ...data,
      states: this.pauseState(data.states, cardId, paused),
      sessions: paused
        ? data.sessions.flatMap((session) => {
            if (!session.learning?.some((entry) => entry.cardId === cardId)) {
              return [session];
            }
            const next = {
              ...session,
              learning: session.learning.filter((entry) => entry.cardId !== cardId),
            };
            return hasRemainingSession(next) ? [next] : [];
          })
        : data.sessions,
    }));
  }
  private pauseState(states: Record<string, ReviewState>, cardId: string, paused: boolean) {
    const previous = states[cardId] ?? {
      cardId,
      interval: 0,
      ease: 2.5,
      reviewCount: 0,
      lapses: 0,
    };
    const { paused: _paused, ...memory } = previous;
    return Object.assign(Object.create(null) as Record<string, ReviewState>, states, {
      [cardId]: { ...memory, ...(paused ? { paused: true } : {}) },
    });
  }
  /** Skip/pause advances the saved cursor without rating or changing memory. */
  skipCard(step: SessionStep, cardId: string, pause = false) {
    return this.change(
      (data) => {
        const session = data.sessions.find((s) => s.id === step.id);
        if (!session || !matchesSessionStep(session, step, cardId)) {
          throw new Error('This session changed in another view. Return to Qard and resume it.');
        }
        const next = {
          ...session,
          position: session.position + (step.learningDue === undefined ? 1 : 0),
          updatedAt: Date.now(),
          skippedIds: [...new Set([...(session.skippedIds ?? []), cardId])],
          ...(session.repeatLearning
            ? { learning: session.learning?.filter((entry) => entry.cardId !== cardId) ?? [] }
            : {}),
        };
        return {
          ...data,
          states: pause ? this.pauseState(data.states, cardId, true) : data.states,
          sessions: data.sessions.flatMap((s) =>
            s.id !== step.id ? [s] : hasRemainingSession(next) ? [next] : [],
          ),
        };
      },
      () => {
        this.undo = undefined;
      },
    );
  }
  /** Adds migrated schedules. Existing Qard states always win. */
  requireContentCheck(cardId: string, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]+$/.test(cardId)) {
      return Promise.reject(new Error('A stable card ID is required.'));
    }
    return this.change((data) => {
      const state = data.states[cardId] ?? {
        cardId,
        interval: 0,
        ease: 2.5,
        reviewCount: 0,
        lapses: 0,
      };
      return {
        ...data,
        states: Object.assign(Object.create(null) as Record<string, ReviewState>, data.states, {
          [cardId]: { ...state, due: Math.min(state.due ?? now, now), needsContentCheck: true },
        }),
      };
    });
  }
  importStates(states: ReviewState[]) {
    const valid = states.filter(
      (s) =>
        /^[A-Za-z0-9_-]+$/.test(s.cardId) &&
        Number.isFinite(s.interval) &&
        Number.isFinite(s.ease) &&
        s.ease > 0 &&
        Number.isSafeInteger(s.reviewCount) &&
        s.reviewCount >= 0 &&
        s.interval >= 0,
    );
    if (!valid.length) {
      return Promise.resolve();
    }
    return this.change((data) => {
      const next = Object.assign(Object.create(null) as Record<string, ReviewState>, data.states);
      for (const state of valid) {
        if (!next[state.cardId]) {
          next[state.cardId] =
            data.settings.scheduler === 'fsrs'
              ? initializeFsrs(state, [], data.settings.desiredRetention)
              : state;
        }
      }
      return { ...data, states: next };
    });
  }
  link(cardId: string, link: CardLink) {
    return this.change((data) => ({
      ...data,
      links: Object.assign(Object.create(null) as Record<string, CardLink>, data.links, {
        [cardId]: link,
      }),
    }));
  }
  /** Recent job durations (ms) by job kind, connection and model, for time-left estimates. */
  recordTiming(key: string, ms: number) {
    return this.change((data) => ({
      ...data,
      timings: { ...data.timings, [key]: [...(data.timings[key] ?? []), Math.round(ms)].slice(-9) },
    }));
  }
  /** Adds one agent run's tokens to the day's totals. */
  recordUsage(day: string, key: string, usage: Usage) {
    return this.change((data) => ({ ...data, usage: addToLog(data.usage, day, key, usage) }));
  }
  resetUsage() {
    return this.change((data) => ({ ...data, usage: {} }));
  }
  async startSession(
    cards: QardCard[],
    style: SessionStyle = 'normal',
    examId?: string,
    mode: StudyMode = 'all',
  ): Promise<SavedSession> {
    if (
      !cards.length ||
      cards.some((c) => !c.stable || c.duplicateId || !stableId(c.id)) ||
      new Set(cards.map((c) => c.id)).size !== cards.length
    ) {
      throw new Error('These cards need unique, stable IDs before saving a session.');
    }
    const now = Date.now(),
      decks = [...new Set(cards.map((c) => c.deck))];
    const session: SavedSession = {
      id: crypto.randomUUID(),
      title: decks.join(', '),
      cardIds: cards.map((c) => c.id),
      position: 0,
      style,
      results: [],
      createdAt: now,
      updatedAt: now,
      ...(examId ? { examId } : {}),
    };
    await this.change((data) => {
      if (cards.some((c) => data.states[c.id]?.paused)) {
        throw new Error('Some cards are paused. Resume them before starting a session.');
      }
      if (
        style === 'normal' &&
        mode === 'due' &&
        !examId &&
        data.settings.scheduling &&
        data.settings.scheduler === 'fsrs'
      ) {
        session.repeatLearning = true;
        session.learning = [];
      }
      return { ...data, sessions: [...data.sessions, session] };
    });
    return session;
  }
  async resumeSession(id: string, cards: QardCard[]) {
    let resolved: ReturnType<typeof resolveSession> | undefined;
    await this.change((data) => {
      const session = data.sessions.find((s) => s.id === id);
      if (!session) {
        throw new Error('This session has already finished or was discarded.');
      }
      resolved = resolveSession(session, cards, data.states);
      const next = resolved.session;
      return {
        ...data,
        sessions: data.sessions.flatMap((s) =>
          s.id !== id ? [s] : hasRemainingSession(next) ? [next] : [],
        ),
      };
    });
    return resolved!;
  }
  private advanceSession(
    sessions: SavedSession[],
    step: SessionStep,
    cardId: string,
    rating: Rating | undefined,
    now: number,
    state?: ReviewState,
  ) {
    const session = sessions.find((s) => s.id === step.id);
    if (!session || !matchesSessionStep(session, step, cardId)) {
      throw new Error('This session changed in another view. Return to Qard and resume it.');
    }
    if ((session.style === 'normal') !== (rating !== undefined)) {
      throw new Error('The session mode changed. Resume it from Qard.');
    }
    if (step.learningDue !== undefined && step.learningDue > now) {
      throw new Error('This learning card is not due yet.');
    }
    const repeat = session.repeatLearning ? learningReview(state) : undefined;
    const next = {
      ...session,
      position: session.position + (step.learningDue === undefined ? 1 : 0),
      updatedAt: now,
      results: rating ? [...session.results, { cardId, rating }] : session.results,
      ...(session.repeatLearning
        ? {
            learning: [
              ...(session.learning ?? []).filter((entry) => entry.cardId !== cardId),
              ...(repeat ? [repeat] : []),
            ],
          }
        : {}),
    };
    return sessions.flatMap((s) =>
      s.id !== step.id ? [s] : hasRemainingSession(next) ? [next] : [],
    );
  }
  advanceCram(step: SessionStep, cardId: string) {
    return this.change((data) => {
      if (data.states[cardId]?.paused) {
        throw new Error('This card is paused. Skip it or resume it before studying.');
      }
      return {
        ...data,
        sessions: this.advanceSession(data.sessions, step, cardId, undefined, Date.now()),
      };
    });
  }
  discardSession(id: string) {
    return this.change((data) => ({ ...data, sessions: data.sessions.filter((s) => s.id !== id) }));
  }
  saveExam(plan: ExamPlan) {
    if (!validExam(plan)) {
      return Promise.reject(
        new Error('Choose a name, valid exam date, study days, daily target and study material.'),
      );
    }
    return this.change((data) => ({
      ...data,
      exams: [...data.exams.filter((p) => p.id !== plan.id), readExams([plan])[0]!],
    }));
  }
  deleteExam(id: string) {
    return this.change((data) => ({ ...data, exams: data.exams.filter((p) => p.id !== id) }));
  }
  flush() {
    return this.queue;
  }
  dispose() {
    this.listeners.clear();
  }
}
