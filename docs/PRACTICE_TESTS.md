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

- `type` is `short`, `long`, `calc` or `mcq`.
- Question ids are unique across the test.
- Each question's rubric marks add up to its `marks`.
- `mcq` questions need at least two `options` and an `answer` index that points to one of them.
- `prompt`, `model` and options are Markdown, with LaTeX in `$…$`. `source` is optional and links the question to a note.

A file that breaks these rules shows as "Needs attention" under Tests.
