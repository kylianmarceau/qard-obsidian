import { Notice, normalizePath, type App } from 'obsidian';
import { debug, type DebugSink } from './debug-log';
import type { LearnService } from '../learn/learn-service';
import type { TestService } from '../tests/test-service';
import type { QardSettings } from '../settings/settings';

const KEEP_RUNS = 100;
const MAX_LOG = 5_000_000;

interface Plugin {
  app: App;
  manifest: { dir?: string; version: string };
  learn: LearnService;
  tests: TestService;
  reviews: { getSnapshot(): { settings: QardSettings } };
}

/** debug.log and saved runs live in the plugin folder: .obsidian/plugins/qard/debug.log and debug/runs/. */
function sink(app: App, dir: string): DebugSink {
  const adapter = app.vault.adapter,
    log = normalizePath(`${dir}/debug.log`),
    runs = normalizePath(`${dir}/debug/runs`);
  let checked = false;
  return {
    async append(line) {
      if (!checked) {
        checked = true;
        const stat = await adapter.stat(log).catch(() => null);
        if (stat && stat.size > MAX_LOG) {
          await adapter.rename(log, `${log}.old`).catch(() => {});
        }
      }
      await adapter.append(log, line);
    },
    async saveRun(name, body) {
      if (!(await adapter.exists(runs))) {
        await adapter.mkdir(runs);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await adapter.write(
        `${runs}/${stamp}-${name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`,
        body,
      );
      const files = (await adapter.list(runs)).files.sort();
      for (const old of files.slice(0, Math.max(0, files.length - KEEP_RUNS))) {
        await adapter.remove(old).catch(() => {});
      }
    },
  };
}

const age = (t?: number) =>
  t === undefined ? undefined : `${Math.round((Date.now() - t) / 1000)}s`;
const row = (e: { t: number; area: string; event: string; data?: Record<string, unknown> }) => ({
  time: new Date(e.t).toLocaleTimeString(),
  area: e.area,
  event: e.event,
  data: e.data ? JSON.stringify(e.data) : '',
});

/**
 * Developer tools, with no change to Qard's interface: two commands (toggle debug logging, write a debug report)
 * and a `qard` object in the developer console (Cmd/Ctrl+Option+I). Run `qard.help()` there.
 */
export function installDevTools(
  plugin: Plugin,
  addCommand: (c: { id: string; name: string; callback: () => void }) => void,
): () => void {
  const { app } = plugin,
    dir = plugin.manifest.dir ?? `${app.vault.configDir}/plugins/qard`;
  debug.attach(sink(app, dir));
  // Logging stays on across reloads while this marker file exists.
  const marker = normalizePath(`${dir}/debug/enabled`);
  const setEnabled = async (on: boolean) => {
    debug.enabled = on;
    debug.log('debug', on ? 'logging on' : 'logging off', { version: plugin.manifest.version });
    if (on) {
      if (!(await app.vault.adapter.exists(normalizePath(`${dir}/debug`)))) {
        await app.vault.adapter.mkdir(normalizePath(`${dir}/debug`));
      }
      await app.vault.adapter.write(marker, '');
    } else if (await app.vault.adapter.exists(marker)) {
      await app.vault.adapter.remove(marker);
    }
  };
  void app.vault.adapter.exists(marker).then(
    (on) => {
      if (on) {
        debug.enabled = true;
        debug.log('debug', 'logging on', { version: plugin.manifest.version });
      }
    },
    () => {},
  );

  const jobs = () => [
    ...Object.entries(plugin.learn.getSnapshot().jobs).map(([key, j]) => ({
      service: 'learn',
      key,
      kind: j.kind,
      age: age(j.startedAt),
      error: j.error ?? '',
    })),
    ...Object.entries(plugin.tests.getSnapshot().jobs).map(([key, j]) => ({
      service: 'tests',
      key,
      kind: j.kind,
      age: age(j.startedAt),
      error: j.error ?? '',
    })),
  ];
  const report = async () => {
    const { settings } = plugin.reviews.getSnapshot();
    const body = {
      written: new Date().toISOString(),
      version: plugin.manifest.version,
      debugLogging: debug.enabled,
      roles: settings.agents.roles,
      jobs: jobs(),
      inFlight: [...debug.inFlight.entries()].map(([id, r]) => ({ id, ...r, age: age(r.started) })),
      events: debug.recent(undefined, 3000),
    };
    const path = normalizePath(
      `${dir}/debug/report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    if (!(await app.vault.adapter.exists(normalizePath(`${dir}/debug`)))) {
      await app.vault.adapter.mkdir(normalizePath(`${dir}/debug`));
    }
    await app.vault.adapter.write(path, JSON.stringify(body, null, 2));
    return path;
  };
  const api = {
    help() {
      return `Qard developer tools
  qard.debug(true|false)   turn debug logging on or off (also: command "Qard: Toggle debug logging")
  qard.log(filter?, n?)    recent events; filter is text or a RegExp, e.g. qard.log('openrouter') or qard.log(/failed/)
  qard.errors()            recent failures, timeouts, rejected replies and cancels
  qard.jobs()              Qard's jobs (lessons, checks, tests…) with their age and error
  qard.runs()              agent runs, processes and jobs in flight right now, with their age
  qard.lesson(path?)       a lesson's saved state; without a path, the most recently opened one
  qard.cancel(key)         cancel a job by the key qard.jobs() shows
  qard.report()            write everything above to a JSON file in the plugin folder
With logging on, events also go to ${dir}/debug.log and each run's full prompt and reply to ${dir}/debug/runs/.
Tables read best with console.table, e.g. console.table(qard.log('agent')).`;
    },
    debug(on = !debug.enabled) {
      void setEnabled(on);
      return `Debug logging ${on ? 'on' : 'off'}`;
    },
    log(filter?: string | RegExp, n = 100) {
      return debug.recent(filter, n).map(row);
    },
    errors(n = 50) {
      return debug.recent(/failed|timed out|rejected|error|cancel/, n).map(row);
    },
    jobs,
    runs() {
      return [...debug.inFlight.entries()].map(([id, r]) => ({
        id,
        name: r.name,
        age: age(r.started),
        data: JSON.stringify(r.data),
      }));
    },
    lesson(path?: string) {
      const target = path ?? debug.recent(/^lesson open$/).at(-1)?.data?.path;
      return typeof target === 'string'
        ? (plugin.learn.lessonAt(target) ?? `Not loaded: ${target}`)
        : 'No lesson opened yet; pass a path.';
    },
    cancel(key: string) {
      const [target = '', kind = '', id = ''] = key.split('|');
      if (key in plugin.learn.getSnapshot().jobs) {
        plugin.learn.cancel(target, kind as never, id);
      } else {
        plugin.tests.cancel(target, kind as never, id);
      }
      return `Cancel requested: ${key}`;
    },
    report,
    plugin,
  };
  (window as unknown as { qard?: typeof api }).qard = api;

  addCommand({
    id: 'toggle-debug-logging',
    name: 'Toggle debug logging',
    callback: () => {
      void setEnabled(!debug.enabled);
      new Notice(
        `Qard debug logging ${debug.enabled ? 'on' : 'off'}. Run qard.help() in the developer console.`,
      );
    },
  });
  addCommand({
    id: 'write-debug-report',
    name: 'Write debug report',
    callback: () => {
      void report().then(
        (path) => new Notice(`Debug report written to ${path}`),
        (e) => new Notice(`Could not write the report: ${(e as Error).message}`),
      );
    },
  });
  return () => {
    void debug.flush();
    delete (window as unknown as { qard?: unknown }).qard;
    debug.attach(undefined);
  };
}
