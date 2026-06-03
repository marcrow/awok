// Single source of truth for pure helpers — shared with the bun tests
// (src/scripts/tests/webedit import the same files).
import { computeDropDepends, safeDropDepends, blockedDependents,
         buildNotice, renderEdges, aggregateInvocationIo, applyPhaseGroup } from "./editlogic.js";
import { makeCard, section, helpNote, helpIcon, labelWithHelp } from "./render-helpers.js";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor } from "./formfields.js";

const $ = s => document.querySelector(s);
const api = (m, p, b) => fetch(p, {method:m, headers:{'Content-Type':'application/json'},
  body: b ? JSON.stringify(b) : undefined}).then(async r => ({status:r.status, j:await r.json()}));

function showNotice(title, lines){
  document.querySelectorAll(".notice-overlay").forEach(n=>n.remove());
  const ov=document.createElement("div"); ov.className="notice-overlay";
  const box=buildNotice(title, lines);
  const btn=document.createElement("button"); btn.textContent="Got it";
  btn.addEventListener("click",()=>ov.remove());
  box.appendChild(btn); ov.appendChild(box);
  ov.addEventListener("click",e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
}

let state={name:null, model:null, view:null, selected:null, workflows:[], agents:[], panelTab:"general", panelWidth:null};

// Mirror of bb-workflow's group palette so grid cards match the cartography
// colors. Known semantic groups keep a curated color; custom groups get a
// distinct palette color cycled in declaration order (deterministic, not random).
const DEFAULT_GROUP_COLORS={
  "passive-recon":"#14532d","active-collection":"#1e3a5f","static-analysis":"#5c3a00",
  "consolidation":"#3b0764","active-exploit":"#5b1a1a","g1":"#1e3a5f","g2":"#5c3a00",
};
const GROUP_COLOR_PALETTE=["#1e3a5f","#14532d","#5c3a00","#3b0764","#5b1a1a","#134e4a","#7c2d12","#4c1d95","#831843","#155e75","#365314","#3f3f46"];
function resolveGroupColors(model){
  const colors={...DEFAULT_GROUP_COLORS}; let idx=0;
  for(const g of Object.keys((model&&model.groups)||{})){
    if(!(g in colors)){ colors[g]=GROUP_COLOR_PALETTE[idx%GROUP_COLOR_PALETTE.length]; idx++; }
  }
  return colors;
}

let _panelGlobalsWired=false;
function wirePanelGlobals(){
  if(_panelGlobalsWired) return; _panelGlobalsWired=true;
  document.addEventListener("mousedown",e=>{
    const panel=$('#edit-panel');
    if(!panel || panel.hidden) return;
    if(panel.contains(e.target)) return;
    if(e.target.closest && (e.target.closest('.phase-card') || e.target.closest('.notice-overlay'))) return;
    panel.hidden=true; state.selected=null; renderGrid();
  });
}
function ensureResizeGrip(panel){
  wirePanelGlobals();
  if(state.panelWidth) panel.style.width=state.panelWidth+"px";
  const grip=document.createElement("div"); grip.className="resize-grip"; panel.appendChild(grip);
  grip.addEventListener("mousedown",e=>{
    e.preventDefault();
    const startX=e.clientX, startW=panel.getBoundingClientRect().width;
    const move=ev=>{ const w=Math.min(window.innerWidth-80, Math.max(280, startW+(startX-ev.clientX))); panel.style.width=w+"px"; state.panelWidth=w; if(state.view) drawEdges(); };
    const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); };
    document.addEventListener("mousemove",move); document.addEventListener("mouseup",up);
  });
}

async function loadList(){
  const {j}=await api('GET','/api/workflows');
  state.workflows = j;
  state.agents = (await api('GET','/api/agents')).j || [];
  const sel=$('#wf-select'); sel.replaceChildren();
  j.forEach(n=>{ const o=document.createElement('option'); o.textContent=n; sel.appendChild(o); });
  if(!j.length) return;
  const want=new URLSearchParams(location.search).get('workflow');
  const initial=(want && j.includes(want))?want:j[0];
  sel.value=initial; await loadWorkflow(initial);
}
async function loadWorkflow(name){
  const {j}=await api('GET','/api/workflow/'+name);
  state={...state, name, model:j.model, view:null, selected:null};
  $('#edit-panel').hidden=true;
  await refreshView();
}
async function refreshView(){
  const {j}=await api('POST','/api/view',state.model);
  state.view=j;
  renderGrid(); renderYaml();
  setStatus(j.errors && j.errors.length ? '⚠ '+j.errors.length+' validation issue(s)' : '');
}
function setStatus(t){ $('#status').textContent=t; }

