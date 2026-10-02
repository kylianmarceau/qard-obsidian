// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanSvg, figureMarkdown, figureName } from '../src/learn/figures';
import { pythonRunner, PY_AFTER } from '../src/agents/python';
import type { NodeHost } from '../src/agents/cli-runner';
import { readSettings } from '../src/settings/settings';

describe('figures', () => {
  it('keeps only drawing in an SVG', () => {
    const out = cleanSvg('Here it is:\n<svg viewBox="0 0 10 10" onload="x()"><script>x()</script><foreignObject><div/></foreignObject><a href="https://evil.example"><text x="1" y="2" fill="url(#g)">hi</text></a><image href="file:///etc/passwd"/><rect style="background:url(https://x)" width="1" height="1"/><use href="#g"/></svg>');
    expect(out).not.toMatch(/script|onload|foreignObject|evil|passwd|https/);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<use href="#g"/>');
    expect(() => cleanSvg('<svg viewBox="0 0 1 1"><text>unclosed</svg>')).toThrow(/well-formed/);
    expect(() => cleanSvg('<svg><text>x</text></svg>')).toThrow(/viewBox/);
    expect(() => cleanSvg('<svg viewBox="0 0 1 1"></svg>')).toThrow(/draws nothing/);
    expect(() => cleanSvg('no figure')).toThrow(/<svg>/);
  });

  it('names and captions figures the way the vault does', () => {
    expect(figureName('Beta shapes (α=2, β=5)!')).toBe('beta-shapes-2-5');
    expect(figureName('student_t tails 2026')).toBe('student-t-tails-2026');
    expect(figureName('!!!')).toBe('figure');
    expect(figureMarkdown({ path: 'assets/statistics/beta.svg', caption: '*Figure: Beta(2,5).*' })).toBe('![[assets/statistics/beta.svg|700]]\n\n*Figure: Beta(2,5).*');
  });

  it('runs plot scripts sandboxed, with the style set and the figure saved by Qard', async () => {
    const calls: { command: string; args: string[]; input: string; env: Record<string, string | undefined> }[] = [];
    const host: NodeHost = {
      env: { PATH: '/usr/bin' }, home: '/home/me', windows: false, exists: p => p === '/usr/bin/python3' || p === '/usr/bin/sandbox-exec', readFile: () => '', remove: () => {}, tempFile: n => `/tmp/${n}`,
      spawn: (command, args, options) => {
        const handlers: Record<string, (x: unknown) => void> = {}, out: { l?: (c: { toString(): string }) => void } = {};
        return { stdout: { on: (_: string, l: (c: { toString(): string }) => void) => { out.l = l; } }, stderr: { on: () => {} }, kill: () => true,
          stdin: { on: () => {}, end: (input: string) => { calls.push({ command, args, input, env: options.env }); window.setTimeout(() => { out.l?.({ toString: () => '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' }); handlers.close?.(0); }, 0); } },
          on: (event: string, listener: (x: unknown) => void) => { handlers[event] = listener; } } as never;
      }
    };
    expect(await pythonRunner(host)('plt.plot([1, 2])')).toBe('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>');
    const run = calls.find(c => c.command === '/usr/bin/sandbox-exec')!;
    expect(run.args[0]).toBe('-p');
    expect(run.args[1]).toMatch(/\(deny network\*\)\(deny file-write\*\)\(allow file-write\* \(subpath "\/tmp\/qard-figures"\)/);
    expect(run.args.slice(2)).toEqual(['/usr/bin/python3', '-']);
    expect(run.env.MPLCONFIGDIR).toBe('/tmp/qard-figures');
    expect(run.input).toContain("matplotlib.use('Agg')");
    expect(run.input).toContain('plt.plot([1, 2])');
    expect(run.input.endsWith(PY_AFTER)).toBe(true);
  });

  it('starts the illustrator on the writer\'s connection, and saves figures to assets', () => {
    const s = readSettings({ agents: { roles: { writer: { provider: 'codex', model: 'gpt-5.6-sol' } } } });
    expect(s.agents.roles.illustrator).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' });
    expect(s.learn.figures).toBe('assets');
    expect(readSettings({ learn: { folder: 'Q', figures: 'Attachments' } }).learn).toEqual({ folder: 'Q', figures: 'Attachments' });
  });
});
