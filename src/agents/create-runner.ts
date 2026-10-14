import { debug, errorText } from '../debug/debug-log';
import { FileSystemAdapter, Platform, TFile, type App } from 'obsidian';
import type { QardSettings } from '../settings/settings';
import type { AgentProvider, AgentRole, AgentRunner } from './runner';
import type { Usage } from './usage';
import { purposeOf } from './usage-report';
import { AnthropicRunner, DEFAULT_API_MODEL, FAST_API_MODEL } from './api-runner';
import { CustomRunner } from './custom-runner';
import { OpenRouterRunner } from './openrouter-runner';
import { ClaudeCodeRunner, CodexRunner, findBinary, type NodeHost } from './cli-runner';
import { isPdf, isStudySource, studyPdfs, studySources } from '../vault-access';
import { PdfReader } from '../sources/pdf-reader';

export const API_KEY_SECRET = 'qard-anthropic-api-key';
export const CUSTOM_KEY_SECRET = 'qard-custom-api-key';
export const OPENROUTER_KEY_SECRET = 'qard-openrouter-api-key';

/** Node built-ins exist only on desktop; load them lazily so mobile never touches them. */
export function nodeHost(): NodeHost | undefined {
  if (!Platform.isDesktopApp) {
    return undefined;
  }
  const load = (window as unknown as { require?: (id: string) => unknown }).require;
  if (!load) {
    return undefined;
  }
  const cp = load('child_process') as typeof import('child_process'),
    fs = load('fs') as typeof import('fs'),
    os = load('os') as typeof import('os'),
    path = load('path') as typeof import('path');
  const env = (load('process') as typeof import('process')).env;
  return {
    spawn: (command, args, options) => cp.spawn(command, args, options),
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    remove: (p) => fs.rmSync(p, { force: true }),
    tempFile: (name) => path.join(os.tmpdir(), name),
    env,
    home: os.homedir(),
    windows: Platform.isWin,
  };
}
export function vaultPath(app: App) {
  return app.vault.adapter instanceof FileSystemAdapter
    ? app.vault.adapter.getBasePath()
    : undefined;
}
/** SecretStorage arrived in Obsidian 1.11.4; Qard still supports older versions, so detect it. */
export function secrets(
  app: App,
):
  | { getSecret(id: string): string | null; setSecret(id: string, secret: string): void }
  | undefined {
  return (
    app as unknown as {
      secretStorage?: {
        getSecret(id: string): string | null;
        setSecret(id: string, secret: string): void;
      };
    }
  ).secretStorage;
}
export function readSecret(app: App, id: string) {
  return secrets(app)?.getSecret(id) ?? null;
}

/** The tutor defaults to each connection's fast model; the writer and marker to its best. */
export function defaultModel(provider: AgentProvider, role: AgentRole, settings?: QardSettings) {
  if (provider === 'custom') {
    return settings?.agents.custom.model ?? '';
  }
  const fast = role === 'tutor';
  if (provider === 'anthropic') {
    return fast ? FAST_API_MODEL : DEFAULT_API_MODEL;
  }
  if (provider === 'openrouter') {
    return fast ? 'anthropic/claude-haiku-4.5' : 'anthropic/claude-opus-5.5';
  }
  return provider === 'claude-code' && fast ? 'haiku' : '';
}