function rowsFromView(){
  const lv=state.view.levels, max=Math.max(0,...Object.values(lv));
  const rows=[]; for(let i=0;i<=max;i++) rows.push([]);
  (state.model.phases||[]).forEach(p=>rows[lv[p.id]||0].push(p.id));
  return rows;
}
function renderGrid(){
  const grid=$('#grid'); grid.replaceChildren();
  const rows=rowsFromView();
  const byId={}; (state.model.phases||[]).forEach(p=>byId[p.id]=p);
  const colors=resolveGroupColors(state.model);
  rows.forEach((ids,i)=>grid.appendChild(makeRow(ids,i,byId,false,colors)));
  grid.appendChild(makeRow([],rows.length,byId,true,colors));
  requestAnimationFrame(drawEdges);
}
function makeRow(ids,i,byId,isNew,colors){
  const row=document.createElement("div");
  row.className="row"+(isNew?" new-level":""); row.dataset.level=i;
  row.addEventListener("dragover",e=>{e.preventDefault();row.classList.add("drop-hover");});
  row.addEventListener("dragleave",()=>row.classList.remove("drop-hover"));
  row.addEventListener("drop",e=>onDrop(e,i));
  const label=document.createElement("div"); label.className="row-label";
  label.textContent = isNew ? `Lvl ${i+1} (drop here)` : `Lvl ${i+1}`;
  row.appendChild(label);
  ids.forEach(id=>{
    const card=makeCard(byId[id], (colors||{})[byId[id].group]);
    if(id===state.selected) card.classList.add("selected");
    card.addEventListener("dragstart",e=>e.dataTransfer.setData("text/plain",id));
    card.addEventListener("click",()=>selectPhase(id));
    row.appendChild(card);
  });
  return row;
}
function cardCenter(id){
  const el=[...document.querySelectorAll('.phase-card')].find(c=>c.dataset.id===id);
  if(!el) return null;
  const wrap=$('#grid-wrap').getBoundingClientRect();
  const r=el.getBoundingClientRect();
  return {x:r.left-wrap.left+r.width/2, y:r.top-wrap.top+r.height/2};
}
function drawEdges(){
  const svg=$('#edge-overlay');
  const wrap=$('#grid-wrap').getBoundingClientRect();
  svg.setAttribute("width",wrap.width); svg.setAttribute("height",wrap.height);
  const pos={}; (state.model.phases||[]).forEach(p=>{const c=cardCenter(p.id); if(c) pos[p.id]=c;});
  renderEdges(svg, state.view.edges||[], pos);
}
async function onDrop(ev,level){
  ev.preventDefault();
  const id=ev.dataTransfer.getData("text/plain");
  const p=(state.model.phases||[]).find(x=>x.id===id); if(!p) return;
  // previous-row deps minus any descendant of the dragged phase -> never a cycle
  const rows=rowsFromView();
  const blocked=blockedDependents(state.model.phases, rows, level, id);
  p.depends_on=safeDropDepends(state.model.phases, rows, level, id);
  await refreshView();
  if(blocked.length){
    setStatus("↪ "+id+": constrained move (anti-cycle)");
    showNotice("Constrained move — "+id, [
      "These phases already depend on "+id+": "+blocked.join(", ")+".",
      id+" cannot depend on them (that would create a cycle).",
      "To place it lower, first remove those links (uncheck "+id+" in their depends_on panel), then move it again.",
    ]);
  }
  if(state.selected) selectPhase(state.selected); // refresh open panel + links
}

