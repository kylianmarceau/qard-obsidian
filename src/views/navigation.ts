import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { Selection, SessionStyle } from '../review/session';
import type { SavedSession } from '../review/saved-session';

export type Screen =
  | { kind: 'library' }
  | { kind: 'deck'; deck: string }
  | { kind: 'card'; card: QardCard }
  | { kind: 'editor' | 'generate-cards'; draft?: Partial<CardDraft> }
  | { kind: 'builder'; selection: Selection }
  | {
      kind: 'study';
      cards: QardCard[];
      serial: number;
      style?: SessionStyle;
      session?: SavedSession;
      notice?: string;
    }
  | { kind: 'tests' }
  | { kind: 'new-test'; prompt?: string; serial: number }
  | { kind: 'plan' | 'take' | 'results' | 'test-cards'; folder: string }
  | { kind: 'review'; folder: string; question?: string }
  | { kind: 'exams' | 'today' | 'learn' | 'usage' | 'statistics' | 'source-updates' }
  | { kind: 'map-course'; folder?: string }
  | { kind: 'check' | 'lesson'; path: string }
  | { kind: 'course'; path: string; objective?: string; serial: number };

export type TestNav = {
  library: () => void;
  tests: () => void;
  newTest: (prompt?: string) => void;
  plan: (folder: string) => void;
  take: (folder: string) => void;
  results: (folder: string) => void;
  review: (folder: string, question?: string) => void;
  cards: (folder: string) => void;
};

export type LearnNav = {
  library: () => void;
  today: () => void;
  learn: () => void;
  mapCourse: (folder?: string) => void;
  course: (path: string, objective?: string) => void;
  check: (path: string) => void;
  lesson: (path: string) => void;
  studyDue: () => void;
  usage?: () => void;
};

export interface UiRequest {
  serial: number;
  kind:
    | 'builder'
    | 'create'
    | 'library'
    | 'tests'
    | 'new-test'
    | 'today'
    | 'learn'
    | 'lesson'
    | 'usage'
    | 'statistics'
    | 'source-updates';
  selection?: Selection;
  draft?: Partial<CardDraft>;
  path?: string;
}
