// Outil « Fichiers » : explorateur des dossiers du NAS.
import { $, $$, esc, icon, toast, modal, closePanel, sizeStr } from "../ui.js";
import { api, ago, enabled } from "../state.js";
import { pageHead } from "../main.js";
import { targetsFor, extOf } from "../converter.js";

const KIND_ICON = { folder: "folder", image: "image", video: "film", audio: "music", pdf: "pdf", doc: "doc", sheet: "sheet",
                    slide: "slides", archive: "archive", text: "file", file: "file" };
const THUMB = new Set(["image", "video", "pdf"]);
let S = { root: null, path: "", entries: [], sel: new Set(), view: "grid", filter: "", roots: [] };
try { S.view = localStorage.getItem("bt-files-view") || "grid"; } catch {}

const enc = encodeURIComponent;
const fsUrl = (kind, root, path, extra = "") => `/api/fs/${kind}?root=${enc(root)}&path=${enc(path)}${extra}`;
const join = (a, b) => (a ? a + "/" : "") + b;

export async function render(root, parts, query) {
  const fresh = !root.querySelector(".fx");
  if (fresh) {
    root.innerHTML = pageHead("fichiers") + `<div class="fx">
      <div class="roots" id="fx-roots"></div>
      <div class="card fx-main" id="fx-main">
        <div class="fx-bar">
          <nav class="crumbs" id="fx-crumbs"></nav>
          <input type="text" id="fx-filter" placeholder="Filtrer…">
          <button class="icon-btn" data-a="view" title="Affichage grille / liste">${icon("grid")}</button>
          <button class="icon-btn" data-a="mkdir" title="Nouveau dossier">${icon("plus")}</button>
          <label class="btn small" title="Envoyer des fichiers ici">${icon("upload2")}<span class="lbl">Importer</span><input type="file" multiple hidden id="fx-up"></label>
          <label class="icon-btn" title="Envoyer un dossier entier">${icon("folder")}<input type="file" webkitdirectory multiple hidden id="fx-updir"></label>
        </div>
        <div class="fx-sel" id="fx-sel" hidden></div>
        <div id="fx-list" class="fx-list"></div>
        <div class="fx-drop" id="fx-drop">${icon("upload")}<b>Dépose pour envoyer ici</b></div>
      </div></div>`;
    bind(root);
    S.roots = await api("/api/files/roots");
    if (!S.roots.length) {
      $("#fx-main").innerHTML = `<div class="empty">${icon("folder")}Aucun dossier disponible. Monte des dossiers dans docker-compose.yml (voir le README).</div>`;
      return;
    }
  }
  const rootId = parts[0] && S.roots.some(r => r.id === parts[0]) ? parts[0] : S.roots[0].id;
  const path = parts.slice(1).join("/");
  if (fresh || rootId !== S.root || path !== S.path) await load(rootId, path);
  if (query.voir) {
    const e = S.entries.find(x => x.name === query.voir);
    history.replaceState(null, "", location.hash.split("?")[0]);
    if (e) preview(e);
  }
}

function bind(root) {
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", e => { const it = e.target.closest(".fx-item"); if (it) open(entryOf(it)); });
  $("#fx-filter").oninput = e => { S.filter = e.target.value.toLowerCase(); draw(); };
  $("#fx-up").onchange = e => { upload([...e.target.files]); e.target.value = ""; };
  $("#fx-updir").onchange = e => { upload([...e.target.files], true); e.target.value = ""; };
  const main = $("#fx-main");
  let depth = 0;
  main.addEventListener("dragenter", e => { if (e.dataTransfer.types.includes("Files")) { depth++; main.classList.add("dragging"); } });
  main.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; main.classList.remove("dragging"); } });
  main.addEventListener("dragover", e => e.preventDefault());
  main.addEventListener("drop", e => {
    e.preventDefault(); depth = 0; main.classList.remove("dragging");
    if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]);
  });
}

