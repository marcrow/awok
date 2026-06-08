---
agent: seam-continuity-tracer
generated: false
---

**seam-continuity-tracer** [opus] · Checks each producer→consumer seam holds semantically; scores criticality, gated by the pre-scan.
{{ inputs_outputs_compact }}

**Task**: Walk every DAG seam; state what the producer promises vs what the consumer
assumes, and flag capacity mismatches. A semantic mismatch may only be raised as a
QUESTION — it escalates to CRITICAL only on a seam the pre-scan's `seam_mismatch`
already flagged. Name the weakest link that governs the verdict and any single point of
failure.
