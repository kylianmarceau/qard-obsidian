export function ignoresStudyKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
    return true;
  }
  const target = event.target as Element | null;
  return !!target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], audio, video, [data-qard-keyboard-ignore], .modal-container, .suggestion-container',
  );
}

/** Study actions that have a single-key shortcut. Escape is fixed and never remapped. */
export type StudyKeyAction =
  | 'reveal'
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  | 'undo'
  | 'edit'
  | 'skip'
  | 'focus';
export type StudyKeys = Record<StudyKeyAction, string>;
/** Everything a study session can do from a key or an Obsidian command. */
export type StudyAction = StudyKeyAction | 'pause' | 'leave';
/** Runs a study action; with `checking`, only reports whether it applies right now. */
export type StudyCommands = (action: StudyAction, checking: boolean) => boolean;
export const RATING_ACTIONS = ['again', 'hard', 'good', 'easy'] as const;
export const STUDY_KEY_ACTIONS: { action: StudyKeyAction; name: string }[] = [
  { action: 'reveal', name: 'Show or hide answer' },
  { action: 'again', name: 'Again' },
  { action: 'hard', name: 'Hard' },
  { action: 'good', name: 'Good' },
  { action: 'easy', name: 'Easy' },
  { action: 'undo', name: 'Undo last rating' },
  { action: 'edit', name: 'Edit card' },
  { action: 'skip', name: 'Skip card' },
  { action: 'focus', name: 'Focus mode' },
];
export const DEFAULT_STUDY_KEYS: StudyKeys = {
  reveal: 'Space',
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
  undo: 'u',
  edit: 'e',
  skip: 's',
  focus: 'f',
};
const NAMED_KEYS = ['Space', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
/** The stored name of a pressed key: `Space`, a named key, or one lowercase character. */
export function keyName(event: Pick<KeyboardEvent, 'key'>): string | undefined {
  const key = event.key === ' ' ? 'Space' : event.key;
  if (NAMED_KEYS.includes(key)) {
    return key;
  }
  return [...key].length === 1 && key.trim() ? key.toLowerCase() : undefined;
}
export function validStudyKey(key: unknown): key is string {
  return typeof key === 'string' && keyName({ key }) === key;
}
/** Each action keeps a valid key or its default. A duplicate would make keys ambiguous, so it resets them all. */
export function readStudyKeys(raw: unknown): StudyKeys {
  const value = raw && typeof raw === 'object' ? (raw as Partial<Record<string, unknown>>) : {};
  const keys = { ...DEFAULT_STUDY_KEYS };
  for (const { action } of STUDY_KEY_ACTIONS) {
    const key = value[action];
    if (validStudyKey(key)) {
      keys[action] = key;
    }
  }
  return new Set(Object.values(keys)).size === STUDY_KEY_ACTIONS.length
    ? keys
    : { ...DEFAULT_STUDY_KEYS };
}
/**
 * The action for a key press. Digits also match by physical key, so 1–4 rate on layouts such as
 * AZERTY, where those keys type `&é"'` without Shift.
 */
export function studyActionFor(
  event: Pick<KeyboardEvent, 'key' | 'code'>,
  keys: StudyKeys,
): StudyKeyAction | undefined {
  const find = (name: string | undefined) =>
    name === undefined
      ? undefined
      : STUDY_KEY_ACTIONS.find(({ action }) => keys[action] === name)?.action;
  return find(keyName(event)) ?? find(event.code?.match(/^(?:Digit|Numpad)(\d)$/)?.[1]);
}
export function keyLabel(key: string): string {
  return (
    { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[key] ??
    (key.length === 1 ? key.toUpperCase() : key)
  );
}
