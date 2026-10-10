import { expect, it } from 'vitest';
import { srCloze } from '../src/migration/sr-cloze';
import {
  DEFAULT_SR_SETTINGS,
  readSrSettings,
  scanSrNote,
  convertSrNote,
} from '../src/migration/sr-parser';
import { parseCards } from '../src/cards/parser';
import { readCardFormat } from '../src/cards/card-format';

it('migrates each simple blank with its own schedule and shared sibling identity', () => {
  const source =
    '#flashcards\n\n==TCP== provides ==reliable;;adjective== delivery.\n<!--SR:!2026-10-11,4,250!2026-10-12,5,240-->\n';
  let id = 0;
  const result = convertSrNote(source, scanSrNote(source, 'Networks.md')!, () => `blank-${++id}`);
  expect(result.converted).toBe(2);
  expect(result.states.map((s) => [s.cardId, s.interval, s.ease])).toEqual([
    ['blank-1', 4, 2.5],
    ['blank-2', 5, 2.4],
  ]);
  const cards = parseCards(result.source, 'Networks.md').cards;
  expect(cards.map((c) => readCardFormat(c.frontMarkdown))).toMatchObject([
    { target: 1 },
    { target: 2 },
  ]);
  expect(cards[0]?.siblingGroup).toBe(cards[1]?.siblingGroup);
  expect(cards[0]?.frontMarkdown).toContain('{{c2::reliable::adjective}}');
  expect(result.source).not.toContain('<!--SR:');
  expect(scanSrNote(result.source, 'Networks.md')?.cards).toHaveLength(0);
});
it('preserves repeated classic groups, hints, bold and curly settings', () => {
  const settings = readSrSettings({
    settings: {
      clozePatterns: [
        '==[123;;]answer[;;hint]==',
        '**[123;;]answer[;;hint]**',
        '{{[123::]answer[::hint]}}',
      ],
    },
  });
  const result = srCloze(
    '==2;;TCP;;protocol== and **2;;UDP** use {{4::ports::routing}}.',
    settings,
  );
  expect(result).toEqual({
    text: '{{c2::TCP::protocol}} and {{c2::UDP}} use {{c4::ports::routing}}.',
    targets: [2, 4],
  });
  const scanned = scanSrNote(
    '#flashcards\n\n{{2::TCP::protocol}} uses {{4::ports}}.',
    'a.md',
    settings,
  );
  expect(scanned?.cards[0]?.clozeTargets).toEqual([2, 4]);
  expect(scanned?.cards[0]?.reversed).toBe(false);
});
it('supports sequential hints and explicit groups in standard older SR patterns', () => {
  const settings = readSrSettings({ clozePatterns: ['==answer[^\\[hint\\]][\\[^123\\]]'] });
  expect(srCloze('==TCP==^[protocol][^2] and ==UDP==[^2].', settings)).toEqual({
    text: '{{c2::TCP::protocol}} and {{c2::UDP}}.',
    targets: [2],
  });
});
it('keeps blank lines until the configured end marker and its following schedule', () => {
  const settings = { ...DEFAULT_SR_SETTINGS, endMarker: 'END' };
  const source =
    '#flashcards\n\n==TCP==\n\nuses ports.\nEND\n<!--SR:!2026-10-11,4,250-->\n\nProse stays.\n';
  let id = 0;
  const result = convertSrNote(source, scanSrNote(source, 'a.md', settings)!, () => `id-${++id}`);
  expect(result.states[0]?.interval).toBe(4);
  expect(parseCards(result.source, 'a.md').cards[0]?.frontMarkdown).toContain('uses ports.');
  expect(result.source).toContain('Prose stays.');
  expect(result.source).not.toContain('END');
});
it('ignores code, comments, escaped markup and disabled formats', () => {
  const body =
    '`==literal==` <!-- ==comment== --> \\==escaped==\n```md\n==code==\n```\n==TCP== **bold**';
  const result = srCloze(body, DEFAULT_SR_SETTINGS);
  expect(result?.targets).toEqual([1]);
  expect(result?.text).toContain('`==literal==`');
  expect(result?.text).toContain('==code==');
  expect(result?.text).toContain('**bold**');
});
it.each(['==a;;TCP==', '==1;;TCP== and ==UDP=='])(
  'reports unsupported overlapping or mixed clozes and preserves source: %s',
  (body) => {
    const source = '#flashcards\n\n' + body;
    const scanned = scanSrNote(source, 'a.md')!;
    expect(scanned.cards).toEqual([]);
    expect(scanned.skipped).toHaveLength(1);
    expect(convertSrNote(source, scanned, () => 'id').source).toBe(source);
  },
);
it('reports a custom pattern without silently treating it as a standard blank', () => {
  const settings = readSrSettings({ clozePatterns: ['__[123;;]answer[;;hint]__'] });
  const source = '#flashcards\n\n__TCP__';
  expect(scanSrNote(source, 'a.md', settings)?.skipped[0]?.reason).toContain('custom');
});