export interface UsageEvent {
  purpose: string;
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  usage: Usage;
}
/** Reports every run's token usage with what it was for and which connection and model ran it. */
function tracked(
  runner: AgentRunner,
  role: AgentRole,
  provider: AgentProvider,
  model: string,
  record?: (e: UsageEvent) => void,
): AgentRunner {
  return {
    name: runner.name,
    run: async (task) => {
      const purpose = purposeOf(task.schema);
      // Every run is logged for debugging: who ran it, how big the prompt was, how long it took and how it ended.
      const span = debug.span('agent', 'run', {
        purpose,
        role,
        provider,
        model,
        promptChars: task.prompt.length,
        vault: task.vault !== false,
        effort: task.effort,
      });
      const onAbort = () => span.note('cancel requested');
      task.signal?.addEventListener('abort', onAbort);
      let usage: Usage | undefined;
      try {
        const reply = await runner.run({
          ...task,
          onUsage: (u) => {
            usage = u;
            record?.({ purpose, role, provider, model: u.model ?? model, usage: u });
            task.onUsage?.(u);
          },
        });
        const text = JSON.stringify(reply) ?? '';
        span.end({ replyChars: text.length, tokensIn: usage?.input, tokensOut: usage?.output });
        debug.saveRun(`${purpose}-${role}`, {
          purpose,
          role,
          provider,
          model,
          prompt: task.prompt,
          schema: task.schema,
          reply,
          usage,
        });
        return reply;
      } catch (error) {
        span.fail(error, { tokensIn: usage?.input, tokensOut: usage?.output });
        debug.saveRun(`${purpose}-${role}-failed`, {
          purpose,
          role,
          provider,
          model,
          prompt: task.prompt,
          schema: task.schema,
          error: errorText(error),
          usage,
        });
        throw error;
      } finally {
        task.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** pdfs: the plugin's shared reader, so PDF text extracted once is reused across runs. */
export function createRunner(
  app: App,
  settings: QardSettings,
  role: AgentRole,
  record?: (e: UsageEvent) => void,
  pdfs: PdfReader = new PdfReader(app),
): AgentRunner {
  const { provider } = settings.agents.roles[role],
    model = settings.agents.roles[role].model.trim() || defaultModel(provider, role, settings);
  return tracked(buildRunner(app, settings, provider, model, pdfs), role, provider, model, record);
}
function buildRunner(
  app: App,
  settings: QardSettings,
  provider: AgentProvider,
  model: string,
  pdfs: PdfReader,
): AgentRunner {
  const excluded = [settings.tests.folder];
  const reader = {
    paths: () => studySources(app, excluded).map((f) => f.path),
    read: (p: string) => {
      if (!isStudySource(p, excluded)) {
        return Promise.resolve('');
      }
      if (isPdf(p)) {
        return pdfs.read(p).then((text) => text ?? '');
      }
      const f = app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? app.vault.cachedRead(f) : Promise.resolve('');
    },
  };
  // The note tools only list Markdown and PDFs, so test, check and lesson JSON is never visible; the tests folder is hidden as before.
  const exclude = [settings.tests.folder.replace(/\/+$/, '')];
  if (provider === 'custom') {
    return new CustomRunner(
      reader,
      () => readSecret(app, CUSTOM_KEY_SECRET),
      { ...settings.agents.custom, model },
      exclude,
    );
  }
  if (provider === 'anthropic') {
    return new AnthropicRunner(reader, () => readSecret(app, API_KEY_SECRET), model, exclude);
  }
  if (provider === 'openrouter') {
    return new OpenRouterRunner(
      reader,
      () => readSecret(app, OPENROUTER_KEY_SECRET),
      model,
      exclude,
    );
  }
  const host = nodeHost(),
    vault = vaultPath(app);
  if (!host || !vault) {
    return {
      name: 'Unavailable',
      run: () =>
        Promise.reject(
          new Error(
            'Claude Code and Codex need the desktop app. On mobile, choose an API key connection in Settings → Qard.',
          ),
        ),
    };
  }
  // Claude Code opens PDFs with its own Read tool; Codex can't, so it is given their text.
  return provider === 'codex'
    ? new CodexRunner(host, vault, settings.agents.codexPath, model, {
        paths: () => studyPdfs(app, excluded).map((f) => f.path),
        read: (p) => pdfs.read(p),
      })
    : new ClaudeCodeRunner(host, vault, settings.agents.claudePath, model);
}
/** For the settings status lines. */
export async function detectAgent(
  settings: QardSettings,
  provider: AgentProvider,
): Promise<string | undefined> {
  const host = nodeHost();
  if (!host) {
    return undefined;
  }
  return provider === 'codex'
    ? findBinary(host, 'codex', settings.agents.codexPath)
    : findBinary(host, 'claude', settings.agents.claudePath);
}
