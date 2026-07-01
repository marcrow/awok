---
agent: premortem
generated: false
---

**premortem** [sonnet]{% if background %} (bg){% endif %} · Assumes the change shipped and broke the workflow, then traces the specific causes.
{{ inputs_outputs_compact }}

**Task**: Assume the change shipped and quietly broke the target workflow. Work backward to
the specific causes — each with a named trigger, a threshold, and a concrete consequence
(not "might be slow"). Surface the design errors the maintainer won't volunteer while
excited about the idea. Advisory; the maintainer decides.
