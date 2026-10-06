import { flashcardBatchSchema, flashcardsSchema } from '../cards/generation-schema';
import type { Schema } from '../tests/test-schema';
import {
  askSchema,
  disputeSchema,
  marksSchema,
  planSchema,
  retrySchema,
  testSchema,
  wrapupSchema,
} from '../tests/test-schema';
import {
  answerSchema,
  closeSchema,
  courseUpdateSchema,
  mapSchema,
  objectivesSchema,
  probeMapSchema,
  probeSchema,
  questionsSchema,
  stepSchema,
  tutorMarkSchema,
} from '../learn/learn-schema';
import type { Usage } from './usage';
import { sourceSuggestionSchema } from '../cards/source-sync-schema';

/** Per-day totals, keyed "feature|role|connection|model". */
export interface UsageTotals {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  costCalls: number;
}
export type UsageLog = Record<string, Record<string, UsageTotals>>;

/** Which feature a run served, from the reply format it was asked for. No call site needs to say. */
const PURPOSES = new Map<Schema, string>([
  [sourceSuggestionSchema, 'Updating flashcards'],
  [flashcardsSchema, 'Writing flashcards'],
  [flashcardBatchSchema, 'Writing flashcards'],
  [planSchema, 'Test plans'],
  [testSchema, 'Writing tests'],
  [marksSchema, 'Marking'],
  [wrapupSchema, 'Test summaries'],
  [retrySchema, 'Test review'],
  [askSchema, 'Test review'],
  [disputeSchema, 'Test review'],
  [objectivesSchema, 'Course mapping'],
  [courseUpdateSchema, 'Course mapping'],
  [questionsSchema, 'Writing checks'],
  [probeSchema, 'Lesson planning'],
  [probeMapSchema, 'Lesson planning'],
  [mapSchema, 'Lesson planning'],
  [stepSchema, 'Writing lessons'],
  [tutorMarkSchema, 'Tutoring'],
  [answerSchema, 'Tutoring'],
  [closeSchema, 'Lesson wrap-ups'],
]);
export const purposeOf = (schema: Schema) => PURPOSES.get(schema) ?? 'Other';
export const usageKey = (purpose: string, role: string, provider: string, model: string) =>
  [purpose, role, provider, model || 'default'].join('|');

export function addToLog(
  log: UsageLog,
  day: string,
  key: string,
  u: Usage,
  keepDays = 180,
): UsageLog {
  const today = { ...(log[day] ?? {}) },
    t = today[key] ?? {
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
      costCalls: 0,
    };
  today[key] = {
    calls: t.calls + 1,
    input: t.input + u.input,
    output: t.output + u.output,
    cacheRead: t.cacheRead + u.cacheRead,
    cacheWrite: t.cacheWrite + u.cacheWrite,
    costUsd: t.costUsd + (u.costUsd ?? 0),
    costCalls: t.costCalls + (u.costUsd === undefined ? 0 : 1),
  };
  const next = { ...log, [day]: today };
  for (const d of Object.keys(next).sort().slice(0, -keepDays)) delete next[d];
  return next;
}

export interface UsageRow {
  label: string;
  detail?: string;
  totals: UsageTotals;
}
export interface UsageReport {
  totals: UsageTotals;
  byFeature: UsageRow[];
  byModel: UsageRow[];
  daily: { day: string; totals: UsageTotals }[];
}
const zero = (): UsageTotals => ({
  calls: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  costCalls: 0,
});
const add = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  calls: a.calls + b.calls,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  costUsd: a.costUsd + b.costUsd,
  costCalls: a.costCalls + b.costCalls,
});
export const tokens = (t: UsageTotals) => t.input + t.output + t.cacheRead + t.cacheWrite;
const PROVIDERS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  anthropic: 'Anthropic API',
  openrouter: 'OpenRouter',
};

/** Totals from `from` (a YYYY-MM-DD day, inclusive) onwards, by feature, by connection and model, and by day. */
export function usageReport(log: UsageLog, from?: string): UsageReport {
  const feature = new Map<string, UsageTotals>(),
    model = new Map<string, UsageTotals>(),
    daily: UsageReport['daily'] = [];
  let totals = zero();
  for (const day of Object.keys(log).sort()) {
    if (from && day < from) continue;
    let dayTotal = zero();
    for (const [key, t] of Object.entries(log[day]!)) {
      const [purpose = 'Other', , provider = '', name = 'default'] = key.split('|');
      feature.set(purpose, add(feature.get(purpose) ?? zero(), t));
      const m = `${provider}|${name}`;
      model.set(m, add(model.get(m) ?? zero(), t));
      dayTotal = add(dayTotal, t);
    }
    totals = add(totals, dayTotal);
    daily.push({ day, totals: dayTotal });
  }
  const rows = (
    map: Map<string, UsageTotals>,
    label: (k: string) => { label: string; detail?: string },
  ) =>
    [...map]
      .map(([k, t]) => ({ ...label(k), totals: t }))
      .sort((a, b) => tokens(b.totals) - tokens(a.totals));
  return {
    totals,
    daily,
    byFeature: rows(feature, (k) => ({ label: k })),
    byModel: rows(model, (k) => {
      const [p = '', m = ''] = k.split('|');
      return { label: PROVIDERS[p] ?? p, detail: m === 'default' ? 'default model' : m };
    }),
  };
}
