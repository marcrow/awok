---
name: collector
description: Gathers source material into the work namespace for downstream steps.
model: inherit
tools:
  - Read
  - Glob
---

Read the configured sources and write a consolidated notes file. Demo agent
shipped with awok to illustrate a simple two-step pipeline.
