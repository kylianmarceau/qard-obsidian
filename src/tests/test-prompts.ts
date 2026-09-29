import type { Attempt, PracticeTest, Question, QuestionMark, TestPlan, TestRequest } from './test-types';
import { questions } from './test-types';

/** Shared by every task. Agents read the vault; Qard writes all files from their JSON. */
export const PREAMBLE = `You are the test-writing and marking assistant inside Qard, an Obsidian study plugin.
The working directory is the student's Obsidian vault. Paths are vault-relative. You may read and search notes, but never create, edit or delete files.
Ground questions and marking in the student's notes. Where the notes are silent, use standard, correct subject knowledge.
Write in plain, direct language. Use Markdown, with LaTeX in $…$ for maths.`;

export interface TestDefaults { questions: number; marking: 'section' | 'end'; profile?: string }
const list = (paths: string[]) => paths.length ? paths.map(p => `- ${p}`).join('\n') : '(none)';
const profileBlock = (profile?: string) => profile?.trim() ? `\nThe student's study profile (past weak spots and habits). Use it to target weaknesses:\n<profile>\n${profile.trim()}\n</profile>\n` : '';
const requestBlock = (r: TestRequest) => `The student's request:\n<request>\n${r.prompt.trim() || '(no prompt: build a balanced test from the sources)'}\n</request>\n\n` +
  (r.sources.length ? `Sources the student chose (read these first):\n${list(r.sources)}${r.decks.length ? `\n(These include the flashcard decks: ${r.decks.join(', ')}.)` : ''}\n` : 'The student chose no sources. Search the vault for the notes that best fit the request.\n');

export function planPrompt(r: TestRequest, d: TestDefaults) {
  return `${requestBlock(r)}${profileBlock(d.profile)}
Draft a short test plan for the student to approve. Do not write the questions yet.
- title: at most eight words.
- goal: two to four sentences that restate the request precisely, including any emphasis.
- sources: keep every note the student chose; add others you found, each with a few words of reason. Read enough to be sure they fit.
- sections: two to four groups of related questions. Each has a one-sentence focus, the question mix (short answer, long answer, calculation, multiple choice) and its marks.
- Aim for about ${d.questions} questions unless the request says otherwise. Estimate minutes realistically.
Keep it brief: this is a plan, not the test.`;
}
export function revisePrompt(plan: TestPlan, change: string, d: TestDefaults) {
  return `Here is a test plan the student is reviewing:\n<plan>\n${JSON.stringify(plan, null, 2)}\n</plan>\n${profileBlock(d.profile)}
The student asks for this change:\n<change>\n${change.trim()}\n</change>\n
Return the whole plan with the change applied. Keep everything else unless the change requires otherwise. Update the counts, marks and minutes.`;
}
export function generatePrompt(input: { request: TestRequest; plan?: TestPlan }, d: TestDefaults) {
  const basis = input.plan ? `Write the test described by this approved plan:\n<plan>\n${JSON.stringify(input.plan, null, 2)}\n</plan>\n` : requestBlock(input.request);
  return `${basis}${profileBlock(d.profile)}
Question types:
- short: one to three sentences. 1–3 marks.
- long: an explanation or comparison. 4–6 marks.
- calc: a worked calculation with fresh numbers. The student may write LaTeX.
- mcq: four options with exactly one correct; set answer to its index. Usually 1 mark.
Rules:
- Test understanding, not the wording of the notes. No two questions test the same point.
- Every question needs a rubric: separate, checkable points whose marks add up to the question's marks.
- model is an answer that earns full marks, no longer than needed.
- source is the note (and heading, if any) the question is based on.
- Section ids are s1, s2, …; question ids are q1, q2, … across the whole test, in order.
${input.plan ? 'Follow the plan\'s sections, focus and mix.' : `Use two to four sections and about ${d.questions} questions.`}`;
}

