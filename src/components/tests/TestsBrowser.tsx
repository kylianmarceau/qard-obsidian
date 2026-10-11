import { LibraryHeader } from '../library/LibraryHeader';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { QardServices } from '../../views/services';
import { InlineMarkdown } from '../Markdown';
import type { TestSummary } from '../../tests/test-contracts';
import type { TestNav } from '../../views/navigation';
const STATUS: Record<TestSummary['status'], string> = {
  planning: 'Planning…',
  plan: 'Plan ready',
  writing: 'Writing…',
  ready: 'Not started',
  'in-progress': 'In progress',
  marked: '',
  failed: 'Needs attention',
};

/** Home-page shortcut back into an unfinished test, if there is one. */
export function ResumeTest({ services, nav }: { services: QardServices; nav: TestNav }) {
  const snapshot = useSyncExternalStore(services.tests.subscribe, services.tests.getSnapshot);
  const [test, setTest] = useState<TestSummary>();
  useEffect(() => {
    let live = true;
    services.tests.list().then(
      (all) => {
        if (live) {
          setTest(
            all.find((t) =>
              ['in-progress', 'ready', 'plan', 'planning', 'writing'].includes(t.status),
            ),
          );
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [services, snapshot.revision]);
  if (!test) {
    return null;
  }
  const open = () =>
    test.status === 'ready' || test.status === 'in-progress'
      ? nav.take(test.folder)
      : nav.plan(test.folder);
  return (
    <button className="qard-resume" onClick={open}>
      <span className="qard-muted">{test.status === 'ready' ? 'Start' : 'Continue'}</span>
      <strong>
        <InlineMarkdown text={test.title} path={test.folder} services={services} />
      </strong>
      <span className="qard-muted">{STATUS[test.status]}</span>
      <ChevronRight size={16} />
    </button>
  );
}

export function TestsBrowser({
  services,
  nav,
  learn,
  plans,
}: {
  services: QardServices;
  nav: TestNav;
  learn?: () => void;
  plans?: () => void;
}) {
  const snapshot = useSyncExternalStore(services.tests.subscribe, services.tests.getSnapshot);
  const [tests, setTests] = useState<TestSummary[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    services.tests.list().then(
      (t) => {
        if (live) {
          setTests(t);
        }
      },
      (e) => {
        if (live) {
          setError((e as Error).message);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [services, snapshot.revision]);
  const open = (t: TestSummary) =>
    t.status === 'marked'
      ? nav.results(t.folder)
      : t.status === 'ready' || t.status === 'in-progress'
        ? nav.take(t.folder)
        : nav.plan(t.folder);
  return (
    <>
      <LibraryHeader
        active="tests"
        decks={nav.library}
        tests={nav.tests}
        learn={learn}
        plans={plans}
        title="Practice tests"
        description="Put what you know into practice, then revisit the points you missed."
      >
        <button className="qard-primary" onClick={() => nav.newTest()}>
          <Plus size={16} />
          New test
        </button>
      </LibraryHeader>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      {!tests && !error && (
        <p className="qard-muted" role="status">
          Loading tests…
        </p>
      )}
      <div className="qard-deck-list">
        {tests?.map((t) => (
          <button key={t.folder} className="qard-deck qard-test-row" onClick={() => open(t)}>
            <span className="qard-deck-name">
              <strong>
                <InlineMarkdown text={t.title} path={t.folder} services={services} />
              </strong>
              <small>
                {t.created ? new Date(t.created).toLocaleDateString() : t.folder.split('/').pop()}
              </small>
            </span>
            <span className="qard-test-status">
              {t.status === 'marked' ? `${t.score} / ${t.marks}` : STATUS[t.status]}
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {tests && !tests.length && (
        <div className="qard-empty">
          <p>No tests yet.</p>
          <button onClick={() => nav.newTest()}>Create a test</button>
        </div>
      )}
    </>
  );
}
