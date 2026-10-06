import { useMemo, useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import { tokens, usageReport, type UsageRow, type UsageTotals } from '../../agents/usage-report';
import { addDays, isoDay } from '../../learn/mastery';

type Range = 'today' | 'week' | 'month' | 'all';
const RANGES: { id: Range; label: string; days?: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'all', label: 'All time' },
];
/** 1,234 → "1.2k", 3,400,000 → "3.4M". */
export const compact = (n: number) =>
  n < 1000
    ? String(Math.round(n))
    : n < 1_000_000
      ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
      : `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
const money = (t: UsageTotals) =>
  t.costCalls ? `$${t.costUsd < 1 ? t.costUsd.toFixed(3) : t.costUsd.toFixed(2)}` : '—';

/** Token usage by Qard: totals for a range, a daily chart, and breakdowns by feature and by connection and model. */
export function UsageView({ services }: { services: QardServices }) {
  const data = useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot);
  const [range, setRange] = useState<Range>('week'),
    [confirm, setConfirm] = useState(false);
  const today = isoDay(Date.now()),
    days = RANGES.find((r) => r.id === range)!.days;
  const report = useMemo(
    () => usageReport(data.usage ?? {}, days ? addDays(today, 1 - days) : undefined),
    [data.usage, days, today],
  );
  // Every day of the range gets a bar, including days with no use.
  const bars = useMemo(() => {
    if (!days || days === 1) {
      return [];
    }
    const byDay = new Map(report.daily.map((d) => [d.day, d.totals]));
    return Array.from({ length: days }, (_, i) => {
      const day = addDays(today, i + 1 - days);
      return { day, totals: byDay.get(day) };
    });
  }, [report, days, today]);
  const peak = Math.max(1, ...bars.map((b) => (b.totals ? tokens(b.totals) : 0)));
  const t = report.totals,
    empty = !t.calls;
  return (
    <div className="qard-usage">
      <div className="qard-heading">
        <div>
          <h1>Token usage</h1>
          <p className="qard-muted">
            Every call Qard makes to Claude Code, Codex, the Anthropic API or OpenRouter.
          </p>
        </div>
        <div className="qard-segmented" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <div className="qard-empty">
          <p>No usage {range === 'all' ? 'yet' : 'in this period'}.</p>
          <p className="qard-muted">
            Usage is recorded from the moment this version of Qard is installed.
          </p>
        </div>
      ) : (
        <>
          <section className="qard-usage-summary">
            <div className="qard-usage-total">
              <strong>{compact(tokens(t))}</strong>
              <span className="qard-muted">
                tokens · {t.calls} {t.calls === 1 ? 'run' : 'runs'}
              </span>
            </div>
            <dl className="qard-usage-stats">
              <div>
                <dt>Input</dt>
                <dd>{compact(t.input)}</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{compact(t.output)}</dd>
              </div>
              <div>
                <dt>Cache read</dt>
                <dd>{compact(t.cacheRead)}</dd>
              </div>
              <div>
                <dt>Cache write</dt>
                <dd>{compact(t.cacheWrite)}</dd>
              </div>
              <div>
                <dt>Reported cost</dt>
                <dd>{money(t)}</dd>
              </div>
            </dl>
          </section>
          {bars.length > 0 && (
            <section className="qard-usage-chart" aria-label="Tokens per day">
              {bars.map((b) => {
                const total = b.totals ? tokens(b.totals) : 0,
                  part = (n: number) => `${(n / peak) * 100}%`;
                return (
                  <div
                    key={b.day}
                    className="qard-usage-day"
                    title={`${b.day}: ${compact(total)} tokens`}
                  >
                    <div className="qard-usage-bar">
                      {b.totals && (
                        <>
                          <span
                            className="is-cache"
                            style={{ height: part(b.totals.cacheRead + b.totals.cacheWrite) }}
                          />
                          <span className="is-input" style={{ height: part(b.totals.input) }} />
                          <span className="is-output" style={{ height: part(b.totals.output) }} />
                        </>
                      )}
                    </div>
                    <small>{b.day.slice(8)}</small>
                  </div>
                );
              })}
            </section>
          )}
          {bars.length > 0 && (
            <div className="qard-usage-legend">
              <span className="is-input">
                <i />
                Input
              </span>
              <span className="is-output">
                <i />
                Output
              </span>
              <span className="is-cache">
                <i />
                Cache
              </span>
            </div>
          )}
          <UsageTable title="By feature" rows={report.byFeature} />
          <UsageTable title="By connection and model" rows={report.byModel} />
        </>
      )}
      <p className="qard-muted qard-small">
        Cost is shown only where the provider reports it: OpenRouter, and Claude Code (an estimate
        at API prices; a Claude subscription isn't billed per token). Anthropic API and Codex runs
        show tokens only. Counts are kept for 180 days in Qard's plugin data.
      </p>
      {!empty &&
        (confirm ? (
          <p className="qard-small">
            {'Clear all recorded usage? '}
            <button
              className="qard-text-button"
              onClick={() => {
                void services.reviews.resetUsage();
                setConfirm(false);
              }}
            >
              Clear
            </button>
            <button className="qard-text-button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </p>
        ) : (
          <button className="qard-text-button qard-small" onClick={() => setConfirm(true)}>
            Clear usage history
          </button>
        ))}
    </div>
  );
}

function UsageTable({ title, rows }: { title: string; rows: UsageRow[] }) {
  return (
    <section>
      <div className="qard-label">{title}</div>
      <table className="qard-usage-table">
        <thead>
          <tr>
            <th />
            <th>Runs</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label + (r.detail ?? '')}>
              <td>
                <strong>{r.label}</strong>
                {r.detail && <small className="qard-muted">{r.detail}</small>}
              </td>
              <td>{r.totals.calls}</td>
              <td>{compact(r.totals.input)}</td>
              <td>{compact(r.totals.output)}</td>
              <td>{compact(r.totals.cacheRead + r.totals.cacheWrite)}</td>
              <td>{money(r.totals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
