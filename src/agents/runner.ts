import type { Schema } from '../tests/test-schema';

export type AgentProvider = 'claude-code' | 'codex' | 'anthropic' | 'openrouter';
/** Tutor replies live and should be fast; the writer and marker favour quality. */
export type AgentRole = 'tutor' | 'writer' | 'marker';
/**
 * vault: false when the prompt already holds everything needed, so API runners skip the note tools.
 * effort: how hard to think, where the provider supports it.
 */
export interface AgentTask { prompt: string; schema: Schema; signal?: AbortSignal; vault?: boolean; effort?: 'low' | 'medium' | 'high' }
/** Runs one task and returns the parsed JSON reply. Validation happens in the caller. */
export interface AgentRunner { readonly name: string; run(task: AgentTask): Promise<unknown> }

export const SCHEMA_INSTRUCTION = (schema: Schema) =>
  `Reply with only one JSON object matching this JSON Schema. No prose and no code fences.\n<schema>\n${JSON.stringify(schema)}\n</schema>`;

/** Agents sometimes wrap JSON in prose or fences; take the outermost object. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) { try { return JSON.parse(fenced[1]!); } catch { /* fall through */ } }
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ } }
  throw new Error('The agent did not return JSON. Try again, or check the agent in Settings → Qard.');
}

/** One retry with the validation error, which fixes most format slips. */
export async function runValidated<T>(runner: AgentRunner, task: AgentTask, read: (value: unknown) => T): Promise<T> {
  const first = await runner.run(task);
  try { return read(first); }
  catch (error) {
    const again = await runner.run({ ...task, prompt: `${task.prompt}\n\nYour previous reply was rejected: ${(error as Error).message}\nPrevious reply:\n${JSON.stringify(first).slice(0, 20000)}\nReturn a corrected reply.` });
    return read(again);
  }
}
