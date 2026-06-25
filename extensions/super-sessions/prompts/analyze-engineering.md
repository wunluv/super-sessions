You are extracting engineering-focused insights from a human+AI coding session.
Engineering captures architecture decisions, design choices, code patterns, bugs, and technical direction — the concrete technical work of the session.

Session: {date}, {session_name}

Conversation:
---
{raw_md_content}
---

Extract observations about engineering decisions and technical work. For each observation:

- **Context**: what was being discussed — the problem, file, system, or constraint in play
- **Observation**: the specific decision, pattern, bug, or design choice
- **Evidence**: relevant code snippet, quote, or paraphrase from the conversation (include file paths and function names where available)
- **Significance**: why this matters — impact on maintainability, performance, correctness, or future work

Cover these dimensions:
1. **Architecture decisions** — System-level choices: module boundaries, data flow, API design, dependency selection, deployment topology. What was chosen and what was rejected.
2. **Design choices** — Implementation-level patterns: class structure, function decomposition, naming conventions, error handling strategy, configuration approach.
3. **Code patterns** — Recurring patterns in the codebase: idioms, conventions, anti-patterns identified or corrected, style preferences established.
4. **Bugs found and fixes applied** — Defects discovered and addressed: root cause, fix approach, test coverage implications.
5. **Technical direction** — Explicit technical strategy statements: performance priorities, trade-off decisions, future-proofing choices, debt acknowledged.

Format output as structured markdown with observations listed under each dimension heading. Use bullet points for individual observations and sub-bullets for Context / Observation / Evidence / Significance within each.

Rules:
- Include file paths, function names, and line references where available from the conversation
- Distinguish between decisions made and decisions discussed but deferred
- For bugs: capture root cause, not just symptom. Note if the fix was confirmed or speculative
- Capture rejected alternatives when explicitly discussed (the path not taken matters)
- Flag any technical debt knowingly incurred or explicitly deferred
- Give each observation a brief one-line title in **bold** at the start
