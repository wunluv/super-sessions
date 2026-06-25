You are tagging a developer session transcript for a project knowledge base.

Project context:
{project_context}

Session transcript:
---
{session_body}
---

Analyze the session and return ONLY valid YAML frontmatter (no code fences, no extra text):

```yaml
---
project_relevant: true   # true if this session is about the project, false if entirely unrelated
topics:
  - topic1               # 2-5 topics (e.g. architecture, debugging, refactoring, authentication)
  - topic2
summary: "One-sentence description of what happened in this session."
noise_stripped: false    # set to true only if noise stripping is requested separately
---
```

Rules:
- `project_relevant` must be `true` or `false` (no quotes)
- `topics` must be an array of 2-5 lowercase strings
- `summary` must be a single sentence, 10-20 words
- `noise_stripped` must be `false`
- Return ONLY the YAML frontmatter block, nothing else
