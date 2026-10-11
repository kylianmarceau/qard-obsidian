import { DEFAULT_SETTINGS, readSettings, type QardSettings } from '../settings/settings';
import { scheduler, type Rating, type ReviewEvent, type ReviewState } from './scheduler';
export interface PluginData { version: 1; settings: QardSettings; states: Record<string, ReviewState>; history: ReviewEvent[] }
export class ReviewStore {
  private data: PluginData = { version: 1, settings: DEFAULT_SETTINGS, states: Object.create(null) as Record<string, ReviewState>, history: [] };
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
    this.data = { version: 1, settings: readSettings(value.settings), states, history };
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
  flush() { return this.queue; }
  dispose() { this.listeners.clear(); }
}