function questionBlock(q: Question, attempt: Attempt) {
  const a = attempt.answers[q.id];
  return `<question id="${q.id}" type="${q.type}" marks="${q.marks}">
<prompt>${q.prompt}</prompt>
<rubric>
${q.rubric.map((r, i) => `${i + 1}. (${r.marks}) ${r.point}`).join('\n')}
</rubric>
<model_answer>${q.model}</model_answer>
${q.source ? `<source>${q.source.path}${q.source.heading ? ` › ${q.source.heading}` : ''}</source>\n` : ''}<student_answer confidence="${a?.confidence ?? 'unstated'}">${a?.text?.trim() || '(blank)'}</student_answer>
</question>`;
}
const MARKING = `Mark strictly against each rubric. awarded[i] is true only when the answer clearly makes point i; score is the sum of the awarded points' marks. A blank answer scores 0.
Annotate the answer the way a teacher marks a script:
- quote: text copied exactly from the student's answer (one to twelve words).
- kind: correct (earned a point), wrong (factually incorrect), vague (the right idea, stated imprecisely), insight (a good point beyond the rubric).
- For every rubric point not awarded, add a "missing" annotation. Its quote is the exact answer text after which the point belongs, or "" for the end. Its note says what was needed.
- Notes are one or two specific sentences addressed to the student ("you").
mistake is the main reason marks were lost: misconception, careless, imprecise, incomplete, or none. feedback is one sentence.
You may read the source notes to check facts.`;
export function markPrompt(test: PracticeTest, attempt: Attempt, ids: string[]) {
  return `Test: ${test.title}\n\n${questions(test).filter(q => ids.includes(q.id)).map(q => questionBlock(q, attempt)).join('\n\n')}\n\n${MARKING}\nReturn one entry per question above, using its id.`;
}
export function disputePrompt(test: PracticeTest, attempt: Attempt, q: Question, argument: string) {
  const m = attempt.marks[q.id];
  return `Test: ${test.title}\n\n${questionBlock(q, attempt)}\n\nThe current mark is ${m?.score ?? 0}/${q.marks} (awarded: ${JSON.stringify(m?.awarded ?? [])}).
The student disputes it:\n<dispute>\n${argument.trim()}\n</dispute>\n
Re-mark the answer fairly against the same rubric. Change the mark only if the student's case is right. ${MARKING}
reply explains your decision in at most two sentences.`;
}
export function retryPrompt(q: Question, attempt: Attempt, text: string) {
  const m = attempt.marks[q.id];
  return `${questionBlock(q, attempt)}\n\nThe student's first answer was awarded ${m?.score ?? 0}/${q.marks} (awarded: ${JSON.stringify(m?.awarded ?? [])}).
They tried the missed points again:\n<second_attempt>\n${text.trim()}\n</second_attempt>\n
Judge the first answer plus this second attempt against the rubric. score is what they would earn together. feedback says, in one or two sentences, what is now right and what is still missing.`;
}
export function askPrompt(q: Question, attempt: Attempt, question: string) {
  const prior = attempt.review[q.id]?.followups ?? [];
  return `${questionBlock(q, attempt)}\n${prior.length ? `\nEarlier follow-ups:\n${prior.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n')}\n` : ''}
The student asks about this question:\n<ask>\n${question.trim()}\n</ask>\n
Answer like a good tutor: direct, correct, at most 150 words. Read the source note if it helps.`;
}
export function wrapupPrompt(test: PracticeTest, attempt: Attempt, profile: string | undefined, today: string) {
  const summary = questions(test).map(q => {
    const m: QuestionMark | undefined = attempt.marks[q.id], a = attempt.answers[q.id];
    const lost = q.rubric.filter((_, i) => !m?.awarded[i]).map(r => r.point);
    return `<question id="${q.id}" marks="${m?.score ?? 0}/${q.marks}" confidence="${a?.confidence ?? 'unstated'}" mistake="${m?.mistake ?? 'none'}">
${q.prompt}${q.source ? `\nsource: ${q.source.path}` : ''}${lost.length ? `\nmissed: ${lost.join(' | ')}` : ''}${m?.annotations.filter(n => n.kind !== 'correct').map(n => `\nnote: ${n.note}`).join('') ?? ''}
</question>`;
  }).join('\n');
  return `The student has finished "${test.title}". Marked results:\n${summary}\n
${profile?.trim() ? `Their current study profile:\n<profile>\n${profile.trim()}\n</profile>` : 'They have no study profile yet.'}
Return:
- fixes: at most three things to fix, most important first. Rank by marks lost, and put answers the student was sure about but lost marks on first. Each has the question id, a title of at most eight words and one or two sentences.
- cards: one flashcard per clear gap (at most six). front is a precise question; back is a short, complete answer.
- profile: the full updated study profile in Markdown, at most 300 words, with the headings "## Weak spots", "## Improving" and "## Habits". Merge with the existing profile, drop items the student has now mastered, and date new items (${today}).`;
}
