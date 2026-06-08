---
agent: agent-quality-auditor
generated: false
---

**agent-quality-auditor** [sonnet] · Scores each target agent against the embedded best-practices rubric — hard violations only.
{{ inputs_outputs_compact }}

**Task**: Judge each agent against the rubric in the agent body — emit only HARD
violations (missing required tool, pinned model, description↔body contradiction, no
output contract), cap style notes at a shared top-3 (non-blocking), and never penalize
terseness. Add inter-agent coherence findings. Warn if the engine schema_version exceeds
the rubric's.
