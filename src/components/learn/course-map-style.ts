import type { MasteryState } from '../../learn/mastery';

export const masteryNodeClass = (state: MasteryState) => `qard-node-${state.replace(' ', '-')}`;
