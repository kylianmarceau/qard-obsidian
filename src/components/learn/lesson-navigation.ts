import type { QardServices } from '../../views/services';
import type { LearnNav } from '../../views/navigation';

/** Opens a lesson for an objective that needs teaching. */
/** Opens a lesson for an objective: the unfinished one if there is one, otherwise a new lesson. */
export async function teach(
  services: QardServices,
  nav: LearnNav,
  item: { mastery: string; objective: string; title: string },
) {
  const open = (await services.learn.listLessons()).find(
    (l) => !l.finished && l.mastery === item.mastery && l.objective === item.objective,
  );
  nav.lesson(
    open?.path ??
      (await services.learn.startLesson({
        topic: item.title,
        notes: [],
        mastery: item.mastery,
        objective: item.objective,
      })),
  );
}
