// Outil « Album photo » : chronologie par mois, albums (dossiers), visionneuse, partage.
import { $, $$, esc, icon, toast, openPanel, closePanel, sizeStr } from "../ui.js";
import { api, enabled } from "../state.js";
import { pageHead } from "../main.js";

const enc = encodeURIComponent;
const thumb = (p, s = 320) => `/api/fs/thumb?root=photos&path=${enc(p.path)}&s=${s}`;
const raw = p => `/api/fs/raw?root=photos&path=${enc(p.path)}`;
const WEB = /\.(jpe?g|png|webp|gif|avif)$/i;
const PAGE = 360;
let all = [], shown = [], album = null, view = "chrono", limit = PAGE, sel = new Set(), poll = null;

export async function render(root, parts) {
  album = parts[0] === "album" ? parts.slice(1).join("/") : null;
  view = parts[0] === "albums" ? "albums" : "chrono";
  root.innerHTML = pageHead("photos", `<label class="btn ghost">${icon("upload2")}Importer<input type="file" accept="image/*,video/*" multiple hidden id="ph-up"></label>`) + `
    <nav class="tabs"><a href="#/photos" class="${view === "chrono" && !album ? "on" : ""}">${icon("clock")}Chronologie</a>
      <a href="#/photos/albums" class="${view === "albums" || album ? "on" : ""}">${icon("folder")}Albums</a></nav>
    <div id="ph-scan"></div><div class="ph-sel" id="ph-sel" hidden></div><div id="ph-body"></div>`;
  $("#ph-up").onchange = e => upload([...e.target.files]);
  await load();
}

async function load(refresh = false) {
  const d = await api("/api/photos" + (refresh ? "?refresh=1" : ""));
  if (!d.available) {
    $("#ph-body").innerHTML = `<div class="card"><div class="empty">${icon("camera")}<b>Aucun dossier photos</b>
      Monte ton dossier de photos sur <code>/photos</code> dans docker-compose.yml (ex. <code>/volume1/photo:/photos</code>), puis redémarre.</div></div>`;
    return;
  }
  all = d.photos;
  $("#ph-scan").innerHTML = d.scanning ? `<div class="intro"><span class="spinner"></span><p>Analyse des photos… ${d.done} / ${d.total}</p></div>` : "";
  clearTimeout(poll);
  if (d.scanning) poll = setTimeout(() => { if ($("#ph-body")) load(); }, 2500);
  draw();
}

function draw() {
  sel.clear();
  drawSel();
  const body = $("#ph-body");
  if (view === "albums" && !album) {
    const albums = {};
    all.forEach(p => { const a = p.album || "(racine)"; (albums[a] ||= []).push(p); });
    const names = Object.keys(albums).sort((a, b) => albums[b][0].taken - albums[a][0].taken);
    body.innerHTML = names.length ? `<div class="albums">${names.map(n => `
      <a class="album" href="#/photos/album/${enc(n)}"><img loading="lazy" src="${thumb(albums[n][0], 480)}" alt="">
        <span><b>${esc(n)}</b><small>${albums[n].length} élément${albums[n].length > 1 ? "s" : ""}</small></span></a>`).join("")}</div>` : empty();
    return;
  }
  shown = album ? all.filter(p => (p.album || "(racine)") === album) : all;
  if (!shown.length) { body.innerHTML = empty(); return; }
  let html = album ? `<div class="row" style="margin-top:0"><a class="back" href="#/photos/albums">${icon("back")}Albums</a><b class="grow">${esc(album)}</b></div>` : "";
  let month = "";
  shown.slice(0, limit).forEach((p, i) => {
    const m = new Date(p.taken * 1000).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    if (m !== month) { html += `${month ? "</div>" : ""}<h3 class="ph-month">${m}</h3><div class="ph-grid">`; month = m; }
    html += `<button class="ph" data-i="${i}"><img loading="lazy" src="${thumb(p)}" alt="">${p.video ? `<span class="badge-v">${icon("play")}</span>` : ""}
      <span class="ph-check">${icon("check")}</span></button>`;
  });
  html += "</div>";
  if (shown.length > limit) html += `<button class="btn ghost wide" id="ph-more" style="margin-top:16px">Afficher plus (${shown.length - limit} restantes)</button>`;
  body.innerHTML = html;
  body.onclick = e => {
    if (e.target.closest("#ph-more")) { limit += PAGE; draw(); return; }
    const b = e.target.closest(".ph");
    if (!b) return;
    const i = +b.dataset.i;
    if (sel.size || e.ctrlKey || e.metaKey) { sel.has(i) ? sel.delete(i) : sel.add(i); b.classList.toggle("sel", sel.has(i)); drawSel(); }
    else viewer(i);
  };
  body.oncontextmenu = e => {
    const b = e.target.closest(".ph");
    if (!b) return;
    e.preventDefault();
    const i = +b.dataset.i;
    sel.add(i); b.classList.add("sel"); drawSel();
  };
}

