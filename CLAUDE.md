# CLAUDE.md

## Model routing (token policy)

Standing rule for every session: use the cheapest model that can do the job well.

- **Haiku** (fast, cheapest): simple, well-defined tasks. Examples: reading a file to answer a question, running a single command, simple text edits, listing files, quick lookups, formatting.
- **Sonnet** (default): most work. Examples: writing and editing code, fixing normal bugs, implementing features, explaining, reviewing code. Start here.
- **Opus** (most expensive): only for complex work. Examples: hard bugs Sonnet could not solve, architecture decisions, security review, multi-file refactors where correctness is critical, anything Sonnet tried and failed. Never use it for routine work.

How to route:
- Start with Sonnet. Before each task, ask "Can Haiku do this?" If yes, delegate it to a Haiku subagent (Task tool, model=haiku). If the task is genuinely complex, or Sonnet already failed, escalate to Opus (Task tool, model=opus).
- When delegating, say what Haiku will do, what Sonnet will do, and what would need Opus.
- Never use Opus where Haiku or Sonnet can do the task. Never use Sonnet where Haiku can.
- Keep replies short. Do not repeat the request. No extra explanation unless asked.
