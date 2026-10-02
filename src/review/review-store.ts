import { DEFAULT_SETTINGS, readSettings, type QardSettings } from '../settings/settings';
import { scheduler, type Rating, type ReviewEvent, type ReviewState } from './scheduler';
import { addToLog, type UsageLog } from '../agents/usage-report';
import type { Usage } from '../agents/usage';
import { addStudy, type StudyLog } from '../time/study-time';
/** A card made for a mastery objective; lapses count Again ratings since the objective was last marked. */
export interface CardLink { mastery: string; objective: string; lapses: number }
export interface PluginData { version: 1; settings: QardSettings; states: Record<string, ReviewState>; history: ReviewEvent[]; links: Record<string, CardLink>; timings: Record<string, number[]>; usage: UsageLog; study: StudyLog }
export class ReviewStore {
  private data: PluginData = { version: 1, settings: DEFAULT_SETTINGS, states: Object.create(null) as Record<string, ReviewState>, history: [], links: Object.create(null) as Record<string, CardLink>, timings: {}, usage: {}, study: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private persist: (data: PluginData) => Promise<void>) {}
  load(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Partial<PluginData>;
    const states: Record<string, ReviewState> = Object.create(null) as Record<string, ReviewState>;
    for (const [id, state] of Object.entries(value.states || {})) {
      if (state && typeof state === 'object' && /^[A-Za-z0-9_-]+$/.test(id) && Number.isFinite(state.reviewCount) && state.reviewCount >= 0 && Number.isFinite(state.interval) && Number.isFinite(state.ease)) states[id] = state;
    }
    const history = Array.isArray(value.history) ? value.history.filter(e => e && typeof e.cardId === 'string' && [1,2,3,4].includes(e.rating) && Number.isFinite(e.at)).slice(-10000) : [];
    const links: Record<string, CardLink> = Object.create(null) as Record<string, CardLink>;
    for (const [id, link] of Object.entries(value.links || {})) {
      if (/^[A-Za-z0-9_-]+$/.test(id) && link && typeof link.mastery === 'string' && typeof link.objective === 'string') links[id] = { mastery: link.mastery, objective: link.objective, lapses: Number.isFinite(link.lapses) ? link.lapses : 0 };
    }
    const timings: Record<string, number[]> = {};
    for (const [k, list] of Object.entries(value.timings || {})) if (Array.isArray(list)) timings[k] = list.filter(n => Number.isFinite(n) && n > 0).slice(-9);
    const usage: UsageLog = {};
    for (const [day, entries] of Object.entries(value.usage || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && entries && typeof entries === 'object') usage[day] = entries;
    const study: StudyLog = {};
    for (const [day, entries] of Object.entries(value.study || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entries || typeof entries !== 'object') continue;
      const valid = Object.entries(entries).filter(([k, s]) => typeof k === 'string' && Number.isFinite(s) && s > 0);
      if (valid.length) study[day] = Object.fromEntries(valid);
    }
    this.data = { version: 1, settings: readSettings(value.settings), states, history, links, timings, usage, study };
  }
  getSnapshot = () => this.data;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private change(transform: (data: PluginData) => PluginData): Promise<void> {
    const operation = this.queue.catch(() => {}).then(async () => {
      const next = transform(this.data);
      await this.persist(next); // A failed write must never advance the session's state.
      this.data = next; this.listeners.forEach(listener => listener());
    });
    this.queue = operation; return operation;
  }
  saveSettings(settings: QardSettings) { return this.change(data => ({ ...data, settings })); }
  review(cardId: string, rating: Rating, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]+$/.test(cardId)) return Promise.reject(new Error('A stable card ID is required before reviewing.'));
    return this.change(data => {
      const previous = data.states[cardId];
      const scheduled = data.settings.scheduling;
      const state = scheduled ? scheduler.reviewCard(cardId, previous, rating, now) : {
        cardId, reviewCount: (previous?.reviewCount || 0) + 1, lastReviewed: now, lastRating: rating,
        interval: previous?.interval || 0, ease: previous?.ease || 2.5, lapses: (previous?.lapses || 0) + (rating === 1 ? 1 : 0), due: previous?.due
      };
      return { ...data, states: Object.assign(Object.create(null) as Record<string, ReviewState>, data.states, { [cardId]: state }), history: [...data.history, { cardId, at: now, rating, scheduled }].slice(-10000) };
    });
  }
  /** Adds migrated schedules. Existing Qard states always win. */
  importStates(states: ReviewState[]) {
    const valid = states.filter(s => /^[A-Za-z0-9_-]+$/.test(s.cardId) && Number.isFinite(s.interval) && Number.isFinite(s.ease) && s.reviewCount >= 0);
    if (!valid.length) return Promise.resolve();
    return this.change(data => {
      const next = Object.assign(Object.create(null) as Record<string, ReviewState>, data.states);
      for (const state of valid) if (!next[state.cardId]) next[state.cardId] = state;
      return { ...data, states: next };
    });
  }
  link(cardId: string, link: CardLink) {
    return this.change(data => ({ ...data, links: Object.assign(Object.create(null) as Record<string, CardLink>, data.links, { [cardId]: link }) }));
  }
  /** Recent job durations (ms) by job kind, connection and model, for time-left estimates. */
  recordTiming(key: string, ms: number) {
    return this.change(data => ({ ...data, timings: { ...data.timings, [key]: [...(data.timings[key] ?? []), Math.round(ms)].slice(-9) } }));
  }
  /** Adds one agent run's tokens to the day's totals. */
  recordUsage(day: string, key: string, usage: Usage) { return this.change(data => ({ ...data, usage: addToLog(data.usage, day, key, usage) })); }
  resetUsage() { return this.change(data => ({ ...data, usage: {} })); }
  /** Adds counted study time. */
  recordStudy(add: StudyLog, today: string) { return this.change(data => ({ ...data, study: addStudy(data.study, add, today) })); }
  resetStudy() { return this.change(data => ({ ...data, study: {} })); }
  flush() { return this.queue; }
  dispose() { this.listeners.clear(); }
}
