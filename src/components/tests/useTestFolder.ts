import { useEffect, useState, useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { TestFolder } from '../../tests/test-types';
import type { Job, JobKind } from '../../tests/test-contracts';

/** Loads a test folder and re-renders when the service changes it. */
export function useTestFolder(
  services: QardServices,
  folder: string,
): { entry?: TestFolder; error?: string; job: (kind: JobKind, id?: string) => Job | undefined } {
  const snapshot = useSyncExternalStore(services.tests.subscribe, services.tests.getSnapshot);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    services.tests.load(folder).catch((e) => {
      if (live) {
        setError((e as Error).message);
      }
    });
    return () => {
      live = false;
    };
  }, [services, folder]);
  void snapshot;
  return {
    entry: services.tests.get(folder),
    error,
    job: (kind, id) => services.tests.job(folder, kind, id),
  };
}
