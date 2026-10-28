// Outil « Tâches » : listes perso et partagées, tâches confiées, dates et répétitions.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

const COLORS = ["bleu", "vert", "ambre", "rose", "violet", "bleu-vert"];
const ICONS = ["check", "home", "user", "cart", "briefcase", "heart", "star", "car", "utensils", "sparkles", "calendar", "tag"];
const TODAY = "__today__", MINE = "__mine__";
let info = null, cur = null, items = [], showDone = false;

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());

function dueLabel(due) {
  if (!due) return "";
  const t = today(), tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (due === t) return "Aujourd'hui";
  if (due === iso(tm)) return "Demain";
  const d = new Date(due + "T12:00");
  const s = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return due < t ? `En retard · ${s}` : s;
}

export async function render(root, parts) {
  root.innerHTML = pageHead("taches", `<button class="btn" id="tk-newlist">${icon("plus")}Nouvelle liste</button>`)
    + `<div class="tk-layout"><aside class="card tk-side" id="tk-side"></aside><section class="card tk-main" id="tk-main"></section></div>`;
  $("#tk-newlist").onclick = () => listPanel();
  info = await api("/api/tasks");
  cur = parts[0] || TODAY;
  if (cur !== TODAY && cur !== MINE && !info.lists.some(l => l.id === cur)) cur = TODAY;
  await open(cur);
}

function paintSide() {
  const side = $("#tk-side");
  if (!side) return;
  const btn = (id, name, ic, tile, n, late, sub = "") => `<button class="ml-folder ${cur === id ? "on" : ""}" data-l="${id}">
    <span class="tk-dot tile ${tile}">${icon(ic)}</span><span class="grow">${esc(name)}${sub ? ` <small class="meta">${sub}</small>` : ""}</span>
    ${n ? `<span class="count ${late ? "late" : ""}">${n}</span>` : ""}</button>`;
  side.innerHTML = btn(TODAY, "Aujourd'hui", "sun", "ambre", 0, false) + (info.members.length > 1 ? btn(MINE, "Pour moi", "user", "violet", 0, false) : "")
    + `<p class="meta tk-sep">Listes</p>` + info.lists.map(l => btn(l.id, l.name, l.icon || "check", l.color, l.count, l.late, l.shared ? "· partagée" : "")).join("");
  side.onclick = e => { const b = e.target.closest("[data-l]"); if (b) open(b.dataset.l); };
}

async function open(id) {
  cur = id;
  history.replaceState(null, "", `#/taches${id === TODAY ? "" : "/" + id}`);
  paintSide();
  if (id === TODAY || id === MINE) {
    const all = await Promise.all(info.lists.map(l => api(`/api/tasks/${l.id}`)));
    items = all.flatMap(l => l.items.map(i => ({ ...i, list: l.id, listName: l.name })));
    items = id === TODAY ? items.filter(i => !i.done && i.due && i.due <= today() && (!i.assignee || i.assignee === info.me))
      : items.filter(i => i.assignee === info.me);
  } else {
    items = (await api(`/api/tasks/${id}`)).items.map(i => ({ ...i, list: id }));
  }
  paint();
}

function itemHTML(i) {
  const late = !i.done && i.due && i.due < today();
  return `<div class="tk-item ${i.done ? "done" : ""}" data-i="${i.id}" data-list="${i.list}">
    <button class="tk-check" data-done title="${i.done ? "Pas encore fait" : "C'est fait"}">${i.done ? icon("check") : ""}</button>
    <div class="grow tk-text"><span>${esc(i.text)}</span>
      <small class="tk-meta">${i.listName && cur !== i.list ? `<span>${esc(i.listName)}</span>` : ""}
        ${i.due ? `<span class="${late ? "late" : ""}">${icon("calendar")}${esc(dueLabel(i.due))}</span>` : ""}
        ${i.repeat ? `<span>${icon("refresh")}${esc(info.repeats[i.repeat])}</span>` : ""}
        ${i.assignee && info.members.length > 1 ? `<span>${icon("user")}${esc(i.assignee === info.me ? "Moi" : i.assignee)}</span>` : ""}
        ${i.notes ? `<span>${icon("notebook")}Note</span>` : ""}
        ${i.done && i.done_by && info.members.length > 1 ? `<span>fait par ${esc(i.done_by)}</span>` : ""}</small></div>
    <button class="icon-btn plain tk-star ${i.star ? "on" : ""}" data-star title="Important">${icon("star")}</button></div>`;
}

