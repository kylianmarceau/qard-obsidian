import type { CardOrder, StudyMode } from '../review/session';
import type { AgentProvider } from '../agents/runner';
export interface TestSettings {
  provider: AgentProvider; model: string; agentPath: string;
  planFirst: boolean; marking: 'section' | 'end'; questions: number; useProfile: boolean; folder: string;
}
export interface QardSettings {
  defaultMode: StudyMode; defaultOrder: CardOrder; keyboardHints: boolean;
  autoFocus: boolean; audioEnabled: boolean; cardFolder: string; scheduling: boolean;
  tests: TestSettings;
}
export const DEFAULT_TEST_SETTINGS: TestSettings = { provider: 'claude-code', model: '', agentPath: '', planFirst: true, marking: 'section', questions: 10, useProfile: true, folder: 'Qard/Tests' };
export const DEFAULT_SETTINGS: QardSettings = { defaultMode: 'all', defaultOrder: 'note', keyboardHints: true, autoFocus: false, audioEnabled: false, cardFolder: 'Qard', scheduling: true, tests: DEFAULT_TEST_SETTINGS };
function readTestSettings(raw: unknown): TestSettings {
  const t = raw && typeof raw === 'object' ? raw as Partial<TestSettings> : {};
  const d = DEFAULT_TEST_SETTINGS;
  return {
    provider: t.provider === 'codex' || t.provider === 'anthropic' ? t.provider : 'claude-code',
    model: typeof t.model === 'string' ? t.model : d.model, agentPath: typeof t.agentPath === 'string' ? t.agentPath : d.agentPath,
    planFirst: t.planFirst !== false, marking: t.marking === 'end' ? 'end' : 'section',
    questions: typeof t.questions === 'number' && t.questions >= 3 && t.questions <= 40 ? Math.round(t.questions) : d.questions,
    useProfile: t.useProfile !== false, folder: typeof t.folder === 'string' && t.folder.trim() ? t.folder : d.folder
  };
}
export function readSettings(raw: unknown): QardSettings {
  const s = raw && typeof raw === 'object' ? raw as Partial<QardSettings> : {};
  return { defaultMode: ['all','due','new','difficult'].includes(s.defaultMode || '') ? s.defaultMode! : 'all', defaultOrder: s.defaultOrder === 'shuffle' ? 'shuffle' : 'note', keyboardHints: s.keyboardHints !== false, autoFocus: s.autoFocus === true, audioEnabled: s.audioEnabled === true, cardFolder: typeof s.cardFolder === 'string' ? s.cardFolder : 'Qard', scheduling: s.scheduling !== false, tests: readTestSettings(s.tests) };
}
