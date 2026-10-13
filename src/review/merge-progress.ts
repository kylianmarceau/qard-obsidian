import { isoDay } from '../learn/mastery';
import { reviewWithFsrs } from './fsrs-scheduler';
import { scheduler, type ReviewEvent, type ReviewState } from './scheduler';
import type { RatingCounts, StudyStatistics } from './statistics';
import type { SavedSession } from './saved-session';
import type { PluginData } from './review-store';
import type { StudyLog } from '../time/study-time';
import type { UsageLog } from '../agents/usage-report';

/**
 * Plugin data can reach this device from another one (Obsidian Sync, iCloud, Git). A synced copy may be
 * newer or older than the last save here, so absence never means deletion: ratings are merged as a set,
 * removals travel as tombstones, and metadata edits carry the time they were made.
 */

/** Card markers that change without a rating; merged by their last change time. */
export const FLAG_KEYS = [
  'paused',
  'needsFixing',
  'repairSince',
  'buriedUntil',
  'needsContentCheck',
] as const;
const MEMORY_KEYS = [
  'lastReviewed',
  'due',
  'interval',
  'ease',
  'reviewCount',
  'lapses',
  'lastRating',
  'fsrs',
] as const;
/** Undo, finished sessions and deleted exams leave tombstones; the newest ones are kept. */
export const MAX_TOMBSTONES = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** JSON with sorted keys, so equal values compare equal however they were built. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isRecord(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || canonical(a) === canonical(b);

export const eventKey = (e: ReviewEvent) => `${e.cardId}|${e.at}|${e.rating}`;
export const eventTombstone = (e: ReviewEvent) => `event:${eventKey(e)}`;
export const sessionTombstone = (id: string) => `session:${id}`;
export const examTombstone = (id: string) => `exam:${id}`;

/** A readable copy of plugin data that contains review progress worth merging. */
export function savedProgress(raw: unknown): raw is Partial<PluginData> {
  return isRecord(raw) && Array.isArray(raw.history) && isRecord(raw.states);
}

const flagsChanged = (a: ReviewState | undefined, b: ReviewState | undefined) =>
  FLAG_KEYS.some((k) => !sameValue(a?.[k], b?.[k]));
const appended = (before: ReviewEvent[], next: ReviewEvent[]) =>
  next.length >= before.length &&
  (!before.length || next[before.length - 1] === before[before.length - 1]);
export const capTombstones = (list: string[]) => [...new Set(list)].slice(-MAX_TOMBSTONES);

/** Stamps metadata edits and records removals, so another device can tell an edit from a stale copy. */
export function recordChanges(
  before: PluginData,
  next: PluginData,
  now: number,
  device: string,
): PluginData {
  const totals = recordTotals(before, next, device);
  let states = next.states;
  if (next.states !== before.states) {
    for (const [id, state] of Object.entries(next.states)) {
      if (state !== before.states[id] && flagsChanged(before.states[id], state)) {
        if (states === next.states) {
          states = Object.assign(Object.create(null) as Record<string, ReviewState>, next.states);
        }
        states[id] = { ...state, flagsAt: now };
      }
    }
  }
  const removed: string[] = [];
  if (next.history !== before.history && !appended(before.history, next.history)) {
    const kept = new Set(next.history.map(eventKey));
    for (const e of before.history) {
      if (!kept.has(eventKey(e))) {
        removed.push(eventTombstone(e));
      }
    }
  }
  const removedIds = <T extends { id: string }>(
    a: T[],
    b: T[],
    tombstone: (id: string) => string,
  ) => {
    if (a !== b) {
      const kept = new Set(b.map((item) => item.id));
      for (const item of a) {
        if (!kept.has(item.id)) {
          removed.push(tombstone(item.id));
        }
      }
    }
  };
  removedIds(before.sessions, next.sessions, sessionTombstone);
  removedIds(before.exams, next.exams, examTombstone);
  const settingsChanged =
    next.settings !== before.settings && !sameValue(next.settings, before.settings);
  if (states === next.states && !removed.length && !settingsChanged && totals === next.totals) {
    return next;
  }
  return {
    ...next,
    states,
    totals,
    removed: removed.length ? capTombstones([...next.removed, ...removed]) : next.removed,
    ...(settingsChanged ? { settingsAt: now } : {}),
  };
}

function groupEvents(history: ReviewEvent[]) {
  const byCard = new Map<string, ReviewEvent[]>();
  for (const e of history) {
    const list = byCard.get(e.cardId) ?? [];
    list.push(e);
    byCard.set(e.cardId, list);
  }
  return byCard;
}
const keysOf = (events: ReviewEvent[] | undefined) => new Set((events ?? []).map(eventKey));
const sameKeys = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((k) => b.has(k));

/** Ratings from both copies, minus any either device undid, in time order. */
function mergeHistory(local: ReviewEvent[], remote: ReviewEvent[], gone: Set<string>) {
  const events = new Map<string, ReviewEvent>();
  for (const e of [...local, ...remote]) {
    const key = eventKey(e);
    if (!events.has(key) && !gone.has(`event:${key}`)) {
      events.set(key, e);
    }
  }
  return [...events.values()].sort((a, b) => a.at - b.at);
}

/** Applies ratings exactly as ReviewStore.review does, without sibling deferral or sessions. */
function replay(
  cardId: string,
  start: ReviewState | undefined,
  events: ReviewEvent[],
  retention: number,
) {
  let state = start;
  for (const e of events) {
    const computed =
      e.scheduler === 'fsrs'
        ? reviewWithFsrs(cardId, state, e.rating, e.at, e.desiredRetention ?? retention)
        : scheduler.reviewCard(cardId, state, e.rating, e.at);
    state = e.scheduled
      ? computed
      : { ...computed, due: state?.due, interval: state?.interval ?? 0, ease: state?.ease ?? 2.5 };
  }
  return state;
}

/** Both devices rated this card: rebuild its memory from the combined ratings. */
function replayCard(
  cardId: string,
  local: ReviewState | undefined,
  remote: ReviewState | undefined,
  events: ReviewEvent[],
  localKeys: Set<string>,
  remoteKeys: Set<string>,
  retention: number,
) {
  const complete = (state: ReviewState | undefined, keys: Set<string>) =>
    (state?.reviewCount ?? 0) === keys.size;
  if (complete(local, localKeys) && complete(remote, remoteKeys)) {
    return replay(cardId, undefined, events, retention);
  }
  // Imported schedules have no complete log: continue the newer copy with the other device's later ratings.
  const useLocal = (local?.lastReviewed ?? -Infinity) >= (remote?.lastReviewed ?? -Infinity);
  const start = useLocal ? local : remote;
  const known = useLocal ? localKeys : remoteKeys;
  const after = start?.lastReviewed ?? -Infinity;
  return replay(
    cardId,
    start,
    events.filter((e) => !known.has(eventKey(e)) && e.at > after),
    retention,
  );
}

function compose(cardId: string, memory?: ReviewState, flags?: ReviewState) {
  if (memory && memory === flags) {
    return memory;
  }
  const flagged = !!flags && FLAG_KEYS.some((k) => flags[k] !== undefined);
  if (!memory && !flagged) {
    return undefined;
  }
  const state: ReviewState = { cardId, interval: 0, ease: 2.5, reviewCount: 0, lapses: 0 };
  const target = state as unknown as Record<string, unknown>;
  if (memory) {
    const source = memory as unknown as Record<string, unknown>;
    for (const k of MEMORY_KEYS) {
      if (source[k] !== undefined) {
        target[k] = source[k];
      }
    }
  }
  if (flags) {
    const source = flags as unknown as Record<string, unknown>;
    for (const k of [...FLAG_KEYS, 'flagsAt']) {
      if (source[k] !== undefined) {
        target[k] = source[k];
      }
    }
  }
  return state;
}

function mergeStates(
  local: PluginData,
  remote: PluginData,
  history: ReviewEvent[],
  retention: number,
) {
  const merged = groupEvents(history),
    localEvents = groupEvents(local.history),
    remoteEvents = groupEvents(remote.history);
  const states = Object.create(null) as Record<string, ReviewState>;
  for (const id of new Set([...Object.keys(local.states), ...Object.keys(remote.states)])) {
    const l = local.states[id],
      r = remote.states[id];
    if (l && r && sameValue(l, r)) {
      states[id] = l;
      continue;
    }
    const events = merged.get(id) ?? [];
    const keys = keysOf(events),
      lk = keysOf(localEvents.get(id)),
      rk = keysOf(remoteEvents.get(id));
    // Markers follow the most recent edit; a tie keeps this device's copy.
    const flags = !l || (r && (r.flagsAt ?? 0) > (l.flagsAt ?? 0)) ? r : l;
    const memory =
      sameKeys(keys, lk) && sameKeys(keys, rk)
        ? flags
        : sameKeys(keys, lk)
          ? l
          : sameKeys(keys, rk)
            ? r
            : replayCard(id, l, r, events, lk, rk, retention);
    const state = compose(id, memory, flags);
    if (state) {
      states[id] = state;
    }
  }
  return states;
}

const maxCounts = (...all: (RatingCounts | undefined)[]): RatingCounts =>
  [0, 1, 2, 3].map((i) => Math.max(0, ...all.map((c) => c?.[i] ?? 0))) as RatingCounts;
const anyCounts = (c: RatingCounts) => c.some((n) => n > 0);

/** Ratings are counted from the merged log where it is complete; older aggregates keep their highest copy. */
function mergeStatistics(local: StudyStatistics, remote: StudyStatistics, history: ReviewEvent[]) {
  const fromLog = {
    daily: {} as Record<string, RatingCounts>,
    cards: {} as Record<string, RatingCounts>,
  };
  for (const e of history) {
    const day = isoDay(e.at);
    for (const [entries, key] of [
      [fromLog.daily, day],
      [fromLog.cards, e.cardId],
    ] as const) {
      const counts: RatingCounts = entries[key] ? [...entries[key]] : [0, 0, 0, 0];
      counts[e.rating - 1] = counts[e.rating - 1]! + 1;
      entries[key] = counts;
    }
  }
  const firstDay = history.length ? isoDay(history[0]!.at) : undefined;
  const daily: Record<string, RatingCounts> = {};
  for (const day of new Set([
    ...Object.keys(local.daily),
    ...Object.keys(remote.daily),
    ...Object.keys(fromLog.daily),
  ])) {
    const counts =
      firstDay !== undefined && day > firstDay
        ? (fromLog.daily[day] ?? [0, 0, 0, 0])
        : maxCounts(local.daily[day], remote.daily[day], fromLog.daily[day]);
    if (anyCounts(counts)) {
      daily[day] = counts;
    }
  }
  const cards = Object.create(null) as Record<string, RatingCounts>;
  for (const id of new Set([
    ...Object.keys(local.cards),
    ...Object.keys(remote.cards),
    ...Object.keys(fromLog.cards),
  ])) {
    const counts = maxCounts(local.cards[id], remote.cards[id], fromLog.cards[id]);
    if (anyCounts(counts)) {
      cards[id] = counts;
    }
  }
  return { daily, cards, partialHistory: local.partialHistory || remote.partialHistory };
}

/** Study time and token usage that one device added; totals are the sum over devices. */
export interface DeviceTotals {
  study: StudyLog;
  usage: UsageLog;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Combines two trees of numbers leaf by leaf; never below zero. */
function combine(a: unknown, b: unknown, op: (x: number, y: number) => number): unknown {
  if (typeof a === 'number' || typeof b === 'number') {
    return Math.round(Math.max(0, op(num(a), num(b))) * 1e6) / 1e6;
  }
  const l = isRecord(a) ? a : {},
    r = isRecord(b) ? b : {};
  return Object.fromEntries(
    [...new Set([...Object.keys(l), ...Object.keys(r)])].map((k) => [k, combine(l[k], r[k], op)]),
  );
}
const onlyDays = <T>(tree: Record<string, T>, days: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(tree).filter(([day]) => day in days));

/**
 * Adds what this change counted to this device's own totals. Each device only ever increases its own
 * entry, so merging keeps the larger copy of every entry and nothing is counted twice.
 */
function recordTotals(before: PluginData, next: PluginData, device: string) {
  if (next.study === before.study && next.usage === before.usage) {
    return next.totals;
  }
  const add = (current: unknown, after: unknown, previous: unknown) =>
    combine(
      current,
      combine(after, previous, (x, y) => x - y),
      (x, y) => x + y,
    );
  const own = next.totals[device] ?? { study: {}, usage: {} };
  const totals = { ...next.totals, [device]: { ...own } };
  for (const field of ['study', 'usage'] as const) {
    if (next[field] === before[field]) {
      continue;
    }
    if (!Object.keys(next[field]).length) {
      // A reset clears every device's entry known here.
      for (const id of Object.keys(totals)) {
        totals[id] = { ...totals[id]!, [field]: {} };
      }
      continue;
    }
    totals[device] = {
      ...totals[device]!,
      [field]: onlyDays(
        add(own[field], next[field], before[field]) as Record<string, unknown>,
        next[field],
      ),
    };
  }
  return totals;
}

function mergeTotals(local: PluginData, remote: PluginData) {
  const totals: Record<string, DeviceTotals> = {};
  for (const id of new Set([...Object.keys(local.totals), ...Object.keys(remote.totals)])) {
    const l = local.totals[id],
      r = remote.totals[id];
    totals[id] = {
      study: combine(l?.study, r?.study, Math.max) as StudyLog,
      usage: combine(l?.usage, r?.usage, Math.max) as UsageLog,
    };
  }
  const devices = Object.values(totals);
  const sum = (pick: (d: DeviceTotals) => unknown) =>
    devices.reduce<unknown>((acc, d) => combine(acc, pick(d), (x, y) => x + y), {});
  const study = sum((d) => d.study) as StudyLog;
  const usage = sum((d) => d.usage) as UsageLog;
  // Keep the same windows as addStudy (a year) and addToLog (180 days).
  const days = Object.keys(study).sort();
  const oldest = days.length
    ? isoDay(new Date(`${days[days.length - 1]!}T12:00:00`).getTime() - 365 * 86_400_000)
    : '';
  const usageDays = new Set(Object.keys(usage).sort().slice(-180));
  return {
    totals,
    study: Object.fromEntries(Object.entries(study).filter(([day]) => day >= oldest)),
    usage: Object.fromEntries(Object.entries(usage).filter(([day]) => usageDays.has(day))),
  };
}

/** Keeps this device's value when it changed since the last save; otherwise takes the other copy's. */
const changedValue = <T>(base: T | undefined, local: T | undefined, remote: T | undefined) =>
  local === undefined ? remote : remote !== undefined && sameValue(local, base) ? remote : local;

function mergeRecords<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
) {
  const out = Object.create(null) as Record<string, T>;
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    out[k] = changedValue(base[k], local[k], remote[k])!;
  }
  return out;
}

