import type { Schema } from '../tests/test-schema';
import type { Usage } from './usage';

export type AgentProvider = 'claude-code' | 'codex' | 'anthropic' | 'openrouter';
/** Tutor replies live and should be fast; the writer and marker favour quality. */
export type AgentRole = 'tutor' | 'writer' | 'marker';
/**
 * vault: false when the prompt already holds everything needed, so API runners skip the note tools.
 * effort: how hard to think, where the provider supports it.
 * onUsage: the run's token usage, summed over its turns, when reported by the provider.
 */
export interface AgentTask {
  prompt: string;
  schema: Schema;
  signal?: AbortSignal;
  vault?: boolean;
  effort?: 'low' | 'medium' | 'high';
  onUsage?: (usage: Usage) => void;
}
/** Runs one task and returns the parsed JSON reply. Validation happens in the caller. */
export interface AgentRunner {
  readonly name: string;
  run(task: AgentTask): Promise<unknown>;
}

export const SCHEMA_INSTRUCTION = (schema: Schema) =>
  `Reply with only one JSON object matching this JSON Schema. No prose and no code fences.\n<schema>\n${JSON.stringify(schema)}\n</schema>`;

/** Agents sometimes wrap JSON in prose or fences; take the outermost object. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{'),
    end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error(
    'The agent did not return JSON. Try again, or check the agent in Settings → Qard.',
  );
}

/** One retry with the validation error, which fixes most format slips. */
export async function runValidated<T>(
  runner: AgentRunner,
  task: AgentTask,
  read: (value: unknown) => T,
): Promise<T> {
  const first = await runner.run(task);
  try {
    return read(first);
  } catch (error) {
    if (task.signal?.aborted) {
      throw new Error(CANCELLED);
    }
    const again = await runner.run({
      ...task,
      prompt: `${task.prompt}\n\nYour previous reply was rejected: ${(error as Error).message}\nPrevious reply:\n${JSON.stringify(first).slice(0, 20000)}\nReturn a corrected reply.`,
    });
    return read(again);
  }
}

export const CANCELLED = 'Cancelled.';
/** Ignore replies from providers that finish after the caller cancels the job. */
export function guardRunner(runner: AgentRunner, signal: AbortSignal): AgentRunner {
  return {
    name: runner.name,
    run: async (task) => {
      if (signal.aborted) {
        throw new Error(CANCELLED);
      }
      const result = await runner.run(task);
      if (signal.aborted) {
        throw new Error(CANCELLED);
      }
      return result;
    },
  };
}

/** One API request (one turn of a tool loop). Replies usually take seconds; a stalled connection otherwise waits forever. */
export const REQUEST_TIMEOUT = 5 * 60_000;
/** Settles when work does, or rejects on timeout or cancel. Obsidian's requestUrl can't be aborted, so this stops waiting for it. */
export function deadline<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  ms = REQUEST_TIMEOUT,
  what = 'The provider',
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error(CANCELLED));
  }
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      done();
      reject(new Error(CANCELLED));
    };
    const timer = window.setTimeout(() => {
      done();
      reject(
        new Error(
          `${what} didn't reply within ${Math.round(ms / 60_000)} minutes, so Qard stopped waiting.`,
        ),
      );
    }, ms);
    signal?.addEventListener('abort', abort);
    work.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
