import type { CardOrder, StudyMode } from '../review/session';
export interface QardSettings {
  defaultMode: StudyMode; defaultOrder: CardOrder; keyboardHints: boolean;
  autoFocus: boolean; audioEnabled: boolean; cardFolder: string; scheduling: boolean;
}
export const DEFAULT_SETTINGS: QardSettings = { defaultMode: 'all', defaultOrder: 'note', keyboardHints: true, autoFocus: false, audioEnabled: false, cardFolder: 'Qard', scheduling: true };
export function readSettings(raw: unknown): QardSettings {
  const s = raw && typeof raw === 'object' ? raw as Partial<QardSettings> : {};
  return { defaultMode: ['all','due','new','difficult'].includes(s.defaultMode || '') ? s.defaultMode! : 'all', defaultOrder: s.defaultOrder === 'shuffle' ? 'shuffle' : 'note', keyboardHints: s.keyboardHints !== false, autoFocus: s.autoFocus === true, audioEnabled: s.audioEnabled === true, cardFolder: typeof s.cardFolder === 'string' ? s.cardFolder : 'Qard', scheduling: s.scheduling !== false };
}
