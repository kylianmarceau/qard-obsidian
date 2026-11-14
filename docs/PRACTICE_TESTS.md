# Practice test files

Qard lists every folder under the tests folder (default `Qard/Tests/`) that contains a `test.json`. You can write one with any agent, such as Claude Code or Codex in your vault, and take it in Qard. Qard creates `attempt.json` when you start answering.

```text
Qard/Tests/2026-09-29 HMM inference/
  request.json   what you asked for (written by Qard)
  plan.json      the approved plan (optional)
  test.json      the questions and mark scheme
  attempt.json   your answers, marks, notes and follow-ups (written by Qard)
Qard/Tests/_profile.md   study profile, updated after each marked test
```

## test.json

```json
{
  "title": "HMM inference",
  "sections": [
    {
      "id": "s1",
      "title": "Inference",
      "questions": [
        {
          "id": "q1",
          "type": "long",
          "prompt": "Explain how Viterbi differs from the forward algorithm.",
          "marks": 2,
          "rubric": [
            { "point": "Both are dynamic programming over the trellis", "marks": 1 },
            { "point": "Viterbi takes the max where forward sums", "marks": 1 }
          ],
          "model": "Both fill the trellis left to right. Forward sums over predecessors; Viterbi takes the max and stores backpointers.",
          "source": { "path": "Notes/HMM.md", "heading": "Viterbi" }
        },
        {
          "id": "q2",
          "type": "mcq",
          "prompt": "Which algorithm returns the most likely state sequence?",
          "marks": 1,
          "options": ["Forward", "Viterbi", "Baum–Welch"],
          "answer": 1,
          "rubric": [{ "point": "Selects Viterbi", "marks": 1 }],
          "model": "Viterbi."
        }
      ]
    }
  ]
}
```

Rules Qard checks when it opens the file:

- `type` is `short`, `long`, `calc`, `mcq` or `cloze`.
- Question ids are unique across the test.
- Each question's rubric marks add up to its `marks`.
- `mcq` questions need at least two `options` and an `answer` index that points to one of them.
- `cloze` questions put each `{{id}}` slot exactly once in plain question text, with a matching `blanks` entry containing that `id`. Each blank has one rubric point worth one mark, in the same order as `blanks`. The total marks equal the number of blanks. The marker grades each submitted blank against its rubric point, accepting equivalent wording rather than comparing against a predefined answer list.
- `prompt`, `model` and options are Markdown, with LaTeX in `$…$`. `source` is optional and links the question to a note.

A file that breaks these rules shows as "Needs attention" under Tests.

For example, a terminology question can use this format:

```json
{
  "id": "q3",
  "type": "cloze",
  "prompt": "The observed outcome compared with a prediction is its {{target}}.",
  "blanks": [{ "id": "target" }],
  "marks": 1,
  "rubric": [{ "point": "Identifies the observed target or label.", "marks": 1 }],
  "model": "The observed outcome compared with a prediction is its target."
}
```

Qard stores typed gaps in `answers[q3].blanks`, keyed by the slot ID. Each gap is graded independently; one wrong gap does not erase correct gaps. The LLM marks blanks through the same validated grading path as written answers; marks are recalculated from awarded rubric points. Missing blanks earn no mark. You can dispute a mark, but cloze questions do not offer a free-text second attempt.
