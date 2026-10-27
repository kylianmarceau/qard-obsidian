import {
  readCustomConnection,
  DEFAULT_CUSTOM_CONNECTION,
  type CustomConnection,
} from '../agents/custom-connection';
import { retention } from '../review/fsrs-scheduler';
import { clip, validParameters } from '../review/fsrs-optimizer';
import type { CardOrder, StudyMode } from '../review/session';
import type { AgentProvider, AgentRole } from '../agents/runner';
import { DEFAULT_STUDY_KEYS, readStudyKeys, type StudyKeys } from '../review/keyboard';
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
  custom: CustomConnection;
  roles: Record<AgentRole, RoleSetting>;
}
/** figures: where drawn figures are saved, one subfolder per subject (the vault's assets/<domain>/ convention). */
export interface LearnSettings {
  folder: string;
  figures: string;
}
/** Overrides for one deck and, unless they set their own, the decks nested under it. */
export interface DeckOptions {
  desiredRetention?: number;
  /** Daily new-card limit for this deck and its subdecks together; absent means no deck limit. */
  newCardsPerDay?: number;
}
export interface QardSettings {
  /** Off hides every AI feature and stops AI work; tests, courses and connections are kept. */
  aiEnabled: boolean;
  defaultMode: StudyMode;
  defaultOrder: CardOrder;
  keyboardHints: boolean;
  /** Put the current course in the tab and window title, so time trackers can see it. */
  courseInTitle: boolean;
  /** Single keys used while reviewing cards. */
  studyKeys: StudyKeys;
  autoFocus: boolean;
  audioEnabled: boolean;
  cardFolder: string;
  scheduling: boolean;
  burySiblings: boolean;
  scheduler: 'simple' | 'fsrs';
  desiredRetention: number;
  /** FSRS parameters fitted to this user's reviews; absent means the published defaults. */
  fsrsParameters?: number[];
  newCardsPerDay: number;
  reviewBatchSize: number;
  typedAnswers: boolean;
  /** Notes without `qard-deck` are named after the note, or after their folder path as nested decks. */
  deckNaming: 'note' | 'folder';
  /** Keyed by canonical deck name, such as `Biology::Cells`. */
  deckOptions: Record<string, DeckOptions>;
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
  custom: DEFAULT_CUSTOM_CONNECTION,
  roles: {
    tutor: { provider: 'claude-code', model: 'haiku' },
    writer: { provider: 'claude-code', model: '' },
    marker: { provider: 'claude-code', model: '' },
    illustrator: { provider: 'claude-code', model: '' },
  },
};
export const DEFAULT_LEARN_SETTINGS: LearnSettings = { folder: 'Qard', figures: 'assets' };
export const DEFAULT_SETTINGS: QardSettings = {
  aiEnabled: true,
  defaultMode: 'all',
  defaultOrder: 'note',
  keyboardHints: true,
  courseInTitle: true,
  studyKeys: DEFAULT_STUDY_KEYS,
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
  deckNaming: 'note',
  deckOptions: {},
  tests: DEFAULT_TEST_SETTINGS,
  agents: DEFAULT_AGENT_SETTINGS,
  learn: DEFAULT_LEARN_SETTINGS,
  showAgent: true,
};
const PROVIDERS: AgentProvider[] = ['claude-code', 'codex', 'anthropic', 'openrouter', 'custom'];
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
      custom: readCustomConnection(a.custom),
      roles: {
        tutor: readRole(roles.tutor, d.tutor),
        writer: readRole(roles.writer, d.writer),
        marker: readRole(roles.marker, d.marker),
        illustrator: readRole(roles.illustrator, readRole(roles.writer, d.writer)),
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
    custom: readCustomConnection(undefined),
    roles: {
      tutor,
      writer: { provider, model },
      marker: { provider, model },
      illustrator: { provider, model },
    },
  };
}
function readLearnSettings(raw: unknown): LearnSettings {
  const l = raw && typeof raw === 'object' ? (raw as Partial<LearnSettings>) : {};
  const d = DEFAULT_LEARN_SETTINGS;
  return {
    folder: typeof l.folder === 'string' && l.folder.trim() ? l.folder : d.folder,
    figures: typeof l.figures === 'string' && l.figures.trim() ? l.figures : d.figures,
  };
}
function readDeckOptions(raw: unknown): Record<string, DeckOptions> {
  const result: Record<string, DeckOptions> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return result;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
    const o = value && typeof value === 'object' ? (value as DeckOptions) : {};
    const options: DeckOptions = {
      ...(typeof o.desiredRetention === 'number' &&
      o.desiredRetention >= 0.7 &&
      o.desiredRetention <= 0.97
        ? { desiredRetention: o.desiredRetention }
        : {}),
      ...(Number.isSafeInteger(o.newCardsPerDay) &&
      o.newCardsPerDay! > 0 &&
      o.newCardsPerDay! <= 10000
        ? { newCardsPerDay: o.newCardsPerDay! }
        : {}),
    };
    if (name.trim() && name.length <= 1000 && Object.keys(options).length) {
      result[name] = options;
    }
  }
  return result;
}
export function readSettings(raw: unknown): QardSettings {
  const s = raw && typeof raw === 'object' ? (raw as Partial<QardSettings>) : {};
  return {
    aiEnabled: s.aiEnabled !== false,
    defaultMode: ['all', 'due', 'new', 'difficult'].includes(s.defaultMode || '')
      ? s.defaultMode!
      : 'all',
    defaultOrder: s.defaultOrder === 'shuffle' ? 'shuffle' : 'note',
    keyboardHints: s.keyboardHints !== false,
    courseInTitle: s.courseInTitle !== false,
    studyKeys: readStudyKeys(s.studyKeys),
    autoFocus: s.autoFocus === true,
    audioEnabled: s.audioEnabled === true,
    cardFolder: typeof s.cardFolder === 'string' ? s.cardFolder : 'Qard',
    scheduling: s.scheduling !== false,
    burySiblings: s.burySiblings !== false,
    scheduler: s.scheduler === 'simple' ? 'simple' : 'fsrs',
    desiredRetention: retention(s.desiredRetention),
    ...(validParameters(s.fsrsParameters) ? { fsrsParameters: clip(s.fsrsParameters) } : {}),
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
    deckNaming: s.deckNaming === 'folder' ? 'folder' : 'note',
    deckOptions: readDeckOptions(s.deckOptions),
    tests: readTestSettings(s.tests),
    agents: readAgentSettings(s.agents, s.tests),
    learn: readLearnSettings(s.learn),
    showAgent: s.showAgent !== false,
  };
}

/** Whether AI features are on. Every AI entry point and background job checks this. */
export const aiOn = (settings: Pick<QardSettings, 'aiEnabled'>): boolean =>
  settings.aiEnabled !== false;
