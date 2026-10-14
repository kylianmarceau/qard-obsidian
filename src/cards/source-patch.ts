import { locationComment, type CardLocation } from './card-location';
import type { QardCard } from './card-types';
import { parseCards, sameContent, sourceLines, topicSections } from './parser';
import { siblingGroup } from './siblings';
import { readCardFormat } from './card-format';

/** Persist legacy group identities before an edit or ID assignment can change their content. */
export function ensureSiblingGroupsInSource(source: string, path: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  for (const card of parseCards(source, path).cards.reverse()) {
    const group = siblingGroup(card);
    if (group && !card.siblingGroup) {
      source =
        source.slice(0, card.sourcePosition.start) +
        `<!-- qard-siblings: ${group} -->${eol}` +
        source.slice(card.sourcePosition.start);
    }
  }
  return source;
}
export function locateCard(
  source: string,
  card: QardCard,
  parsed = parseCards(source, card.sourceFile).cards,
): QardCard {
  const matches = card.stable
    ? parsed.filter((c) => c.stable && c.id === card.id)
    : parsed.filter((c) => !c.stable && sameContent(c, card));
  if (matches.length !== 1) {
    throw new Error(
      'The card moved, was changed, or has an ambiguous ID. Reopen it from the library before editing.',
    );
  }
  const match = matches[0]!;
  if (!sameContent(match, card) || match.reverseId !== card.reverseId) {
    throw new Error('This card changed in your note. Reopen it to avoid overwriting your edits.');
  }
  return match;
}
export function ensureIdInSource(
  source: string,
  card: QardCard,
  id: string,
): { source: string; card: QardCard } {
  const current = locateCard(source, card);
  if (current.stable) {
    return { source, card: current };
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const updated =
    source.slice(0, current.sourcePosition.calloutStart) +
    `<!-- qard-id: ${id} -->${eol}` +
    source.slice(current.sourcePosition.calloutStart);
  const found = parseCards(updated, card.sourceFile).cards.find((c) => c.id === id);
  if (!found) {
    throw new Error('Could not safely assign a card ID.');
  }
  return { source: updated, card: found };
}
export function serializeCard(
  id: string,
  front: string,
  back: string,
  eol = '\n',
  group?: string,
  location?: CardLocation,
  reverseId?: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid card ID.');
  }
  front = front.replace(/\r\n?/g, '\n').trim();
  back = back.replace(/\r\n?/g, '\n').trim();
  if (!front || !back) {
    throw new Error('Both the question and answer are required.');
  }
  const [first, ...rest] = front.split('\n');
  const lines = [`<!-- qard-id: ${id} -->`, `> [!qard]- ${first}`];
  if (group) {
    if (!/^[A-Za-z0-9_-]+$/.test(group)) {
      throw new Error('Invalid sibling group.');
    }
    lines.unshift(`<!-- qard-siblings: ${group} -->`);
  }
  if (location) {
    lines.unshift(locationComment(location));
  }
  if (reverseId) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(reverseId) ||
      reverseId === id ||
      readCardFormat(front).kind !== 'basic'
    ) {
      throw new Error('Reverse pairs need distinct IDs and basic question/answer content.');
    }
    lines.unshift(`<!-- qard-reverse: ${reverseId} -->`);
  }
  const content = rest.length
    ? [...rest, '<!-- qard-answer -->', ...back.split('\n')]
    : back.split('\n');
  lines.push(...content.map((line) => (line ? `> ${line}` : '>')));
  const serialized = lines.join(eol) + eol;
  const parsed = parseCards(serialized, 'validation.md');
  if (
    parsed.cards.length !== 1 ||
    parsed.cards[0]?.frontMarkdown !== front ||
    parsed.cards[0]?.backMarkdown !== back
  ) {
    throw new Error(
      'This content includes a reserved Qard boundary or malformed Markdown fence. Put literal Qard syntax inside a fenced code block.',
    );
  }
  return serialized;
}
export function replaceCardInSource(
  source: string,
  original: QardCard,
  front: string,
  back: string,
  id: string,
): string {
  source = ensureSiblingGroupsInSource(source, original.sourceFile);
  const current = locateCard(source, original);
  if (current.reverseId) {
    const partner = parseCards(source, original.sourceFile).cards.filter(
      (card) => card.id === current.reverseId,
    );
    if (
      partner.length !== 1 ||
      partner[0]!.reverseId !== current.id ||
      partner[0]!.frontMarkdown !== current.backMarkdown ||
      partner[0]!.backMarkdown !== current.frontMarkdown
    ) {
      throw new Error(
        'This reverse pair changed in the note. Restore matching opposite content and links before editing.',
      );
    }
    if (readCardFormat(front).kind !== 'basic' || readCardFormat(back).kind !== 'basic') {
      throw new Error('Linked reverse pairs must remain basic cards.');
    }
    for (const entry of [
      { card: current, front, back, id },
      { card: partner[0]!, front: back, back: front, id: partner[0]!.id },
    ].sort((a, b) => b.card.sourcePosition.start - a.card.sourcePosition.start)) {
      source = replaceSingleCard(source, entry.card, entry.front, entry.back, entry.id);
    }
    return source;
  }
  return replaceSingleCard(source, current, front, back, id);
}
function replaceSingleCard(
  source: string,
  current: QardCard,
  front: string,
  back: string,
  id: string,
) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let replacement = serializeCard(
    id,
    front,
    back,
    eol,
    current.siblingGroup,
    current.location,
    current.reverseId,
  );
  if (!/[\r\n]$/.test(current.sourceText)) {
    replacement = replacement.slice(0, -eol.length);
  }
  return (
    source.slice(0, current.sourcePosition.start) +
    replacement +
    source.slice(current.sourcePosition.end)
  );
}
export function deleteCardInSource(source: string, original: QardCard): string {
  const current = locateCard(source, original);
  const next =
    source.slice(0, current.sourcePosition.start) + source.slice(current.sourcePosition.end);
  return unlinkRemovedReverse(next, original.sourceFile, new Set([current.id]));
}
function unlinkRemovedReverse(source: string, path: string, removed: Set<string>) {
  for (const card of parseCards(source, path).cards.sort(
    (a, b) => b.sourcePosition.start - a.sourcePosition.start,
  )) {
    if (card.reverseId && removed.has(card.reverseId)) {
      const prefix = source
        .slice(card.sourcePosition.start, card.sourcePosition.calloutStart)
        .replace(/^\s*<!-- qard-reverse: [A-Za-z0-9_-]+ -->[\r\n]*/m, '');
      source =
        source.slice(0, card.sourcePosition.start) +
        prefix +
        source.slice(card.sourcePosition.calloutStart);
    }
  }
  return source;
}

