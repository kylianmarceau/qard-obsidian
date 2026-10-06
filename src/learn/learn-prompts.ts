import type { AnswerState, Goal, Question } from '../tests/test-types';
import { GOAL_RULES, MARKING, MCQ_RULES, questionBlock } from '../tests/test-prompts';
import { objectiveLines, type Mastery, type Objective } from './mastery';
import type { CheckRecord, Lesson, LessonMap, LessonStep, StepState } from './learn-types';

/** The teaching approach: understanding over recall, built from foundations the student already accepts. */
export const TEACHING = `How to teach:
- Aim for understanding, not recall. Each new fact should follow from foundations the student already accepts, so it is held in place by its connections.
- Start from unconditional truths: definitions and universal statements the student can accept as they are, without caveats.
- Explain every step, including why it is needed now, as if showing how it could have been discovered.
- When the student can plausibly work something out, ask before telling.
- Ground everything in the student's notes and name the note. Where the notes are silent, use standard, correct knowledge.
- Plain, direct language. Short paragraphs. Markdown, with LaTeX in $…$.`;

const QUESTION_FORMAT = `${GOAL_RULES}
${MCQ_RULES}
Every question needs a rubric of separate, checkable points whose marks add up to its marks, and a model answer that earns full marks.`;
/** The lesson's notes, inlined so the live tutor needs no tools. */
export const sourcesBlock = (sources?: string) =>
  sources ? `\nThe notes' text:\n${sources}\n` : '';
const notesList = (notes: string[]) =>
  notes.length ? notes.map((n) => `- ${n}`).join('\n') : '(none given: search the vault)';
const objectiveBlock = (o: Objective) =>
  `<objective id="${o.id}" state="${o.state}">\n${o.title}\nNotes: ${o.notes.join(', ') || '(none listed)'}\nEvidence so far: ${o.evidence.join('; ') || 'none'}\n</objective>`;
const courseBlock = (m?: Mastery) =>
  m
    ? `\nThe student's mastery file for ${m.course} (id | objective | state | evidence):\n<mastery>\n${objectiveLines(m)}\n</mastery>\n`
    : '';

const OBJECTIVE_RULES = `- Each objective is one teachable idea or skill, specific enough to test in a few questions ("Derive the LDA generative process", not "Topic models").
- notes lists the notes that cover it.
- needs lists the ids of the objectives that must be understood first: the direct prerequisites only, not everything before it. Together they form the course map, a graph from foundations to the hardest ideas, so never make a cycle.
- label is a short name for the course map, two to four words ("LDA generative story", "Dirichlet draws").
- group names the topic it belongs to, one to three words ("Text mining", "Topic models"). A topic is roughly one lecture block or week of the course: use four to eight for the whole course, and the exact same name for every objective in it.`;