function selectPhase(id){
  state.selected=id;
  const p=(state.model.phases||[]).find(x=>x.id===id); if(!p) return;
  const panel=$('#edit-panel'); panel.hidden=false; panel.replaceChildren();
  ensureResizeGrip(panel);

  const title=document.createElement("div"); title.className="panel-title"; title.textContent=p.id; panel.appendChild(title);

  const tabs=[
    {key:"general", label:"General", render:b=>tabGeneral(b,p,id)},
    {key:"deps", label:"Dependencies", render:b=>tabDeps(b,p)},
    {key:"files", label:"Files", render:b=>tabFiles(b,p)},
    {key:"triggers", label:"Triggers", render:b=>tabTriggers(b,p)},
    {key:"invocations", label:"Invocations ("+((p.invocations||[]).length)+")", render:b=>renderInvocations(b,p,id)},
  ];
  if(!tabs.some(t=>t.key===state.panelTab)) state.panelTab="general";

  const strip=document.createElement("div"); strip.className="panel-tabs";
  const content=document.createElement("div"); content.className="panel-content";
  const draw=()=>{
    content.replaceChildren();
    (tabs.find(t=>t.key===state.panelTab)||tabs[0]).render(content);
    [...strip.children].forEach(b=>b.classList.toggle("active", b.dataset.k===state.panelTab));
  };
  tabs.forEach(t=>{ const b=document.createElement("button"); b.className="ptab"; b.dataset.k=t.key; b.textContent=t.label;
    b.addEventListener("click",()=>{ state.panelTab=t.key; draw(); }); strip.appendChild(b); });
  panel.appendChild(strip); panel.appendChild(content);

  const actions=document.createElement("div"); actions.className="panel-actions";
  const del=document.createElement("button"); del.textContent="🗑 delete phase";
  del.addEventListener("click",deletePhase); actions.appendChild(del);
  const close=document.createElement("button"); close.textContent="close";
  close.addEventListener("click",()=>{panel.hidden=true;}); actions.appendChild(close);
  panel.appendChild(actions);

  draw();
  renderGrid();
}