async function load(rootId, path) {
  $("#fx-list").innerHTML = `<div class="loading"><span class="spinner"></span>Chargement…</div>`;
  try {
    const d = await api(`/api/files/list?root=${enc(rootId)}&path=${enc(path)}`);
    Object.assign(S, { root: rootId, path: d.path, entries: d.entries, trash: d.trash, sel: new Set() });
  } catch (e) {
    toast(e.message, "err");
    if (path) return go(rootId, "");
  }
  drawRoots();
  draw();
}

const go = (rootId, path) => { location.hash = "#/fichiers/" + [rootId, ...path.split("/").filter(Boolean)].map(enc).join("/"); };
const reload = () => load(S.root, S.path);
const entryOf = el => S.entries.find(e => e.path === el.dataset.path);
const inTrash = () => S.path.split("/")[0] === ".corbeille";

function drawRoots() {
  $("#fx-roots").innerHTML = S.roots.map(r => `<a class="root ${r.id === S.root ? "on" : ""}" href="#/fichiers/${enc(r.id)}">
    ${icon(r.icon)}<span><b>${esc(r.label)}</b><small>${sizeStr(r.free)} libres</small></span></a>`).join("");
}

function draw() {
  const label = S.roots.find(r => r.id === S.root)?.label || "";
  const segs = S.path ? S.path.split("/") : [];
  $("#fx-crumbs").innerHTML = `<a href="#/fichiers/${enc(S.root)}">${esc(label)}</a>` + segs.map((s, i) =>
    `<span>›</span><a href="#/fichiers/${[S.root, ...segs.slice(0, i + 1)].map(enc).join("/")}">${esc(s === ".corbeille" ? "Corbeille" : s)}</a>`).join("");
  $("[data-a=view]").innerHTML = icon(S.view === "grid" ? "list" : "grid");
  const list = S.entries.filter(e => !S.filter || e.name.toLowerCase().includes(S.filter));
  const trashBar = inTrash() ? `<div class="fx-note">${icon("trash")}<span>Corbeille : les éléments supprimés d'ici le sont définitivement.</span>
      <button class="btn small danger" data-a="empty-trash">Vider la corbeille</button></div>`
    : S.trash && !S.path ? `<div class="fx-note">${icon("trash")}<span>Des éléments sont dans la corbeille.</span>
      <a class="btn small ghost" href="#/fichiers/${enc(S.root)}/.corbeille">Ouvrir la corbeille</a></div>` : "";
  $("#fx-list").className = "fx-list " + S.view;
  $("#fx-list").innerHTML = trashBar + (list.length ? list.map(e => item(e)).join("")
    : `<div class="empty">${icon("folder")}${S.filter ? "Aucun élément ne correspond." : "Dossier vide. Glisse des fichiers ici pour les envoyer."}</div>`);
  drawSel();
}

function item(e) {
  const thumb = !e.dir && THUMB.has(e.kind) ? `<img loading="lazy" src="${fsUrl("thumb", S.root, e.path, "&s=240")}" alt="" onerror="this.remove()">` : "";
  const meta = e.dir ? `${e.count} élément${e.count > 1 ? "s" : ""}` : sizeStr(e.size);
  return `<div class="fx-item ${S.sel.has(e.path) ? "sel" : ""}" data-path="${esc(e.path)}" tabindex="0">
    <label class="fx-check" title="Sélectionner"><input type="checkbox" ${S.sel.has(e.path) ? "checked" : ""}></label>
    <span class="fx-thumb k-${e.kind}">${icon(KIND_ICON[e.kind] || "file")}${thumb}${e.kind === "video" ? `<span class="play">${icon("play")}</span>` : ""}</span>
    <span class="fx-name"><b title="${esc(e.name)}">${esc(e.name)}</b><small>${meta} · ${ago(e.mtime)}</small></span>
    <button class="icon-btn plain fx-more" data-a="more" title="Actions">${icon("dots")}</button>
  </div>`;
}

