import type { QardServices } from '../../views/services';
import type { Question, PracticeTest } from '../../tests/test-types';

/** Where a card for this question belongs: its source note's deck and heading, else a deck named after the test. */
export function cardTarget(
  services: QardServices,
  q: Question,
  testTitle: string,
  sectionTitle: string,
  test?: PracticeTest,
) {
  const cards = q.source
    ? services.index.getSnapshot().cards.filter((c) => c.sourceFile === q.source!.path)
    : [];
  const topic =
    cards.find((c) => q.source?.heading && c.topic === q.source.heading)?.topic ??
    cards[0]?.topic ??
    sectionTitle;
  const provenance = q.source
    ? {
        generatedFrom: [q.source.path],
        sourceSnapshots: test?.sourceSnapshots?.filter((s) => s.path === q.source!.path),
      }
    : {};
  return cards.length
    ? { ...provenance, deck: cards[0]!.deck, topic, sourceFile: q.source!.path }
    : { ...provenance, deck: testTitle, topic: sectionTitle, sourceFile: undefined };
}
