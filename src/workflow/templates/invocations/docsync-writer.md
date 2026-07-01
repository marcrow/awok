---
agent: docsync-writer
generated: false
---

**docsync-writer** [sonnet] · Syncs the human-maintained docs the change actually touched, proportionally.
{{ inputs_outputs_compact }}

**Task**: After the modified workflow is regenerated, find the HUMAN docs that drifted
(CLAUDE.md's workflow table, docs/dev/bb-workflow.md, relevant specs/plans, a changelog) and
update exactly what the change made stale — exhaustive but never over-documented. Edit
surgically (`Edit`, never a wholesale rewrite of a long doc). Report every doc touched and
every doc deliberately left alone with its proportionality reason. Advisory; the maintainer commits.
