import { expect, it } from 'vitest';
import { clozeMarkdown, readCardFormat, validateCloze } from '../src/cards/card-format';
import type { CardFormat } from '../src/cards/card-types';
import { parseCards } from '../src/cards/parser';
import { deleteCardInSource, ensureIdInSource, replaceCardInSource, serializeCard } from '../src/cards/source-patch';
import { readFlashcards } from '../src/cards/generation-schema';

const cloze: CardFormat = { type: 'cloze' };
const occlusion: CardFormat = { type: 'occlusion', image: 'Attachments/network.svg', masks: [{ x: 12, y: 24, width: 30, height: 10 }] };
it('hides multiple blanks and hints, then reveals the exact formula and code answers', () => {
  const text = 'TCP is {{reliable::property}}. $E={{mc^2}}$\n```js\nconst total = {{items.length}};\n```';
  validateCloze(text);
  const hidden = clozeMarkdown(text, false);
  expect(hidden).toBe('TCP is [property]. $E=[…]$\n```js\nconst total = […];\n```');
  expect(clozeMarkdown(text, true)).toBe('TCP is reliable. $E=mc^2$\n```js\nconst total = items.length;\n```');
  const formula = '$x_{\\mathrm{in}} = {{\\frac{a}{b}}}$';
  validateCloze(formula); expect(clozeMarkdown(formula, false)).toBe('$x_{\\mathrm{in}} = […]$');
  expect(clozeMarkdown(formula, true)).toBe('$x_{\\mathrm{in}} = \\frac{a}{b}$');
  const code = '```python\nif ready:\n{{    send()\n    close()}}\n```';
  validateCloze(code); expect(clozeMarkdown(code, true)).toBe('```python\nif ready:\n    send()\n    close()\n```');
});
it.each(['No blank', '{{}}', '{{ ::hint}}', '{{unfinished', '{{one {{two}}}}'])('rejects an unusable cloze card: %s', text => {
  expect(() => serializeCard('a', text, '', '\n', cloze)).toThrow();
});
it('keeps hint content from becoming an image or HTML embed', () => {
  expect(clozeMarkdown('{{secret::![[secret.png]] <img>}}', false)).toBe('[secret.png img]');
});
it.each([cloze, occlusion])('round-trips card formats, empty explanations and CRLF with stable IDs', format => {
  const front = format.type === 'cloze' ? 'Recall {{TCP}}\nAnd {{UDP}}' : 'Identify these labels.';
  const source = serializeCard('visual', front, '', '\r\n', format);
  const parsed = parseCards(source, 'Cards.md'); expect(parsed.issues).toEqual([]);
  expect(parsed.cards[0]).toMatchObject({ id: 'visual', stable: true, format, frontMarkdown: front, backMarkdown: '' });
  if (format.type === 'occlusion') expect(source).toContain('> ![[Attachments/network.svg]]\r\n');
  expect(source.replace(/\r\n/g, '')).not.toContain('\n');
});
it('preserves surrounding prose, identity and masks when editing or assigning an ID', () => {
  const source = 'Before  \n' + serializeCard('visual', 'Identify it.', 'Explanation', '\n', occlusion) + '\nAfter';
  const card = parseCards(source, 'a.md').cards[0]!;
  const next = replaceCardInSource(source, card, 'New question', 'New context', card.id);
  expect(parseCards(next, 'a.md').cards[0]).toMatchObject({ id: 'visual', format: occlusion });
  expect(deleteCardInSource(next, parseCards(next, 'a.md').cards[0]!)).toBe('Before  \n\nAfter');
  const unidentified = source.replace('<!-- qard-id: visual -->\n', '');
  expect(ensureIdInSource(unidentified, parseCards(unidentified, 'a.md').cards[0]!, 'assigned').card.format).toEqual(occlusion);
});
it('refuses to overwrite a mask changed since the editor opened', () => {
  const source = serializeCard('visual', 'Identify it.', '', '\n', occlusion);
  const card = parseCards(source, 'a.md').cards[0]!;
  expect(() => replaceCardInSource(source.replace('"x":12', '"x":13'), card, 'New question', '', card.id)).toThrow('changed');
});
it('converts formats deliberately while retaining the card ID', () => {
  const source = serializeCard('visual', 'Recall {{TCP}}', '', '\n', cloze);
  const next = replaceCardInSource(source, parseCards(source, 'a.md').cards[0]!, 'What is TCP?', 'Reliable transport', 'visual', null);
  expect(parseCards(next, 'a.md').cards[0]).toMatchObject({ id: 'visual', frontMarkdown: 'What is TCP?' });
  expect(parseCards(next, 'a.md').cards[0]!.format).toBeUndefined();
});
it.each([
  { ...occlusion, image: ' https://example.com/image.png' },
  { ...occlusion, image: 'file:///tmp/image.png' },
  { ...occlusion, image: 'notes.md' },
  { ...occlusion, masks: [] },
  { ...occlusion, masks: [{ x: 90, y: 0, width: 20, height: 10 }] },
  { ...occlusion, masks: [{ x: '12', y: 0, width: 20, height: 10 }] },
  { ...occlusion, masks: [{ x: 0, y: 0, width: 0, height: 10 }] }
])('rejects remote images and invalid mask data', format => { expect(() => readCardFormat(format)).toThrow(); });
it('reports damaged format metadata without losing neighbouring normal cards', () => {
  const damaged = '> [!qard]- Broken\n> <!-- qard-format: {invalid} -->\n> Answer\n\n' + serializeCard('normal', 'Question', 'Answer');
  const parsed = parseCards(damaged, 'a.md'); expect(parsed.issues).toHaveLength(1); expect(parsed.cards.map(c => c.id)).toEqual(['normal']);
});
it('leaves cloze-looking text untouched in ordinary cards', () => {
  const card = parseCards(serializeCard('ordinary', 'What does {{x}} mean?', 'A template variable'), 'a.md').cards[0]!;
  expect(card.format).toBeUndefined(); expect(card.frontMarkdown).toBe('What does {{x}} mean?');
});
it('keeps literal format comments inside code fences and round-trips code-only cloze fronts', () => {
  const literal = '```html\n<!-- qard-format: {"type":"cloze"} -->\n```';
  const ordinary = parseCards(serializeCard('ordinary', literal, 'A comment'), 'a.md').cards[0]!;
  expect(ordinary.format).toBeUndefined(); expect(ordinary.frontMarkdown).toBe(literal);
  const front = '```js\nconst total = {{items.length}};\n```';
  const source = serializeCard('code', front, '', '\n', cloze);
  expect(source.indexOf('qard-format')).toBeLessThan(source.indexOf('```js'));
  expect(parseCards(source, 'a.md').cards[0]).toMatchObject({ format: cloze, frontMarkdown: front });
});
it('distinguishes unidentified image cards with different masks', () => {
  const a = serializeCard('first', 'Identify it.', '', '\n', occlusion).replace(/<!-- qard-id:.*?-->\n/, '');
  const b = serializeCard('second', 'Identify it.', '', '\n', { ...occlusion, masks: [{ x: 1, y: 1, width: 10, height: 10 }] }).replace(/<!-- qard-id:.*?-->\n/, '');
  expect(parseCards(a, 'a.md').cards[0]!.id).not.toBe(parseCards(b, 'a.md').cards[0]!.id);
});
it('validates AI cloze output before it can be accepted', () => {
  const result = readFlashcards({ cards: [{ front: 'TCP is {{reliable}}.', back: '', source: 'TCP.md' }] }, ['TCP.md'], 'cloze');
  expect(result[0]!.format).toEqual(cloze);
  expect(() => readFlashcards({ cards: [{ front: 'TCP is reliable.', back: 'No blank', source: '' }] }, [], 'cloze')).toThrow('blank');
});
