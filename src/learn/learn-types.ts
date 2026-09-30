/** Checks and lessons. As with tests, Qard is the only writer; agents return JSON that Qard validates. */
import type { AnswerState, Goal, Question, QuestionMark } from '../tests/test-types';
import type { MasteryState } from './mastery';

/** One to three fresh questions on one objective, written ahead of time and kept afterwards as evidence. */
export interface CheckRecord {
  version: 1; createdAt: number;
  mastery: string; course: string; objective: string; title: string; goal: Goal;
  questions: Question[];
  answers: Record<string, AnswerState>;
  marks: Record<string, QuestionMark>;
  status: 'ready' | 'marking' | 'marked' | 'error'; error?: string;
  finishedAt?: number;
}

export interface LessonMap { title: string; plan: string; mermaid: string; objective?: string; steps: { title: string; why: string }[] }
/** Written by the writer after the map is accepted, one step at a time. */
export interface LessonStep {
  title: string; explain: string; connect: string;
  /** Ask before telling, when the student can plausibly work it out. */
  checkFirst: boolean;
  check: Question;
  misconceptions: { signs: string; reteach: string }[];
}
export interface StepState {
  answer?: AnswerState; mark?: QuestionMark;
  /** The tutor's reply to the answer, and a prepared re-explanation when the mistake was anticipated. */
  reply?: string; reteach?: string;
  retry?: { text: string; mark: QuestionMark; reply: string };
  asks: { q: string; a: string }[];
}
export interface LessonClose {
  summary: string;
  cards: { front: string; back: string }[];
  noteEdit?: { path: string; heading: string; text: string };
  cardState: Record<number, 'added' | 'skipped'>;
  noteState?: 'accepted' | 'skipped';
  note?: string;
  nextCheck?: string;
}
export interface Lesson {
  version: 1; createdAt: number; topic: string; notes: string[];
  mastery?: string; course?: string; objective?: string;
  probe?: { questions: Question[]; answers: Record<string, AnswerState>; submitted?: boolean; marks?: Record<string, QuestionMark>; findings?: string };
  map?: LessonMap; accepted?: boolean;
  steps: (LessonStep | null)[];
  state: StepState[];
  current: number;
  finishedAt?: number;
  close?: LessonClose;
}
export interface LessonSummary { path: string; title: string; created: number; finished: boolean; objective?: string }
export interface TodayItem { mastery: string; course: string; objective: string; title: string; state: MasteryState; due: string; check?: string }
export interface Today { checks: TodayItem[]; lessons: TodayItem[]; moreLessons: number; cards: number }