function mergeItems<T extends { id: string }>(
  local: T[],
  remote: T[],
  gone: Set<string>,
  tombstone: (id: string) => string,
  choose: (local: T, remote: T) => T,
) {
  const byId = new Map(remote.map((item) => [item.id, item]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of [...local, ...remote]) {
    if (seen.has(item.id) || gone.has(tombstone(item.id))) {
      continue;
    }
    seen.add(item.id);
    const other = byId.get(item.id);
    out.push(other && other !== item ? choose(item, other) : item);
  }
  return out;
}

/** Combines this device's progress with a copy saved elsewhere. `base` is the last copy this device saved or read. */
export function mergeProgress(base: PluginData, local: PluginData, remote: PluginData): PluginData {
  const removed = capTombstones([...remote.removed, ...local.removed]);
  const gone = new Set(removed);
  const history = mergeHistory(local.history, remote.history, gone);
  const remoteSettings = (remote.settingsAt ?? 0) > (local.settingsAt ?? 0);
  const settings = remoteSettings ? remote.settings : local.settings;
  const settingsAt = remoteSettings ? remote.settingsAt : local.settingsAt;
  const exams = new Map(base.exams.map((e) => [e.id, e]));
  return {
    ...local,
    settings,
    ...(settingsAt !== undefined ? { settingsAt } : {}),
    removed,
    history,
    states: mergeStates(local, remote, history, settings.desiredRetention),
    statistics: mergeStatistics(local.statistics, remote.statistics, history),
    links: mergeRecords(base.links, local.links, remote.links),
    timings: mergeRecords(base.timings, local.timings, remote.timings),
    ...mergeTotals(local, remote),
    sessions: mergeItems<SavedSession>(
      local.sessions,
      remote.sessions,
      gone,
      sessionTombstone,
      (l, r) => (r.updatedAt > l.updatedAt ? r : l),
    ),
    exams: mergeItems(
      local.exams,
      remote.exams,
      gone,
      examTombstone,
      (l, r) => changedValue(exams.get(l.id), l, r)!,
    ),
  };
}
