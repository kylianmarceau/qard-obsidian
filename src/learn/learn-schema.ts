import type { Question, QuestionMark } from '../tests/test-types';
import {
  arr,
  check,
  markSchema,
  obj,
  oneOf,
  questionSchema,
  str,
  type Schema,
} from '../tests/test-schema';
import { STATES, type MasteryState } from './mastery';
import type { LessonMap, LessonStep } from './learn-types';

const markProps = (markSchema as { properties: Record<string, Schema> }).properties;
const objectiveItem = obj({
  id: str('Short kebab-case id, unique, e.g. "lda-generative-process".'),
  title: str('What the student should be able to do or explain, at most eight words.'),
  label: str('A short name for the course map, two to four words, e.g. "LDA generative story".'),
  notes: arr(str('Vault-relative path of a note that covers it.')),
  needs: arr(str('Id of an objective that must be understood first.')),
  group: str(
    'The topic it belongs to, one to three words, shared by related objectives, e.g. "Topic models".',
  ),
  state: oneOf(STATES),
  evidence: str('Where the state comes from, e.g. "test 2026-09-29 q7 0/6 sure", or "" when new.'),
});
export const objectivesSchema = obj({
  course: str('Short course name, e.g. "DS346".'),
  objectives: arr(objectiveItem),
});
export const courseUpdateSchema = obj({
  added: arr(objectiveItem),
  extended: arr(
    obj({
      id: str('An existing objective id.'),
      notes: arr(str('A note that now also covers it.')),
      needs: arr(str('A prerequisite id to add.')),
      group: str('Its topic group, when it has none yet; otherwise "".'),
      label: str('Its short map name, when it has none yet; otherwise "".'),
    }),
  ),
  outdated: arr(obj({ id: str('An existing objective id.'), reason: str('A few words.') })),
});
export const questionsSchema = obj({ questions: arr(questionSchema) });
export const probeSchema = obj({
  questions: arr(questionSchema),
  note: str('One sentence on what the probe checks, or why none is needed.'),
});
const mapProps = {
  title: str('At most eight words.'),
  plan: str('Two to four sentences, addressed to the student.'),
  mermaid: str(
    'A small Mermaid flowchart (graph TD) from starting facts at the top to the goal at the bottom. Put every node label in double quotes, e.g. A["x[[1]] picks one"]. No code fences.',
  ),
  objective: str('Mastery objective id this lesson teaches, if one fits.'),
  steps: arr(obj({ title: str(), why: str('One sentence: why this step is needed now.') })),
};
export const mapSchema = obj(mapProps, ['objective']);
export const probeMapSchema = obj({
  marks: arr(obj({ id: str(), ...markProps })),
  findings: str('One or two sentences on what the answers show, addressed to the student.'),
  map: mapSchema,
});
export const stepSchema = obj({
  title: str(),
  explain: str(
    'Markdown. Establish the idea from what the student already accepts, showing how it could have been discovered.',
  ),
  connect: str('One or two sentences linking it to the previous step and the goal.'),
  checkFirst: { type: 'boolean' },
  check: questionSchema,
  misconceptions: arr(
    obj({
      signs: str('What an answer showing this mistake looks like.'),
      reteach: str('Markdown: a short re-explanation aimed at this mistake.'),
    }),
  ),
});
export const tutorMarkSchema = obj({
  ...markProps,
  reply: str('Markdown, at most 80 words, addressed to the student.'),
  misconception: {
    type: 'integer',
    description: 'Index of the anticipated misconception the answer shows, or -1.',
  },
});
export const answerSchema = obj({ answer: str('Markdown, at most 150 words.') });
export const closeSchema = obj(
  {
    summary: str(
      'Markdown: what the lesson covered and what the student showed, at most 200 words.',
    ),
    cards: arr(obj({ front: str(), back: str() })),
    noteEdit: obj({
      path: str('The note to add to.'),
      heading: str('The heading to add it under, or "" for the end.'),
      text: str('Markdown to add.'),
    }),
  },
  ['noteEdit'],
);

function questionErrors(list: Question[], where: string): string[] {
  const errors: string[] = [],
    ids = new Set<string>();
  for (const q of list) {
    if (ids.has(q.id)) {
      errors.push(`${where}: question id ${q.id} is used twice`);
    }
    ids.add(q.id);
    if (!q.rubric.length) {
      errors.push(`${q.id} has no rubric`);
    } else if (Math.abs(q.rubric.reduce((n, r) => n + r.marks, 0) - q.marks) > 1e-6) {
      errors.push(`${q.id}: rubric marks must add up to ${q.marks}`);
    }
    if (
      q.type === 'mcq' &&
      (!q.options || q.options.length < 2 || q.answer === undefined || !q.options[q.answer])
    ) {
      errors.push(`${q.id}: multiple choice needs options and a valid answer index`);
    }
  }
  return errors;
}
export interface ObjectiveReply {
  id: string;
  title: string;
  label: string;
  notes: string[];
  needs: string[];
  group: string;
  state: MasteryState;
  evidence: string;
}
export const readObjectives = (v: unknown) =>
  check<{ course: string; objectives: ObjectiveReply[] }>(objectivesSchema, v, (r) =>
    r.objectives.length ? [] : ['result.objectives is empty'],
  );
export const readCourseUpdate = (v: unknown) =>
  check<{
    added: ObjectiveReply[];
    extended: { id: string; notes: string[]; needs: string[]; group: string; label: string }[];
    outdated: { id: string; reason: string }[];
  }>(courseUpdateSchema, v);
export const readQuestions = (v: unknown) =>
  check<{ questions: Question[] }>(questionsSchema, v, (r) =>
    r.questions.length ? questionErrors(r.questions, 'questions') : ['result.questions is empty'],
  ).questions;
export const readProbe = (v: unknown) =>
  check<{ questions: Question[]; note: string }>(probeSchema, v, (r) =>
    questionErrors(r.questions, 'probe'),
  );
export const readMap = (v: unknown) =>
  check<LessonMap>(mapSchema, v, (m) => (m.steps.length ? [] : ['result.steps is empty']));
export function readProbeMap(v: unknown, expected: { id: string; rubric: number }[]) {
  return check<{ marks: (QuestionMark & { id: string })[]; findings: string; map: LessonMap }>(
    probeMapSchema,
    v,
    (r) => [
      ...(r.map.steps.length ? [] : ['result.map.steps is empty']),
      ...expected.flatMap((e) => {
        const m = r.marks.find((x) => x.id === e.id);
        return !m
          ? [`no mark for ${e.id}`]
          : m.awarded.length !== e.rubric
            ? [`${e.id}: awarded needs ${e.rubric} entries`]
            : [];
      }),
    ],
  );
}
export const readStep = (v: unknown) =>
  check<LessonStep>(stepSchema, v, (s) => questionErrors([s.check], 'check'));
export const readTutorMark = (v: unknown, rubric: number) =>
  check<QuestionMark & { reply: string; misconception: number }>(tutorMarkSchema, v, (m) =>
    m.awarded.length === rubric ? [] : [`awarded needs ${rubric} entries`],
  );
export const readAnswer = (v: unknown) => check<{ answer: string }>(answerSchema, v);
export const readClose = (v: unknown) =>
  check<{
    summary: string;
    cards: { front: string; back: string }[];
    noteEdit?: { path: string; heading: string; text: string };
  }>(closeSchema, v);
