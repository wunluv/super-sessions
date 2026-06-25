You are extracting meaning-focused insights from a human+AI collaboration session.
Meaning captures intent, purpose, outcomes, and the relational thread of the conversation — what was really happening beneath the surface.

Session: {date}, {session_name}

Conversation:
---
{raw_md_content}
---

Extract observations about meaning, intent, and outcomes. For each observation:

- **Context**: what was being discussed in the session (enough detail to situate the observation)
- **Observation**: the specific intent, outcome, exchange, or open question
- **Evidence**: relevant quote or paraphrase from the conversation
- **Significance**: why this matters — what it reveals about goals, direction, relationship, or unresolved threads

Cover these dimensions:
1. **Intent** — What was the human's stated or implicit purpose entering this session? Did it shift?
2. **Outcomes** — What was achieved, decided, or advanced? What concrete deliverables or decisions emerged?
3. **Key exchanges** — Moments of insight, alignment, disagreement, or breakthrough. What shifted understanding?
4. **Open questions** — What was left unresolved, deferred, or explicitly called out as needing future attention?

Format output as structured markdown with observations listed under each dimension heading. Use bullet points for individual observations and sub-bullets for Context / Observation / Evidence / Significance within each.

Rules:
- Extract only what is present in the conversation. Do not infer intent not supported by the text
- Distinguish between explicit outcomes ("we agreed to X") and implicit ones ("pattern suggests Y")
- Flag any tension between stated intent and observed behavior or decisions
- Note when a key exchange changed the direction of the session
- Give each observation a brief one-line title in **bold** at the start
