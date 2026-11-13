# CLAUDE.md

## Model routing (token policy)

Standing rule for every session: use the cheapest model that can do the job well. This replaces any earlier model-routing policy.

- **Haiku** (fast, cheapest): simple, well-defined tasks. Examples: reading a file to answer a question, running a single command, simple text edits, listing files, quick lookups, formatting. If the task is clear and small, use Haiku.
- **Sonnet 5.5** (medium, default): most work. Examples: writing and editing code, fixing normal bugs, implementing features, explaining things, reviewing code. Start here.
- **Opus 5.5** (powerful, expensive): complex work. Examples: hard bugs Sonnet 5.5 could not solve, architecture decisions, security review, multi-file refactors where correctness is critical, anything Sonnet 5.5 tried and failed. Use only when Sonnet 5.5 is not enough.
- **Fable 5.2** (most capable for technical work, most expensive): ONLY for the hardest technical work: the most difficult bugs, large refactors, and architecture where Opus 5.5 is not enough. Free for Pro users until November 16, 2026 (up to 50% of weekly limits); after that it bills to usage credits. Use it while free, but never on routine work.

How to route:
- Start with Sonnet 5.5. Before each task, ask "Can Haiku do this?" If yes, delegate it to a Haiku subagent. If the task is genuinely complex or Sonnet 5.5 already failed, escalate to Opus 5.5. If Opus 5.5 is not enough for a very hard technical task, escalate to Fable 5.2.
- When delegating, be explicit: what the Haiku subagent does, what Sonnet 5.5 does, and what would need Opus 5.5 or Fable 5.2. Example: "Haiku will read these 3 files and summarize them; I will implement the fix; Opus 5.5 will review it only if the fix is risky; Fable 5.2 only for the hardest part."
- Never use a stronger model for a task a cheaper one can do: not Sonnet 5.5 where Haiku can, not Opus 5.5 where Sonnet 5.5 can, not Fable 5.2 where Opus 5.5 can.
- Keep all replies short. Do not repeat the user's request back. No extra explanation unless asked.

## Library docs (Context7)

Before using a library API (React, Tailwind, Supabase, Vite, Motion, etc.), fetch its current docs with the Context7 MCP tools (`resolve-library-id`, then the docs tool). Do not guess an API from memory.

## Complex problems (Sequential Thinking)

For complex, multi-step problems (debugging freezes, reconciling git branches, multi-step fixes), use the Sequential Thinking MCP tool: break the problem into steps, revise as you go, and do not jump to a fix before the reasoning is done.
