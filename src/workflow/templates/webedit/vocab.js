// Reusable prompt-assist vocabulary module. `knobView` derives widget-ready
// data from the merged /api/vocab payload (so definition.js drops its local
// constants); `renderVocabEditor` is the editor mounted on the awok settings
// page. Both stay engine-first — this never recompiles style prose (D5); it
// only renders option lists and edits the user overlay.
import { bigSlider } from "./formfields.js";

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

const KNOB_ORDER = ["length", "tone", "format", "audience", "language", "stance"];
const KNOB_LABEL = { length: "Length", tone: "Tone", format: "Format",
                     audience: "Audience", language: "Language", stance: "Stance" };
const KNOB_HELP = {
  length: "How long the final answer should be.",
  tone: "The voice of the final answer.",
  format: "How the answer is structured.",
  audience: "Who the answer is written for.",
  language: "Output language of the answer.",
  stance: "Whether the answer recommends or presents options.",
};

const numWeight = o => (typeof o.weight === "number" ? o.weight : Infinity);

export function renderVocabEditor(root, ctx) {
  root.replaceChildren();
  const merged = ctx.getMerged() || { knobs: {} };
  const overlayVersion = ((ctx.getOverlay() || {}).version) || 1;

  // Working model: a mutable clone of every knob's merged options. All edits,
  // adds and deletes happen here; the overlay is rebuilt from it on Save.
  const model = {};
  KNOB_ORDER.forEach(name => {
    const km = merged.knobs && merged.knobs[name];
    if (km) model[name] = (km.options || []).map(o => ({ ...o }));
  });
  const touched = new Set();          // "knob:value" of base options the user edited
  const mark = (name, value) => { if (value) touched.add(name + ":" + value); };

  // Rebuild the overlay from the model: custom options in full, plus base
  // options that were reworded (provenance flag) or edited this session. A
  // deleted custom option is simply absent → gone. Base options are never
  // deletable, so the base contract can't be orphaned.
  const buildOverlay = () => {
    const ov = { version: overlayVersion, knobs: {} };
    KNOB_ORDER.forEach(name => {
      const opts = model[name]; if (!opts) return;
      const entries = [];
      opts.forEach(o => {
        if (!o.value) return;                         // skip an in-progress blank option
        const isCustom = o.source === "overlay";
        const isBaseEdit = o.source === "base" && (o.overridden || touched.has(name + ":" + o.value));
        if (!isCustom && !isBaseEdit) return;
        const e = { value: o.value };
        if (typeof o.definition === "string") e.definition = o.definition;
        if (typeof o.prose === "string") e.prose = o.prose;
        if (typeof o.weight === "number") e.weight = o.weight;
        if (o.hint) e.hint = o.hint;
        if (o.label) e.label = o.label;
        entries.push(e);
      });
      if (entries.length) ov.knobs[name] = { options: entries };
    });
    return ov;
  };

  const wrap = document.createElement("div"); wrap.className = "vocab-editor";
  const intro = document.createElement("p"); intro.className = "vocab-intro";
  intro.textContent = "Prompt-assist vocabulary — global to awok. Slide to an option to edit its meaning and the sentence injected into the prompt, or add your own. Base options are shipped; your edits and additions are saved to this project's custom/ overlay and survive engine upgrades.";
  wrap.appendChild(intro);

  KNOB_ORDER.forEach(name => {
    const opts = model[name]; if (!opts) return;
    const knobMeta = merged.knobs[name];

    const sec = document.createElement("section");
    sec.className = "vocab-knob"; sec.dataset.knob = name;
    const h = document.createElement("h3"); h.className = "vocab-knob-title";
    h.textContent = KNOB_LABEL[name] || name;
    const sub = document.createElement("span"); sub.className = "vocab-knob-sub";
    sub.textContent = KNOB_HELP[name] || "";
    h.appendChild(sub); sec.appendChild(h);

    const sliderHost = document.createElement("div"); sliderHost.className = "vocab-slider-host";
    const editHost = document.createElement("div"); editHost.className = "vocab-edit-host";
    sec.appendChild(sliderHost); sec.appendChild(editHost);

    const visible = () => opts.filter(o => o.value).sort((a, b) => numWeight(a) - numWeight(b));
    let sel = visible()[0] || null;    // selected option object (reference)

    const renderSlider = () => {
      sliderHost.replaceChildren();
      const v = visible();
      if (!v.length) { return; }
      const scale = v.map(o => o.value);
      const labels = v.map(o => (o.label != null ? o.label : o.value));
      const defs = Object.fromEntries(v.map(o => [o.value, o.definition || ""]));
      const cur = sel && sel.value ? sel.value : "";
      sliderHost.appendChild(bigSlider("", null, scale, labels, cur,
        x => x || "— pick an option to edit —",
        x => { sel = opts.find(o => o.value === x) || null; renderEdit(); }, defs));
    };

    const field = (labelText, value, multiline, oninput) => {
      const l = document.createElement("label"); l.className = "vocab-field";
      const t = document.createElement("span"); t.className = "vocab-field-lab"; t.textContent = labelText;
      const inp = multiline ? document.createElement("textarea") : document.createElement("input");
      if (!multiline) inp.type = "text";
      inp.value = value == null ? "" : value;
      inp.addEventListener("input", () => oninput(inp.value, inp));
      l.append(t, inp); return { l, inp };
    };

    const renderEdit = () => {
      editHost.replaceChildren();
      if (!sel) {
        const n = document.createElement("div"); n.className = "vocab-empty";
        n.textContent = visible().length ? "Slide to an option to edit it."
                                         : "No options yet — add one below.";
        editHost.appendChild(n); renderAdd(); return;
      }
      const o = sel;
      const card = document.createElement("div"); card.className = "vocab-card";
      card.dataset.editing = name + ":" + (o.value || "");
      const custom = o.source === "overlay";

      const head = document.createElement("div"); head.className = "vocab-card-head";
      const badge = document.createElement("span");
      badge.className = "vocab-src vocab-src-" + (custom ? "overlay" : "base");
      badge.textContent = custom ? "custom" : (o.overridden ? "base · reworded" : "base");
      head.appendChild(badge);
      if (custom) {
        const del = document.createElement("button");
        del.className = "vocab-del"; del.dataset.del = "1"; del.textContent = "🗑 delete";
        del.title = "Remove this custom option";
        del.addEventListener("click", () => {
          const i = opts.indexOf(o); if (i >= 0) opts.splice(i, 1);
          sel = visible()[0] || null; renderSlider(); renderEdit();
        });
        head.appendChild(del);
      }
      card.appendChild(head);

      // value — editable only for a custom option (it is the key); base is fixed.
      if (custom) {
        const vf = field("value (the stored key)", o.value, false, (val, inp) => {
          const trimmed = val.trim();
          const clash = opts.some(x => x !== o && x.value === trimmed);
          inp.classList.toggle("vocab-bad", !!clash || !trimmed);
          if (clash || !trimmed) return;
          const wasAuto = o._autoProse !== false;
          o.value = trimmed;
          if (wasAuto) { o.prose = prefillProse(knobMeta, trimmed); }
          card.dataset.editing = name + ":" + trimmed;
          renderSlider();
          // keep the value input focused/rerender prose field only
          const pf = card.querySelector("[data-field='prose']");
          if (pf && wasAuto) pf.value = o.prose;
        });
        vf.inp.dataset.field = "value"; vf.inp.placeholder = "e.g. warm";
        card.appendChild(vf.l);
      } else {
        const vrow = document.createElement("div"); vrow.className = "vocab-val-fixed";
        vrow.textContent = o.value; card.appendChild(vrow);
      }

      const df = field("definition — what it means (shown here, never injected)", o.definition, true, (val) => {
        o.definition = val; if (!custom) mark(name, o.value);
      });
      df.inp.dataset.field = "definition"; card.appendChild(df.l);

      const pf = field("prose — the sentence injected into the prompt", o.prose, true, (val) => {
        o.prose = val; o._autoProse = false; if (!custom) mark(name, o.value);
      });
      pf.inp.dataset.field = "prose"; card.appendChild(pf.l);

      const wrow = document.createElement("div"); wrow.className = "vocab-weight-row";
      const wf = field("weight — position on the slider (low = left)", o.weight == null ? "" : o.weight, false, (val, inp) => {
        const n = parseFloat(val);
        if (val.trim() === "" || Number.isNaN(n)) { delete o.weight; }
        else { o.weight = n; }
        if (!custom) mark(name, o.value);
        inp.classList.toggle("vocab-bad", val.trim() !== "" && Number.isNaN(n));
        renderSlider();
      });
      wf.inp.type = "number"; wf.inp.dataset.field = "weight"; wf.inp.step = "1";
      wrow.appendChild(wf.l);
      // hint only matters where the prose template interpolates it (length).
      if (knobMeta && (knobMeta.prose_template || "").includes("{hint}")) {
        const hf = field("hint — e.g. ~150 words", o.hint, false, (val) => {
          if (val) o.hint = val; else delete o.hint; if (!custom) mark(name, o.value);
        });
        hf.inp.dataset.field = "hint"; wrow.appendChild(hf.l);
      }
      card.appendChild(wrow);

      editHost.appendChild(card);
      renderAdd();
    };

    let addBtn;
    const renderAdd = () => {
      if (addBtn) return;                       // the add button lives once under the card host
      addBtn = document.createElement("button");
      addBtn.className = "vocab-add"; addBtn.dataset.addKnob = name;
      addBtn.textContent = "+ add a custom option";
      addBtn.addEventListener("click", () => {
        // reuse an existing in-progress blank option instead of stacking blanks
        let blank = opts.find(o => o.source === "overlay" && !o.value);
        if (!blank) {
          const maxW = opts.reduce((m, o) => Math.max(m, typeof o.weight === "number" ? o.weight : 0), 0);
          blank = { value: "", definition: "", prose: "", weight: maxW + 10,
                    source: "overlay", overridden: false, _autoProse: true };
          opts.push(blank);
        }
        sel = blank; renderEdit();
        const vi = editHost.querySelector("[data-field='value']"); if (vi) vi.focus();
      });
      sec.appendChild(addBtn);
    };

    renderSlider();
    renderEdit();
    wrap.appendChild(sec);
  });

  const bar = document.createElement("div"); bar.className = "vocab-bar";
  const save = document.createElement("button"); save.className = "vocab-save-btn";
  save.textContent = "Save vocabulary"; save.dataset.vocabSave = "1";
  const status = document.createElement("span"); status.className = "vocab-status";
  save.addEventListener("click", async () => {
    status.textContent = "saving…";
    const r = await ctx.onSave(buildOverlay());
    status.textContent = r && r.ok ? "✓ saved" : "✗ " + (((r && r.errors) || ["error"]).join("; "));
  });
  bar.appendChild(save); bar.appendChild(status); wrap.appendChild(bar);
  root.appendChild(wrap);
}
