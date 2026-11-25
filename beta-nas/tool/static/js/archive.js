// Outil « Décompresseur » (+ création d'archives ZIP dans le navigateur).
import { $, esc, icon, toast, dropHTML, dropzone, resultCard, loading, sizeStr } from "./ui.js";

const ACCEPT = ".zip,.rar,.7z,.tar,.gz,.tgz,.bz2,.xz,.zst,.iso,.cab,.cbz,.cbr,.arj,.lzh,.wim";
const MAX_ROWS = 1500;
let A = null;  // archive ouverte

export function init() {
  const root = $("#arc-root");
  root.innerHTML = `
    <div class="card" id="arc-zone">${dropHTML("arc-drop", { accept: ACCEPT, title: "Glisse ton archive ici", sub: "ZIP, RAR, 7Z, TAR.GZ, ISO… ou clique pour la choisir", tile: "vert" })}</div>
    <div class="card">
      <div class="card-title">${icon("archive")}Créer une archive ZIP</div>
      <p class="hint" style="margin:-6px 0 14px">Regroupe plusieurs fichiers dans un seul .zip (tout se fait dans ton navigateur).</p>
      ${dropHTML("zip-drop", { accept: "*/*", multiple: true, title: "Glisse les fichiers à compresser", sub: "ou clique pour les choisir", tile: "vert" })}
      <div id="zip-list"></div>
    </div>`;
  bindDrop();
  zipMaker();
}

function bindDrop() {
  const z = $("#arc-drop");
  dropzone(z, z.querySelector("input"), files => open(files[0]));
}

async function open(file) {
  const zone = $("#arc-zone");
  loading(zone, `Lecture de « ${file.name} »…`);
  try {
    const form = new FormData();
    form.append("file", file);
    const data = await api("/api/archive", { method: "POST", body: form });
    show(data);
  } catch (e) {
    toast(e.message, "err");
    zone.innerHTML = dropHTML("arc-drop", { accept: ACCEPT, title: "Glisse ton archive ici", sub: "ZIP, RAR, 7Z, TAR.GZ, ISO… ou clique pour la choisir", tile: "vert" });
    bindDrop();
  }
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

const header = (name, extra) => `<div class="files"><div class="file"><span class="ficon" style="color:var(--ok)">${icon("archive")}</span>
  <div class="name">${esc(name)}<small>${extra}</small></div>
  <span class="pick"><button class="btn small ghost" data-change>${icon("file")}Autre archive</button></span></div></div>`;

export function show(data) {
  const zone = $("#arc-zone");
  if (data.need_password) {
    zone.innerHTML = header(data.name, "Archive protégée") + `
      <form id="arc-pw" class="row" style="margin-top:16px">
        <input type="password" class="grow" placeholder="Mot de passe de l'archive" required autofocus>
        <button class="btn">${icon("unlock")}Ouvrir</button>
      </form>${data.wrong ? `<div class="msg">Mot de passe incorrect</div>` : ""}`;
    zone.querySelector("[data-change]").onclick = init;
    $("#arc-pw").onsubmit = async e => {
      e.preventDefault();
      const password = e.target.querySelector("input").value;
      try { show({ ...await api(`/api/archive/${data.id}/password`, json({ password })), password }); }
      catch (err) { toast(err.message, "err"); }
    };
    return;
  }
  A = { ...data, selected: new Set(data.entries.filter(e => !e.dir && !e.link).map(e => e.path)), collapsed: new Set(), filter: "" };
  const stem = data.name.replace(/\.(tar\.\w+|tgz|tbz2?|txz)$|\.[^.]+$/i, "");
  zone.innerHTML = header(data.name, `${data.count} fichier${data.count > 1 ? "s" : ""} · ${sizeStr(data.total)} une fois décompressé${data.encrypted ? " · 🔒 chiffrée" : ""}`) + `
    <div class="row" style="margin-top:16px">
      <input type="text" class="grow" id="arc-search" placeholder="Rechercher dans l'archive…">
      <button class="btn small ghost" data-sel="all">Tout cocher</button>
      <button class="btn small ghost" data-sel="none">Tout décocher</button>
    </div>
    <div class="tree" id="arc-tree"></div>
    <div class="grid2" style="align-items:end">
      <div><label class="field">Où extraire ?</label>
        <div class="seg">
          <label><input type="radio" name="arc-dest" value="server" checked>${icon("nas")}Sur le NAS</label>
          <label><input type="radio" name="arc-dest" value="download">${icon("download")}Sur mon appareil</label>
        </div></div>
      <div id="arc-sub"><label class="field">Dossier de destination</label><input type="text" id="arc-folder" placeholder="${esc(stem)}"></div>
    </div>
    ${data.encrypted ? `<label class="field">Mot de passe</label><input type="password" id="arc-pass" value="${esc(data.password || "")}" style="margin-bottom:14px">` : ""}
    <button class="btn wide" id="arc-go">${icon("unzip")}<span id="arc-go-label"></span></button>
    <div id="arc-result"></div>`;
  zone.querySelector("[data-change]").onclick = init;
  $("#arc-search").oninput = e => { A.filter = e.target.value.toLowerCase(); tree(); };
  zone.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => {
    A.selected = new Set(b.dataset.sel === "all" ? A.entries.filter(e => !e.dir && !e.link).map(e => e.path) : []);
    tree();
  });
  zone.querySelectorAll("[name=arc-dest]").forEach(r => r.onchange = () => { $("#arc-sub").style.visibility = r.value === "server" ? "visible" : "hidden"; });
  $("#arc-tree").addEventListener("change", onCheck);
  $("#arc-tree").addEventListener("click", e => {
    const t = e.target.closest("[data-toggle]");
    if (!t) return;
    const p = t.dataset.toggle;
    A.collapsed.has(p) ? A.collapsed.delete(p) : A.collapsed.add(p);
    tree();
  });
  $("#arc-go").onclick = extract;
  tree();
}

