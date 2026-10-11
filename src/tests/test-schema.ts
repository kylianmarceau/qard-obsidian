import type { PracticeTest, QuestionMark, TestPlan, Wrapup } from './test-types';

/** The JSON Schema subset shared by structured outputs and the local validator. */
export type Schema =
  | { type: 'string'; enum?: string[]; description?: string }
  | { type: 'number' | 'integer' | 'boolean'; description?: string }
  | { type: 'array'; items: Schema; description?: string }
  | {
      type: 'object';
      properties: Record<string, Schema>;
      required: string[];
      additionalProperties: false;
      description?: string;
    };
const str = (description?: string): Schema => ({ type: 'string', description });
const num = (description?: string): Schema => ({ type: 'number', description });
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});
const arr = (items: Schema): Schema => ({ type: 'array', items });
const oneOf = (values: string[]): Schema => ({ type: 'string', enum: values });

export function validate(schema: Schema, value: unknown, path = 'result'): string[] {
  switch (schema.type) {
    case 'string':
      return typeof value !== 'string'
        ? [`${path} must be a string`]
        : schema.enum && !schema.enum.includes(value)
          ? [`${path} must be one of ${schema.enum.join(', ')}`]
          : [];
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? []
        : [`${path} must be a number`];
    case 'integer':
      return Number.isInteger(value) ? [] : [`${path} must be an integer`];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path} must be true or false`];
    case 'array':
      return Array.isArray(value)
        ? value.flatMap((item, i) => validate(schema.items, item, `${path}[${i}]`))
        : [`${path} must be an array`];
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [`${path} must be an object`];
      }
      const record = value as Record<string, unknown>;
      return [
        ...schema.required
          .filter((k) => record[k] === undefined)
          .map((k) => `${path}.${k} is missing`),
        ...Object.entries(schema.properties)
          .filter(([k]) => record[k] !== undefined)
          .flatMap(([k, s]) => validate(s, record[k], `${path}.${k}`)),
      ];
    }
  }
}

export const planSchema = obj({
  title: str('At most eight words.'),
  goal: str('Two to four sentences restating the request precisely.'),
  sources: arr(
    obj({
      path: str('Vault-relative path of a Markdown note.'),
      reason: str('A few words: why this note is included.'),
    }),
  ),
  sections: arr(
    obj({
      title: str(),
      focus: str('One sentence.'),
      questions: str('The question mix, e.g. "2 short answer, 1 multiple choice".'),
      marks: num(),
    }),
  ),
  questionCount: num(),
  totalMarks: num(),
  minutes: num(),
});
const question = obj(
  {
    id: str('Unique across the test: q1, q2, …'),
    type: oneOf(['short', 'long', 'mcq', 'calc']),
    prompt: str('Markdown; LaTeX in $…$.'),
    marks: num(),
    options: arr(str()),
    answer: num('Index of the correct option (multiple choice only).'),
    rubric: arr(obj({ point: str('One checkable idea.'), marks: num() })),
    model: str('A full-marks answer in Markdown.'),
    source: obj({ path: str(), heading: str() }, ['heading']),
    objective: str('Mastery objective id from the list given, if any.'),
    goal: oneOf(['recognise', 'recall', 'explain', 'apply']),
  },
  ['options', 'answer', 'source', 'objective', 'goal'],
);
export const testSchema = obj({
  title: str(),
  sections: arr(obj({ id: str('s1, s2, …'), title: str(), questions: arr(question) })),
});
const annotation = obj({
  quote: str('Exact text copied from the answer.'),
  kind: oneOf(['correct', 'wrong', 'vague', 'missing', 'insight']),
  note: str('One or two sentences, second person.'),
});
const mark = obj({
  score: num(),
  awarded: arr({ type: 'boolean' }),
  annotations: arr(annotation),
  mistake: oneOf(['misconception', 'careless', 'imprecise', 'incomplete', 'none']),
  feedback: str('One sentence.'),
});
export const marksSchema = obj({
  questions: arr(
    obj({ id: str(), ...(mark as { properties: Record<string, Schema> }).properties }),
  ),
});
export const wrapupSchema = obj({
  fixes: arr(
    obj({
      questionId: str(),
      title: str('At most eight words.'),
      body: str('One or two sentences.'),
    }),
  ),
  cards: arr(obj({ questionId: str(), front: str(), back: str() })),
  profile: str('The full updated study profile in Markdown.'),
});
export const retrySchema = obj({
  feedback: str('One or two sentences.'),
  score: num('Marks the original and second attempt earn together.'),
});
export const askSchema = obj({ answer: str('Markdown, at most 150 words.') });
export const disputeSchema = obj({
  ...(mark as { properties: Record<string, Schema> }).properties,
  reply: str('Two sentences at most, addressed to the student.'),
});

export function check<T>(schema: Schema, value: unknown, extra: (v: T) => string[] = () => []): T {
  const errors = validate(schema, value);
  if (!errors.length) {
    errors.push(...extra(value as T));
  }
  if (errors.length) {
    throw new SchemaError(errors);
  }
  return value as T;
}
export class SchemaError extends Error {
  constructor(public errors: string[]) {
    super(`The agent's reply did not match the expected format: ${errors.slice(0, 5).join('; ')}`);
  }
}
export const readPlan = (v: unknown) =>
  check<TestPlan>(planSchema, v, (p) => (p.sections.length ? [] : ['result.sections is empty']));
