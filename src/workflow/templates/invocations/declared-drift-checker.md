---
agent: declared-drift-checker
generated: false
---

**declared-drift-checker** [sonnet] · Reconciles observed I/O vs the declared YAML; emits non-decidable drift as questions.
{{ inputs_outputs_compact }}

**Task**: Pass the pre-scan's decidable_drift through unchanged, then judge only the
residue: where an agent's prose works on an artifact it never declares, or declares an
output its prose never produces. Exclude anything `awok validate` owns. Phrase every
non-decidable finding as a question that names the decision it unblocks.