const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Construit la liste à plat (dossiers + fichiers) avec leur profondeur. */
function rows() {
  const files = A.entries.filter(e => !e.dir && !e.link);
  const folders = new Set();
  files.forEach(f => { const parts = f.path.split("/"); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/")); });
  const all = [...[...folders].map(p => ({ path: p, dir: true })), ...files].sort((a, b) => a.path.localeCompare(b.path, "fr", { numeric: true }));
  return all.filter(r => {
    if (A.filter) return !r.dir && r.path.toLowerCase().includes(A.filter);
    const parts = r.path.split("/");
    for (let i = 1; i < parts.length; i++) if (A.collapsed.has(parts.slice(0, i).join("/"))) return false;
    return true;
  });
}

function filesUnder(folder) {
  return A.entries.filter(e => !e.dir && !e.link && e.path.startsWith(folder + "/")).map(e => e.path);
}

function tree() {
  const list = rows();
  const html = list.slice(0, MAX_ROWS).map(r => {
    const depth = A.filter ? 0 : r.path.split("/").length - 1;
    const name = A.filter ? r.path : r.path.split("/").pop();
    if (r.dir) {
      const under = filesUnder(r.path);
      const n = under.filter(p => A.selected.has(p)).length;
      return `<div class="tr dir" style="padding-left:${depth * 22 + 6}px">
        <input type="checkbox" data-dir="${esc(r.path)}" ${n === under.length && n ? "checked" : ""} ${n && n < under.length ? 'data-partial="1"' : ""}>
        <button class="caret" data-toggle="${esc(r.path)}">${A.collapsed.has(r.path) ? "▸" : "▾"}</button>
        ${icon("folder")}<span class="nm">${esc(name)}</span><span class="sz">${under.length} fichier${under.length > 1 ? "s" : ""}</span></div>`;
    }
    return `<label class="tr" style="padding-left:${depth * 22 + 30}px">
      <input type="checkbox" data-file="${esc(r.path)}" ${A.selected.has(r.path) ? "checked" : ""}>
      ${icon("file")}<span class="nm">${esc(name)}${r.enc ? " 🔒" : ""}</span><span class="sz">${sizeStr(r.size)}</span></label>`;
  }).join("") + (list.length > MAX_ROWS ? `<div class="hint" style="padding:10px">… et ${list.length - MAX_ROWS} autres éléments (utilise la recherche)</div>` : "")
    + (!list.length ? `<div class="empty">${icon("inbox")}Rien ne correspond</div>` : "");
  $("#arc-tree").innerHTML = html;
  $("#arc-tree").querySelectorAll("[data-partial]").forEach(c => { c.indeterminate = true; });
  const n = A.selected.size;
  const size = A.entries.filter(e => A.selected.has(e.path)).reduce((s, e) => s + e.size, 0);
  $("#arc-go-label").textContent = n ? `Extraire ${n} fichier${n > 1 ? "s" : ""} (${sizeStr(size)})` : "Sélectionne des fichiers";
  $("#arc-go").disabled = !n;
}

function onCheck(e) {
  const c = e.target;
  if (c.dataset.file) c.checked ? A.selected.add(c.dataset.file) : A.selected.delete(c.dataset.file);
  if (c.dataset.dir) filesUnder(c.dataset.dir).forEach(p => c.checked ? A.selected.add(p) : A.selected.delete(p));
  tree();
}

async function extract() {
  const dest = document.querySelector("[name=arc-dest]:checked").value;
  const all = A.selected.size === A.entries.filter(e => !e.dir && !e.link).length;
  const btn = $("#arc-go");
  btn.disabled = true;
  loading($("#arc-result"), "Extraction en cours…");
  try {
    const data = await api(`/api/archive/${A.id}/extract`, json({
      paths: all ? null : [...A.selected], dest, subfolder: $("#arc-folder").value.trim(),
      password: $("#arc-pass")?.value ?? A.password ?? "",
    }));
    if (dest === "server") {
      $("#arc-result").innerHTML = `<div class="result"><span class="tile">${icon("check")}</span>
        <div class="body"><b>${data.count} fichier${data.count > 1 ? "s" : ""} extrait${data.count > 1 ? "s" : ""}</b>
        <span class="meta">Sur le NAS, dans « Décompressés / ${esc(data.saved)} »</span></div></div>`;
      toast("Extraction terminée");
    } else {
      $("#arc-result").innerHTML = `<div class="result"><span class="tile">${icon("check")}</span>
        <div class="body"><b>${esc(data.name)}</b><span class="meta">${data.count} fichier${data.count > 1 ? "s" : ""} · ${sizeStr(data.size)}</span></div>
        <div class="actions"><a class="btn small" href="${data.download}">${icon("download")}Télécharger</a></div></div>`;
      location.href = data.download;
    }
  } catch (err) {
    $("#arc-result").innerHTML = "";
    toast(err.message, "err");
  }
  btn.disabled = false;
}

// --- Créer un ZIP -------------------------------------------------------------

function zipMaker() {
  let files = [];
  const z = $("#zip-drop");
  const render = () => {
    const total = files.reduce((s, f) => s + f.size, 0);
    $("#zip-list").innerHTML = files.length ? `
      <div class="files" style="margin-top:14px">${files.map((f, i) => `<div class="file"><span class="ficon">${esc((f.name.split(".").pop() || "").slice(0, 4))}</span>
        <div class="name">${esc(f.webkitRelativePath || f.name)}<small>${sizeStr(f.size)}</small></div>
        <span class="pick"><button class="icon-btn plain" data-rm="${i}" title="Retirer">✕</button></span></div>`).join("")}</div>
      <div class="row"><input type="text" class="grow" id="zip-name" value="archive.zip">
        <button class="btn" id="zip-go">${icon("archive")}Créer le ZIP (${files.length} fichier${files.length > 1 ? "s" : ""}, ${sizeStr(total)})</button></div>
      <div id="zip-result"></div>` : "";
    if (!files.length) return;
    $("#zip-list").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { files.splice(+b.dataset.rm, 1); render(); });
    $("#zip-go").onclick = async () => {
      const zip = new window.JSZip();
      files.forEach(f => zip.file(f.webkitRelativePath || f.name, f));
      $("#zip-go").disabled = true;
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      let name = $("#zip-name").value.trim() || "archive.zip";
      if (!/\.zip$/i.test(name)) name += ".zip";
      resultCard($("#zip-result"), blob, name, { editable: false, tool: "archive" });
      $("#zip-go").disabled = false;
    };
  };
  dropzone(z, z.querySelector("input"), list => { files = files.concat(list); render(); });
}

