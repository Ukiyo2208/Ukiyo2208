// Outil « Bêta Work » : gestion des documents + éditeur ONLYOFFICE intégré.
import { $, esc, icon, toast, modal, closePanel, sizeStr } from "./ui.js";

const KINDS = {
  word: { label: "Document", plural: "Documents", ic: "doc", cls: "w-word" },
  cell: { label: "Tableur", plural: "Tableurs", ic: "sheet", cls: "w-cell" },
  slide: { label: "Présentation", plural: "Présentations", ic: "slides", cls: "w-slide" },
  pdf: { label: "PDF", plural: "PDF", ic: "pdf", cls: "w-pdf" },
};
const POWERED = `<a class="powered" href="https://www.onlyoffice.com/" target="_blank" rel="noopener">Propulsé par <b>ONLYOFFICE Docs</b> · open source (AGPL v3)</a>`;
let docs = [];
let filter = { kind: "all", q: "" };
let status = null;
let editor = null;

// --- Liste des documents ------------------------------------------------------

export async function showHome() {
  closeEditor();
  const root = $("#work-root");
  if (!root.dataset.ready) {
    root.dataset.ready = "1";
    root.innerHTML = `
      <div id="work-status"></div>
      <div class="work-new">
        ${["word", "cell", "slide"].map(k => `
          <button class="card new ${KINDS[k].cls}" data-new="${k}">
            <span class="tile">${icon(KINDS[k].ic)}</span><b>${k === "slide" ? "Nouvelle" : "Nouveau"} ${KINDS[k].label.toLowerCase()}</b>
            <small>${{ word: "Lettres, rapports, CV…", cell: "Budgets, tableaux, calculs…", slide: "Diaporamas, exposés…" }[k]}</small>
          </button>`).join("")}
        <label class="card new w-up">
          <input type="file" hidden multiple accept=".docx,.doc,.odt,.rtf,.txt,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp,.pdf">
          <span class="tile">${icon("upload")}</span><b>Importer</b><small>Word, Excel, PowerPoint, PDF…</small>
        </label>
      </div>
      <div class="card">
        <div class="row" style="margin:0 0 6px">
          <div class="card-title" style="margin:0">Mes documents</div>
          <div class="seg" id="work-filter" style="margin-left:auto">
            <label><input type="radio" name="wk" value="all" checked>Tous</label>
            ${Object.entries(KINDS).map(([k, v]) => `<label><input type="radio" name="wk" value="${k}">${v.plural}</label>`).join("")}
          </div>
        </div>
        <input type="text" id="work-search" placeholder="Rechercher un document…" style="margin:8px 0 6px">
        <div id="work-list"></div>
      </div>
      <div class="powered-wrap">${POWERED}</div>`;
    root.querySelectorAll("[data-new]").forEach(b => b.onclick = () => askName(b.dataset.new));
    root.querySelector(".w-up input").onchange = e => upload([...e.target.files]);
    $("#work-filter").onchange = e => { filter.kind = e.target.value; list(); };
    $("#work-search").oninput = e => { filter.q = e.target.value.toLowerCase(); list(); };
    $("#work-list").addEventListener("click", onAction);
  }
  refresh();
  status = await (await fetch("/api/work/status")).json().catch(() => ({ ready: false, reason: "offline" }));
  $("#work-status").innerHTML = status.ready ? "" : `
    <div class="intro" style="border-color:rgb(240 169 43 / .5);background:linear-gradient(90deg,rgb(240 169 43 / .12),transparent)">
      <span class="tile ambre">${icon("alert")}</span>
      <p><b>L'éditeur n'est pas encore démarré.</b> ${status.reason === "secret"
        ? "Renseigne ONLYOFFICE_JWT_SECRET dans le fichier .env puis relance le conteneur."
        : "Le service ONLYOFFICE ne répond pas : il met 1 à 2 minutes à démarrer, ou il n'est pas activé (voir le README, « Bêta Work »)."}
      Tu peux quand même gérer tes fichiers.</p>
    </div>`;
}

async function refresh() {
  docs = await (await fetch("/api/work/docs")).json().catch(() => []);
  list();
}

const ago = t => {
  const s = Date.now() / 1000 - t;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
};

function list() {
  const shown = docs.filter(d => (filter.kind === "all" || d.kind === filter.kind) && (!filter.q || d.name.toLowerCase().includes(filter.q)));
  $("#work-list").innerHTML = shown.length ? shown.map(d => `
    <div class="doc ${KINDS[d.kind].cls}" data-id="${d.id}">
      <a class="doc-main" href="#/work/${d.id}">
        <span class="tile">${icon(KINDS[d.kind].ic)}</span>
        <span class="doc-name"><b>${esc(d.name)}</b><small>${d.folder ? esc(d.folder) + " · " : ""}${ago(d.modified)} · ${sizeStr(d.size)}${d.editable ? "" : " · lecture seule"}</small></span>
      </a>
      <span class="doc-acts">
        <button class="icon-btn plain" data-a="rename" title="Renommer">${icon("edit")}</button>
        <a class="icon-btn plain" href="/api/work/${d.id}/download" title="Télécharger">${icon("download")}</a>
        <button class="icon-btn plain" data-a="delete" title="Mettre à la corbeille">${icon("trash")}</button>
      </span>
    </div>`).join("")
    : `<div class="empty">${icon("inbox")}${docs.length ? "Aucun document ne correspond." : "Aucun document pour l'instant : crée le premier ci-dessus !"}</div>`;
}

