import { FileSystemAdapter, Platform, TFile, type App } from 'obsidian';
import type { QardSettings } from '../settings/settings';
import type { AgentProvider, AgentRole, AgentRunner } from './runner';
import type { Usage } from './usage';
import { purposeOf } from './usage-report';
import { AnthropicRunner, DEFAULT_API_MODEL, FAST_API_MODEL } from './api-runner';
import { OpenRouterRunner } from './openrouter-runner';
import { ClaudeCodeRunner, CodexRunner, findBinary, type NodeHost } from './cli-runner';

export const API_KEY_SECRET = 'qard-anthropic-api-key';
export const OPENROUTER_KEY_SECRET = 'qard-openrouter-api-key';

/** Node built-ins exist only on desktop; load them lazily so mobile never touches them. */
export function nodeHost(): NodeHost | undefined {
  if (!Platform.isDesktopApp) return undefined;
  const load = (window as unknown as { require?: (id: string) => unknown }).require;
  if (!load) return undefined;
  const cp = load('child_process') as typeof import('child_process'), fs = load('fs') as typeof import('fs'), os = load('os') as typeof import('os'), path = load('path') as typeof import('path');
  const env = (load('process') as typeof import('process')).env;
  return {
    spawn: (command, args, options) => cp.spawn(command, args, options),
    exists: p => fs.existsSync(p), readFile: p => fs.readFileSync(p, 'utf8'), remove: p => fs.rmSync(p, { force: true }),
    tempFile: name => path.join(os.tmpdir(), name), env, home: os.homedir(), windows: Platform.isWin
  };
}
export function vaultPath(app: App) { return app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() : undefined; }
/** SecretStorage arrived in Obsidian 1.11.4; Qard still supports older versions, so detect it. */
export function secrets(app: App): { getSecret(id: string): string | null; setSecret(id: string, secret: string): void } | undefined {
  return (app as unknown as { secretStorage?: { getSecret(id: string): string | null; setSecret(id: string, secret: string): void } }).secretStorage;
}
export function readSecret(app: App, id: string) { return secrets(app)?.getSecret(id) ?? null; }

/** The tutor defaults to each connection's fast model; the writer and marker to its best. */
export function defaultModel(provider: AgentProvider, role: AgentRole) {
  const fast = role === 'tutor';
  if (provider === 'anthropic') return fast ? FAST_API_MODEL : DEFAULT_API_MODEL;
  if (provider === 'openrouter') return fast ? 'anthropic/claude-haiku-4.5' : 'anthropic/claude-opus-5.5';
  return provider === 'claude-code' && fast ? 'haiku' : '';
}

export interface UsageEvent { purpose: string; role: AgentRole; provider: AgentProvider; model: string; usage: Usage }
/** Reports every run's token usage with what it was for and which connection and model ran it. */
function tracked(runner: AgentRunner, role: AgentRole, provider: AgentProvider, model: string, record?: (e: UsageEvent) => void): AgentRunner {
  if (!record) return runner;
  return { name: runner.name, run: task => runner.run({ ...task, onUsage: usage => { record({ purpose: purposeOf(task.schema), role, provider, model: usage.model ?? model, usage }); task.onUsage?.(usage); } }) };
}

export function createRunner(app: App, settings: QardSettings, role: AgentRole, record?: (e: UsageEvent) => void): AgentRunner {
  const { provider } = settings.agents.roles[role], model = settings.agents.roles[role].model.trim() || defaultModel(provider, role);
  return tracked(buildRunner(app, settings, role, provider, model), role, provider, model, record);
}
function buildRunner(app: App, settings: QardSettings, role: AgentRole, provider: AgentProvider, model: string): AgentRunner {
  const reader = { paths: () => app.vault.getMarkdownFiles().map(f => f.path), read: (p: string) => { const f = app.vault.getAbstractFileByPath(p); return f instanceof TFile ? app.vault.cachedRead(f) : Promise.resolve(''); } };
  // The note tools only list Markdown, so test, check and lesson JSON is never visible; the tests folder is hidden as before.
  const exclude = [settings.tests.folder.replace(/\/+$/, '')];
  if (provider === 'anthropic') return new AnthropicRunner(reader, () => readSecret(app, API_KEY_SECRET), model, exclude);
  if (provider === 'openrouter') return new OpenRouterRunner(reader, () => readSecret(app, OPENROUTER_KEY_SECRET), model, exclude);
  const host = nodeHost(), vault = vaultPath(app);
  if (!host || !vault) return { name: 'Unavailable', run: () => Promise.reject(new Error('Claude Code and Codex need the desktop app. On mobile, choose an API key connection in Settings → Qard.')) };
  return provider === 'codex' ? new CodexRunner(host, vault, settings.agents.codexPath, model) : new ClaudeCodeRunner(host, vault, settings.agents.claudePath, model);
}
/** For the settings status lines. */
export async function detectAgent(settings: QardSettings, provider: AgentProvider): Promise<string | undefined> {
  const host = nodeHost(); if (!host) return undefined;
  return provider === 'codex' ? findBinary(host, 'codex', settings.agents.codexPath) : findBinary(host, 'claude', settings.agents.claudePath);
}
