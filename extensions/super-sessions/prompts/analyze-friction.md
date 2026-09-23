You are extracting friction observations from a human+AI coding session.
Friction is where the collaboration cost more than it should have: turns spent rediscovering what was already available, instructions restated, context missing, tools misapplied.

Session: {date}, {session_name}

Conversation:
---
{raw_md_content}
---

Extract observations about friction. For each observation:

- **Context**: what was being worked on
- **Observation**: the friction class and the moment it happened
- **Evidence**: the exact quote, preferably the human's correction
- **Cost**: turns or exchanges plausibly lost (estimate; "1 turn" is a valid answer)
- **Significance**: what would have prevented it

Friction classes:

- **F1 supplied-context ignored** — a path, link, id, value or reference the human supplied, then searched for, re-requested, or used wrongly.
- **F2 procedure rebuilt** — a multi-step task reconstructed from scratch when a precedent, script or documented procedure already existed in the project.
- **F3 fact re-derived** — the same question, query, schema lookup or project fact as an earlier session, or something already written in memory.
- **F4 rule not honoured** — a rule that exists in the project's instructions and was broken, or that the agent sought permission for anyway.
- **F5 output-shape drift** — the human restated a format, length, tone, language or level of detail.
- **F6 friction by question** — the agent asked what it could have read, asked twice, or asked a question the human had already answered.
- **F7 tool misfit** — repeated manual workaround for something no available tool does.
- **F8 human-side friction** — the human repeated himself, corrected the same misread twice, did the work himself, or abandoned a thread.

Rules:

- Quote the evidence. No observation without a quoted line from the transcript.
- The human's corrections and repeats are the strongest evidence. Quote them verbatim, and state what they reveal about the context that was missing.
- Tool calls are not visible in this transcript. Do not infer them. Judge from how the conversation moves and how many exchanges an outcome took.
- Report a class only where the transcript shows it. Never invent friction to fill a quota.
- If the session ran clean, output exactly `No friction observed.` and nothing else.
- One observation per moment. Do not merge two corrections into one.
- Distinguish agent-side friction (F1-F7) from human-side friction (F8).

Format output as structured markdown. One heading per class that has observations, then a bullet per observation with sub-bullets for Context / Observation / Evidence / Cost / Significance. Give each observation a one-line bold title first.
