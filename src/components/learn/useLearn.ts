import { useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { LearnJob, LearnJobKind } from '../../learn/learn-contracts';

/** Re-renders when the learn service changes, and exposes its jobs. */
export function useLearn(services: QardServices) {
  const snapshot = useSyncExternalStore(services.learn.subscribe, services.learn.getSnapshot);
  return {
    revision: snapshot.revision,
    job: (target: string, kind: LearnJobKind, id = ''): LearnJob | undefined =>
      services.learn.job(target, kind, id),
  };
}
