// awok orchestration layer — program (block-tree) view + gate editor.
// Rendered ONLY when state.showOrch is on; the classic grid is untouched otherwise.
export function renderProgram(ctx) {
  const grid = document.querySelector("#grid"); grid.replaceChildren();
  const note = document.createElement("div"); note.className = "help-note";
  note.textContent = "Orchestration view — rendering in Task 7."; grid.appendChild(note);
}
