// Outil « Bêta Notes » : notes Markdown avec cases à cocher, dossiers, épingles.
import { $, $$, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";
import { marked } from "../../vendor/marked.esm.js";
import DOMPurify from "../../vendor/purify.es.mjs";

const COLORS = ["", "bleu", "vert", "jaune", "rouge", "violet"];
let notes = [], cur = null, view = "all", q = "", mode = "edit", saveTimer = null;
try { mode = localStorage.getItem("bt-notes-mode") || "edit"; } catch {}

export async function render(root, parts) {
  if (!root.querySelector(".nt")) {
    root.innerHTML = pageHead("notes", `<button class="btn" id="nt-new">${icon("plus")}Nouvelle note</button>`) + `
      <div class="nt">
        <aside class="nt-side card" id="nt-side"></aside>
        <section class="nt-list card"><input type="text" id="nt-q" placeholder="Rechercher dans les notes…"><div id="nt-items"></div></section>
        <section class="nt-editor card" id="nt-editor"></section>
      </div>`;
    $("#nt-new").onclick = () => create();
    $("#nt-q").oninput = e => { q = e.target.value.toLowerCase(); drawList(); };
    $("#nt-side").onclick = e => { const v = e.target.closest("[data-view]"); if (v) { view = v.dataset.view; drawSide(); drawList(); } };
    $("#nt-items").onclick = e => { const it = e.target.closest("[data-id]"); if (it) location.hash = "#/notes/" + it.dataset.id; };
  }
  await flushNow();
  notes = await api("/api/notes");
  if (parts[0] === "nouvelle") return create();
  cur = notes.find(n => n.id === parts[0]) || null;
  root.querySelector(".nt").classList.toggle("open", !!cur);
  drawSide();
  drawList();
  drawEditor();
}

const folders = () => [...new Set(notes.filter(n => !n.trashed && n.folder).map(n => n.folder))].sort((a, b) => a.localeCompare(b, "fr"));

function drawSide() {
  const count = f => notes.filter(f).length;
  const item = (v, ic, label, n) => `<button class="nt-v ${view === v ? "on" : ""}" data-view="${esc(v)}">${icon(ic)}<span>${esc(label)}</span><small>${n}</small></button>`;
  $("#nt-side").innerHTML = item("all", "notebook", "Toutes les notes", count(n => !n.trashed))
    + item("pinned", "pin", "Épinglées", count(n => n.pinned && !n.trashed))
    + item("tasks", "check", "Avec des tâches", count(n => !n.trashed && /- \[ \]/.test(n.body)))
    + `<div class="nav-label">Dossiers</div>` + (folders().map(f => item("f:" + f, "folder", f, count(n => n.folder === f && !n.trashed))).join("") || `<p class="hint" style="padding:0 10px">Aucun dossier</p>`)
    + `<div class="nav-label">&nbsp;</div>` + item("trash", "trash", "Corbeille", count(n => n.trashed));
}

function visibleNotes() {
  return notes.filter(n => {
    if (view === "trash" ? !n.trashed : n.trashed) return false;
    if (view === "pinned" && !n.pinned) return false;
    if (view === "tasks" && !/- \[ \]/.test(n.body)) return false;
    if (view.startsWith("f:") && n.folder !== view.slice(2)) return false;
    return !q || (n.title + " " + n.body).toLowerCase().includes(q);
  });
}

function drawList() {
  const list = visibleNotes();
  $("#nt-items").innerHTML = list.length ? list.map(n => {
    const done = (n.body.match(/- \[x\]/gi) || []).length, todo = (n.body.match(/- \[ \]/g) || []).length;
    return `<button class="nt-item c-${n.color || "none"} ${cur?.id === n.id ? "on" : ""}" data-id="${n.id}">
      <b>${n.pinned ? icon("pin") : ""}${esc(n.title || "Sans titre")}</b>
      <span>${esc(n.body.replace(/[#*_>`\[\]-]/g, "").slice(0, 110)) || "Note vide"}</span>
      <small>${ago(n.updated)}${n.folder ? " · " + esc(n.folder) : ""}${todo + done ? ` · ☑ ${done}/${todo + done}` : ""}</small></button>`;
  }).join("") : `<div class="empty">${icon("notebook")}${view === "trash" ? "La corbeille est vide." : "Aucune note ici."}</div>`;
}

function drawEditor() {
  const ed = $("#nt-editor");
  if (!cur) {
    ed.innerHTML = `<div class="empty" style="height:100%">${icon("notebook")}<b>Choisis une note</b>ou crée-en une nouvelle.<button class="btn small" id="nt-new2">${icon("plus")}Nouvelle note</button></div>`;
    $("#nt-new2").onclick = () => create();
    return;
  }
  ed.innerHTML = `<div class="nt-bar">
      <a class="icon-btn plain nt-back" href="#/notes" title="Retour">${icon("back")}</a>
      <button class="icon-btn plain" data-md="**" title="Gras"><b>B</b></button>
      <button class="icon-btn plain" data-md="_" title="Italique"><i>I</i></button>
      <button class="icon-btn plain" data-md="# " title="Titre"><b>H</b></button>
      <button class="icon-btn plain" data-md="- " title="Liste">${icon("list")}</button>
      <button class="icon-btn plain" data-md="- [ ] " title="Case à cocher">${icon("check")}</button>
      <button class="icon-btn plain" data-md="link" title="Lien">${icon("link")}</button>
      <span class="grow"></span>
      <div class="seg mini">${[["edit", "Écrire"], ["split", "Les deux"], ["preview", "Lire"]].map(([m, l]) => `<label><input type="radio" name="nt-mode" value="${m}" ${mode === m ? "checked" : ""}>${l}</label>`).join("")}</div>
      <button class="icon-btn plain ${cur.pinned ? "on" : ""}" data-a="pin" title="Épingler">${icon("pin")}</button>
      <button class="icon-btn plain" data-a="more" title="Plus">${icon("dots")}</button>
    </div>
    <input type="text" class="nt-title" id="nt-title" value="${esc(cur.title)}" placeholder="Titre" ${cur.trashed ? "disabled" : ""}>
    <div class="nt-body mode-${mode}">
      <textarea id="nt-text" placeholder="Écris ici… (Markdown : # titre, **gras**, - [ ] tâche)" ${cur.trashed ? "disabled" : ""}>${esc(cur.body)}</textarea>
      <div class="md" id="nt-preview"></div>
    </div>
    <div class="nt-foot meta" id="nt-status">Modifiée ${ago(cur.updated)}</div>`;
  preview();
  $("#nt-title").oninput = e => { cur.title = e.target.value; save({ title: cur.title }); };
  $("#nt-text").oninput = e => { cur.body = e.target.value; preview(); save({ body: cur.body }); };
  ed.querySelectorAll("[name=nt-mode]").forEach(r => r.onchange = () => {
    mode = r.value;
    try { localStorage.setItem("bt-notes-mode", mode); } catch {}
    ed.querySelector(".nt-body").className = "nt-body mode-" + mode;
  });
  ed.querySelectorAll("[data-md]").forEach(b => b.onclick = () => format(b.dataset.md));
  ed.querySelector("[data-a=pin]").onclick = () => { cur.pinned = !cur.pinned; save({ pinned: cur.pinned }, true); drawEditor(); };
  ed.querySelector("[data-a=more]").onclick = more;
  $("#nt-preview").onclick = e => {
    const box = e.target.closest("input[type=checkbox]");
    if (!box) return;
    // Cocher dans l'aperçu modifie la case correspondante dans le texte
    const i = [...$("#nt-preview").querySelectorAll("input[type=checkbox]")].indexOf(box);
    let n = -1;
    cur.body = cur.body.replace(/- \[( |x|X)\]/g, (m, c) => (++n === i ? (c === " " ? "- [x]" : "- [ ]") : m));
    $("#nt-text").value = cur.body;
    preview();
    save({ body: cur.body });
  };
}

function preview() {
  const html = DOMPurify.sanitize(marked.parse(cur.body || "", { gfm: true, breaks: true }));
  $("#nt-preview").innerHTML = html.replace(/<input disabled="" type="checkbox"/g, '<input type="checkbox"').replace(/<input checked="" disabled="" type="checkbox"/g, '<input checked type="checkbox"');
  $("#nt-preview").querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
}

function format(md) {
  const t = $("#nt-text");
  const [s, e] = [t.selectionStart, t.selectionEnd];
  const sel = t.value.slice(s, e);
  let ins;
  if (md === "link") ins = `[${sel || "texte"}](https://)`;
  else if (md.endsWith(" ")) { const lineStart = t.value.lastIndexOf("\n", s - 1) + 1; t.setRangeText(md, lineStart, lineStart, "end"); t.dispatchEvent(new Event("input")); t.focus(); return; }
  else ins = `${md}${sel || "texte"}${md}`;
  t.setRangeText(ins, s, e, "end");
  t.dispatchEvent(new Event("input"));
  t.focus();
}

