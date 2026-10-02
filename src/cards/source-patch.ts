import type { QardCard } from './card-types';
import { parseCards, sameContent } from './parser';
export function locateCard(source: string, card: QardCard): QardCard {
  const parsed = parseCards(source, card.sourceFile).cards;
  const matches = card.stable ? parsed.filter(c => c.stable && c.id === card.id) : parsed.filter(c => !c.stable && sameContent(c, card));
  if (matches.length !== 1) throw new Error('The card moved, was changed, or has an ambiguous ID. Reopen it from the library before editing.');
  const match = matches[0]!;
  if (!sameContent(match, card)) throw new Error('This card changed in your note. Reopen it to avoid overwriting your edits.');
  return match;
}
export function ensureIdInSource(source: string, card: QardCard, id: string): { source: string; card: QardCard } {
  const current = locateCard(source, card);
  if (current.stable) return { source, card: current };
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const updated = source.slice(0, current.sourcePosition.calloutStart) + `<!-- qard-id: ${id} -->${eol}` + source.slice(current.sourcePosition.calloutStart);
  const found = parseCards(updated, card.sourceFile).cards.find(c => c.id === id);
  if (!found) throw new Error('Could not safely assign a card ID.');
  return { source: updated, card: found };
}
export function serializeCard(id: string, front: string, back: string, eol = '\n'): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid card ID.');
  front = front.replace(/\r\n?/g, '\n').trim(); back = back.replace(/\r\n?/g, '\n').trim();
  if (!front || !back) throw new Error('Both the question and answer are required.');
  const [first, ...rest] = front.split('\n');
  const lines = [`<!-- qard-id: ${id} -->`, `> [!qard]- ${first}`];
  const content = rest.length ? [...rest, '<!-- qard-answer -->', ...back.split('\n')] : back.split('\n');
  lines.push(...content.map(line => line ? `> ${line}` : '>'));
  const serialized = lines.join(eol) + eol;
  const parsed = parseCards(serialized, 'validation.md');
  if (parsed.cards.length !== 1 || parsed.cards[0]?.frontMarkdown !== front || parsed.cards[0]?.backMarkdown !== back) {
    throw new Error('This content includes a reserved Qard boundary or malformed Markdown fence. Put literal Qard syntax inside a fenced code block.');
  }
  return serialized;
}
export function replaceCardInSource(source: string, original: QardCard, front: string, back: string, id: string): string {
  const current = locateCard(source, original);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let replacement = serializeCard(id, front, back, eol);
  if (!/[\r\n]$/.test(current.sourceText)) replacement = replacement.slice(0, -eol.length);
  return source.slice(0, current.sourcePosition.start) + replacement + source.slice(current.sourcePosition.end);
}
export function deleteCardInSource(source: string, original: QardCard): string {
  const current = locateCard(source, original);
  return source.slice(0, current.sourcePosition.start) + source.slice(current.sourcePosition.end);
}

/** Remove a deck/topic's current callouts by range; preserve all other note content. */
export function deleteGroupInSource(source: string, path: string, deck: string, topic?: string): string {
  const cards = parseCards(source, path).cards.filter(c => c.deck === deck && (topic === undefined || c.topic === topic));
  for (const card of cards.sort((a, b) => b.sourcePosition.start - a.sourcePosition.start)) {
    source = source.slice(0, card.sourcePosition.start) + source.slice(card.sourcePosition.end);
  }
  return source;
}