function drawSel() {
  const n = S.sel.size;
  const bar = $("#fx-sel");
  bar.hidden = !n;
  if (!n) return;
  const one = n === 1 ? S.entries.find(e => S.sel.has(e.path)) : null;
  bar.innerHTML = `<b>${n} sélectionné${n > 1 ? "s" : ""}</b>
    <button class="btn small ghost" data-a="dl">${icon("download")}Télécharger</button>
    ${enabled("drop") ? `<button class="btn small ghost" data-a="share">${icon("send")}Partager</button>` : ""}
    <button class="btn small ghost" data-a="move">${icon("move")}Déplacer</button>
    <button class="btn small ghost" data-a="copy">${icon("copy")}Copier</button>
    ${one ? `<button class="btn small ghost" data-a="rename">${icon("edit")}Renommer</button>` : ""}
    <button class="btn small danger" data-a="delete">${icon("trash")}${inTrash() ? "Supprimer définitivement" : "Supprimer"}</button>
    <button class="icon-btn plain" data-a="unselect" title="Tout désélectionner">${icon("x")}</button>`;
}

async function onClick(e) {
  const a = e.target.closest("[data-a]")?.dataset.a;
  const el = e.target.closest(".fx-item");
  if (e.target.closest(".fx-check") && el) {
    e.preventDefault();
    toggle(el.dataset.path);
    return;
  }
  if (a === "more" && el) return menu(entryOf(el), e.target.closest("[data-a]"));
  if (el && !a) {
    const ent = entryOf(el);
    if (e.ctrlKey || e.metaKey || S.sel.size) return toggle(ent.path);
    return open(ent);
  }
  const selected = () => S.entries.filter(x => S.sel.has(x.path));
  if (a === "view") { S.view = S.view === "grid" ? "list" : "grid"; try { localStorage.setItem("bt-files-view", S.view); } catch {} draw(); }
  if (a === "mkdir") ask("Nouveau dossier", "Nom du dossier", "Nouveau dossier", async name => {
    await api("/api/files/mkdir", { json: { root: S.root, path: S.path, name } });
    reload();
  });
  if (a === "unselect") { S.sel.clear(); draw(); }
  if (a === "dl") download(selected());
  if (a === "share") share(selected());
  if (a === "move" || a === "copy") moveDialog(selected(), a === "copy");
  if (a === "rename") rename(selected()[0]);
  if (a === "delete") remove(selected());
  if (a === "empty-trash") confirmBox("Vider la corbeille ?", "Tous les éléments de la corbeille seront supprimés définitivement.", async () => {
    await api("/api/files/empty-trash", { json: { root: S.root } });
    go(S.root, "");
  });
}

function toggle(path) {
  S.sel.has(path) ? S.sel.delete(path) : S.sel.add(path);
  $$(".fx-item").forEach(it => {
    const on = S.sel.has(it.dataset.path);
    it.classList.toggle("sel", on);
    it.querySelector("input").checked = on;
  });
  drawSel();
}

function open(e) {
  if (e.dir) return go(S.root, e.path);
  preview(e);
}

// --- Actions ------------------------------------------------------------------

function download(items) {
  const q = items.map(e => "p=" + enc(e.path)).join("&");
  location.href = `/api/files/download?root=${enc(S.root)}&${q}`;
}

function share(items) {
  const files = items.filter(e => !e.dir);
  if (!files.length) return toast("Choisis des fichiers (les dossiers ne se partagent pas directement)", "err");
  location.hash = `#/drop/partager?root=${enc(S.root)}&` + files.map(e => "p=" + enc(e.path)).join("&");
}

function rename(e) {
  ask("Renommer", "Nouveau nom", e.name, async name => {
    await api("/api/files/rename", { json: { root: S.root, path: e.path, name } });
    reload();
  }, e.dir ? undefined : e.name.lastIndexOf("."));
}

function remove(items) {
  const n = items.length;
  const label = n === 1 ? `« ${items[0].name} »` : `${n} éléments`;
  confirmBox(inTrash() ? `Supprimer définitivement ${label} ?` : `Mettre ${label} à la corbeille ?`,
    inTrash() ? "Cette action est irréversible." : "Tu pourras les retrouver dans la corbeille de ce dossier.", async () => {
      await api("/api/files/delete", { json: { root: S.root, paths: items.map(e => e.path) } });
      toast(inTrash() ? "Supprimé définitivement" : "Mis à la corbeille");
      reload();
    });
}

