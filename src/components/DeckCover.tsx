/** A stable identity for each deck, independent of its position or search results. */
export function DeckCover({ name }: { name: string }) {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? ['?'];
  const first = words[0] ?? '?';
  const initials = (/^[A-Z0-9]{2,3}$/.test(first) ? first : words.length === 1 ? Array.from(first).slice(0, 2).join('') : words.slice(0, 2).map(word => Array.from(word)[0]).join('')).toLocaleUpperCase();
  const tone = Array.from(name).reduce((hash, letter) => ((hash * 31) + letter.codePointAt(0)!) >>> 0, 0) % 6;
  return <span className={`qard-deck-cover qard-tone-${tone}`} aria-hidden="true"><span>{initials}</span></span>;
}
