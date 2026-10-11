import { readCardFormat } from './card-format';
import type { QardCard } from './card-types';

/** Legacy variants are recognized only when their content and source match exactly. */
export function siblingGroup(card: QardCard): string | undefined {
  if (card.siblingGroup) {
    return card.siblingGroup;
  }
  const format = readCardFormat(card.frontMarkdown);
  if (format.kind === 'basic') {
    return undefined;
  }
  const content =
    format.kind === 'cloze'
      ? format.text
      : JSON.stringify({
          text: format.text,
          image: format.occlusion.image,
          masks: format.occlusion.masks,
        });
  let hash = 14695981039346656037n;
  for (const char of JSON.stringify([card.sourceFile, content, card.backMarkdown])) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n);
  }
  return `legacy-${hash.toString(36)}`;
}

export function siblingIds(card: QardCard, cards: QardCard[]): string[] {
  const group = siblingGroup(card);
  return group
    ? cards
        .filter(
          (other) =>
            other.id !== card.id &&
            other.stable &&
            !other.duplicateId &&
            siblingGroup(other) === group,
        )
        .map((other) => other.id)
    : [];
}
