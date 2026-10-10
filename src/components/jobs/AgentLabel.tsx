import { useSyncExternalStore } from 'react';
import type { QardServices } from '../../views/services';
import type { AgentProvider, AgentRole } from '../../agents/runner';
import { defaultModel } from '../../agents/create-runner';

const noSubscription = () => () => {};
const ROLES: Record<AgentRole, string> = {
  tutor: 'Tutor',
  writer: 'Writer',
  marker: 'Marker',
  illustrator: 'Illustrator',
};
const CONNECTIONS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  anthropic: 'Anthropic API',
  openrouter: 'OpenRouter',
};

/** A quiet "Tutor · Claude Code · haiku" tag showing who is working on something. Hidden when turned off in settings. */
export function AgentLabel({ services, role }: { services: QardServices; role: AgentRole }) {
  // Subscribe to a plain string of just the fields shown, so an unchanged value never causes a re-render loop.
  const key = useSyncExternalStore(services.reviews.subscribe ?? noSubscription, () => {
    const s = services.reviews.getSnapshot().settings;
    return s?.showAgent && s.agents
      ? `${s.agents.roles[role].provider}\u0000${s.agents.roles[role].model}`
      : '';
  });
  if (!key) {
    return null;
  }
  const [provider = '', model = ''] = key.split('\u0000');
  const name = model.trim() || defaultModel(provider as AgentProvider, role) || 'default model';
  return (
    <span
      className="qard-agent"
      title={`${ROLES[role]}: ${CONNECTIONS[provider] ?? provider}, ${name}`}
    >
      {ROLES[role]} · {CONNECTIONS[provider] ?? provider} · {name}
    </span>
  );
}