/** Remove a deck/topic's current callouts by range; preserve all other note content. */
export function deleteGroupInSource(
  source: string,
  path: string,
  deck: string,
  topic?: string,
): string {
  const cards = parseCards(source, path).cards.filter(
    (c) => c.deck === deck && (topic === undefined || c.topic === topic),
  );
  for (const card of cards.sort((a, b) => b.sourcePosition.start - a.sourcePosition.start)) {
    source = source.slice(0, card.sourcePosition.start) + source.slice(card.sourcePosition.end);
  }
  return unlinkRemovedReverse(source, path, new Set(cards.map((card) => card.id)));
}

/** Only placement metadata changes; the callout, note prose and attachment paths stay byte-for-byte intact. */
export function placeCardInSource(
  source: string,
  card: QardCard,
  location: CardLocation,
  parsed?: QardCard[],
): string {
  const current = locateCard(source, card, parsed);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const prefix = source
    .slice(current.sourcePosition.start, current.sourcePosition.calloutStart)
    .split(/\r\n|\n|\r/)
    .filter((line) => !/^\s*<!-- qard-location: /.test(line))
    .join(eol);
  return (
    source.slice(0, current.sourcePosition.start) +
    locationComment(location) +
    eol +
    prefix +
    source.slice(current.sourcePosition.calloutStart)
  );
}

/** Insert at `at` with one blank line on each side, so a callout never runs into nearby text. */
function insertBlock(source: string, at: number, block: string, eol: string) {
  let before = source.slice(0, at);
  const after = source.slice(at);
  if (before && !/[\r\n]$/.test(before)) {
    before += eol;
  }
  if (before && !/(?:\r\n|\n|\r){2}$/.test(before) && before !== eol) {
    before += eol;
  }
  return before + block + (after && !/^[\r\n]/.test(after) ? eol : '') + after;
}
/**
 * Put new card markup where a card of `deck`/`topic` belongs in this note: after the topic's last
 * card, else at the end of its last heading section, else under a new heading at the end. Location
 * overrides are inherited when the only cards of the topic were moved here from another deck.
 */
