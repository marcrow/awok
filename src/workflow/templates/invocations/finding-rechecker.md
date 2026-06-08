---
agent: finding-rechecker
generated: false
---

**finding-rechecker** [opus] · Re-examines only the blocking findings with a fresh lens; clears or confirms each before the verdict.
{{ inputs_outputs_compact }}

**Task**: Re-derive each blocking finding from the target's own text as if seeing it
fresh, and try to refute it. Mark each CONFIRMED / CLEARED / DOWNGRADED, defaulting to
CLEARED when refutation even partly succeeds. Write the final verdict (HEALTHY /
NEEDS-FIX / BLOCKED) governed by the surviving weakest link, then the questions and
capped style notes.
