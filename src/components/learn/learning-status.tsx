import type { QardServices } from '../../views/services';
import type { MasteryState } from '../../learn/mastery';

/** Shown while waiting on a CLI tutor, which takes much longer per reply than an API. */
export function TutorHint({ services }: { services: QardServices }) {
  const provider = services.reviews.getSnapshot().settings.agents.roles.tutor.provider;
  if (provider !== 'claude-code' && provider !== 'codex') {
    return null;
  }
  return (
    <p className="qard-muted qard-small">
      {provider === 'codex' ? 'Codex' : 'Claude Code'} can take 30 seconds or more per reply. For a
      faster tutor, choose an API connection in Settings → Qard → AI roles.
    </p>
  );
}

export const STATE_LABEL: Record<MasteryState, string> = {
  planned: 'Not covered yet',
  new: 'New',
  gap: 'Gap',
  misconception: 'Misconception',
  taught: 'Taught',
  shaky: 'Shaky',
  'right once': 'Right once',
  mastered: 'Mastered',
  slipping: 'Slipping',
};

export function StateChip({ state }: { state: MasteryState }) {
  return (
    <span className={`qard-state qard-state-${state.replace(' ', '-')}`}>{STATE_LABEL[state]}</span>
  );
}

export function relativeDay(day: string, today: string) {
  if (day <= today) {
    return day === today ? 'today' : 'overdue';
  }
  const [y, m, d] = day.split('-').map(Number),
    [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((Date.UTC(y!, m! - 1, d) - Date.UTC(ty!, tm! - 1, td)) / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
