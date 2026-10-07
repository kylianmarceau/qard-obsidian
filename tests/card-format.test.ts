import { expect, it } from 'vitest';
import {
  cardTitle,
  clozeFront,
  clozeGroups,
  FORMAT_BACK,
  occlusionFront,
  readCardFormat,
  renderCloze,
  type ImageOcclusion,
} from '../src/cards/card-format';
import { parseCards } from '../src/cards/parser';
import {
  serializeCard,
  replaceCardInSource,
  ensureIdInSource,
  deleteCardInSource,
} from '../src/cards/source-patch';
import { ReviewStore } from '../src/review/review-store';

const sentence = '{{c1::TCP::protocol}} provides {{c2::reliable delivery}}; {{c1::UDP}} does not.';
const image: ImageOcclusion = {
  image: 'Attachments/Network diagram.svg',
  masks: [
    { id: 'sender', x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
    { id: 'router', x: 0.5, y: 0.2, width: 0.2, height: 0.1 },
  ],
  target: 'sender',
};
it('hides matching numbered blanks together and reveals other groups as context', () => {
  expect(clozeGroups(sentence)).toEqual([1, 2]);
  const hidden = renderCloze(sentence, 1, false);
  expect(hidden).toBe('**[protocol]** provides reliable delivery; **[…]** does not.');
  expect(hidden).not.toContain('TCP');
  expect(hidden).not.toContain('UDP');
  expect(renderCloze(sentence, 2, false)).toBe('TCP provides **[…]**; UDP does not.');
  expect(renderCloze(sentence, 1, true)).toBe('TCP provides reliable delivery; UDP does not.');
});
it('preserves Markdown, math braces, code, escaped syntax and comments', () => {
  const text =
    'Recall {{c1::$\\frac{a}{b}$}} and {{c2::**bold**}}.\n`{{c3::code}}`\n```md\n{{c4::fenced}}\n```\n\\{{c5::escaped}}\n<!-- {{c6::comment}} -->';
  expect(clozeGroups(text)).toEqual([1, 2]);
  expect(renderCloze(text, 1, true)).toContain('$\\frac{a}{b}$');
  expect(renderCloze(text, 1, false)).toContain('`{{c3::code}}`');
  expect(renderCloze(text, 1, false)).toContain('{{c4::fenced}}');
  expect(renderCloze(text, 1, true)).toContain('**bold**');
});
it('does not turn literal cloze text in a basic card into a new format', () => {
  const front = 'How does {{c1::syntax}} work?';
  expect(readCardFormat(front)).toEqual({ kind: 'basic', text: front });
  expect(cardTitle(front)).toBe(front);
});
it('escapes hint syntax so hints cannot embed remote images or HTML', () => {
  expect(renderCloze('{{c1::secret::![[image.svg]]<img>}}', 1, false)).toBe(
    '**[\\!\\[\\[image.svg\\]\\]\\<img\\>]**',
  );
});
it.each(['{{c1::}}', '{{c0::answer}}', '{{c1::unfinished}', '`{{c1::code}}`'])(
  'rejects cloze cards without an actual matching blank: %s',
  (text) => {
    expect(() => readCardFormat(clozeFront(text, 1))).toThrow('matching blank');
  },
);
it.each([clozeFront(sentence, 1), occlusionFront('Identify the hidden label.', image)])(
  'round-trips special cards and patches only their Markdown range',
  (front) => {
    const source =
      'Keep this prose.\r\n\r\n' +
      serializeCard('stable', front, FORMAT_BACK, '\r\n') +
      '\r\nKeep the ending.\r\n';
    const parsed = parseCards(source, 'a.md');
    expect(parsed.issues).toEqual([]);
    expect(parsed.cards[0]?.frontMarkdown).toBe(front);
    const card = parsed.cards[0]!;
    const updated = replaceCardInSource(source, card, front, 'Extra notes.', 'stable');
    expect(updated.startsWith('Keep this prose.\r\n\r\n')).toBe(true);
    expect(updated.endsWith('\r\nKeep the ending.\r\n')).toBe(true);
    expect(parseCards(updated, 'renamed.md').cards[0]?.id).toBe('stable');
    expect(parseCards(updated, 'a.md').cards[0]?.backMarkdown).toBe('Extra notes.');
    expect(deleteCardInSource(source, card)).toBe(
      'Keep this prose.\r\n\r\n\r\nKeep the ending.\r\n',
    );
  },
);
it('assigns an ID to a handwritten cloze and preserves its format and history through an edit', async () => {
  const source = serializeCard('old', clozeFront(sentence, 1), FORMAT_BACK).replace(
    '<!-- qard-id: old -->\n',
    '',
  );
  const assigned = ensureIdInSource(source, parseCards(source, 'a.md').cards[0]!, 'new');
  expect(readCardFormat(assigned.card.frontMarkdown).kind).toBe('cloze');
  const reviews = new ReviewStore(async () => {});
  await reviews.review(assigned.card.id, 3);
  const changed = replaceCardInSource(
    assigned.source,
    assigned.card,
    clozeFront(sentence.replace('TCP', 'Transmission Control Protocol'), 1),
    'Notes',
    'new',
  );
  expect(parseCards(changed, 'a.md').cards[0]?.id).toBe('new');
  expect(reviews.getSnapshot().states.new?.reviewCount).toBe(1);
});
it('preserves local images, normalized masks and target IDs without losing JSON escapes', () => {
  expect(readCardFormat(occlusionFront('Diagram', image))).toEqual({
    kind: 'occlusion',
    text: 'Diagram',
    occlusion: image,
  });
  const unusual = { ...image, image: 'Attachments/Arrow -->.svg' };
  expect(readCardFormat(occlusionFront('Diagram', unusual))).toEqual({
    kind: 'occlusion',
    text: 'Diagram',
    occlusion: unusual,
  });
});
it.each([
  { ...image, image: 'https://example.com/image.png' },
  { ...image, image: '../image.png' },
  { ...image, image: '/private/image.png' },
  { ...image, image: 'image.pdf' },
  { ...image, masks: [] },
  { ...image, target: 'missing' },
  { ...image, masks: [image.masks[0]!, image.masks[0]!] },
  { ...image, masks: [{ ...image.masks[0]!, width: 2 }] },
  { ...image, masks: [{ ...image.masks[0]!, x: -0.1 }] },
  { ...image, masks: [{ ...image.masks[0]!, width: 0 }] },
])('rejects malformed occlusion metadata before it becomes a reviewable card', (data) => {
  const front = occlusionFront('Diagram', data);
  expect(() => readCardFormat(front)).toThrow();
  const result = parseCards(
    `> [!qard]- ${front.replace(/\n/g, '\n> ')}\n> <!-- qard-answer -->\n> Answer\n`,
    'a.md',
  );
  expect(result.cards).toHaveLength(0);
  expect(result.issues).toHaveLength(1);
});
it('gives each special variant a distinct readable library title', () => {
  expect(cardTitle(clozeFront(sentence, 1))).toContain('Blank 1');
  expect(cardTitle(occlusionFront('Diagram', image))).toBe('Diagram · Mask 1');
  expect(cardTitle(occlusionFront('Diagram', { ...image, target: 'router' }))).toBe(
    'Diagram · Mask 2',
  );
});

it('uses the normal image wikilink after Obsidian renames an attachment', () => {
  const moved = occlusionFront('Diagram', image).replace(
    '![[Attachments/Network diagram.svg]]',
    '![[Moved/Network diagram.svg]]',
  );
  expect(readCardFormat(moved)).toEqual({
    kind: 'occlusion',
    text: 'Diagram',
    occlusion: { ...image, image: 'Moved/Network diagram.svg' },
  });
});

it('supports code and nested math braces inside a blank while leaving code examples alone', () => {
  const text = 'Recall {{c1::`Array.map()`}} and {{c2::$\\frac{a}{b}$}}. Literal: `{{c3::code}}`.';
  expect(clozeGroups(text)).toEqual([1, 2]);
  expect(renderCloze(text, 1, false)).toBe(
    'Recall **[…]** and $\\frac{a}{b}$. Literal: `{{c3::code}}`.',
  );
  expect(renderCloze(text, 2, true)).toContain('`Array.map()`');
});
