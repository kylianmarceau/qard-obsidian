import type { SourceSnapshot } from '../cards/source-sync-types';
/** Practice-test files. Qard is the only writer; agents return JSON that Qard validates and saves. */
export type QuestionType = 'short' | 'long' | 'mcq' | 'calc';
export type Confidence = 'sure' | 'unsure' | 'guess';
export type AnnotationKind = 'correct' | 'wrong' | 'vague' | 'missing' | 'insight';
export type Mistake = 'misconception' | 'careless' | 'imprecise' | 'incomplete' | 'unknown' | 'none';
/** What a question is for; the format follows from it. */
export type Goal = 'recognise' | 'recall' | 'explain' | 'apply';

export interface TestPlan {
  title: string; goal: string;
  sources: { path: string; reason: string }[];
  sections: { title: string; focus: string; questions: string; marks: number }[];
  questionCount: number; totalMarks: number; minutes: number;
}
export interface RubricPoint { point: string; marks: number }
export interface Question {
  id: string; type: QuestionType; prompt: string; marks: number;
  options?: string[]; answer?: number;
  rubric: RubricPoint[]; model: string;
  source?: { path: string; heading?: string };
  /** Mastery objective id, when the test or lesson belongs to a course. */
  objective?: string;
  goal?: Goal;
}
export interface Section { id: string; title: string; questions: Question[] }
export interface PracticeTest { version: 1; title: string; createdAt: number; sections: Section[]; /** The course mastery file its objectives come from. */ mastery?: string; recorded?: boolean; sourceSnapshots?: SourceSnapshot[] }

export interface Annotation { quote: string; kind: AnnotationKind; note: string }
export interface QuestionMark { score: number; awarded: boolean[]; annotations: Annotation[]; mistake: Mistake; feedback: string }
/** unknown: the student chose "I don't know", which marks a gap rather than a wrong answer. */
export interface AnswerState { text?: string; choice?: number; confidence?: Confidence; flagged?: boolean; unknown?: boolean }
export type SectionStatus = 'open' | 'submitted' | 'marking' | 'marked' | 'error';
export interface ReviewState {
  retry?: { text: string; feedback: string; score: number };
  followups?: { q: string; a: string }[];
  dispute?: { text: string; reply: string };
  card?: 'added';
}
export interface Wrapup { fixes: { questionId: string; title: string; body: string }[]; cards: { questionId: string; front: string; back: string }[] }
export interface Attempt {
  version: 1; startedAt: number; finishedAt?: number;
  answers: Record<string, AnswerState>;
  sections: Record<string, { status: SectionStatus; error?: string }>;
  marks: Record<string, QuestionMark>;
  review: Record<string, ReviewState>;
  wrapup?: Wrapup;
  cards?: Record<number, 'added' | 'skipped'>;
}
/** What the user asked for on the New test screen. */
/** writing: set while the test is being written, so a reload knows to start it again. */
export interface TestRequest { prompt: string; decks: string[]; notes: string[]; sources: string[]; folders?: string[]; writing?: number }
export interface TestFolder { folder: string; request?: TestRequest; plan?: TestPlan; test?: PracticeTest; attempt?: Attempt }

export function questions(test: PracticeTest): Question[] { return test.sections.flatMap(s => s.questions); }
export function sectionOf(test: PracticeTest, id: string): Section | undefined { return test.sections.find(s => s.questions.some(q => q.id === id)); }
export function totalMarks(test: PracticeTest) { return questions(test).reduce((n, q) => n + q.marks, 0); }
export function scoreOf(test: PracticeTest, attempt: Attempt | undefined, section?: Section) {
  const list = section ? section.questions : questions(test);
  return { score: list.reduce((n, q) => n + (attempt?.marks[q.id]?.score ?? 0), 0), marks: list.reduce((n, q) => n + q.marks, 0), marked: list.every(q => attempt?.marks[q.id]) };
}
export function emptyAttempt(test: PracticeTest, now = Date.now()): Attempt {
  return { version: 1, startedAt: now, answers: {}, marks: {}, review: {}, sections: Object.fromEntries(test.sections.map(s => [s.id, { status: 'open' }])) };
}
/** "I don't know" never needs an agent. */
export function markUnknown(q: Question): QuestionMark {
  return { score: 0, awarded: q.rubric.map(() => false), annotations: [], mistake: 'unknown', feedback: 'You said you didn\'t know. The model answer shows what was needed.' };
}
/** Multiple choice never needs an agent. */
export function markChoice(q: Question, answer: AnswerState | undefined): QuestionMark {
  if (answer?.unknown) return markUnknown(q);
  const right = answer?.choice !== undefined && answer.choice === q.answer;
  return { score: right ? q.marks : 0, awarded: q.rubric.map(() => right), annotations: [], mistake: right ? 'none' : 'misconception', feedback: right ? 'Correct.' : `The answer is “${q.options?.[q.answer ?? -1] ?? ''}”.` };
}
