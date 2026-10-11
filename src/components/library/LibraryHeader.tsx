import type { ReactNode } from 'react';

type LibraryNavigation = {
  active: 'decks' | 'tests' | 'learn' | 'plans';
  decks: () => void;
  tests?: () => void;
  learn?: () => void;
  plans?: () => void;
};

export function LibraryTabs({ active, decks, tests, learn, plans }: LibraryNavigation) {
  const tabs = [
    { id: 'decks', label: 'Decks', open: decks },
    ...(tests ? [{ id: 'tests', label: 'Tests', open: tests }] : []),
    ...(learn ? [{ id: 'learn', label: 'Learn', open: learn }] : []),
    ...(plans ? [{ id: 'plans', label: 'Plans', open: plans }] : []),
  ];
  return (
    <div className="qard-tabs" role="tablist" aria-label="Study workspace">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={tab.open}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (i + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (i - 1 + tabs.length) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : undefined;
            if (next === undefined) {
              return;
            }
            event.preventDefault();
            const scope =
              event.currentTarget.closest('.qard-app') ?? event.currentTarget.parentElement;
            tabs[next]!.open();
            // Each workspace screen mounts a new header; restore focus after navigation.
            window.setTimeout(
              () =>
                scope
                  ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
                  ?.focus(),
              0,
            );
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function LibraryHeader({
  title,
  description,
  children,
  ...navigation
}: LibraryNavigation & { title: string; description?: string; children: ReactNode }) {
  return (
    <header className="qard-library-header">
      <LibraryTabs {...navigation} />
      <div className="qard-heading qard-library-heading">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        <div className="qard-actions">{children}</div>
      </div>
    </header>
  );
}