export function mapCoursePrompt(
  folder: string,
  notes: string[],
  request: string,
  profile?: string,
) {
  return `Map a course into mastery objectives: the things the student must be able to explain or do.
Course folder: ${folder}
Notes in it:
${notesList(notes)}
${request.trim() ? `\nThe student adds:\n<request>\n${request.trim()}\n</request>\n` : ''}${profile?.trim() ? `\nThe student's study profile from past tests:\n<profile>\n${profile.trim()}\n</profile>\n` : ''}
Read the course hub, study indexes, assessment notes, course outline and topic notes. Return 10 to 40 objectives, foundations first.
${OBJECTIVE_RULES}
- state is "new" unless the profile gives evidence: "misconception" if the student was sure but wrong, "gap" if they could not answer, "shaky" if right but unsure. evidence says where it comes from.
- If a course outline or syllabus lists topics that no note covers yet, add them with state "planned" and no notes, so the map shows what is coming.`;
}

/** The course has grown: propose additions without disturbing what exists. */
export function updateCoursePrompt(m: Mastery, changed: string[], request: string) {
  return `The student's mastery file for ${m.course} already has these objectives (id | objective | label | group | state | needs | notes):
<objectives>
${m.objectives.map((o) => `${o.id} | ${o.title} | ${o.label ?? '-'} | ${o.group ?? '-'} | ${o.state} | ${o.needs.join(', ') || '-'} | ${o.notes.join(', ') || '-'}`).join('\n')}
</objectives>

Notes added or changed since the course was last mapped (read them):
${notesList(changed)}
${request.trim() ? `\nThe student adds:\n<request>\n${request.trim()}\n</request>\n` : ''}
Propose how the objectives should grow. Never rename, merge or rewrite existing objectives: the student's progress is recorded against their ids.
- added: new objectives the new material introduces. Their needs may use existing or other added ids.${'\n'}${OBJECTIVE_RULES}
  state is "new", or "planned" if an outline lists it but no note covers it yet.
- extended: existing objectives that the new notes also cover (notes to add), that gain a prerequisite (needs to add), or that have no group or label yet (set them; reuse existing group names where they fit). Give every existing objective without a label or group one here. Otherwise group and label are "". A "planned" objective whose material has now arrived belongs here with its notes.
- outdated: existing objectives no note covers any more, with a short reason. Only when clearly so; the student decides.
Return empty lists when nothing changes.`;
}

export function checkPrompt(m: Mastery, o: Objective, goal: Goal, previous: CheckRecord[]) {
  const past = previous
    .slice(-4)
    .flatMap((c) =>
      c.questions.map((q) => `- (${c.goal}) ${q.prompt.replace(/\s+/g, ' ').slice(0, 200)}`),
    );
  return `Write a short check on one objective. It will be answered days from now to test whether the student still understands it.
${objectiveBlock(o)}
Course: ${m.course}

Goal: ${goal}. Write one to three questions at this goal, each worth 1–4 marks. Use fresh wording and new cases; the student must not be able to pass by remembering an earlier question.
${past.length ? `Earlier check questions on this objective (do not repeat them):\n${past.join('\n')}\n` : ''}${o.state === 'misconception' || o.state === 'slipping' ? 'The latest evidence shows a mistake. Aim at least one question at it.\n' : ''}
Read the notes first. Question ids are c1, c2, c3; set objective to "${o.id}" and goal on each.
${QUESTION_FORMAT}`;
}

export function markCheckPrompt(check: CheckRecord, ids: string[]) {
  return `A check on "${check.title}".\n\n${check.questions
    .filter((q) => ids.includes(q.id))
    .map((q) => questionBlock(q, check.answers[q.id]))
    .join('\n\n')}\n\n${MARKING}\nReturn one entry per question above, using its id.`;
}

export function probePrompt(lesson: Lesson, m?: Mastery, o?: Objective, sources?: string) {
  return `The student wants to learn: ${lesson.topic}
${o ? objectiveBlock(o) : ''}Notes to teach from:
${notesList(lesson.notes)}
${sourcesBlock(sources)}${courseBlock(m)}
Before planning the lesson, find the edge of what the student knows. List the prerequisite ideas the lesson depends on. Skip any the mastery file already shows as taught, right once or mastered.
Write at most four quick probe questions, one per remaining prerequisite, each worth 1 mark. Prefer mcq (recognise) or short (recall); they must be answerable in under a minute. Set objective to a mastery id when the prerequisite is one. Ids are p1, p2, …
Return no questions if the evidence already shows where to start. note says in one sentence what the probe checks.
${MCQ_RULES}`;
}

function answersBlock(questions: Question[], answers: Record<string, AnswerState>) {
  return questions.map((q) => questionBlock(q, answers[q.id])).join('\n\n');
}
export function probeMapPrompt(lesson: Lesson, m?: Mastery, o?: Objective, sources?: string) {
  const probe = lesson.probe;
  const typed = probe?.questions.filter((q) => q.type !== 'mcq') ?? [];
  return `${TEACHING}

The student wants to learn: ${lesson.topic}
${o ? objectiveBlock(o) : ''}Notes to teach from:
${notesList(lesson.notes)}
${sourcesBlock(sources)}${courseBlock(m)}
${probe?.questions.length ? `Their probe answers (multiple choice is already marked; mark the others):\n${answersBlock(probe.questions, probe.answers)}\n${MARKING}\nReturn marks only for: ${typed.map((q) => q.id).join(', ') || '(none)'}.\n` : 'There was no probe. Return an empty marks list.\n'}
Then plan the lesson from the edge you found:
- findings: what the answers show, in one or two sentences. Name a wrong answer as a slip, an isolated gap or a misconception.
- map: three to five steps. The first builds on something the student has shown they know; the last reaches the goal. plan says in prose where you will start and why. mermaid is a small graph TD from the starting facts to the goal. Each step has a one-sentence why.${m ? '\n- objective: the mastery id this lesson teaches, if one fits.' : ''}`;
}

export function reviseMapPrompt(lesson: Lesson, change: string) {
  return `${TEACHING}\n\nA lesson plan the student is reviewing:\n<map>\n${JSON.stringify(lesson.map, null, 2)}\n</map>\nProbe findings: ${lesson.probe?.findings ?? 'none'}\n\nThe student asks:\n<change>\n${change.trim()}\n</change>\n\nReturn the whole map with the change applied.`;
}

export function stepPrompt(lesson: Lesson, map: LessonMap, index: number) {
  const done = map.steps
    .slice(0, index)
    .map((s, i) => `${i + 1}. ${s.title}`)
    .join('\n');
  const step = map.steps[index]!;
  return `${TEACHING}

You are writing one step of a lesson on: ${lesson.topic}
Notes to teach from (read them):
${notesList(lesson.notes)}
The plan: ${map.plan}
Probe findings: ${lesson.probe?.findings ?? 'none'}
Steps already taught:
${done || '(none: this is the first step)'}

Write step ${index + 1} of ${map.steps.length}: "${step.title}". Why it is needed now: ${step.why}
- explain: establish the idea from what the student already accepts. 80 to 250 words.
- connect: how it links to the previous step and the goal.
- checkFirst: true when the student can plausibly work the idea out before reading the explanation; the check is then asked first.
- check: one question (id "k${index + 1}") that shows whether the step landed, worth 1–4 marks.${lesson.objective ? ` Set objective to "${lesson.objective}".` : ''}
- misconceptions: the two or three likely wrong answers to the check, each with a short re-explanation aimed at that mistake.
${QUESTION_FORMAT}`;
}

export function tutorMarkPrompt(
  lesson: Lesson,
  step: LessonStep,
  answer: AnswerState | undefined,
  retryOf?: StepState,
) {
  return `${TEACHING}

You are tutoring live, so be quick and brief. Lesson: ${lesson.topic}. Step: ${step.title}
<explanation>${step.explain}</explanation>
${questionBlock(step.check, answer)}
${retryOf?.mark ? `\nThis is a second attempt. The first scored ${retryOf.mark.score}/${step.check.marks}.\n` : ''}
Anticipated misconceptions:
${step.misconceptions.map((m, i) => `${i}. ${m.signs}`).join('\n') || '(none)'}

${MARKING}
reply: speak to the student in at most 80 words. If they are right, confirm the key idea and move on. If not, point at the exact error and give a nudge, not the whole answer.
misconception: the index of the anticipated misconception the answer shows, or -1.`;
}

export function askPrompt(
  lesson: Lesson,
  step: LessonStep | undefined,
  asks: { q: string; a: string }[],
  question: string,
  sources?: string,
) {
  return `${TEACHING}

You are tutoring live. Lesson: ${lesson.topic}.${step ? `\nCurrent step: ${step.title}\n<explanation>${step.explain}</explanation>` : ''}
Notes: ${lesson.notes.join(', ') || 'none'}
${sourcesBlock(sources)}${asks.length ? `Earlier questions in this step:\n${asks.map((a) => `Q: ${a.q}\nA: ${a.a}`).join('\n\n')}\n` : ''}
The student asks:\n<ask>\n${question.trim()}\n</ask>\nAnswer directly and correctly in at most 150 words, grounded in their notes where possible.`;
}

export function closePrompt(lesson: Lesson) {
  const steps = lesson.steps
    .map((s, i) => {
      const st = lesson.state[i];
      return s
        ? `<step title="${s.title}" check="${st?.mark ? `${st.mark.score}/${s.check.marks}` : 'not answered'}" confidence="${st?.answer?.unknown ? "didn't know" : (st?.answer?.confidence ?? 'unstated')}">${st?.asks.map((a) => `\nasked: ${a.q}`).join('') ?? ''}${st?.mark && st.mark.score < s.check.marks ? `\nmistake: ${st.mark.feedback}` : ''}</step>`
        : '';
    })
    .join('\n');
  return `The student finished a lesson on: ${lesson.topic}
Notes: ${lesson.notes.join(', ') || 'none'}
Plan: ${lesson.map?.plan ?? ''}
Probe findings: ${lesson.probe?.findings ?? 'none'}
${steps}

Return:
- summary: what the lesson covered and what the student showed, for the lesson note. At most 200 words.
- cards: two to four flashcards for the ideas most worth keeping fresh, and any gap the checks exposed. front is a precise question; back is short and complete.
- noteEdit: only if one of the notes is missing something the lesson had to explain, the paragraph to add (path, the heading to put it under or "" for the end, and the Markdown). Omit it otherwise.`;
}