const empty = () => `<div class="card"><div class="empty">${icon("camera")}Aucune photo pour l'instant. Utilise « Importer » ou ajoute des photos dans le dossier du NAS.</div></div>`;

function drawSel() {
  const bar = $("#ph-sel");
  if (!bar) return;
  bar.hidden = !sel.size;
  if (!sel.size) return;
  bar.innerHTML = `<b>${sel.size} sélectionnée${sel.size > 1 ? "s" : ""}</b>
    <button class="btn small ghost" data-s="dl">${icon("download")}Télécharger</button>
    ${enabled("drop") ? `<button class="btn small ghost" data-s="share">${icon("send")}Partager</button>` : ""}
    <button class="btn small danger" data-s="del">${icon("trash")}Supprimer</button>
    <button class="icon-btn plain" data-s="none">${icon("x")}</button>`;
  bar.onclick = async e => {
    const a = e.target.closest("[data-s]")?.dataset.s;
    const items = [...sel].map(i => shown[i]);
    if (a === "none") draw();
    if (a === "dl") location.href = "/api/files/download?root=photos&" + items.map(p => "p=" + enc(p.path)).join("&");
    if (a === "share") location.hash = "#/drop/partager?root=photos&" + items.map(p => "p=" + enc(p.path)).join("&");
    if (a === "del") {
      await api("/api/files/delete", { json: { root: "photos", paths: items.map(p => p.path) } });
      toast(`${items.length} élément${items.length > 1 ? "s" : ""} mis à la corbeille`);
      load(true);
    }
  };
}

// --- Visionneuse --------------------------------------------------------------

function viewer(i) {
  let el = $("#ph-viewer");
  if (!el) {
    el = document.createElement("div");
    el.id = "ph-viewer";
    el.className = "viewer";
    document.body.append(el);
  }
  const show = () => {
    const p = shown[i];
    const date = new Date(p.taken * 1000).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
    el.innerHTML = `<div class="v-top"><span><b>${esc(date)}</b><small>${esc(p.camera || "")}${p.w ? ` · ${p.w}×${p.h}` : ""} · ${sizeStr(p.size)}</small></span>
        <a class="icon-btn plain" href="${raw(p)}&dl=1" title="Télécharger">${icon("download")}</a>
        ${enabled("drop") ? `<a class="icon-btn plain" href="#/drop/partager?root=photos&p=${enc(p.path)}" title="Partager">${icon("send")}</a>` : ""}
        ${enabled("image") && WEB.test(p.path) ? `<button class="icon-btn plain" data-v="edit" title="Retoucher">${icon("wand")}</button>` : ""}
        <button class="icon-btn plain" data-v="close" title="Fermer (Échap)">${icon("x")}</button></div>
      <button class="v-nav prev" data-v="prev">${icon("left")}</button>
      <div class="v-stage">${p.video ? `<video src="${raw(p)}" controls autoplay playsinline></video>`
        : `<img src="${WEB.test(p.path) ? raw(p) : thumb(p, 2048)}" alt="">`}</div>
      <button class="v-nav next" data-v="next">${icon("right")}</button>`;
  };
  const move = d => { i = (i + d + shown.length) % shown.length; show(); };
  const close = () => { el.remove(); removeEventListener("keydown", keys); };
  const keys = e => { if (e.key === "ArrowRight") move(1); if (e.key === "ArrowLeft") move(-1); if (e.key === "Escape") close(); };
  addEventListener("keydown", keys);
  el.onclick = async e => {
    const a = e.target.closest("[data-v]")?.dataset.v;
    if (a === "prev") move(-1);
    if (a === "next") move(1);
    if (a === "close" || e.target.classList.contains("v-stage") || e.target.closest("a[href^='#']")) close();
    if (a === "edit") {
      const p = shown[i];
      const r = await fetch(raw(p));
      window.btHandoff = new File([await r.blob()], p.path.split("/").pop(), { type: r.headers.get("Content-Type") });
      close();
      location.hash = "#/image";
    }
  };
  // Balayage gauche / droite sur téléphone
  let x0 = null;
  el.ontouchstart = e => { x0 = e.touches[0].clientX; };
  el.ontouchend = e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1); x0 = null; };
  show();
}

async function upload(list) {
  if (!list.length) return;
  const form = new FormData();
  list.forEach(f => form.append("file", f));
  toast(`Envoi de ${list.length} élément${list.length > 1 ? "s" : ""}…`);
  try {
    const r = await api("/api/photos/upload", { method: "POST", body: form });
    toast(`${r.saved} élément${r.saved > 1 ? "s" : ""} importé${r.saved > 1 ? "s" : ""} (dossier Import)`);
    setTimeout(() => load(), 1500);
  } catch (e) { toast(e.message, "err"); }
}

export function leave() { clearTimeout(poll); $("#ph-viewer")?.remove(); }