function tabGeneral(body,p,id){
  const mk=(node)=>body.appendChild(node);
  const idR=fieldText("id", p.id, ()=>{}); idR.querySelector("input").addEventListener("change",e=>renamePhase(e.target.value)); idR.appendChild(helpIcon("Unique identifier in UPPERCASE (e.g. R1-BOT-SIM).")); mk(idR);
  mk(fieldText("name", p.name||"", v=>{p.name=v; refreshView();}));
  const typeR=fieldSelect("type", p.type||"agent", ["agent","script","external","main_agent","workflow_call"], v=>{p.type=v; refreshView().then(()=>selectPhase(id));});
  typeR.appendChild(helpIcon("agent = invokes sub-agents · script = shell command (cmd) · external = produced outside the workflow · main_agent = driven by the main agent · workflow_call = calls another workflow.")); mk(typeR);
  const grp=fieldDatalist("group", p.group||"", Object.keys(state.model.groups||{}), v=>setPhaseGroup(p,v));
  grp.appendChild(helpIcon("Free-form group name (drives visual grouping + risk). Existing groups are suggested; a new name automatically creates the group (adjustable in Settings › groups).")); mk(grp);
  mk(fieldTextarea("description", p.description, v=>{ if(v) p.description=v; else delete p.description; refreshView(); }));
  if(p.type==="script"){
    const c=fieldTextarea("cmd", p.cmd, v=>{ if(v) p.cmd=v; else delete p.cmd; refreshView(); });
    c.appendChild(helpIcon("Shell command run for this phase (e.g. python src/scripts/foo.py).")); mk(c);
  }
  if(p.type==="workflow_call"){
    const w=fieldSelect("workflow", p.workflow||"", ["", ...(state.workflows||[]).filter(n=>n!==state.name)], v=>{ if(v) p.workflow=v; else delete p.workflow; refreshView(); });
    w.appendChild(helpIcon("Workflow to invoke as a sub-step (must exist in src/workflows/).")); mk(w);
  }
}
function tabDeps(body,p){
  const lvl=state.view.levels[p.id]||0;
  const candidates=(state.model.phases||[]).filter(o=>o.id!==p.id && (state.view.levels[o.id]||0)<lvl);
  const head=labelWithHelp("depends_on", "Check the (lower-level) phases that must finish before this one. You can also drag the card under another row."); body.appendChild(head);
  if(!candidates.length){const m=document.createElement("div"); m.className="muted"; m.textContent="root — no lower-level phase."; body.appendChild(m);}
  candidates.forEach(o=>{
    const wrap=document.createElement("label"); wrap.style.textTransform="none";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=(p.depends_on||[]).includes(o.id);
    cb.addEventListener("change",()=>toggleDep(o.id,cb.checked));
    wrap.appendChild(cb); wrap.appendChild(document.createTextNode(" "+o.id+" (lvl "+((state.view.levels[o.id]||0)+1)+")"));
    body.appendChild(wrap);
  });
}
function tabFiles(body,p){
  const ph=section("phase files", true);
  ph.body.appendChild(labelWithHelp("phase-level", "Inputs/outputs declared directly on the phase (scripts, main_agent). For a phase with invocations, files are set per invocation — see below and the Invocations tab."));
  ph.body.appendChild(ioRefEditor("inputs", p.inputs||[], next=>{ if(next.length) p.inputs=next; else delete p.inputs; refreshView(); }));
  ph.body.appendChild(ioRefEditor("outputs", p.outputs||[], next=>{ if(next.length) p.outputs=next; else delete p.outputs; refreshView(); }));
  body.appendChild(ph);
  const agg=aggregateInvocationIo(p);
  if(agg.length){
    const inv=section("invocation files (read-only)", true);
    inv.body.appendChild(helpNote("Overview — same files as the Dataflow. Edit them in the Invocations tab."));
    agg.forEach(g=>{
      const row=document.createElement("div"); row.className="io-rollup";
      const t=document.createElement("div"); t.className="io-rollup-agent"; t.textContent="▸ "+g.agent; row.appendChild(t);
      if(g.inputs.length){ const d=document.createElement("div"); d.className="io-rollup-line io-in"; d.textContent="in  "+g.inputs.map(x=>x.path+(x.optional?"?":"")).join(", "); row.appendChild(d); }
      if(g.outputs.length){ const d=document.createElement("div"); d.className="io-rollup-line io-out"; d.textContent="out "+g.outputs.map(x=>x.path+(x.optional?"?":"")).join(", "); row.appendChild(d); }
      inv.body.appendChild(row);
    });
    body.appendChild(inv);
  }
}
function tabTriggers(body,p){
  body.appendChild(triggerEditor("triggers", p.triggers||[], next=>{ if(next.length) p.triggers=next; else delete p.triggers; refreshView(); }));
}

