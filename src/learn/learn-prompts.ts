import type { AnswerState, Goal, Question } from '../tests/test-types';
import {
  GOAL_RULES,
  MARKING,
  MCQ_RULES,
  formatHistory,
  questionBlock,
  studentAnswer,
} from '../tests/test-prompts';
import { objectiveLines, type Mastery, type Objective } from './mastery';
import type { CheckRecord, Lesson, LessonMap, LessonStep, StepState } from './learn-types';

/** Teach mechanisms, retrieval and application from demonstrated foundations. */
export const TEACHING = `How to teach:
- Teach the student to understand the mechanism, retrieve it later, and apply it to a new case.
- Start from relevant knowledge supported by their answers. Treat a lesson title or taught status as evidence of exposure, not proof of understanding.
- State the conditions under which a rule holds. Preserve boundaries needed for correctness.
- In each lesson explanation, always illustrate the idea with a compact example. Prefer a simple, generic situation that makes the mechanism clear. Define unfamiliar terms and supply every premise needed to follow the reasoning. For conceptual explanations, use a qualitative illustration rather than inventing values, names or timestamps. Add concrete quantities or timing only when the reasoning needs them; do not add a calculation merely to make an example look concrete. Work through calculations or code when the idea requires them.
- Preserve the source's relationships and conditions when illustrating its setup. Invented details must not silently change what is being predicted, its time horizon, what information is available, or another premise on which the reasoning depends. If a transfer example deliberately changes a premise, state the change explicitly and reason consistently from it.
- Give enough context to identify what the example describes and why its conclusion follows, without turning every example into a detailed case study. Ask before explaining only when the answer follows from knowledge the student has already demonstrated.
- Prefer concrete inputs, state changes, decisions and outputs. Use terminology after establishing what it means.
- Ground explanations in the student's notes and link the supporting passage: [[path#Heading|label]], or [[path#^block-id|label]] when that block ID already exists. Verify the path and anchor; link to the note itself if it has no suitable anchor. Never invent headings or block IDs. Keep answer-revealing citations out of questions shown before an attempt. Where no supporting note exists, use standard, correct knowledge without fabricating a citation.
- Explain only what is needed, without vague philosophical prose or length quotas. Plain, direct language. Short paragraphs. Markdown, with LaTeX in $…$.`;

/**
 * When to show rather than tell, from the vault's figure guide: only when the student would understand
 * significantly faster or more accurately with a visual. Most steps need none.
 */
const VISUALS = `Visuals. Use one only when the student would understand significantly faster or more accurately with it; text is the default, and most steps need none. Good reasons: the idea has a visual structure (a tree, graph, layout or flow), a shape (a distribution, a curve, convergence, a decision boundary), a spatial relationship, or would otherwise take 150 words to describe.
- A flow, process, sequence, decision or small graph: a Mermaid block in the Markdown (\`\`\`mermaid, graph TD or LR). Put every node label in double quotes, and use <br/> for line breaks.
- A figure already embedded in the notes that shows this idea: reuse it. Copy its embed, e.g. ![[beta-shapes.png|700]], followed by a blank line and an italic caption starting *Figure:*.`;
const DRAWN = `- A shape or picture Mermaid can't show, with no figure in the notes (a distribution or function with specific parameters, a geometric picture, a data structure with real values, a worked example laid out in space): write a brief in figure and the illustrator will draw it. Name exactly what to plot or draw, with the parameters and values, and what the student should notice.`;

