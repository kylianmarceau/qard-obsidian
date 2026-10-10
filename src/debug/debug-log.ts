/**
 * Developer diagnostics. Every event goes into an in-memory ring buffer (cheap, always on, so `qard.log()` in the
 * console can show what led up to a problem). With debug logging turned on, events are also printed to the
 * console and appended to debug.log in the plugin folder, and each agent run's prompt and reply is saved.
 * Nothing here is shown in Qard's interface or sent anywhere.
 */
export interface DebugEvent {
  t: number;
  area: string;
  event: string;
  data?: Record<string, unknown>;
}
/** Where debug files go; injected by the plugin so tests and mobile need no file system. */
export interface DebugSink {
  append(line: string): Promise<void>;
  saveRun(name: string, body: string): Promise<void>;
}

const BUFFER = 3000;
let seq = 0;

export class DebugLog {
  enabled = false;
  private events: DebugEvent[] = [];
  private sink?: DebugSink;
  private writing: Promise<void> = Promise.resolve();
  /** Agent runs and jobs in flight, by id, for `qard.runs()`. */
  readonly inFlight = new Map<
    string,
    { area: string; name: string; started: number; data: Record<string, unknown> }
  >();

  attach(sink: DebugSink | undefined) {
    this.sink = sink;
  }
  log(area: string, event: string, data?: Record<string, unknown>) {
    const entry: DebugEvent = { t: Date.now(), area, event, ...(data ? { data } : {}) };
    this.events.push(entry);
    if (this.events.length > BUFFER) {
      this.events.splice(0, this.events.length - BUFFER);
    }
    if (!this.enabled) {
      return;
    }
    console.debug(`[Qard:${area}] ${event}`, data ?? '');
    const sink = this.sink;
    if (sink) {
      this.writing = this.writing
        .then(() =>
          sink.append(`${JSON.stringify({ ...entry, time: new Date(entry.t).toISOString() })}\n`),
        )
        .catch(() => {});
    }
  }
  /** Logs a start event now and an end or failure event later, with the duration, and tracks it while in flight. */
  span(area: string, name: string, data: Record<string, unknown> = {}) {
    const id = `${area}#${++seq}`,
      started = Date.now();
    this.inFlight.set(id, { area, name, started, data });
    this.log(area, `${name} start`, { id, ...data });
    const finish = (event: string, extra: Record<string, unknown>) => {
      if (!this.inFlight.delete(id)) {
        return;
      }
      this.log(area, `${name} ${event}`, { id, ms: Date.now() - started, ...data, ...extra });
    };
    return {
      id,
      note: (event: string, extra: Record<string, unknown> = {}) =>
        this.log(area, `${name} ${event}`, { id, ms: Date.now() - started, ...extra }),
      end: (extra: Record<string, unknown> = {}) => finish('done', extra),
      fail: (error: unknown, extra: Record<string, unknown> = {}) =>
        finish('failed', { error: errorText(error), ...extra }),
    };
  }
  /** Saves a full prompt and reply when debug logging is on. */
  saveRun(name: string, body: unknown) {
    const sink = this.sink;
    if (!this.enabled || !sink) {
      return;
    }
    this.writing = this.writing
      .then(() => sink.saveRun(name, JSON.stringify(body, null, 2)))
      .catch(() => {});
  }
  recent(filter?: string | RegExp, limit = 200): DebugEvent[] {
    const match = (e: DebugEvent) =>
      !filter ||
      (typeof filter === 'string'
        ? `${e.area} ${e.event} ${JSON.stringify(e.data ?? {})}`.includes(filter)
        : filter.test(`${e.area} ${e.event}`));
    return this.events.filter(match).slice(-limit);
  }
  clear() {
    this.events = [];
  }
  flush() {
    return this.writing;
  }
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** Long text shortened for a log line: its length, start and end. */
export const clip = (text: string, keep = 300) =>
  text.length <= keep * 2
    ? text
    : `${text.slice(0, keep)} …[${text.length - keep * 2} chars]… ${text.slice(-keep)}`;

/** The one log for the plugin. */
export const debug = new DebugLog();
