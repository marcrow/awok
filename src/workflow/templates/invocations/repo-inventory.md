---
agent: repo-inventory
generated: false
---

**{{ agent }}** [{{ model }}] · Inventories the repo tree, languages and build/config files.
{{ inputs_outputs_compact }}

**Task**: Walk the target repo and write the `inventory`: top-level layout, detected languages, build/config/manifest files, candidate entry points, and rough sizes (file counts, LOC ballpark). Factual and compact — the explorers read it.
