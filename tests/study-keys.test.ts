import { expect, it } from 'vitest';
import {
  DEFAULT_STUDY_KEYS,
  keyLabel,
  keyName,
  readStudyKeys,
  studyActionFor,
} from '../src/review/keyboard';
import { readSettings } from '../src/settings/settings';

it('keeps valid keys, falls back per action, and resets everything on a duplicate', () => {
  expect(readStudyKeys(undefined)).toEqual(DEFAULT_STUDY_KEYS);
  expect(readStudyKeys({ good: 'g', again: 'Escape', hard: 'ab', easy: 7 })).toEqual({
    ...DEFAULT_STUDY_KEYS,
    good: 'g',
  });
  expect(readStudyKeys({ good: 'u' })).toEqual(DEFAULT_STUDY_KEYS);
  expect(readStudyKeys({ reveal: 'Enter', focus: 'ArrowUp' })).toMatchObject({
    reveal: 'Enter',
    focus: 'ArrowUp',
  });
});
it('names keys the way they are stored', () => {
  expect(keyName({ key: ' ' })).toBe('Space');
  expect(keyName({ key: 'E' })).toBe('e');
  expect(keyName({ key: 'é' })).toBe('é');
  expect(keyName({ key: 'Shift' })).toBeUndefined();
  expect(keyName({ key: 'Escape' })).toBeUndefined();
  expect(keyName({ key: 'Tab' })).toBeUndefined();
  expect(keyLabel('Space')).toBe('Space');
  expect(keyLabel('u')).toBe('U');
  expect(keyLabel('ArrowLeft')).toBe('←');
});
it('rates with 1–4 on AZERTY by physical key, while an exact binding wins', () => {
  expect(studyActionFor({ key: '&', code: 'Digit1' }, DEFAULT_STUDY_KEYS)).toBe('again');
  expect(studyActionFor({ key: 'é', code: 'Digit2' }, DEFAULT_STUDY_KEYS)).toBe('hard');
  expect(studyActionFor({ key: '4', code: 'Numpad4' }, DEFAULT_STUDY_KEYS)).toBe('easy');
  expect(studyActionFor({ key: 'E', code: 'KeyE' }, DEFAULT_STUDY_KEYS)).toBe('edit');
  const custom = { ...DEFAULT_STUDY_KEYS, again: '&', undo: '1' };
  expect(studyActionFor({ key: '&', code: 'Digit1' }, custom)).toBe('again');
  expect(studyActionFor({ key: 'x', code: 'KeyX' }, DEFAULT_STUDY_KEYS)).toBeUndefined();
  // Letters follow the layout, never the physical key.
  expect(studyActionFor({ key: 'a', code: 'KeyQ' }, DEFAULT_STUDY_KEYS)).toBeUndefined();
});
it('reads the AI switch and study keys from saved settings', () => {
  expect(readSettings({})).toMatchObject({ aiEnabled: true, studyKeys: DEFAULT_STUDY_KEYS });
  expect(readSettings({ aiEnabled: false, studyKeys: { good: 'g' } })).toMatchObject({
    aiEnabled: false,
    studyKeys: { good: 'g' },
  });
});