function paint() {
  const main = $("#tk-main");
  if (!main) return;
  const lst = info.lists.find(l => l.id === cur);
  const todo = items.filter(i => !i.done).sort((a, b) => (b.star || 0) - (a.star || 0) || (a.due || "9999").localeCompare(b.due || "9999"));
  const done = items.filter(i => i.done);
  const title = cur === TODAY ? "Aujourd'hui" : cur === MINE ? "Pour moi" : lst.name;
  main.innerHTML = `<div class="tk-head"><h2 class="grow">${esc(title)}</h2>
      ${lst ? `<button class="icon-btn plain" id="tk-editlist" title="Modifier la liste">${icon("settings")}</button>` : ""}</div>
    ${lst ? `<form class="tk-add" id="tk-add"><input type="text" name="text" placeholder="Ajouter une tâche… (Entrée)" autocomplete="off" maxlength="300">
      <input type="date" name="due" title="Pour quand ?">
      ${info.members.length > 1 ? `<select name="assignee" title="Pour qui ?"><option value="">Tout le monde</option>${info.members.map(m => `<option value="${esc(m)}">${esc(m === info.me ? "Moi" : m)}</option>`).join("")}</select>` : ""}
      <select name="repeat" title="Répéter">${Object.entries(info.repeats).map(([k, v]) => `<option value="${k}">${k ? v : "Une fois"}</option>`).join("")}</select>
      <button class="btn">${icon("plus")}<span class="hide-sm">Ajouter</span></button></form>` : ""}
    <div class="tk-items">${todo.map(itemHTML).join("") || `<div class="empty">${icon(cur === TODAY ? "sun" : "check")}<b>${cur === TODAY ? "Rien de prévu aujourd'hui" : "Tout est fait !"}</b>${cur === TODAY ? "Les tâches avec une date d'aujourd'hui ou en retard s'affichent ici." : "Ajoute une tâche juste au-dessus."}</div>`}</div>
    ${done.length ? `<button class="btn ghost small" id="tk-done">${icon("check")}${showDone ? "Masquer" : "Voir"} les tâches faites (${done.length})</button>
      ${showDone ? `<div class="tk-items">${done.map(itemHTML).join("")}</div><button class="btn ghost small" id="tk-clear">${icon("trash")}Effacer les tâches faites</button>` : ""}` : ""}`;
  const f = $("#tk-add");
  if (f) {
    f.onsubmit = async e => {
      e.preventDefault();
      if (!f.text.value.trim()) return;
      try {
        const it = await api(`/api/tasks/${cur}/items`, { json: { text: f.text.value, due: f.due.value, assignee: f.assignee?.value || "", repeat: f.repeat.value } });
        items.unshift({ ...it, list: cur });
        f.text.value = ""; f.due.value = ""; f.repeat.value = "";
        refreshCounts(); paint(); $("#tk-add [name=text]").focus();
      } catch (err) { toast(err.message, "err"); }
    };
  }
  $("#tk-editlist")?.addEventListener("click", () => listPanel(lst));
  $("#tk-done")?.addEventListener("click", () => { showDone = !showDone; paint(); });
  $("#tk-clear")?.addEventListener("click", async () => { await api(`/api/tasks/${cur}`, { method: "PUT", json: { clear_done: true } }); items = items.filter(i => !i.done); paint(); });
  main.onclick = onItemClick;
}

async function onItemClick(e) {
  const row = e.target.closest(".tk-item");
  if (!row) return;
  const it = items.find(i => i.id === row.dataset.i);
  if (e.target.closest("[data-done]")) {
    row.classList.add("leaving");
    const r = await api(`/api/tasks/${it.list}/items/${it.id}`, { method: "PUT", json: { done: !it.done } });
    Object.assign(it, r.item);
    if (r.next) { items.unshift({ ...r.next, list: it.list, listName: it.listName }); toast(`Prochaine fois : ${dueLabel(r.next.due).toLowerCase()}`); }
    if (cur === TODAY) items = items.filter(i => !i.done && i.due <= today());
    refreshCounts();
    return setTimeout(paint, 180);
  }
  if (e.target.closest("[data-star]")) {
    const r = await api(`/api/tasks/${it.list}/items/${it.id}`, { method: "PUT", json: { star: !it.star } });
    Object.assign(it, r.item); return paint();
  }
  edit(it);
}

