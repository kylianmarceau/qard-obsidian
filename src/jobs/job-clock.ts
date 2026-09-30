import type { AgentRole } from '../agents/runner';
import type { RoleSetting } from '../settings/settings';

/** Which role each kind of job runs as, so timings are kept per connection and model. */
export const ROLE: Record<string, AgentRole> = {
  plan: 'writer', generate: 'writer', wrapup: 'writer', mark: 'marker', dispute: 'marker', retry: 'tutor', ask: 'tutor',
  'map-course': 'writer', 'check-write': 'writer', steps: 'writer', close: 'writer', 'check-mark': 'tutor', probe: 'tutor', map: 'tutor', revise: 'tutor', tutor: 'tutor'
};

/** The role a kind of job runs as. */
export const roleOf = (kind: string): AgentRole => ROLE[kind] ?? 'writer';
/** Learns how long each kind of job takes (median of recent runs) so waiting screens can say how long is left. */
export class JobClock {
  constructor(private timings: () => Record<string, number[]>, private save: (key: string, ms: number) => Promise<void>, private roles: () => Record<AgentRole, RoleSetting>) {}
  private key(kind: string) { const r = this.roles()[ROLE[kind] ?? 'writer']; return `${kind}|${r.provider}|${r.model}`; }
  record(kind: string, ms: number) { if (ms > 500) void this.save(this.key(kind), ms).catch(() => {}); }
  /** Typical duration in ms, or undefined before the first run. */
  estimate(kind: string): number | undefined {
    const list = [...(this.timings()[this.key(kind)] ?? [])].sort((a, b) => a - b);
    return list.length ? list[Math.floor(list.length / 2)] : undefined;
  }
}
/** "about 2 min left", "about 40 s left" or "almost ready". */
export function timeLeft(estimate: number | undefined, startedAt: number | undefined, now = Date.now()): string | undefined {
  if (estimate === undefined || startedAt === undefined) return undefined;
  const left = estimate - (now - startedAt);
  if (left < 10_000) return 'almost ready';
  return left < 60_000 ? `about ${Math.round(left / 10_000) * 10} s left` : `about ${Math.round(left / 60_000)} min left`;
}
