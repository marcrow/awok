---
agent: prose-io-reader
generated: false
---

**prose-io-reader** [sonnet] · Extracts each target agent's observed I/O from its prose, blind to the declared YAML.
{{ inputs_outputs_compact }}

**Task**: For each agent in the workflow named in `work/workflow-doctor/target.txt`, read ONLY
its body prose and its hand-written Task sentence (never the YAML, never the templated
I/O block) and record what it actually reads/writes, with short evidence quotes and an
`uncertain` list where the prose is vague. Observations, never verdicts.
