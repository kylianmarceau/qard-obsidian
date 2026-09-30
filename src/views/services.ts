import type { App, Component } from 'obsidian';
import type { VaultIndexer } from '../cards/indexer';
import type { CardDraft, CardWriter } from '../cards/card-writer';
import type { QardCard } from '../cards/card-types';
import type { ReviewStore } from '../review/review-store';
import type { Selection } from '../review/session';
import type { TestService } from '../tests/test-service';
import type { LearnService } from '../learn/learn-service';
import type { JobClock } from '../jobs/job-clock';
export interface QardServices {
  app: App; owner: Component; index: VaultIndexer; writer: CardWriter; reviews: ReviewStore; tests: TestService; learn: LearnService; jobs?: JobClock;
  host: HTMLElement; setFocus: (enabled: boolean) => void; isActive: () => boolean;
  openSource: (card: QardCard) => Promise<void>;
}
export interface UiRequest { serial: number; kind: 'builder' | 'create' | 'library' | 'tests' | 'new-test' | 'today' | 'learn' | 'lesson'; selection?: Selection; draft?: Partial<CardDraft>; path?: string }
