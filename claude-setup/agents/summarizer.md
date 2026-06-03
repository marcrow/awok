---
name: summarizer
description: |
  Reads the collected notes and writes a concise digest.
  Multi-line description, used to exercise the literal block scalar in tests.
model: inherit
tools:
  - Read
  - Grep
---

Read work/demo/notes.md, extract the key points, and write a short digest to
work/demo/digest.md.
