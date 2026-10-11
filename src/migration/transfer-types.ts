import type { ReviewEvent, ReviewState } from '../review/scheduler';

export interface TransferCard {
  front: string;
  back: string;
  deck: string;
  topic: string;
  tags: string[];
  group?: string;
  state?: Omit<ReviewState, 'cardId' | 'fsrs'>;
  history?: Omit<ReviewEvent, 'cardId'>[];
}
export interface TransferIssue {
  row: number;
  message: string;
}
export interface TransferInput {
  cards: TransferCard[];
  issues: TransferIssue[];
  media?: { key: string; name: string; bytes: Uint8Array }[];
  packageBytes?: Uint8Array;
}
