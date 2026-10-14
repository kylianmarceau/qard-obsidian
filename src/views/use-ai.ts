import { useSyncExternalStore } from 'react';
import { aiOn } from '../settings/settings';
import type { QardServices } from './services';

/** Whether AI features are on, updating when the setting changes. */
export function useAi(services: Pick<QardServices, 'reviews'>): boolean {
  return aiOn(
    useSyncExternalStore(services.reviews.subscribe, services.reviews.getSnapshot).settings,
  );
}
