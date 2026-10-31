// Blast Furnace web UI. Plain JavaScript, no build step.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STAGE_NAMES = { analyze: "Analyze", plan: "Plan", crossReview: "Cross review", merge: "Merge", approve: "Approve", execute: "Build", finalReview: "Final review" };

let current = null; // project id
let project = null;
let events = null;
let stages = [];

async function api(path, method = "GET", data) {
  const res = await fetch(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

function show(id) {
  for (const s of ["welcome", "new-form", "settings", "project"]) $(`#${s}`).hidden = s !== id;
}

async function loadList() {
  const list = await api("/projects");
  $("#project-list").innerHTML = list.map((p) =>
    `<li data-id="${p.id}" class="${p.id === current ? "on" : ""}"><span>${esc(p.name)}</span><span class="pill ${p.status}">${p.status}</span></li>`).join("");
  document.querySelectorAll("#project-list li").forEach((li) => (li.onclick = () => openProject(li.dataset.id)));
}

function openProject(id) {
  current = id;
  show("project");
  events?.close();
  events = new EventSource(`/api/projects/${id}/events`);
  events.onmessage = (e) => {
    const prev = project?.status;
    project = JSON.parse(e.data);
    render();
    if (prev !== project.status) loadList();
  };
  loadList();
}

// ------------------------------------------------------------------ render

function render() {
  const p = project;
  $("#p-name").textContent = p.name;
  $("#p-ws").textContent = p.workspace;
  const st = $("#p-status");
  st.textContent = p.status === "waiting" ? "waiting for you" : p.status;
  st.className = `badge ${p.status}`;
  $("#btn-start").textContent = p.completed.length ? "▶ Continue" : "▶ Start";
  $("#btn-start").disabled = p.running || p.status === "waiting" || p.status === "done";
  $("#btn-approve").hidden = p.status !== "waiting";
  $("#btn-stop").disabled = !p.running;
  $("#btn-redo").disabled = p.running;
  $("#error").hidden = !p.error;
  $("#error").textContent = p.error ?? "";

  $("#stages").innerHTML = stages.map((s) => {
    const cls = p.completed.includes(s) ? "done" : p.stage === s && (p.running || p.status === "waiting") ? "now" : "";
    return `<span class="${cls}">${STAGE_NAMES[s]}</span>`;
  }).join("");

  // Idea tab: don't overwrite what the user is typing.
  if (document.activeElement !== $("#idea")) $("#idea").value = p.idea;
  if (document.activeElement !== $("#brief")) $("#brief").value = p.brief ?? "";
  const chat = $("#chat");
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  chat.innerHTML = p.chat.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join("") || `<p class="muted">Ask anything about your idea. The model will poke holes in it and help you narrow it down.</p>`;
  if (atBottom) chat.scrollTop = chat.scrollHeight;

  renderPlans(p);
  renderBuild(p);
  renderLog(p);
  if (!$("#tab-steps").dataset.loaded || $("#tab-steps").dataset.loaded !== p.id) renderSteps(p);
}

function card(title, body, extra = "", open = false, cls = "") {
  return `<details class="card ${cls}" ${open ? "open" : ""}><summary><b>${title}</b>${extra}</summary><div class="body">${esc(body)}</div></details>`;
}

function renderPlans(p) {
  const openState = keepOpen("#tab-plans");
  let h = "";
  if (p.finalPlan) h += card("⭐ Final plan", p.finalPlan, `<span class="pill">${p.tasks.length} tasks</span>`, true, "final");
  for (const [k, v] of Object.entries(p.analyses)) h += card(`Analysis · ${esc(k)}`, v);
  for (const [k, v] of Object.entries(p.plans)) h += card(`Plan · ${esc(k)}`, v);
  for (const [k, v] of Object.entries(p.crossReviews)) h += card(`Review · ${esc(k)}`, v);
  for (const s of p.steps) if (p.stepOutputs[s.id]) h += card(`Step · ${esc(s.name)}`, p.stepOutputs[s.id]);
  $("#tab-plans").innerHTML = h || `<p class="muted">Nothing yet. Press Start and the two big models will analyze and plan your idea.</p>`;
  restoreOpen("#tab-plans", openState);
}

function renderBuild(p) {
  const openState = keepOpen("#tab-build");
  let h = p.tasks.map((t) => {
    const reviews = t.reviews.map((r, i) => `<b>Review ${i + 1} by ${esc(r.by)}: <span class="pill ${r.verdict}">${r.verdict}</span></b>\n${esc(r.text)}`).join("\n\n");
    const body = [
      `<b>Task</b>\n${esc(t.details)}`,
      t.acceptance.length ? `<b>Acceptance</b>\n${t.acceptance.map((a) => `• ${esc(a)}`).join("\n")}` : "",
      t.workReport ? `<b>Worker report (${esc(t.worker)})</b>\n${esc(t.workReport)}` : "",
      t.selfReview ? `<b>Self-review</b>\n${esc(t.selfReview)}` : "",
      reviews,
    ].filter(Boolean).join("\n\n");
    return `<details class="card"><summary><b>${esc(t.id)} · ${esc(t.title)}</b><span>${t.worker ? `<span class="muted">${esc(t.worker)}</span> ` : ""}<span class="pill ${t.status}">${t.status}</span></span></summary><div class="body">${body}</div></details>`;
  }).join("");
  if (p.finalReview) h = card("🏁 Final review", p.finalReview, "", true, "final") + h;
  $("#tab-build").innerHTML = h || `<p class="muted">Tasks show up here after the final plan is made.</p>`;
  restoreOpen("#tab-build", openState);
}

function renderLog(p) {
  $("#log").innerHTML = p.log.slice(-400).reverse().map((l) =>
    `<div class="${l.level}">${l.at.slice(11, 19)} ${l.who ? `[${esc(l.who)}] ` : ""}${esc(l.text)}</div>`).join("");
}

// Remember which cards were open (by title) so live updates don't fold them.
function keepOpen(sel) {
  const m = new Map();
  document.querySelectorAll(`${sel} details`).forEach((d) => m.set(d.querySelector("summary b").textContent, d.open));
  return m;
}
function restoreOpen(sel, state) {
  document.querySelectorAll(`${sel} details`).forEach((d) => {
    const k = d.querySelector("summary b").textContent;
    if (state.has(k)) d.open = state.get(k);
  });
}

// ------------------------------------------------------------------ custom steps

const ROLE_OPTS = ["thinkers", "merger", "reviewer", "workers", "chat"];
function stepRow(s = {}) {
  const div = document.createElement("div");
  div.className = "step";
  const opt = (list, v) => list.map((x) => `<option value="${x}" ${x === v ? "selected" : ""}>${STAGE_NAMES[x] ?? x}</option>`).join("");
  div.innerHTML = `
    <input class="s-name" placeholder="Step name" value="${esc(s.name ?? "")}" />
    <select class="s-when">${opt(["before", "after"], s.when ?? "after")}</select>
    <select class="s-stage">${opt(stages, s.stage ?? "execute")}</select>
    <select class="s-role">${opt(ROLE_OPTS, s.role ?? "reviewer")}</select>
    <select class="s-access">${opt(["read", "write"], s.access ?? "read")}</select>
    <button class="danger s-del">✕</button>
    <textarea class="s-prompt" rows="2" placeholder="What should this step do?">${esc(s.prompt ?? "")}</textarea>`;
  div.dataset.id = s.id ?? "";
  div.querySelector(".s-del").onclick = () => div.remove();
  return div;
}
function renderSteps(p) {
  $("#tab-steps").dataset.loaded = p.id;
  const list = $("#steps-list");
  list.innerHTML = "";
  p.steps.forEach((s) => list.appendChild(stepRow(s)));
}

// ------------------------------------------------------------------ wiring

$("#new-btn").onclick = () => { current = null; events?.close(); show("new-form"); loadList(); };
$("#nf-create").onclick = act(async () => {
  const p = await api("/projects", "POST", { idea: $("#nf-idea").value, name: $("#nf-name").value, workspace: $("#nf-ws").value });
  $("#nf-idea").value = $("#nf-name").value = "";
  openProject(p.id);
});
$("#settings-btn").onclick = act(async () => {
  const { config } = await api("/config");
  $("#settings-json").value = JSON.stringify(config, null, 2);
  show("settings");
});
$("#settings-save").onclick = act(async () => {
  await api("/config", "PUT", JSON.parse($("#settings-json").value));
  alert("Saved.");
});

$("#btn-start").onclick = act(() => api(`/projects/${current}/start`, "POST"));
$("#btn-approve").onclick = act(() => api(`/projects/${current}/approve`, "POST"));
$("#btn-redo").onclick = act(async () => {
  const st = $("#redo-stage").value;
  if (!confirm(`Clear "${STAGE_NAMES[st]}" and every stage after it? Their results will be deleted.`)) return;
  await api(`/projects/${current}/reset`, "POST", { stage: st });
});
$("#btn-stop").onclick = act(() => api(`/projects/${current}/stop`, "POST"));
$("#idea-save").onclick = act(() => api(`/projects/${current}/edit`, "POST", { idea: $("#idea").value }));
$("#brief-save").onclick = act(() => api(`/projects/${current}/edit`, "POST", { brief: $("#brief").value }));
$("#refine").onclick = act(() => api(`/projects/${current}/refine`, "POST"));
const sendChat = act(async () => {
  const msg = $("#chat-in").value.trim();
  if (!msg) return;
  $("#chat-in").value = "";
  await api(`/projects/${current}/chat`, "POST", { message: msg });
});
$("#chat-send").onclick = sendChat;
$("#chat-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } };

$("#step-add").onclick = () => $("#steps-list").appendChild(stepRow());
$("#steps-save").onclick = act(async () => {
  const steps = [...document.querySelectorAll("#steps-list .step")].map((d) => ({
    id: d.dataset.id, name: d.querySelector(".s-name").value, when: d.querySelector(".s-when").value,
    stage: d.querySelector(".s-stage").value, role: d.querySelector(".s-role").value,
    access: d.querySelector(".s-access").value, prompt: d.querySelector(".s-prompt").value,
  }));
  await api(`/projects/${current}/steps`, "POST", { steps });
  $("#tab-steps").dataset.loaded = "";
  alert("Steps saved.");
});

document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
}));

(async () => {
  const cfg = await api("/config");
  stages = cfg.stages;
  $("#redo-stage").innerHTML = stages.map((s) => `<option value="${s}">Redo from: ${STAGE_NAMES[s]}</option>`).join("");
  if (cfg.mock) $("#mode-note").innerHTML = `<p class="muted">Demo mode: fake models, no subscription used.</p>`;
  await loadList();
  setInterval(loadList, 5000);
})();
