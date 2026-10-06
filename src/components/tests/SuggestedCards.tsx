import { useState } from 'react';
import type { QardServices } from '../../views/services';
import { questions, sectionOf } from '../../tests/test-types';
import { Markdown } from '../Markdown';
import { Waiting } from '../common/FeedbackStatus';
import { cardTarget } from './card-target';
import { useTestFolder } from './useTestFolder';
import { type TestNav } from '../../views/navigation';

export function SuggestedCards({
  services,
  folder,
}: {
  services: QardServices;
  nav: TestNav;
  folder: string;
}) {
  const { entry } = useTestFolder(services, folder);
  const [busy, setBusy] = useState<number>(),
    [error, setError] = useState('');
  const test = entry?.test,
    attempt = entry?.attempt,
    cards = attempt?.wrapup?.cards ?? [];
  if (!test || !attempt) {
    return <Waiting text="Loading…" />;
  }
  const target = (i: number) => {
    const q = questions(test).find((x) => x.id === cards[i]!.questionId)!;
    return { q, ...cardTarget(services, q, test.title, sectionOf(test, q.id)!.title, test) };
  };
  async function add(i: number) {
    setBusy(i);
    setError('');
    try {
      const t = target(i);
      await services.writer.create({
        deck: t.deck,
        topic: t.topic,
        sourceFile: t.sourceFile,
        generatedFrom: t.generatedFrom,
        sourceSnapshots: t.sourceSnapshots,
        front: cards[i]!.front,
        back: cards[i]!.back,
        folder: services.reviews.getSnapshot().settings.cardFolder,
      });
      await services.tests.cardState(folder, { suggestion: i }, 'added');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }
  const pending = cards.map((_, i) => i).filter((i) => !attempt.cards?.[i]);
  const settings = services.reviews.getSnapshot().settings.tests;
  return (
    <div className="qard-results">
      <div className="qard-heading">
        <div>
          <h1>Suggested cards</h1>
          <p>From the marks you lost. Each card goes into the deck its question came from.</p>
        </div>
        <button
          className="qard-primary"
          disabled={busy !== undefined || !pending.length}
          onClick={() =>
            void (async () => {
              for (const i of pending) {
                await add(i);
              }
            })()
          }
        >
          {pending.length
            ? pending.length === cards.length
              ? 'Add all'
              : `Add ${pending.length}`
            : 'Done'}
        </button>
      </div>
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
      {cards.map((c, i) => {
        const t = target(i),
          state = attempt.cards?.[i];
        return (
          <article
            key={i}
            className={'qard-suggestion' + (state === 'skipped' ? ' is-skipped' : '')}
          >
            <div className="qard-suggestion-body">
              <strong>
                <Markdown text={c.front} path={t.q.source?.path || folder} services={services} />
              </strong>
              <Markdown text={c.back} path={t.q.source?.path || folder} services={services} />
              <small className="qard-muted">
                Q{questions(test).indexOf(t.q) + 1} · {t.deck} › {t.topic}
              </small>
            </div>
            <div className="qard-suggestion-actions">
              {!state ? (
                <>
                  <button
                    className="qard-text-button"
                    onClick={() =>
                      void services.tests.cardState(folder, { suggestion: i }, 'skipped')
                    }
                  >
                    Skip
                  </button>
                  <button disabled={busy !== undefined} onClick={() => void add(i)}>
                    {busy === i ? 'Adding…' : 'Add'}
                  </button>
                </>
              ) : state === 'added' ? (
                <span className="is-full">✓ Added</span>
              ) : (
                <button
                  className="qard-text-button"
                  onClick={() =>
                    void services.tests.cardState(folder, { suggestion: i }, undefined)
                  }
                >
                  Undo
                </button>
              )}
            </div>
          </article>
        );
      })}
      {settings.useProfile && (
        <p className="qard-muted qard-profile-line">
          {'Your study profile was updated, and the next test will use it. '}
          <button
            className="qard-link"
            onClick={() =>
              void services.app.workspace.openLinkText(`${settings.folder}/_profile.md`, '', true)
            }
          >
            Open profile
          </button>
        </p>
      )}
    </div>
  );
}
