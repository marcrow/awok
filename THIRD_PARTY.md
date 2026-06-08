# Third-party attributions

The `create-workflow` and `workflow-doctor` workflows adapt content from
these MIT-licensed projects. Each adapted file also carries an inline attribution
footer. We retain the original copyright and MIT permission notices.

| Project | Copyright | URL | Used in |
|---|---|---|---|
| BMAD-METHOD (`bmad-brainstorming`) | © 2025 BMad Code, LLC (MIT) | https://github.com/bmad-code-org/BMAD-METHOD | brainstorm-protocol facilitator stance + technique library; cross-pollinator; rolestormer |
| claude-skills "the-fool" | © Jeffallan (MIT) | https://github.com/Jeffallan/claude-skills | premortem; devils-advocate; rolestormer personas; finding-rechecker adversarial stance |
| superpowers | © 2025 Jesse Vincent (MIT) | https://github.com/obra/superpowers | devils-advocate "Do Not Trust the Report" stance; skill-reviewer framing; handoff tail; finding-rechecker "assume the report is wrong" stance |

workflow-doctor's `agent-quality-auditor` rubric is adapted (cited, not vendored) from
Anthropic's public guidance — "Skill authoring best practices"
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) and
"Create custom subagents" (https://code.claude.com/docs/en/sub-agents) — with a local
awok overlay. See the attribution footer in `src/agents/agent-quality-auditor.md`.

tessl (`tessl-review`, optional/experimental) is a third-party tool, not vendored:
https://docs.tessl.io .