async function upload(files, keepFolders = false) {
  if (!files.length) return;
  const total = files.reduce((s, f) => s + f.size, 0);
  const form = new FormData();
  form.append("root", S.root);
  form.append("path", S.path);
  files.forEach(f => { form.append("file", f); form.append("relpath", keepFolders ? f.webkitRelativePath || f.name : f.name); });
  const note = document.createElement("div");
  note.className = "toast";
  note.innerHTML = `<span class="spinner"></span><span>Envoi de ${files.length} fichier${files.length > 1 ? "s" : ""} (${sizeStr(total)})… <b>0 %</b></span>`;
  $("#toasts").append(note);
  await new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    xhr.upload.onprogress = ev => { if (ev.lengthComputable) note.querySelector("b").textContent = Math.round(ev.loaded / ev.total * 100) + " %"; };
    xhr.onload = () => { note.remove(); xhr.status === 200 ? toast(`${files.length} fichier${files.length > 1 ? "s" : ""} envoyé${files.length > 1 ? "s" : ""}`) : toast(JSON.parse(xhr.responseText || "{}").error || "Échec de l'envoi", "err"); resolve(); };
    xhr.onerror = () => { note.remove(); toast("Connexion perdue", "err"); resolve(); };
    xhr.send(form);
  });
  reload();
}

function menu(e, anchor) {
  const acts = actions(e);
  const m = modal(e.name, `<div class="menu-list">${acts.map((a, i) => `<button class="menu-item" data-i="${i}">${icon(a[1])}<span>${a[0]}</span></button>`).join("")}</div>`,
    { ic: KIND_ICON[e.kind] || "file" });
  m.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { closePanel(); acts[+b.dataset.i][2](); });
}

/** Actions possibles sur un élément, dont « Ouvrir avec » les autres outils. */
function actions(e) {
  const list = [];
  if (e.dir) list.push(["Ouvrir", "folder", () => go(S.root, e.path)]);
  else list.push(["Aperçu", "eye", () => preview(e)]);
  list.push(["Télécharger", "download", () => download([e])]);
  if (!e.dir && enabled("drop")) list.push(["Partager par lien", "send", () => share([e])]);
  if (!e.dir) list.push(...openWith(e));
  list.push(["Renommer", "edit", () => rename(e)], ["Déplacer", "move", () => moveDialog([e], false)], ["Copier", "copy", () => moveDialog([e], true)],
            [inTrash() ? "Supprimer définitivement" : "Supprimer", "trash", () => remove([e])]);
  return list;
}

function openWith(e) {
  const out = [];
  const ext = extOf(e.name);
  const blobTo = async (hash, type) => {
    const r = await fetch(fsUrl("raw", S.root, e.path));
    window.btHandoff = new File([await r.blob()], e.name, { type: type || r.headers.get("Content-Type") || "" });
    location.hash = hash;
  };
  if (e.kind === "archive" && enabled("decompresser")) out.push(["Décompresser", "unzip", async () => {
    try { window.btArchive = await api("/api/files/extract", { json: { root: S.root, path: e.path } }); location.hash = "#/decompresser"; }
    catch (err) { toast(err.message, "err"); }
  }]);
  if (["doc", "sheet", "slide", "pdf", "text"].includes(e.kind) && enabled("work") && /^(docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?|odp|pdf)$/.test(ext)) out.push(["Ouvrir dans Bêta Work", "briefcase", async () => {
    try { const r = await api("/api/files/to-work", { json: { root: S.root, path: e.path } }); location.hash = "#/work/" + r.id; }
    catch (err) { toast(err.message, "err"); }
  }]);
  if (e.kind === "pdf" && enabled("pdf")) out.push(["Modifier / signer (Studio PDF)", "edit", () => blobTo("#/pdf/editer", "application/pdf")]);
  if (e.kind === "image" && enabled("image") && !/heic|heif|tiff?|svg/.test(ext)) out.push(["Retoucher (Studio Image)", "wand", () => blobTo("#/image")]);
  if (e.kind === "video" && enabled("video")) out.push(["Compresser / couper", "video", () => { location.hash = `#/video?root=${enc(S.root)}&path=${enc(e.path)}`; }]);
  if ((e.kind === "video" || e.kind === "audio") && enabled("transcription")) out.push(["Transcrire en texte", "mic", () => { location.hash = `#/transcription?root=${enc(S.root)}&path=${enc(e.path)}`; }]);
  if (enabled("convertir") && targetsFor(ext).length) out.push(["Convertir…", "convert", () => convertDialog(e)]);
  return out;
}