async function refreshCounts() {
  info = { ...info, ...(await api("/api/tasks")) };
  paintSide();
}

function edit(it) {
  const m = modal("Tâche", `<form>
    <label class="field">Tâche</label><input type="text" name="text" value="${esc(it.text)}" required maxlength="300">
    <div class="grid2"><div><label class="field">Pour quand</label><input type="date" name="due" value="${esc(it.due || "")}"></div>
      <div><label class="field">Répéter</label><select name="repeat" style="width:100%">${Object.entries(info.repeats).map(([k, v]) => `<option value="${k}" ${k === (it.repeat || "") ? "selected" : ""}>${k ? v : "Une fois"}</option>`).join("")}</select></div></div>
    ${info.members.length > 1 ? `<label class="field">Qui s'en occupe</label><select name="assignee" style="width:100%"><option value="">Tout le monde</option>
      ${info.members.map(x => `<option value="${esc(x)}" ${x === it.assignee ? "selected" : ""}>${esc(x === info.me ? "Moi" : x)}</option>`).join("")}</select>` : ""}
    <label class="field">Notes</label><textarea name="notes" rows="3" placeholder="Détails, lien, code de la porte…">${esc(it.notes || "")}</textarea>
    <label class="field">Liste</label><select name="list" style="width:100%">${info.lists.map(l => `<option value="${l.id}" ${l.id === it.list ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
    <div class="modal-foot"><button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "check" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const data = { text: f.text.value, due: f.due.value, repeat: f.repeat.value, notes: f.notes.value, assignee: f.assignee?.value || "" };
    try {
      if (f.list.value !== it.list) {  // changer de liste : on recrée la tâche dans l'autre liste
        await api(`/api/tasks/${f.list.value}/items`, { json: { ...data, star: it.star } });
        await api(`/api/tasks/${it.list}/items/${it.id}`, { method: "DELETE" });
      } else {
        await api(`/api/tasks/${it.list}/items/${it.id}`, { method: "PUT", json: data });
      }
      closePanel(); refreshCounts(); open(cur);
    } catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]").onclick = async () => {
    await api(`/api/tasks/${it.list}/items/${it.id}`, { method: "DELETE" });
    closePanel(); items = items.filter(i => i.id !== it.id); refreshCounts(); paint();
  };
}

function listPanel(lst) {
  const color = lst?.color || "bleu", ic = lst?.icon || "check";
  const m = modal(lst ? "Modifier la liste" : "Nouvelle liste", `<form>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(lst?.name || "")}" required maxlength="60" placeholder="Ex. Ménage, Bricolage, Vacances">
    <label class="field">Couleur</label><div class="tk-pick">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${c === color ? "checked" : ""}><span class="tile ${c}"></span></label>`).join("")}</div>
    <label class="field">Icône</label><div class="tk-pick">${ICONS.map(i => `<label><input type="radio" name="icon" value="${i}" ${i === ic ? "checked" : ""}><span class="tile">${icon(i)}</span></label>`).join("")}</div>
    ${!lst || lst.mine ? `<label class="check"><input type="checkbox" name="shared" ${lst?.shared ? "checked" : ""}> Partager avec toute la maison</label>
      <p class="hint">Une liste partagée est visible et modifiable par tous les comptes de Bêta Tool. Tu peux confier chaque tâche à quelqu'un : il reçoit une notification.</p>` : `<p class="hint">Liste partagée par ${esc(lst.owner)}.</p>`}
    <div class="modal-foot">${lst ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}${lst ? "Enregistrer" : "Créer"}</button></div></form>`, { ic: "check" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const data = { name: f.name.value, color: f.color.value, icon: f.icon.value, ...(f.shared ? { shared: f.shared.checked } : {}) };
    try {
      const r = lst ? await api(`/api/tasks/${lst.id}`, { method: "PUT", json: data }) : await api("/api/tasks", { json: data });
      closePanel(); await refreshCounts(); open(lst ? lst.id : r.id);
    } catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer la liste « ${lst.name} » et toutes ses tâches ?`)) return;
    try { await api(`/api/tasks/${lst.id}`, { method: "DELETE" }); closePanel(); await refreshCounts(); open(TODAY); } catch (err) { toast(err.message, "err"); }
  });
}