function renderInvocations(host, p, id){
  (p.invocations||[]).forEach((inv,idx)=>{
    const box=section("▸ "+inv.agent, false); box.classList.add("inv-card"); host.appendChild(box);
    const b=box.body;
    b.appendChild(fieldSelect("model", inv.model||"inherit", ["inherit","haiku","sonnet","opus"], v=>{inv.model=v; refreshView();}));
    const ep=document.createElement("button"); ep.className="prompt-btn"; ep.textContent="✎ edit prompt"; ep.addEventListener("click",()=>openPrompt(inv.agent)); b.appendChild(ep);
    b.appendChild(fieldTextarea("description (for this invocation)", inv.description, v=>{ if(v) inv.description=v; else delete inv.description; refreshView();}));
    const bg=fieldCheckbox("background (run the agent in the background)", inv.background, v=>{ if(v) inv.background=true; else delete inv.background; refreshView();}); b.appendChild(bg);
    const si=fieldSelect("skip_if (skip when the condition is true)", inv.skip_if||"", ["", ...Object.keys(state.model.conditions||{})], v=>{ if(v) inv.skip_if=v; else delete inv.skip_if; refreshView();}); b.appendChild(si);
    if(!Object.keys(state.model.conditions||{}).length) b.appendChild(helpNote("No condition defined — add one in Settings › conditions."));
    b.appendChild(fieldSelect("depends_on_invocation (wait for another invocation of this phase)", inv.depends_on_invocation||"", ["", ...(p.invocations||[]).filter(x=>x!==inv).map(x=>x.agent)], v=>{ if(v) inv.depends_on_invocation=v; else delete inv.depends_on_invocation; refreshView();}));
    const it=section("invocation triggers", false); b.appendChild(it);
    it.body.appendChild(triggerEditor("triggers", inv.triggers||[], next=>{ if(next.length) inv.triggers=next; else delete inv.triggers; refreshView();}));
    const io=section("invocation files", false); b.appendChild(io);
    io.body.appendChild(ioRefEditor("inputs", inv.inputs||[], next=>{ if(next.length) inv.inputs=next; else delete inv.inputs; refreshView();}));
    io.body.appendChild(ioRefEditor("outputs", inv.outputs||[], next=>{ if(next.length) inv.outputs=next; else delete inv.outputs; refreshView();}));
    const rm=document.createElement("button"); rm.className="inv-remove"; rm.textContent="✕ remove this invocation";
    rm.addEventListener("click",()=>{p.invocations.splice(idx,1); if(!p.invocations.length) delete p.invocations; refreshView().then(()=>selectPhase(id));});
    b.appendChild(rm);
  });
  if((state.agents||[]).length){
    const pick=document.createElement("select");
    const o0=document.createElement("option"); o0.value=""; o0.textContent="+ invocation (existing agent)…"; pick.appendChild(o0);
    state.agents.forEach(a=>{const o=document.createElement("option"); o.value=a; o.textContent=a; pick.appendChild(o);});
    pick.addEventListener("change",()=>{ if(!pick.value)return; p.invocations=p.invocations||[]; if(!p.invocations.some(i=>i.agent===pick.value)) p.invocations.push({agent:pick.value,model:"inherit"}); refreshView().then(()=>selectPhase(id)); });
    host.appendChild(pick);
  } else {
    host.appendChild(helpNote("No agent in src/agents/."));
  }
  const create=document.createElement("button"); create.className="link-btn"; create.textContent="+ create a new agent…";
  create.addEventListener("click",()=>openAgentForm());
  host.appendChild(create);
}

async function refreshAgents(){ state.agents=(await api('GET','/api/agents')).j||[]; }