export function readTest(v: unknown): Omit<PracticeTest, 'version' | 'createdAt'> {
  return check<Omit<PracticeTest, 'version' | 'createdAt'>>(testSchema, v, (t) => {
    const errors: string[] = [],
      ids = new Set<string>();
    if (!t.sections.length) {
      errors.push('result.sections is empty');
    }
    for (const s of t.sections) {
      for (const q of s.questions) {
        if (ids.has(q.id)) {
          errors.push(`question id ${q.id} is used twice`);
        }
        ids.add(q.id);
        if (!q.rubric.length) {
          errors.push(`${q.id} has no rubric`);
        }
        if (Math.abs(q.rubric.reduce((n, r) => n + r.marks, 0) - q.marks) > 1e-6) {
          errors.push(`${q.id}: rubric marks must add up to ${q.marks}`);
        }
        if (
          q.type === 'mcq' &&
          (!q.options || q.options.length < 2 || q.answer === undefined || !q.options[q.answer])
        ) {
          errors.push(`${q.id}: multiple choice needs options and a valid answer index`);
        }
      }
    }
    return errors;
  });
}
export function readMarks(
  v: unknown,
  expected: { id: string; rubric: number }[],
): Record<string, QuestionMark> {
  const result = check<{ questions: (QuestionMark & { id: string })[] }>(marksSchema, v, (m) =>
    expected.flatMap((e) => {
      const found = m.questions.find((q) => q.id === e.id);
      return !found
        ? [`no mark for ${e.id}`]
        : found.awarded.length !== e.rubric
          ? [`${e.id}: awarded needs ${e.rubric} entries`]
          : [];
    }),
  );
  return Object.fromEntries(
    result.questions
      .filter((q) => expected.some((e) => e.id === q.id))
      .map(({ id, ...m }) => [id, m]),
  );
}
export const readWrapup = (v: unknown) => check<Wrapup & { profile: string }>(wrapupSchema, v);
export const readRetry = (v: unknown) => check<{ feedback: string; score: number }>(retrySchema, v);
export const readAsk = (v: unknown) => check<{ answer: string }>(askSchema, v);
export const readDispute = (v: unknown, rubric: number) =>
  check<QuestionMark & { reply: string }>(disputeSchema, v, (d) =>
    d.awarded.length === rubric ? [] : [`awarded needs ${rubric} entries`],
  );
export { question as questionSchema, mark as markSchema, obj, arr, str, num, oneOf };