export function insertIntoTopic(
  source: string,
  path: string,
  deck: string,
  topic: string,
  content: (eol: string, location?: CardLocation) => string,
): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const note = topicSections(source, path);
  if (!note) {
    throw new Error('This note has invalid frontmatter. Fix it or choose another note.');
  }
  const matching = parseCards(source, path).cards.filter(
    (card) => card.deck === deck && card.topic === topic,
  );
  const anchor = matching.filter((card) => !card.location).at(-1) ?? matching.at(-1);
  if (anchor) {
    return insertBlock(source, anchor.sourcePosition.end, content(eol, anchor.location), eol);
  }
  if (note.fixedTopic && note.fixedTopic !== topic) {
    throw new Error(
      `This note fixes its topic to “${note.fixedTopic}”. Choose that topic or create the card in a new note.`,
    );
  }
  if (note.deck !== deck) {
    throw new Error('This note changed or belongs to another deck. Choose another note.');
  }
  const section = [...note.sections].reverse().find((entry) => entry.topic === topic);
  if (section) {
    const lines = sourceLines(source);
    let last = section.end - 1;
    while (last >= section.line && !lines[last]?.text.trim()) {
      last--;
    }
    const at = lines[last]?.end ?? 0;
    return insertBlock(source, at, content(eol), eol);
  }
  return (
    source +
    (!source || source.endsWith(eol + eol) ? '' : source.endsWith(eol) ? eol : eol + eol) +
    `# ${topic}${eol}${eol}` +
    content(eol)
  );
}

export interface SourceEdit {
  at: number;
  text: string;
}
/** Apply insertions given as offsets into the original source. */
export function applyEdits(source: string, edits: SourceEdit[]): string {
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
  }
  return source;
}
export function canReverse(card: QardCard): boolean {
  return (
    !card.reverseId &&
    !card.duplicateId &&
    readCardFormat(card.frontMarkdown).kind === 'basic' &&
    readCardFormat(card.backMarkdown).kind === 'basic'
  );
}
/**
 * Link a basic card to a new opposite card placed right after it. Only comment lines are added
 * above the card; its callout stays byte-for-byte intact. `id` names a card that has no ID yet.
 */
export function reversePairEdits(
  source: string,
  card: QardCard,
  ids: { reverseId: string; group: string; id?: string },
): SourceEdit[] {
  const current = locateCard(source, card);
  if (!canReverse(current)) {
    throw new Error('Only basic cards without a reverse can get one.');
  }
  const id = current.stable ? current.id : ids.id;
  if (!id) {
    throw new Error('Assign a card ID before adding a reverse.');
  }
  const group = current.siblingGroup ?? ids.group;
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const partner = serializeCard(
    ids.reverseId,
    current.backMarkdown,
    current.frontMarkdown,
    eol,
    group,
    current.location,
    id,
  );
  const comments = [
    `<!-- qard-reverse: ${ids.reverseId} -->`,
    ...(current.siblingGroup ? [] : [`<!-- qard-siblings: ${group} -->`]),
    ...(current.stable ? [] : [`<!-- qard-id: ${id} -->`]),
  ];
  const end = current.sourcePosition.end;
  const after = source.slice(end);
  return [
    { at: current.sourcePosition.start, text: comments.map((line) => line + eol).join('') },
    {
      at: end,
      text:
        (/[\r\n]$/.test(current.sourceText) ? '' : eol) +
        eol +
        partner +
        (after && !/^[\r\n]/.test(after) ? eol : ''),
    },
  ];
}
export function addReverseInSource(
  source: string,
  card: QardCard,
  ids: { reverseId: string; group: string; id?: string },
): string {
  const next = applyEdits(source, reversePairEdits(source, card, ids));
  const id = card.stable ? card.id : ids.id;
  const parsed = parseCards(next, card.sourceFile).cards;
  const original = parsed.filter((c) => c.id === id);
  const partner = parsed.filter((c) => c.id === ids.reverseId);
  if (
    original.length !== 1 ||
    partner.length !== 1 ||
    original[0]!.reverseId !== ids.reverseId ||
    partner[0]!.reverseId !== id ||
    partner[0]!.frontMarkdown !== original[0]!.backMarkdown ||
    partner[0]!.backMarkdown !== original[0]!.frontMarkdown ||
    partner[0]!.deck !== original[0]!.deck ||
    partner[0]!.topic !== original[0]!.topic
  ) {
    throw new Error('The reverse card could not be added safely to this note.');
  }
  return next;
}
/** Delete the opposite card of a pair and unlink the one that stays. */
export function removeReverseInSource(source: string, card: QardCard): string {
  const current = locateCard(source, card);
  const partner = parseCards(source, card.sourceFile).cards.filter(
    (c) => c.id === current.reverseId,
  );
  if (!current.reverseId || partner.length !== 1 || partner[0]!.reverseId !== current.id) {
    throw new Error('This reverse pair changed in the note. Reopen the card before removing it.');
  }
  return deleteCardInSource(source, partner[0]!);
}
/** The card whose markup, including its comment lines, covers this line. */
export function cardAtLine(source: string, cards: QardCard[], line: number): QardCard | undefined {
  const at = sourceLines(source)[line]?.start;
  return at === undefined
    ? undefined
    : cards.find((card) => card.sourcePosition.start <= at && at < card.sourcePosition.end);
}