function openAgentForm(){
  document.querySelectorAll(".notice-overlay").forEach(n=>n.remove());
  const ov=document.createElement("div"); ov.className="notice-overlay";
  const box=document.createElement("div"); box.className="prompt-box";
  const h=document.createElement("div"); h.className="notice-title"; h.textContent="New agent"; box.appendChild(h);
  const draft={name:"",description:"",tools:"",model:"inherit",prompt:""};
  box.appendChild(fieldText("name (lowercase slug, e.g. my-agent)", "", v=>draft.name=v));
  box.appendChild(fieldText("description", "", v=>draft.description=v));
  box.appendChild(fieldText("tools (e.g. Read, Grep, Bash)", "", v=>draft.tools=v));
  box.appendChild(fieldSelect("model", "inherit", ["inherit","haiku","sonnet","opus"], v=>draft.model=v));
  const plabel=document.createElement("label"); plabel.textContent="prompt"; box.appendChild(plabel);
  const ta=document.createElement("textarea"); ta.className="prompt-textarea"; ta.spellcheck=false;
  ta.addEventListener("change",()=>draft.prompt=ta.value); box.appendChild(ta);
  const bar=document.createElement("div"); bar.className="prompt-bar";
  const st=document.createElement("span"); st.className="muted";
  const save=document.createElement("button"); save.textContent="create agent";
  save.addEventListener("click",async()=>{
    draft.prompt=ta.value;
    const {status,j}=await api('POST','/api/agent',draft);
    if(status===200 && (!j.errors||!j.errors.length)){
      await refreshAgents(); st.textContent="✓ agent created"; ov.remove();
      if(state.selected) selectPhase(state.selected);
    } else { st.textContent="✗ "+((j.errors||['error']).join('; ')); }
  });
  const close=document.createElement("button"); close.textContent="close"; close.addEventListener("click",()=>ov.remove());
  bar.appendChild(save); bar.appendChild(close); bar.appendChild(st); box.appendChild(bar);
  ov.appendChild(box);
  ov.addEventListener("click",e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
}

async function openPrompt(agent){
  // Two distinct artifacts: the agent's real system prompt (src/agents/<name>.md
  // body) and the per-phase invocation snippet (templates/invocations/<name>.md).
  const ag=await api('GET','/api/agent/'+agent);
  const iv=await api('GET','/api/invocation/'+agent);
  const agentExists=ag.status===200;
  const sources=[
    {label:"Prompt agent — src/agents/"+agent+".md",
     value:(ag.j&&ag.j.body)||"", disabled:!agentExists,
     hint:agentExists?"The agent's full system prompt. The frontmatter (tools, model, description) is preserved.":"Agent not found in src/agents/ — create it via « + agent ».",
     save:v=>api('PUT','/api/agent/'+agent,{body:v})},
    {label:"Invocation snippet — included in the SKILL",
     value:(iv.j&&iv.j.prompt)||"", disabled:false,
     hint:"The Task block injected into the generated SKILL.md for this phase.",
     save:v=>api('PUT','/api/invocation/'+agent,{prompt:v})},
  ];
  document.querySelectorAll(".notice-overlay").forEach(n=>n.remove());
  const ov=document.createElement("div"); ov.className="notice-overlay";
  const box=document.createElement("div"); box.className="prompt-box";
  const h=document.createElement("div"); h.className="notice-title"; h.textContent="Prompts — "+agent; box.appendChild(h);
  const tabs=document.createElement("div"); tabs.className="panel-tabs"; box.appendChild(tabs);
  const hint=document.createElement("div"); hint.className="muted";
  const ta=document.createElement("textarea"); ta.className="prompt-textarea"; ta.spellcheck=false;
  const st=document.createElement("span"); st.className="muted";
  let active=sources[0];
  function activate(s){
    active=s;
    [...tabs.children].forEach((b,i)=>b.classList.toggle("active",sources[i]===s));
    ta.value=s.value; ta.disabled=!!s.disabled; hint.textContent=s.hint||""; st.textContent="";
  }
  sources.forEach(s=>{
    const tb=document.createElement("button"); tb.className="ptab"; tb.textContent=s.label;
    tb.addEventListener("click",()=>{ if(!active.disabled) active.value=ta.value; activate(s); });
    tabs.appendChild(tb);
  });
  box.appendChild(hint); box.appendChild(ta);
  const bar=document.createElement("div"); bar.className="prompt-bar";
  const save=document.createElement("button"); save.textContent="💾 save";
  save.addEventListener("click",async()=>{
    if(active.disabled){ st.textContent="nothing to save"; return; }
    active.value=ta.value;
    const r=await active.save(ta.value);
    st.textContent=(r.status===200)?"✓ saved":"✗ "+(((r.j&&r.j.errors)||['error']).join('; '));
  });
  const close=document.createElement("button"); close.textContent="close"; close.addEventListener("click",()=>ov.remove());
  bar.appendChild(save); bar.appendChild(close); bar.appendChild(st); box.appendChild(bar);
  ov.appendChild(box);
  ov.addEventListener("click",e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
  activate(sources[0]); ta.focus();
}
function setPhaseGroup(p,v){ if(applyPhaseGroup(state.model, p, v)) refreshView().then(()=>selectPhase(state.selected)); }
function cur(){ return (state.model.phases||[]).find(x=>x.id===state.selected); }
function toggleDep(dep,on){ const p=cur(); if(!p)return; p.depends_on=p.depends_on||[];
  if(on){ if(!p.depends_on.includes(dep)) p.depends_on.push(dep);} else p.depends_on=p.depends_on.filter(d=>d!==dep);
  refreshView().then(()=>selectPhase(state.selected)); }
function renamePhase(newId){ const p=cur(); if(!p||!newId||newId===p.id)return;
  const old=p.id; (state.model.phases||[]).forEach(x=>{if(x.depends_on)x.depends_on=x.depends_on.map(d=>d===old?newId:d);});
  p.id=newId; state.selected=newId; refreshView().then(()=>selectPhase(newId)); }
function uniqueId(base){ const ids=new Set((state.model.phases||[]).map(p=>p.id));
  if(!ids.has(base))return base; let n=2; while(ids.has(base+"-"+n))n++; return base+"-"+n; }
function addPhase(){ if(!state.model)return;
  const id=uniqueId("NEW-PHASE"); const group=Object.keys(state.model.groups||{})[0]||"setup";
  state.model.phases=state.model.phases||[]; state.model.phases.push({id,name:"New phase",group,type:"agent",depends_on:[]});
  refreshView().then(()=>selectPhase(id)); }
function deletePhase(){ const p=cur(); if(!p)return; if(!confirm("Delete "+p.id+"?"))return;
  const id=p.id; state.model.phases=state.model.phases.filter(x=>x.id!==id);
  (state.model.phases||[]).forEach(x=>{if(x.depends_on)x.depends_on=x.depends_on.filter(d=>d!==id);});
  state.selected=null; $('#edit-panel').hidden=true; refreshView(); }

function renderYaml(){ $('#yaml-src').textContent=JSON.stringify(state.model,null,2); }

// ---- Dataflow (lazy mermaid) ----------------------------------------------
let _mermaidLoad=null;
function ensureMermaid(){
  if(window.mermaid) return Promise.resolve(true);
  if(_mermaidLoad) return _mermaidLoad;
  _mermaidLoad=new Promise(resolve=>{
    const s=document.createElement("script"); s.src="/editor/mermaid.min.js";
    s.onload=()=>{ try{ window.mermaid.initialize({startOnLoad:false,theme:"dark",securityLevel:"loose"}); }catch(e){} resolve(!!window.mermaid); };
    s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
  return _mermaidLoad;
}
function stripFence(s){ return String(s||"").replace(/^\s*```mermaid\s*/i,"").replace(/```\s*$/,"").trim(); }
async function renderDataflow(){
  const el=$('#dataflow-render'); if(!el) return;
  const {j}=await api('POST','/api/preview',state.model);
  const src=stripFence(j.dataflow);
  if(!src){ el.textContent="(dataflow unavailable for this model)"; return; }
  const ok=await ensureMermaid();
  if(!ok){ el.replaceChildren(); const pre=document.createElement("pre"); pre.textContent=src; el.appendChild(pre);
    el.appendChild(helpNote("mermaid not loaded (offline?). Plain-text diagram above.")); return; }
  try{ const {svg}=await window.mermaid.render("dfg"+(state._dfgN=(state._dfgN||0)+1), src); el.innerHTML=svg; }
  catch(e){ el.replaceChildren(); const pre=document.createElement("pre"); pre.textContent=src; el.appendChild(pre);
    el.appendChild(helpNote("mermaid: "+(e&&e.message||e))); }
}

function renderSettings(){
  const root=$('#settings'); if(!root||!state.model)return; root.replaceChildren();
  const m=state.model; m.skill=m.skill||{};
  const sec=t=>{const h=document.createElement("h3"); h.className="settings-h"; h.textContent=t; root.appendChild(h);};
  sec("skill");
  root.appendChild(fieldText("name", m.skill.name||"", v=>{m.skill.name=v;}));
  root.appendChild(fieldTextarea("description", m.skill.description||"", v=>{m.skill.description=v;}));
  root.appendChild(fieldText("title", m.skill.title||"", v=>{ if(v) m.skill.title=v; else delete m.skill.title; }));
  sec("groups");
  m.groups=m.groups||{};
  Object.keys(m.groups).forEach(g=>{
    const box=document.createElement("div"); box.className="settings-row";
    const nm=document.createElement("input"); nm.value=g;
    nm.addEventListener("change",()=>{ if(nm.value&&nm.value!==g){ m.groups[nm.value]=m.groups[g]; delete m.groups[g]; (m.phases||[]).forEach(p=>{if(p.group===g)p.group=nm.value;}); renderSettings(); refreshView(); } });
    box.appendChild(nm);
    box.appendChild(fieldText("description", m.groups[g].description||"", v=>{m.groups[g].description=v;}));
    box.appendChild(fieldSelect("risk", m.groups[g].risk||"none", ["none","low","medium","high"], v=>{m.groups[g].risk=v;}));
    const del=document.createElement("button"); del.textContent="✕ group"; del.addEventListener("click",()=>{ delete m.groups[g]; renderSettings(); refreshView(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addG=document.createElement("button"); addG.textContent="+ group"; addG.addEventListener("click",()=>{ let n="group",i=1; while(m.groups[n])n="group"+(++i); m.groups[n]={description:""}; renderSettings(); refreshView(); }); root.appendChild(addG);
  sec("conditions");
  m.conditions=m.conditions||{};
  Object.keys(m.conditions).forEach(c=>{
    const box=document.createElement("div"); box.className="settings-row";
    const nm=document.createElement("input"); nm.value=c;
    nm.addEventListener("change",()=>{ if(nm.value&&nm.value!==c){ m.conditions[nm.value]=m.conditions[c]; delete m.conditions[c]; renderSettings(); } });
    box.appendChild(nm);
    box.appendChild(fieldSelect("check", m.conditions[c].check||"file_exists", ["file_missing","file_exists","dir_missing","dir_exists"], v=>{m.conditions[c].check=v;}));
    box.appendChild(fieldText("path", m.conditions[c].path||"", v=>{ if(v) m.conditions[c].path=v; else delete m.conditions[c].path; }));
    const del=document.createElement("button"); del.textContent="✕ condition"; del.addEventListener("click",()=>{ delete m.conditions[c]; renderSettings(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addC=document.createElement("button"); addC.textContent="+ condition"; addC.addEventListener("click",()=>{ let n="cond",i=1; while(m.conditions[n])n="cond"+(++i); m.conditions[n]={check:"file_exists"}; renderSettings(); }); root.appendChild(addC);
  sec("on_demand_agents");
  m.on_demand_agents=m.on_demand_agents||[];
  m.on_demand_agents.forEach((od,idx)=>{
    const box=document.createElement("div"); box.className="settings-row";
    box.appendChild(fieldSelect("agent", od.agent||"", ["", ...(state.agents||[])], v=>{od.agent=v;}));
    box.appendChild(fieldText("description", od.description||"", v=>{od.description=v;}));
    box.appendChild(fieldSelect("model", od.model||"inherit", ["inherit","haiku","sonnet","opus"], v=>{od.model=v;}));
    box.appendChild(fieldText("when", od.when||"", v=>{ if(v) od.when=v; else delete od.when; }));
    const del=document.createElement("button"); del.textContent="✕"; del.addEventListener("click",()=>{ m.on_demand_agents.splice(idx,1); renderSettings(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addO=document.createElement("button"); addO.textContent="+ on-demand agent"; addO.addEventListener("click",()=>{ m.on_demand_agents.push({agent:(state.agents||[])[0]||"",description:""}); renderSettings(); }); root.appendChild(addO);
}

async function save(){
  const {status,j}=await api('PUT','/api/workflow/'+state.name,{model:state.model});
  setStatus(status===200?'✓ saved':'✗ '+((j.errors||[]).join('; ')||'error'));
  if(status===200) loadWorkflow(state.name);
}
async function newWf(){ const name=prompt('Workflow name (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name});
  if(status===200){await loadList(); $('#wf-select').value=name; loadWorkflow(name);} else alert((j.errors||['error']).join('; ')); }
async function cloneWf(){ const {j:list}=await api('GET','/api/workflows');
  const from=prompt('Duplicate from?\n('+list.join(', ')+')',state.name); if(!from)return;
  const name=prompt('Name of the copy (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name,from});
  if(status===200){await loadList(); $('#wf-select').value=name; loadWorkflow(name);} else alert((j.errors||['error']).join('; ')); }

window.addEventListener("resize",()=>{ if(state.view) drawEdges(); });
document.addEventListener('DOMContentLoaded',()=>{
  loadList();
  $('#wf-select').addEventListener('change',e=>loadWorkflow(e.target.value));
  $('#wf-new').addEventListener('click',newWf);
  $('#wf-clone').addEventListener('click',cloneWf);
  $('#add-phase').addEventListener('click',addPhase);
  $('#add-agent').addEventListener('click',openAgentForm);
  $('#wf-save').addEventListener('click',save);
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); $('#panel-'+t.dataset.tab).classList.add('active');
    if(t.dataset.tab==='grid' && state.view) drawEdges();
    if(t.dataset.tab==='settings') renderSettings();
    if(t.dataset.tab==='dataflow') renderDataflow();
  }));
});
