// Reusable prompt-assist vocabulary module. `knobView` derives widget-ready
// data from the merged /api/vocab payload (so definition.js drops its local
// constants); `renderVocabEditor` is the editor mounted on the awok settings
// page. Both are consumed by the Definition tab today and reusable by a future
// agent-style editor. The engine stays the source of truth — this never
// recompiles style prose (D5).

export function knobView(vocab, name) {
  const k = vocab && vocab.knobs && vocab.knobs[name];
  if (!k) return { kind: "ordinal", optional: false, supportsCustom: false,
                   options: [], scale: [], labels: [], hints: {}, defs: {} };
  const options = k.options || [];
  const label = o => (o.label != null ? o.label : o.value);
  return {
    kind: k.kind || "ordinal",
    optional: !!k.optional,
    supportsCustom: !!k.supports_custom,
    options,
    scale: options.map(o => o.value),
    labels: options.map(label),
    hints: Object.fromEntries(options.map(o => [o.value, o.hint || ""])),
    defs: Object.fromEntries(options.map(o => [o.value, o.definition || ""])),
  };
}

// Prefill a new option's prose from the knob's template — a real, usable
// sentence, never phrased as an example (so it does not pollute the prompt).
function prefillProse(knob, value) {
  const tmpl = (knob && knob.prose_template) || "";
  return tmpl.replace(/\{value\}/g, value).replace(/\{hint\}/g, "").trim();
}

// Test seam: overridable so bun tests can inject a value without a real prompt.
export function _askOptionValue(btn) {
  if (btn && btn.dataset && btn.dataset.testValue) return btn.dataset.testValue;
  return (typeof prompt === "function") ? prompt("New option value:") : null;
}

const KNOB_ORDER = ["length", "tone", "format", "audience", "language", "stance"];

export function renderVocabEditor(root, ctx) {
  root.replaceChildren();
  const merged = ctx.getMerged() || { knobs: {} };
  // Working overlay copy the editor mutates; PUT back on Save.
  const overlay = JSON.parse(JSON.stringify(ctx.getOverlay() || { version: 1, knobs: {} }));
  overlay.version = overlay.version || 1;
  overlay.knobs = overlay.knobs || {};

  const upsert = (knob, value, field, val) => {
    overlay.knobs[knob] = overlay.knobs[knob] || { options: [] };
    const opts = overlay.knobs[knob].options = overlay.knobs[knob].options || [];
    let o = opts.find(x => x.value === value);
    if (!o) { o = { value }; opts.push(o); }
    o[field] = val;
  };

  const wrap = document.createElement("div"); wrap.className = "vocab-editor";
  const intro = document.createElement("p"); intro.className = "vocab-intro";
  intro.textContent = "Prompt-assist vocabulary — global to awok. Base options are shipped; your edits and additions are saved to this project's custom/ overlay and survive engine upgrades.";
  wrap.appendChild(intro);

  KNOB_ORDER.forEach(name => {
    const kmeta = (merged.knobs && merged.knobs[name]) || null;
    if (!kmeta) return;
    const sec = document.createElement("section"); sec.className = "vocab-knob";
    const h = document.createElement("h3"); h.textContent = name; sec.appendChild(h);

    (kmeta.options || []).forEach(o => {
      const row = document.createElement("div"); row.className = "vocab-opt";
      row.dataset.opt = name + ":" + o.value;
      const head = document.createElement("div"); head.className = "vocab-opt-head";
      const val = document.createElement("span"); val.className = "vocab-val"; val.textContent = o.value;
      const badge = document.createElement("span"); badge.className = "vocab-src vocab-src-" + o.source;
      badge.textContent = o.source === "base" ? (o.overridden ? "base · reworded" : "base") : "custom";
      head.appendChild(val); head.appendChild(badge); row.appendChild(head);

      const mk = (field, ph) => {
        const inp = document.createElement("input");
        inp.type = "text"; inp.dataset.field = field; inp.placeholder = ph;
        inp.value = o[field] || "";
        inp.addEventListener("input", () => upsert(name, o.value, field, inp.value));
        const l = document.createElement("label"); l.className = "vocab-field";
        l.append(field, inp); return l;
      };
      row.appendChild(mk("definition", "what this option means (shown in the editor)"));
      row.appendChild(mk("prose", "sentence injected into the prompt"));
      sec.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "vocab-add"; add.textContent = "+ option"; add.dataset.addKnob = name;
    add.addEventListener("click", () => {
      const v = _askOptionValue(add);
      if (!v) return;
      const prose = prefillProse(kmeta, v);
      upsert(name, v, "prose", prose);
      upsert(name, v, "definition", "");
      // Reflect the new option live: append a row mirroring the base rows.
      const row = document.createElement("div"); row.className = "vocab-opt"; row.dataset.opt = name + ":" + v;
      const head = document.createElement("div"); head.className = "vocab-opt-head";
      const val = document.createElement("span"); val.className = "vocab-val"; val.textContent = v;
      const badge = document.createElement("span"); badge.className = "vocab-src vocab-src-overlay"; badge.textContent = "custom";
      head.appendChild(val); head.appendChild(badge); row.appendChild(head);
      const mk = (field, value) => {
        const inp = document.createElement("input"); inp.type = "text"; inp.dataset.field = field; inp.value = value;
        inp.addEventListener("input", () => upsert(name, v, field, inp.value));
        const l = document.createElement("label"); l.className = "vocab-field"; l.append(field, inp); return l;
      };
      row.appendChild(mk("definition", "")); row.appendChild(mk("prose", prose));
      add.parentElement.insertBefore(row, add);
    });
    sec.appendChild(add);
    wrap.appendChild(sec);
  });

  const bar = document.createElement("div"); bar.className = "vocab-bar";
  const save = document.createElement("button"); save.textContent = "Save vocabulary";
  save.dataset.vocabSave = "1";
  const status = document.createElement("span"); status.className = "vocab-status";
  save.addEventListener("click", async () => {
    const r = await ctx.onSave(overlay);
    status.textContent = r && r.ok ? "✓ saved" : "✗ " + (((r && r.errors) || ["error"]).join("; "));
  });
  bar.appendChild(save); bar.appendChild(status); wrap.appendChild(bar);
  root.appendChild(wrap);
}
