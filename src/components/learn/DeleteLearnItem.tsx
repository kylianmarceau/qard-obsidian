import { DeleteItem } from '../DeleteItem';
import type { QardServices } from '../../views/services';

export function DeleteLearnItem({
  services,
  kind,
  path,
  deleted,
}: {
  services: QardServices;
  kind: 'course' | 'mapping' | 'lesson' | 'check';
  path: string;
  deleted?: () => void;
}) {
  const descriptions = {
    course:
      'The course mastery file, progress, associated lessons and checks will move to trash. Source notes, flashcards, and practice tests stay.',
    mapping: 'Stop this mapping and remove its saved proposal. Your course notes stay.',
    lesson:
      'This lesson and its generated summary will move to trash. Your course notes and recorded mastery progress stay.',
    check:
      'This check will move to trash. Recorded mastery progress stays. If the objective is still due, Qard may prepare a new check.',
  };
  const remove = () =>
    kind === 'course'
      ? services.learn.removeCourse(path)
      : kind === 'mapping'
        ? services.learn.removeMapping(path)
        : kind === 'lesson'
          ? services.learn.removeLesson(path)
          : services.learn.removeCheck(path);
  return (
    <DeleteItem
      label={`Delete ${kind}`}
      description={descriptions[kind]}
      remove={remove}
      deleted={deleted}
    />
  );
}
