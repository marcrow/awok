---
agent: nature-critic
generated: false
---

**nature-critic** [sonnet] · Recommends each block's optimal awok nature (script / agent / main_agent / workflow_call).
{{ inputs_outputs_compact }}

**Task**: For each block in the draft DAG (skipping ones the reuse-report flags as
borrowable), recommend its optimal awok action nature, hunting especially for
LLM-where-a-script-suffices, script-where-judgment-is-needed, and the persistence
anti-pattern — an agent that appends/merges a growing `.jsonl`/`.md` journal or
registry. Split it: the agent writes a fresh per-run file/payload, a `script` does the
idempotent append. Advisory only.
