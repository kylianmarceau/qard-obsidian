import { locationComment, type CardLocation } from './card-location';
import type { QardCard } from './card-types';
import { parseCards, sameContent } from './parser';
import { siblingGroup } from './siblings';

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
  if (!sameContent(match, card)) {
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
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let replacement = serializeCard(id, front, back, eol, current.siblingGroup, current.location);
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
  return source.slice(0, current.sourcePosition.start) + source.slice(current.sourcePosition.end);
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
  return source;
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