async function call(url, opts = {}) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}
const jsonBody = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function askName(kind) {
  const def = { word: "Nouveau document", cell: "Nouveau tableur", slide: "Nouvelle présentation" }[kind];
  const m = modal(`${kind === "slide" ? "Nouvelle" : "Nouveau"} ${KINDS[kind].label.toLowerCase()}`, `
    <form><label class="field">Nom</label><input type="text" name="n" value="${def}" required>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("plus")}Créer et ouvrir</button></div></form>`,
    { ic: KINDS[kind].ic });
  const input = m.querySelector("input");
  setTimeout(() => input.select(), 150);
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await call("/api/work/new", jsonBody("POST", { kind, name: input.value }));
      closePanel();
      location.hash = `#/work/${d.id}`;
    } catch (err) { toast(err.message, "err"); }
  };
}

async function upload(files) {
  for (const f of files) {
    const form = new FormData();
    form.append("file", f);
    try { await call("/api/work/upload", { method: "POST", body: form }); toast(`« ${f.name} » importé`); }
    catch (e) { toast(`${f.name} : ${e.message}`, "err"); }
  }
  refresh();
}

async function onAction(e) {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const d = docs.find(x => x.id === b.closest(".doc").dataset.id);
  if (b.dataset.a === "rename") {
    const m = modal("Renommer", `<form><input type="text" value="${esc(d.name)}" required>
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Renommer</button></div></form>`);
    const input = m.querySelector("input");
    setTimeout(() => input.setSelectionRange(0, d.name.lastIndexOf(".")), 150);
    m.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      try { await call(`/api/work/${d.id}/rename`, jsonBody("POST", { name: input.value })); closePanel(); refresh(); }
      catch (err) { toast(err.message, "err"); }
    };
  }
  if (b.dataset.a === "delete") {
    const m = modal("Mettre à la corbeille ?", `<p>« ${esc(d.name)} » sera déplacé dans le dossier <b>.corbeille</b> de tes documents.</p>
      <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Mettre à la corbeille</button></div>`, { ic: "trash" });
    m.querySelector("[data-ok]").onclick = async () => {
      try { await call(`/api/work/${d.id}`, { method: "DELETE" }); closePanel(); toast("Document mis à la corbeille"); refresh(); }
      catch (err) { toast(err.message, "err"); }
    };
  }
}

// --- Éditeur ----------------------------------------------------------------

function userName() {
  try { return localStorage.getItem("bt-name") || ""; } catch { return ""; }
}

const effectiveTheme = () => document.documentElement.dataset.theme
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function loadApi(base) {
  if (window.DocsAPI) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = base + "/web-apps/apps/api/documents/api.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Impossible de joindre l'éditeur ONLYOFFICE"));
    document.head.append(s);
  });
}

export async function showEditor(id) {
  closeEditor();
  const shell = $("#work-editor");
  shell.hidden = false;
  document.body.classList.add("editing");
  shell.innerHTML = `
    <header class="we-bar">
      <a class="icon-btn plain" href="#/work" title="Retour à Bêta Work">${icon("back")}</a>
      <span class="we-brand"><span class="tile">${icon("briefcase")}</span><b>Bêta Work</b></span>
      <span class="we-title" id="we-title">Ouverture…</span>
      <span class="we-saved">${icon("check")}Enregistrement automatique</span>
      ${POWERED}
    </header>
    <div class="we-frame"><div id="oo-editor"></div><div class="loading" id="we-wait" style="justify-content:center;padding:60px"><span class="spinner"></span>Chargement de l'éditeur…</div></div>`;
  try {
    if (!userName()) await askUser();
    status ||= await call("/api/work/status");
    const base = status.public_url || `${location.protocol}//${location.hostname}:8081`;
    await loadApi(base);
    const config = await call(`/api/work/${id}/config?theme=${effectiveTheme()}&user=${encodeURIComponent(userName())}&mobile=${innerWidth < 700 ? 1 : 0}`);
    $("#we-title").textContent = config.document.title;
    document.title = config.document.title + " · Bêta Work";
    config.width = "100%";
    config.height = "100%";
    config.events = { onAppReady: () => $("#we-wait")?.remove() };
    editor = new window.DocsAPI.DocEditor("oo-editor", config);
  } catch (e) {
    $("#we-wait").innerHTML = `<div class="empty">${icon("alert")}${esc(e.message)}<a class="btn small ghost" href="#/work">Retour</a></div>`;
  }
}

function askUser() {
  return new Promise(resolve => {
    const m = modal("Comment t'appelles-tu ?", `<form>
      <p class="hint" style="margin-top:0">Ton prénom s'affiche dans le document si vous êtes plusieurs à le modifier en même temps.</p>
      <input type="text" required placeholder="Ton prénom" maxlength="40">
      <div class="modal-foot"><button class="btn">${icon("check")}Continuer</button></div></form>`, { ic: "briefcase" });
    m.addEventListener("closed", () => resolve());
    m.querySelector("form").onsubmit = e => {
      e.preventDefault();
      try { localStorage.setItem("bt-name", m.querySelector("input").value.trim()); } catch {}
      closePanel();
    };
  });
}

export function closeEditor() {
  if (editor) { try { editor.destroyEditor(); } catch {} editor = null; }
  const shell = $("#work-editor");
  if (shell && !shell.hidden) { shell.hidden = true; shell.innerHTML = ""; document.title = "Bêta Tool"; }
  document.body.classList.remove("editing");
}