function convertDialog(e) {
  const targets = targetsFor(extOf(e.name));
  const m = modal(`Convertir « ${e.name} »`, `<form>
    <label class="field">Format de sortie</label>
    <select name="t" style="width:100%">${targets.map(t => `<option>${t}</option>`).join("")}</select>
    <p class="hint">Le résultat arrive dans le dossier des conversions ; tu peux suivre l'avancement dans le Convertisseur.</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("convert")}Convertir</button></div></form>`, { ic: "convert" });
  m.querySelector("form").onsubmit = async ev => {
    ev.preventDefault();
    try {
      await api("/api/files/convert", { json: { root: S.root, path: e.path, target: m.querySelector("select").value, nas: true } });
      closePanel();
      toast("Conversion lancée : tu seras prévenu à la fin");
    } catch (err) { toast(err.message, "err"); }
  };
}

// --- Aperçu -------------------------------------------------------------------

function preview(e) {
  const raw = fsUrl("raw", S.root, e.path);
  const media = S.entries.filter(x => x.kind === e.kind && !x.dir && ["image", "video", "audio"].includes(e.kind));
  let body;
  if (e.kind === "image") body = /heic|heif|tiff?/.test(extOf(e.name))
    ? `<img src="${fsUrl("thumb", S.root, e.path, "&s=1024")}" alt="">` : `<img src="${raw}" alt="">`;
  else if (e.kind === "video") body = `<video src="${raw}" controls autoplay playsinline></video>
    <p class="hint" id="pv-fallback" hidden>Ton navigateur ne sait pas lire ce format. Utilise « Convertir… » vers MP4.</p>`;
  else if (e.kind === "audio") body = `<div class="pv-audio">${icon("music")}<audio src="${raw}" controls autoplay></audio></div>`;
  else if (e.kind === "pdf") body = `<iframe src="${raw}" title="PDF"></iframe>`;
  else if (e.kind === "text") body = `<textarea id="pv-text" spellcheck="false">Chargement…</textarea>`;
  else body = `<div class="empty">${icon(KIND_ICON[e.kind] || "file")}<b>${esc(e.name)}</b>Pas d'aperçu pour ce type de fichier.</div>`;
  const m = modal(e.name, `<div class="pv pv-${e.kind}">${body}</div>
    <p class="meta">${sizeStr(e.size)} · modifié ${ago(e.mtime)}</p>
    <div class="modal-foot">
      ${media.length > 1 ? `<button class="btn ghost" data-nav="-1">${icon("left")}</button><button class="btn ghost" data-nav="1">${icon("right")}</button>` : ""}
      ${e.kind === "text" ? `<button class="btn ghost" data-pv="save">${icon("save")}Enregistrer</button>` : ""}
      <button class="btn ghost" data-pv="actions">${icon("dots")}Plus d'actions</button>
      <a class="btn" href="${raw}&dl=1">${icon("download")}Télécharger</a>
    </div>`, { ic: KIND_ICON[e.kind] || "file", large: true });
  m.querySelector("video")?.addEventListener("error", () => { m.querySelector("#pv-fallback").hidden = false; });
  if (e.kind === "text") api(`/api/files/text?root=${enc(S.root)}&path=${enc(e.path)}`).then(d => {
    m.querySelector("#pv-text").value = d.text + (d.truncated ? "\n…" : "");
    if (d.truncated) m.querySelector("[data-pv=save]").remove();
  });
  m.querySelector("[data-pv=save]")?.addEventListener("click", async () => {
    try { await api("/api/files/text", { json: { root: S.root, path: e.path, text: m.querySelector("#pv-text").value } }); toast("Enregistré"); }
    catch (err) { toast(err.message, "err"); }
  });
  m.querySelector("[data-pv=actions]").onclick = () => { closePanel(); setTimeout(() => menu(e), 260); };
  const nav = d => { const i = media.indexOf(e); closePanel(); setTimeout(() => preview(media[(i + d + media.length) % media.length]), 230); };
  m.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => nav(+b.dataset.nav));
  const keys = ev => { if (ev.key === "ArrowRight" && media.length > 1) nav(1); if (ev.key === "ArrowLeft" && media.length > 1) nav(-1); };
  addEventListener("keydown", keys);
  m.addEventListener("closed", () => removeEventListener("keydown", keys));
}

