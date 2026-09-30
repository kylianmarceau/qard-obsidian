/** The parts of Node's child_process this file uses; typed locally so nothing imports Node on mobile. */
interface Stream { on(event: 'data', listener: (chunk: { toString(): string }) => void): void }
export interface Child { stdout: Stream | null; stderr: Stream | null; stdin: { on(event: 'error', listener: () => void): void; end(data: string): void } | null; on(event: 'error', listener: (e: Error) => void): void; on(event: 'close', listener: (code: number | null) => void): void; kill(): boolean }
export interface SpawnOptions { cwd: string; env: Record<string, string | undefined>; stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean }
import { PREAMBLE } from '../tests/test-prompts';
import { SCHEMA_INSTRUCTION, extractJson, type AgentRunner, type AgentTask } from './runner';
import { fromClaudeCode, fromCodexEvents } from './usage';

/** Node access, injected so tests never spawn anything and mobile never loads Node modules. */
export interface NodeHost {
  spawn(command: string, args: string[], options: SpawnOptions): Child;
  exists(path: string): boolean;
  readFile(path: string): string;
  remove(path: string): void;
  tempFile(name: string): string;
  env: Record<string, string | undefined>;
  home: string;
  windows: boolean;
}
const TIMEOUT = 10 * 60_000;

/** Run a process, send `input` on stdin, and resolve with stdout. */
export function runProcess(host: NodeHost, command: string, args: string[], input: string, options: { cwd: string; path: string; signal?: AbortSignal; timeout?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = host.spawn(command, args, { cwd: options.cwd, env: { ...host.env, PATH: options.path }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const finish = (fn: () => void) => { if (done) return; done = true; window.clearTimeout(timer); options.signal?.removeEventListener('abort', abort); fn(); };
    const abort = () => { child.kill(); finish(() => reject(new Error('Cancelled.'))); };
    const timer = window.setTimeout(() => { child.kill(); finish(() => reject(new Error('The agent took longer than 10 minutes and was stopped.'))); }, options.timeout ?? TIMEOUT);
    options.signal?.addEventListener('abort', abort);
    child.stdout?.on('data', chunk => { out += chunk.toString(); });
    child.stderr?.on('data', chunk => { err += chunk.toString(); });
    child.on('error', e => finish(() => reject(new Error(`Could not start ${command}: ${e.message}`))));
    child.on('close', code => finish(() => code === 0 ? resolve(out) : reject(new Error((err.trim() || out.trim() || `exited with code ${code}`).split('\n').slice(-6).join('\n')))));
    child.stdin?.on('error', () => { /* reported through close */ });
    child.stdin?.end(input);
  });
}

let cachedPath: Promise<string> | undefined;
/** Obsidian launched from the dock does not inherit the shell PATH, so ask a login shell once. */
export function loginPath(host: NodeHost): Promise<string> {
  const fallback = [host.env.PATH, `${host.home}/.local/bin`, `${host.home}/.claude/local`, `${host.home}/.npm-global/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(host.windows ? ';' : ':');
  if (host.windows) return Promise.resolve(fallback);
  cachedPath ??= runProcess(host, host.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__QARD__%s__QARD__" "$PATH"'], '', { cwd: host.home, path: fallback, timeout: 8000 })
    .then(out => { const found = /__QARD__(.*?)__QARD__/s.exec(out)?.[1]; return found ? `${found}:${fallback}` : fallback; })
    .catch(() => fallback);
  return cachedPath;
}
export async function findBinary(host: NodeHost, name: string, override: string): Promise<string | undefined> {
  if (override.trim()) return host.exists(override.trim()) ? override.trim() : undefined;
  const path = await loginPath(host), names = host.windows ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const dir of path.split(host.windows ? ';' : ':')) for (const file of names) {
    const candidate = `${dir.replace(/[\\/]$/, '')}${host.windows ? '\\' : '/'}${file}`;
    if (dir && host.exists(candidate)) return candidate;
  }
  return undefined;
}

abstract class CliRunner implements AgentRunner {
  abstract readonly name: string;
  protected abstract readonly binary: string;
  constructor(protected host: NodeHost, protected vault: string, protected override: string, protected model: string) {}
  protected async command() {
    const bin = await findBinary(this.host, this.binary, this.override);
    if (!bin) throw new Error(`${this.name} was not found. Install it, or set its path in Settings → Qard.`);
    return { bin, path: await loginPath(this.host) };
  }
  protected input(task: AgentTask) { return `${PREAMBLE}\n\n${task.prompt}\n\n${SCHEMA_INSTRUCTION(task.schema)}`; }
  abstract run(task: AgentTask): Promise<unknown>;
}

/** Claude Code in print mode, limited to read-only tools inside the vault. */
export class ClaudeCodeRunner extends CliRunner {
  readonly name = 'Claude Code'; protected readonly binary = 'claude';
  async run(task: AgentTask) {
    const { bin, path } = await this.command();
    // Qard's calls stay out of the user's session history. When the prompt holds everything, no tools at all: faster, and nothing to wander into.
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(task.schema), '--no-session-persistence',
      ...(task.vault === false ? ['--tools', ''] : ['--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch'])];
    if (this.model.trim()) args.push('--model', this.model.trim());
    if (task.effort) args.push('--effort', task.effort);
    const out = await runProcess(this.host, bin, args, this.input(task), { cwd: this.vault, path, signal: task.signal });
    let envelope: { result?: unknown; structured_output?: unknown; is_error?: boolean; usage?: Record<string, unknown>; total_cost_usd?: unknown; modelUsage?: Record<string, unknown> };
    try { envelope = JSON.parse(out) as typeof envelope; } catch { return extractJson(out); }
    const usage = fromClaudeCode(envelope); if (usage) task.onUsage?.(usage);
    if (envelope.is_error) throw new Error(typeof envelope.result === 'string' && envelope.result ? envelope.result : 'Claude Code returned an error.');
    // --json-schema yields validated structured_output; older versions only return the text.
    if (envelope.structured_output !== undefined) return envelope.structured_output;
    if (typeof envelope.result !== 'string') throw new Error('Claude Code returned no result.');
    return extractJson(envelope.result);
  }
}

/** Codex non-interactive mode with a read-only sandbox. */
export class CodexRunner extends CliRunner {
  readonly name = 'Codex'; protected readonly binary = 'codex';
  async run(task: AgentTask) {
    const { bin, path } = await this.command();
    const last = this.host.tempFile(`qard-codex-${Date.now()}.txt`);
    // --json streams events to stdout, including each turn's token usage; the reply itself is read from the last-message file.
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', '--output-last-message', last];
    if (this.model.trim()) args.push('--model', this.model.trim());
    if (task.effort) args.push('-c', `model_reasoning_effort=${task.effort}`);
    args.push('-');
    try {
      const out = await runProcess(this.host, bin, args, this.input(task), { cwd: this.vault, path, signal: task.signal });
      const usage = fromCodexEvents(out); if (usage) task.onUsage?.({ ...usage, model: this.model.trim() || undefined });
      if (this.host.exists(last)) return extractJson(this.host.readFile(last));
      // Without the file, the final agent message is the last completed item in the event stream.
      const items = out.split('\n').map(l => { try { return JSON.parse(l) as { type?: string; item?: { type?: string; text?: string } }; } catch { return undefined; } }).filter(e => e?.type === 'item.completed' && e.item?.type === 'agent_message');
      return extractJson(items.at(-1)?.item?.text ?? out);
    } finally { if (this.host.exists(last)) this.host.remove(last); }
  }
}
