/** Per-card placement overrides keep a logical move in the original source note. */
export interface CardLocation {
  deck: string;
  topic: string;
}
export function readCardLocation(value: unknown): CardLocation {
  if (!value || typeof value !== 'object' || !('deck' in value) || !('topic' in value)) {
    throw new Error('Choose a deck and topic for these cards.');
  }
  const { deck, topic } = value;
  if (
    typeof deck !== 'string' ||
    typeof topic !== 'string' ||
    !deck.trim() ||
    !topic.trim() ||
    /[\r\n\0]/.test(deck + topic) ||
    deck.length > 200 ||
    topic.length > 200
  ) {
    throw new Error('Deck and topic names must be single lines, up to 200 characters each.');
  }
  return { deck: deck.trim(), topic: topic.trim() };
}
export function locationComment(location: CardLocation) {
  const json = JSON.stringify(readCardLocation(location)).replace(/[<>]/g, (character) =>
    character === '<' ? '\\u003c' : '\\u003e',
  );
  return `<!-- qard-location: ${json} -->`;
}