const QUESTION_FORMAT = `${GOAL_RULES}
${MCQ_RULES}
Write the question, rubric and model answer as one aligned task.
The question states one substantive task, relevant assumptions and expected answer form. It is self-contained: identify what its scenario describes, define unfamiliar terms and supply every fact needed to answer without relying on another question or worked example. If an omitted fact could change the correct answer, state that fact. For predictions, identify what is predicted and include entity, time period or observation availability when they affect the answer. Do not demand a fixed list of scenario details; omit names, numbers, units or timing that cannot affect the answer. Do not add length quotas or visible grading instructions. Do not imply the outcome through wording.
One verdict with its reason is one task. A list of independent errors to repair, several separate predictions, or separate deployment, monitoring and retraining decisions is not one task merely because they share a scenario. Choose one such issue for this question; save the others for separate checks. Do not use "for each practice" to disguise several questions as one.
Every scored requirement must follow from what the question asks. If a specific example, failure class or method is required, name it. Otherwise accept technically valid alternatives.
Ask explicitly for any intermediate value or calculation that earns marks. Otherwise do not require it in the rubric. A response that fully answers the question must not lose credit for omitting unrequested intermediate values.
Each rubric point assesses one independently checkable claim. Separate a correct outcome from its required explanation. Do not combine unrelated claims into one all-or-nothing point.
When several outputs, decisions or labels are requested, give each output, decision or label its own rubric point, even when the correct values happen to be the same. For example, "the first output is 5" and "the second output is 5" are separate points, never one point saying "5 followed by 5". Check an answer with one output correct and another wrong: it must retain credit for the correct output. If separate claims exceed the marks available, reduce the task rather than bundle claims or invent fractional marks.
Before returning, check whether the question is answerable without guessing its intended meaning; whether every point assesses a requested part; whether another valid solution earns appropriate credit; and whether the explanation establishes the needed knowledge.
The rubric marks add up to the question marks, and the model answer earns full marks.

Write the shortest model answer that earns full credit while preserving the essential mechanism and conditions. Follow the same answer structure requested from the student. Do not introduce requirements through the model answer. Rubric wording describes concepts, not phrases to reproduce. Account for equivalent terminology and valid alternative solutions. Keep optional explanation visibly separate from the required answer. Optional detail must never become an unstated grading requirement.`;
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

export const CHECK_RULES = `Write a short check on one objective. It will be answered days from now to test whether the student still understands it.
Write ONE or TWO focused, self-contained checks at the supplied goal on this objective, not a broad curriculum. Choose each format for the capability being assessed, using the recent history to balance equally suitable formats. Add a second check only when it gives useful evidence of a distinct gap within this objective; use another suitable format when that fits the task, without adding a question just for variety. Usually use 1–2 marks for written checks, 1 for mcq and 1 per cloze slot. Use fresh wording and new cases; the student must not be able to pass by remembering an earlier question.
Use earlier questions, answers and feedback to target actual gaps; do not repeat cases. If the objective's state is misconception or slipping, aim at least one question at the latest demonstrated mistake.
Read the notes first. Question ids are c1 and, if needed, c2; set objective to the supplied objective id and goal on each.
${QUESTION_FORMAT}`;

export function checkPrompt(
  m: Mastery,
  o: Objective,
  goal: Goal,
  previous: CheckRecord[],
  history?: readonly Pick<Question, 'type' | 'goal'>[],
) {
  const past = previous.slice(-4).flatMap((c) =>
    c.questions.map((q) => {
      const mark = c.marks[q.id];
      return `- (${c.goal}) ${q.prompt.replace(/\s+/g, ' ').slice(0, 200)}\n  Answer: ${studentAnswer(q, c.answers[q.id]) || '(blank)'}${mark ? `\n  Result: ${mark.score}/${q.marks}; ${mark.feedback}` : ''}`;
    }),
  );
  return `${CHECK_RULES}

${objectiveBlock(o)}
Course: ${m.course}
Goal: ${goal}.
${formatHistory(history ?? previous.flatMap((record) => record.questions))}
${past.length ? `Earlier questions, answers and feedback on this objective:\n${past.join('\n')}\n` : ''}`;
}

export function markCheckPrompt(check: CheckRecord, ids: string[]) {
  return `A check on "${check.title}".\n\n${check.questions
    .filter((q) => ids.includes(q.id))
    .map((q) => questionBlock(q, check.answers[q.id]))
    .join('\n\n')}\n\n${MARKING}\nReturn one entry per question above, using its id.`;
}

export function probePrompt(
  lesson: Lesson,
  m?: Mastery,
  o?: Objective,
  sources?: string,
  history: readonly Pick<Question, 'type' | 'goal'>[] = [],
) {
  return `The student wants to learn: ${lesson.topic}
${o ? objectiveBlock(o) : ''}Notes to teach from:
${notesList(lesson.notes)}
${sourcesBlock(sources)}${courseBlock(m)}
${formatHistory(history)}
Before planning the lesson, find the edge of what the student knows. List the prerequisite ideas the lesson depends on. Skip any the mastery file already shows as taught, right once or mastered.
Write at most four quick probe questions, one per remaining prerequisite, each worth 1 mark. Choose the format that best reveals each prerequisite, balancing equally suitable formats against the recent history. Keep each to one substantive prerequisite task. Set objective to a mastery id when the prerequisite is one. Ids are p1, p2, …
Return no questions if the evidence already shows where to start. note says in one sentence what the probe checks.
${QUESTION_FORMAT}`;
}

