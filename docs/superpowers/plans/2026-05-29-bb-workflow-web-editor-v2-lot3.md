# bb-workflow web editor v2 — Lot 3 (agent creation + Dataflow) Plan

> TDD where pure (bun), Chrome harness for integration, pytest for backend. Commit per task.

**Goal:** (1) Create agents from the GUI (unblocks new workflows referencing a not-yet-existing agent), (2) re-add a **Dataflow** tab that renders the agents↔files mermaid diagram, (3) make mermaid **non-blocking** (lazy load + prefetch at server start).

**Architecture:** Backend already has `create_agent`, `POST /api/agent`, `render_dataflow_mermaid`, `/api/preview` (returns `dataflow`), `/editor/mermaid.min.js`, `_mermaid_lib_bytes`, `ThreadingHTTPServer`. Lot 3 is mostly front-end + a prefetch in `cmd_edit`.

**Spec:** `docs/superpowers/specs/2026-05-29-bb-workflow-web-editor-v2-design.md`. Builds on Lot 2.

---

## Task 1: Agent creation modal (GUI)

**Files:** `editor.js`, `editor.css`; backend `POST /api/agent` already tested.

- Add a **"+ agent"** button in the topbar (and an entry in the invocation picker) that opens a modal form: name (slug), description, tools, model, prompt (big textarea).
- Submit → `POST /api/agent {name, description, tools, model, prompt}` → on `{errors:[]}`: close modal, refresh `state.agents` (GET /api/agents), re-render the open phase panel so the new agent appears in pickers. On errors: show them in the modal.
- Verify in Chrome harness: button opens modal, submit calls POST, new agent added to picker, no JS errors. (Backend create_agent already has pytest coverage.)

## Task 2: Dataflow tab (rendered mermaid, lazy + non-blocking)

**Files:** `editor.html` (tab + panel), `editor.js` (ensureMermaid + renderDataflow), `editor.css`.

- Add `<button class="tab" data-tab="dataflow">Dataflow</button>` and `<section id="panel-dataflow"><div id="dataflow-render"></div></section>`.
- `ensureMermaid()`: lazily inject `<script src="/editor/mermaid.min.js">` once, await load, `mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'loose'})`. Returns a promise resolving when `window.mermaid` is ready. Never injected unless the Dataflow tab is opened → no 3 MB on page load.
- On Dataflow tab click (and after model edits while it's active): `POST /api/preview` → take `dataflow` string, `stripFence`, `mermaid.render` into `#dataflow-render`. Graceful fallback to `<pre>` + a hint if mermaid fails/offline.
- Verify in Chrome harness with a stubbed `window.mermaid` and a stubbed `/editor/mermaid.min.js` script: opening Dataflow renders an SVG; switching away/back works; no JS errors.

## Task 3: Mermaid prefetch at server start (non-blocking first load)

**Files:** `bb-workflow` `cmd_edit`.

- In `cmd_edit`, before `serve_forever`, spawn a daemon thread that calls `_mermaid_lib_bytes()` once (downloads+caches) so the first `/editor/mermaid.min.js` GET is instant. Wrap in try/except (offline → editor still works, Dataflow degrades to text). Print a one-line note.
- Manual: launch, confirm editor responds immediately even while mermaid is (pre)fetching; `curl /editor/mermaid.min.js` returns 200 after prefetch.

## Task 4: suites + live gate

- `bun test` + full `pytest` (deselect the stray `test.yaml` drift) green.
- Live (hunter relaunches): open Dataflow on demo → diagram renders; create an agent via "+ agent" → appears in invocation picker; build a brand-new workflow referencing the new agent → saves. Report each.

---

## Notes
- The shared module duplication is resolved (Lot 2): editor.js imports from /editor/*.js. New pure helpers (if any) go in render-helpers.js with bun tests.
- `file://` blocks ES module CORS → keep using the concat harness for editor.js integration checks; mermaid stubbed in-harness.
