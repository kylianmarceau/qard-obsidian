import { FileSystemAdapter, Platform, TFile, type App } from 'obsidian';
import type { TestSettings } from '../settings/settings';
import type { AgentRunner } from './runner';
import { AnthropicRunner } from './api-runner';
import { ClaudeCodeRunner, CodexRunner, findBinary, type NodeHost } from './cli-runner';

export const API_KEY_SECRET = 'qard-anthropic-api-key';

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
export function readApiKey(app: App) { return secrets(app)?.getSecret(API_KEY_SECRET) ?? null; }

export function createRunner(app: App, settings: TestSettings): AgentRunner {
  if (settings.provider === 'anthropic') {
    const reader = { paths: () => app.vault.getMarkdownFiles().map(f => f.path), read: (p: string) => { const f = app.vault.getAbstractFileByPath(p); return f instanceof TFile ? app.vault.cachedRead(f) : Promise.resolve(''); } };
    return new AnthropicRunner(reader, () => readApiKey(app), settings.model, [settings.folder]);
  }
  const host = nodeHost(), vault = vaultPath(app);
  if (!host || !vault) return { name: 'Unavailable', run: () => Promise.reject(new Error('Claude Code and Codex need the desktop app. On mobile, choose the Anthropic API key provider in Settings → Qard.')) };
  return settings.provider === 'codex' ? new CodexRunner(host, vault, settings.agentPath, settings.model) : new ClaudeCodeRunner(host, vault, settings.agentPath, settings.model);
}
/** For the settings status line. */
export async function detectAgent(settings: TestSettings): Promise<string | undefined> {
  const host = nodeHost(); if (!host) return undefined;
  return findBinary(host, settings.provider === 'codex' ? 'codex' : 'claude', settings.agentPath);
}
