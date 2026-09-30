import { expect, it } from 'vitest';
import { JobClock, timeLeft } from '../src/jobs/job-clock';
import { DEFAULT_AGENT_SETTINGS } from '../src/settings/settings';

it('learns typical job durations per connection and model, and says how long is left', async () => {
  const timings: Record<string, number[]> = {};
  let roles = DEFAULT_AGENT_SETTINGS.roles;
  const clock = new JobClock(() => timings, async (key, ms) => { timings[key] = [...(timings[key] ?? []), ms]; }, () => roles);
  expect(clock.estimate('generate')).toBeUndefined();
  for (const ms of [60_000, 90_000, 300_000]) clock.record('generate', ms);
  clock.record('generate', 100); // instant failures and cache hits are ignored
  expect(clock.estimate('generate')).toBe(90_000);
  expect(Object.keys(timings)).toEqual(['generate|claude-code|']);
  // A different writer model starts from scratch.
  roles = { ...roles, writer: { provider: 'anthropic', model: 'claude-opus-5-5' } };
  expect(clock.estimate('generate')).toBeUndefined();
  expect(timeLeft(90_000, 0, 20_000)).toBe('about 1 min left');
  expect(timeLeft(90_000, 0, 55_000)).toBe('about 40 s left');
  expect(timeLeft(90_000, 0, 85_000)).toBe('almost ready');
  expect(timeLeft(undefined, 0)).toBeUndefined();
});
