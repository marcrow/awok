---
agent: skill-reviewer
generated: false
---

**skill-reviewer** [opus] · Scores the generated SKILL.md and the new agent files against Anthropic's rubric.
{{ inputs_outputs_compact }}

**Task**: Review the generated SKILL.md and every referenced agent file against the
Anthropic skill-authoring rubric (description quality, conciseness-for-an-orchestrator,
structure; agent frontmatter + body). Emit per-artifact scores, severity-tagged issues
with concrete fixes, and an overall PASS / NEEDS-FIX / REWORK verdict.