const MAP_RULES = `Rules for the map:
- Each step develops one assessable capability.
- A comparison is one capability when distinguishing the alternatives is the learning goal. Do not split it merely because its title names two concepts.
- For each step, its why states what the student should explain or do, required prerequisite knowledge, what this step introduces, and what belongs to later steps.
- The first step starts with the first idea the student has not yet demonstrated. Recall known foundations inside it in a sentence rather than allocating a recap step.
- Briefly retrieve a prerequisite when evidence is uncertain. Do not reteach demonstrated knowledge without a reason.
- Dependencies precede the steps that need them. The final step exercises the requested goal.
- Keep the lesson compact. If the objective exceeds one lesson, identify unfinished scope explicitly rather than implying everything is covered.
- plan explains the starting point and progression. mermaid is a small graph TD from starting facts to the goal.`;

function answersBlock(questions: Question[], answers: Record<string, AnswerState>) {
  return questions.map((q) => questionBlock(q, answers[q.id])).join('\n\n');
}
export function probeMapPrompt(lesson: Lesson, m?: Mastery, o?: Objective, sources?: string) {
  const probe = lesson.probe;
  const typed =
    probe?.questions.filter((q) => q.type !== 'mcq' && !probe.answers[q.id]?.unknown) ?? [];
  return `${TEACHING}

The student wants to learn: ${lesson.topic}
${o ? objectiveBlock(o) : ''}Notes to teach from:
${notesList(lesson.notes)}
${sourcesBlock(sources)}${courseBlock(m)}
${probe?.questions.length ? `Their probe answers (multiple choice is already marked; mark the others):\n${answersBlock(probe.questions, probe.answers)}\n${MARKING}\nReturn marks only for: ${typed.map((q) => q.id).join(', ') || '(none)'}.\n` : 'There was no probe. Return an empty marks list.\n'}
Then plan the lesson from the edge you found:
- findings: what the answers show, in one or two sentences (at most 50 words; don't repeat the plan). Name a wrong answer as a slip, an isolated gap or a misconception.
- map: the lesson plan, following the rules below.${m ? '\n- objective: the mastery id this lesson teaches, if one fits.' : ''}

${MAP_RULES}`;
}

export function reviseMapPrompt(lesson: Lesson, change: string) {
  return `${TEACHING}\n\nA lesson plan the student is reviewing:\n<map>\n${JSON.stringify(lesson.map, null, 2)}\n</map>\nProbe findings: ${lesson.probe?.findings ?? 'none'}\n\nThe student asks:\n<change>\n${change.trim()}\n</change>\n\nReturn the whole map with the change applied. Apply the student's change first; the rules below cover everything it does not ask for. Where the request conflicts with them, follow the request.\n${MAP_RULES}`;
}

export function stepPrompt(
  lesson: Lesson,
  map: LessonMap,
  index: number,
  history?: readonly Pick<Question, 'type' | 'goal'>[],
) {
  const steps = map.steps
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}: ${s.why}${i < index ? ' (earlier planned step)' : i === index ? ' (this step)' : ''}`,
    )
    .join('\n');
  const step = map.steps[index]!;
  return `${TEACHING}

You are writing one step of a lesson on: ${lesson.topic}
Notes to teach from (read them):
${notesList(lesson.notes)}
The plan: ${map.plan}
Probe findings: ${lesson.probe?.findings ?? 'none'}
${formatHistory(
  history ?? [
    ...(lesson.probe?.questions ?? []),
    ...lesson.steps.flatMap((step) => (step ? [step.check] : [])),
  ],
)}
The lesson's steps, written at the same time by other writers (planned scope, not evidence of demonstrated knowledge):
${steps}