let flush = null;
function save(patch, now = false) {
  $("#nt-status") && ($("#nt-status").textContent = "Enregistrement…");
  clearTimeout(saveTimer);
  // Contenu figé maintenant : si on change de note avant l'envoi, on n'écrit pas dans la mauvaise
  const id = cur.id, payload = { title: cur.title, body: cur.body, ...patch };
  const go = async () => {
    flush = null;
    try {
      const n = await api(`/api/notes/${id}`, { method: "PUT", json: payload });
      const i = notes.findIndex(x => x.id === id);
      if (i >= 0) notes[i] = { ...notes[i], ...n };
      if (cur?.id === id && $("#nt-status")) $("#nt-status").textContent = "Enregistrée";
      drawList();
      drawSide();
    } catch (e) { toast(e.message, "err"); }
  };
  flush = go;
  now ? go() : (saveTimer = setTimeout(go, 500));
}

/** Envoie tout de suite l'enregistrement en attente (changement de note, départ de la page). */
async function flushNow() {
  clearTimeout(saveTimer);
  if (flush) await flush();
}

async function create() {
  const n = await api("/api/notes", { json: { folder: view.startsWith("f:") ? view.slice(2) : "" } });
  notes.unshift(n);
  location.hash = "#/notes/" + n.id;
  setTimeout(() => $("#nt-title")?.focus(), 150);
}

