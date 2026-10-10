import { retention } from '../review/fsrs-scheduler';
import type { CardOrder, StudyMode } from '../review/session';
import type { AgentProvider, AgentRole } from '../agents/runner';
export interface TestSettings {
  planFirst: boolean;
  marking: 'section' | 'end';
  questions: number;
  useProfile: boolean;
  folder: string;
}
export interface RoleSetting {
  provider: AgentProvider;
  model: string;
}
/** Connections are set up once; each role then picks a connection and a model. */
export interface AgentSettings {
  claudePath: string;
  codexPath: string;
  roles: Record<AgentRole, RoleSetting>;
}
export interface LearnSettings {
  folder: string;
}
export interface QardSettings {
  defaultMode: StudyMode;
  defaultOrder: CardOrder;
  keyboardHints: boolean;
  autoFocus: boolean;
  audioEnabled: boolean;
  cardFolder: string;
  scheduling: boolean;
  burySiblings: boolean;
  scheduler: 'simple' | 'fsrs';
  desiredRetention: number;
  newCardsPerDay: number;
  reviewBatchSize: number;
  typedAnswers: boolean;
  tests: TestSettings;
  agents: AgentSettings;
  learn: LearnSettings;
  /** Show which agent (role, connection, model) is working, next to anything in progress. */
  showAgent: boolean;
}
export const DEFAULT_TEST_SETTINGS: TestSettings = {
  planFirst: true,
  marking: 'section',
  questions: 10,
  useProfile: true,
  folder: 'Qard/Tests',
};
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  claudePath: '',
  codexPath: '',
  roles: {
    tutor: { provider: 'claude-code', model: 'haiku' },
    writer: { provider: 'claude-code', model: '' },
    marker: { provider: 'claude-code', model: '' },
  },
};
export const DEFAULT_LEARN_SETTINGS: LearnSettings = { folder: 'Qard' };
export const DEFAULT_SETTINGS: QardSettings = {
  defaultMode: 'all',
  defaultOrder: 'note',
  keyboardHints: true,
  autoFocus: false,
  audioEnabled: false,
  cardFolder: 'Qard',
  scheduling: true,
  burySiblings: true,
  scheduler: 'fsrs',
  desiredRetention: 0.9,
  newCardsPerDay: 0,
  reviewBatchSize: 0,
  typedAnswers: false,
  tests: DEFAULT_TEST_SETTINGS,
  agents: DEFAULT_AGENT_SETTINGS,
  learn: DEFAULT_LEARN_SETTINGS,
  showAgent: true,
};
const PROVIDERS: AgentProvider[] = ['claude-code', 'codex', 'anthropic', 'openrouter'];
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
function readTestSettings(raw: unknown): TestSettings {
  const t = raw && typeof raw === 'object' ? (raw as Partial<TestSettings>) : {};
  const d = DEFAULT_TEST_SETTINGS;
  return {
    planFirst: t.planFirst !== false,
    marking: t.marking === 'end' ? 'end' : 'section',
    questions:
      typeof t.questions === 'number' && t.questions >= 3 && t.questions <= 40
        ? Math.round(t.questions)
        : d.questions,
    useProfile: t.useProfile !== false,
    folder: typeof t.folder === 'string' && t.folder.trim() ? t.folder : d.folder,
  };
}
function readRole(raw: unknown, fallback: RoleSetting): RoleSetting {
  const r = raw && typeof raw === 'object' ? (raw as Partial<RoleSetting>) : {};
  return PROVIDERS.includes(r.provider!)
    ? { provider: r.provider!, model: text(r.model, '') }
    : fallback;
}
/** Before roles existed, practice tests had one provider, model and path; those become the writer and marker. */
function readAgentSettings(raw: unknown, legacy: unknown): AgentSettings {
  const a = raw && typeof raw === 'object' ? (raw as Partial<AgentSettings>) : undefined;
  if (a) {
    const roles = (a.roles ?? {}) as Partial<Record<AgentRole, unknown>>,
      d = DEFAULT_AGENT_SETTINGS.roles;
    return {
      claudePath: text(a.claudePath, ''),
      codexPath: text(a.codexPath, ''),
      roles: {
        tutor: readRole(roles.tutor, d.tutor),
        writer: readRole(roles.writer, d.writer),
        marker: readRole(roles.marker, d.marker),
      },
    };
  }
  const old =
    legacy && typeof legacy === 'object'
      ? (legacy as { provider?: unknown; model?: unknown; agentPath?: unknown })
      : {};
  const provider = PROVIDERS.includes(old.provider as AgentProvider)
      ? (old.provider as AgentProvider)
      : 'claude-code',
    model = text(old.model, ''),
    path = text(old.agentPath, '');
  const tutor: RoleSetting =
    provider === 'anthropic'
      ? { provider, model: 'claude-haiku-4-5' }
      : provider === 'claude-code'
        ? { provider, model: 'haiku' }
        : { provider, model: '' };
  return {
    claudePath: provider === 'claude-code' ? path : '',
    codexPath: provider === 'codex' ? path : '',
    roles: { tutor, writer: { provider, model }, marker: { provider, model } },
  };
}
function readLearnSettings(raw: unknown): LearnSettings {
  const l = raw && typeof raw === 'object' ? (raw as Partial<LearnSettings>) : {};
  return {
    folder:
      typeof l.folder === 'string' && l.folder.trim() ? l.folder : DEFAULT_LEARN_SETTINGS.folder,
  };
}
export function readSettings(raw: unknown): QardSettings {
  const s = raw && typeof raw === 'object' ? (raw as Partial<QardSettings>) : {};
  return {
    defaultMode: ['all', 'due', 'new', 'difficult'].includes(s.defaultMode || '')
      ? s.defaultMode!
      : 'all',
    defaultOrder: s.defaultOrder === 'shuffle' ? 'shuffle' : 'note',
    keyboardHints: s.keyboardHints !== false,
    autoFocus: s.autoFocus === true,
    audioEnabled: s.audioEnabled === true,
    cardFolder: typeof s.cardFolder === 'string' ? s.cardFolder : 'Qard',
    scheduling: s.scheduling !== false,
    burySiblings: s.burySiblings !== false,
    scheduler: s.scheduler === 'simple' ? 'simple' : 'fsrs',
    desiredRetention: retention(s.desiredRetention),
    newCardsPerDay:
      Number.isSafeInteger(s.newCardsPerDay) && s.newCardsPerDay! >= 0 && s.newCardsPerDay! <= 10000
        ? s.newCardsPerDay!
        : 0,
    reviewBatchSize:
      Number.isSafeInteger(s.reviewBatchSize) &&
      s.reviewBatchSize! >= 0 &&
      s.reviewBatchSize! <= 10000
        ? s.reviewBatchSize!
        : 0,
    typedAnswers: s.typedAnswers === true,
    tests: readTestSettings(s.tests),
    agents: readAgentSettings(s.agents, s.tests),
    learn: readLearnSettings(s.learn),
    showAgent: s.showAgent !== false,
  };
}