Write step ${index + 1} of ${map.steps.length}: "${step.title}". Why it is needed now: ${step.why}
- explain: establish the idea from what the student already accepts, recalling a known foundation in a sentence rather than re-teaching it. Always include a compact example with the context needed to follow its reasoning and verified source links. Prefer a generic situation; work through calculations or code when needed, without inventing irrelevant detail. No minimum length.
- connect: how it links to the previous step and the goal.
- checkFirst: true only when the check follows from knowledge the student has already demonstrated, without facts introduced by this step's explanation. The check is then asked first, as a prediction. Otherwise false.
- check: one question (id "k${index + 1}") that shows whether this step's idea landed, usually worth 1–2 marks for written answers, 1 for mcq or 1 per cloze slot. It asks for one coherent task: a prediction, a verdict, a piece of code or one explanation. Its rubric points are parts of that answer, not unrelated tasks chained together. State the facts, types and conditions needed to answer and the expected answer form; omit details that cannot affect the answer. Leave the other steps' ideas to their own checks.${lesson.objective ? ` Set objective to "${lesson.objective}".` : ''}
- Choose check.type for this step's assessed capability. When several formats fit equally well, prefer one used less often in the recent history, considering the whole lesson's capabilities. Do not assign formats by step number or alternate mechanically. Explicit learner requests still take priority. Set goal for the thinking assessed and type for the response format; keep their distinction clear without adding learner-facing grading instructions.
For a check that traces code, predicts an outcome or applies a mechanism, use a case not already solved in the notes or this explanation. Renaming variables, changing literal values or paraphrasing a worked question is not enough. Change a decision, dependency or operation order so it affects the reasoning or result. Keep the new case within this step's scope and supply every needed premise. Before returning, compare the check with the worked examples: the learner must apply the mechanism rather than copy a displayed answer.
- misconceptions: the two or three likely wrong answers to the check, each with a short re-explanation aimed at that mistake.
- figure: "" unless the step needs a figure drawn (see Visuals).
${QUESTION_FORMAT}

${VISUALS}
${DRAWN}`;
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
${step.checkFirst && !retryOf ? 'This check was asked before the explanation, as a prediction. In reply, treat a wrong answer as a prediction to correct, not a failure.\n' : ''}reply: speak to the student in at most 80 words. If they are right, confirm the key idea and move on. If not, point at the exact error and give a nudge, not the whole answer.
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
The student asks:\n<ask>\n${question.trim()}\n</ask>\nAnswer directly and correctly in at most 150 words, grounded in their notes where possible.\n\n${VISUALS}\nThe student can ask for any other figure to be drawn.`;
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
- noteEdit: only if one of the Markdown notes is missing something the lesson had to explain, the paragraph to add (path, the heading to put it under or "" for the end, and the Markdown). Never a PDF. Omit it otherwise.`;
}

/** The illustrator draws one figure for a lesson step or an answer, from a brief. */
export function illustratePrompt(o: {
  topic: string;
  step?: LessonStep;
  context?: string;
  brief: string;
  python: boolean;
  domains: string[];
}) {
  return `You are the illustrator for a lesson on: ${o.topic}.${o.step ? `\nThe step: ${o.step.title}\n<explanation>${o.step.explain.slice(0, 3000)}</explanation>` : ''}${o.context ? `\n${o.context}` : ''}

Draw one figure for this brief:
<brief>${o.brief.trim()}</brief>

The figure must be correct, uncluttered and readable at 700px wide. Label axes, curves and parts directly, with a legend only when labels would crowd. Use the notation of the explanation. Show what the brief asks and nothing decorative.
${
  o.python
    ? `Choose kind:
- "python" for anything computed: functions, distributions, data, curves, regions, convergence. code is a matplotlib script. numpy is imported as np and matplotlib.pyplot as plt; import scipy, scipy.stats or seaborn if needed. The style is already set and Qard saves the current figure, so don't call savefig or show, set a style, or read or write files. Compute every value; never hard-code a shape. Use mathtext ($\\alpha$) for symbols. Use plt.subplots with one to three panels.
- "svg" for structure: trees, layouts, data structures with values, geometric constructions, annotated diagrams.`
    : 'kind must be "svg": write the complete SVG yourself. For a plot, compute the coordinates carefully.'
}
For svg: a complete <svg> with xmlns and a viewBox, width at most 800. A white background rect; dark text (#24273a), muted labels (#5c6070), lines #9ca0b0, and highlights #1e66f5 (blue), #40a02b (green), #fe640b (orange), #d20f39 (red). Plain Unicode text, no LaTeX. Define arrowhead markers in <defs> for directed arrows. No scripts, images, links or external fonts.
caption: what the figure shows, naming the specific parameters or values, so it makes sense on its own.
name: a descriptive file name. domain: the subject folder${o.domains.length ? `; existing: ${o.domains.join(', ')}` : ''}.`;
}