function more() {
  const m = modal("Note", `
    <label class="field">Dossier</label>
    <input type="text" id="nt-folder" list="nt-folders" value="${esc(cur.folder)}" placeholder="Aucun (ex. Travail, Courses…)">
    <datalist id="nt-folders">${folders().map(f => `<option value="${esc(f)}">`).join("")}</datalist>
    <label class="field" style="margin-top:14px">Couleur</label>
    <div class="nt-colors">${COLORS.map(c => `<button class="nt-c c-${c || "none"} ${cur.color === c ? "on" : ""}" data-c="${c}" title="${c || "aucune"}"></button>`).join("")}</div>
    <div class="modal-foot">
      <button class="btn ghost" data-a="dl">${icon("download")}Exporter (.md)</button>
      ${cur.trashed ? `<button class="btn ghost" data-a="restore">${icon("undo")}Restaurer</button><button class="btn danger" data-a="kill">${icon("trash")}Supprimer définitivement</button>`
        : `<button class="btn danger" data-a="trash">${icon("trash")}Mettre à la corbeille</button>`}
      <button class="btn" data-close>OK</button>
    </div>`, { ic: "notebook" });
  m.querySelector("#nt-folder").onchange = e => { cur.folder = e.target.value.trim(); save({ folder: cur.folder }, true); };
  m.querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    cur.color = b.dataset.c;
    m.querySelectorAll("[data-c]").forEach(x => x.classList.toggle("on", x === b));
    save({ color: cur.color }, true);
  });
  m.querySelector("[data-a=dl]").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`# ${cur.title}\n\n${cur.body}`], { type: "text/markdown" }));
    a.download = (cur.title || "note").replace(/[\\/:*?"<>|]/g, "_") + ".md";
    a.click();
  };
  m.querySelector("[data-a=trash]")?.addEventListener("click", async () => { await api(`/api/notes/${cur.id}`, { method: "PUT", json: { trashed: true } }); closePanel(); toast("Note mise à la corbeille"); location.hash = "#/notes"; });
  m.querySelector("[data-a=restore]")?.addEventListener("click", async () => { await api(`/api/notes/${cur.id}`, { method: "PUT", json: { trashed: false } }); closePanel(); render($("#dyn-root"), [cur.id]); });
  m.querySelector("[data-a=kill]")?.addEventListener("click", async () => { await api(`/api/notes/${cur.id}`, { method: "DELETE" }); closePanel(); location.hash = "#/notes"; });
}

export function leave() { flushNow(); }