// --- Déplacer / copier : choix du dossier de destination ----------------------

function moveDialog(items, copy) {
  let root = S.root, path = S.path;
  const m = modal(copy ? "Copier vers…" : "Déplacer vers…", `
    <select id="mv-root" style="width:100%;margin-bottom:10px">${S.roots.map(r => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join("")}</select>
    <nav class="crumbs" id="mv-crumbs"></nav>
    <div class="mv-list" id="mv-list"></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn" id="mv-go">${icon(copy ? "copy" : "move")}${copy ? "Copier ici" : "Déplacer ici"}</button></div>`,
    { ic: copy ? "copy" : "move" });
  const show = async () => {
    m.querySelector("#mv-root").value = root;
    const d = await api(`/api/files/list?root=${enc(root)}&path=${enc(path)}`);
    const segs = path ? path.split("/") : [];
    m.querySelector("#mv-crumbs").innerHTML = `<a data-p="">${esc(S.roots.find(r => r.id === root).label)}</a>` + segs.map((s, i) =>
      `<span>›</span><a data-p="${esc(segs.slice(0, i + 1).join("/"))}">${esc(s)}</a>`).join("");
    const dirs = d.entries.filter(x => x.dir && !(root === S.root && items.some(it => it.path === x.path)));
    m.querySelector("#mv-list").innerHTML = dirs.length ? dirs.map(x => `<button class="menu-item" data-p="${esc(x.path)}">${icon("folder")}<span>${esc(x.name)}</span></button>`).join("")
      : `<p class="hint">Aucun sous-dossier.</p>`;
  };
  m.querySelector("#mv-root").onchange = ev => { root = ev.target.value; path = ""; show(); };
  m.addEventListener("click", ev => { const p = ev.target.closest("[data-p]"); if (p) { path = p.dataset.p; show(); } });
  m.querySelector("#mv-go").onclick = async () => {
    try {
      await api("/api/files/move", { json: { root: S.root, paths: items.map(e => e.path), dest_root: root, dest_path: path, copy } });
      closePanel();
      toast(copy ? "Copié" : "Déplacé");
      reload();
    } catch (err) { toast(err.message, "err"); }
  };
  show();
}

// --- Petites boîtes de dialogue ---------------------------------------------

function ask(title, label, value, onOk, selectEnd) {
  const m = modal(title, `<form><label class="field">${esc(label)}</label><input type="text" value="${esc(value)}" required>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Valider</button></div></form>`);
  const input = m.querySelector("input");
  setTimeout(() => { input.focus(); selectEnd > 0 ? input.setSelectionRange(0, selectEnd) : input.select(); }, 150);
  m.querySelector("form").onsubmit = async ev => {
    ev.preventDefault();
    try { await onOk(input.value.trim()); closePanel(); } catch (err) { toast(err.message, "err"); }
  };
}

function confirmBox(title, text, onOk) {
  const m = modal(title, `<p>${esc(text)}</p><div class="modal-foot"><button class="btn ghost" data-close>Annuler</button>
    <button class="btn danger" data-ok>${icon("check")}Confirmer</button></div>`, { ic: "alert" });
  m.querySelector("[data-ok]").onclick = async () => { try { await onOk(); closePanel(); } catch (err) { toast(err.message, "err"); } };
}
