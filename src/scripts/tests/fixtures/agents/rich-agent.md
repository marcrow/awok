---
name: rich-agent
description: |
  Multi-line description used to exercise the literal block scalar
  in the split_agent_md tests.
model: inherit
tools:
  - Read
  - Grep
---

Read work/rich/input.md, extract the key points, and write a short note to
work/rich/output.md. Fixture body for the split/join round-trip tests.
