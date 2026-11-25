// Outil « Album photo » : chronologie par mois, albums (dossiers), visionneuse, partage.
import { $, $$, esc, icon, toast, openPanel, closePanel, sizeStr } from "../ui.js";
import { api, enabled } from "../state.js";
import { pageHead } from "../main.js";

const enc = encodeURIComponent;
const thumb = (p, s = 320) => `/api/fs/thumb?root=photos&path=${enc(p.path)}&s=${s}`;
const raw = p => `/api/fs/raw?root=photos&path=${enc(p.path)}`;
const WEB = /\.(jpe?g|png|webp|gif|avif)$/i;
const PAGE = 360;
let all = [], shown = [], album = null, view = "chrono", limit = PAGE, sel = new Set(), poll = null, personId = null, memo = null;

export async function render(root, parts) {
  album = parts[0] === "album" ? parts.slice(1).join("/") : null;
  view = parts[0] === "albums" ? "albums" : parts[0] === "personnes" ? "people" : "chrono";
  personId = view === "people" ? parts[1] || null : null;
  root.innerHTML = pageHead("photos", `<label class="btn ghost">${icon("upload2")}Importer<input type="file" accept="image/*,video/*" multiple hidden id="ph-up"></label>`) + `
    <nav class="tabs"><a href="#/photos" class="${view === "chrono" && !album ? "on" : ""}">${icon("clock")}Chronologie</a>
      <a href="#/photos/albums" class="${view === "albums" || album ? "on" : ""}">${icon("folder")}Albums</a>
      <a href="#/photos/personnes" class="${view === "people" ? "on" : ""}">${icon("users")}Personnes</a></nav>
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
  if (view === "people") return peopleView(body);
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
  body.innerHTML = (!album ? `<div id="ph-memo"></div>` : "") + html;
  if (!album) memories($("#ph-memo"));
  body.onclick = e => {
    if (e.target.closest("#ph-more")) { limit += PAGE; draw(); return; }
    const mm = e.target.closest("[data-memo]");
    if (mm) { const [y, k] = mm.dataset.memo.split(":").map(Number); const g = memo.find(x => x.year === y); shown = g.photos.map(path => all.find(p => p.path === path)).filter(Boolean); return viewer(k); }
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

async function memories(box) {
  if (!box) return;
  if (!memo) memo = (await api("/api/photos/memories").catch(() => ({ memories: [] }))).memories;
  if (!memo.length) return;
  box.innerHTML = `<div class="card ph-memories"><div class="card-title">${icon("clock")}Ce jour-là</div>
    ${memo.map(g => `<div class="ph-memo-row"><b>Il y a ${g.ago} an${g.ago > 1 ? "s" : ""}</b><small class="meta">${g.year} · ${g.count} photo${g.count > 1 ? "s" : ""}</small>
      <div class="ph-memo-strip">${g.photos.slice(0, 12).map((path, k) => `<button class="ph-memo" data-memo="${g.year}:${k}"><img loading="lazy" src="${thumb({ path }, 240)}" alt=""></button>`).join("")}</div></div>`).join("")}</div>`;
}

// --- Personnes (visages) ----------------------------------------------------------------------------------------

async function peopleView(body) {
  const d = await api("/api/photos/people");
  if (!d.available) { body.innerHTML = `<div class="card empty">${icon("users")}<b>Reconnaissance des visages indisponible</b>Elle arrive avec la mise à jour (module OpenCV).</div>`; return; }
  if (personId) return personView(body, d);
  const st = d.state;
  body.innerHTML = `<div class="intro"><span class="tile violet">${icon("users")}</span><p>Les visages sont repérés dans tes photos et reconnus <b>sur le NAS</b>, sans rien envoyer.
      Donne un nom à quelques visages : Bêta Tool apprend et propose ensuite les mêmes personnes sur les autres photos.</p></div>
    <div class="card"><div class="ot-top" style="margin:0"><label class="check" style="margin:0"><input type="checkbox" id="pp-on" ${d.on ? "checked" : ""}> Chercher les visages dans les nouvelles photos</label>
      <span class="grow"></span><span class="meta">${d.scanned} / ${d.photos} photos analysées</span>
      <button class="btn ghost small" id="pp-scan" ${st.running ? "disabled" : ""}>${st.running ? `<span class="spinner"></span>${st.done} / ${st.total}` : `${icon("search")}Analyser maintenant`}</button></div>
      ${st.error ? `<p class="pill-warn">${esc(st.error)}</p>` : ""}</div>
    ${d.people.length ? `<h3 class="ph-month">Personnes</h3><div class="pp-grid">${d.people.map(p => `<a class="pp-person" href="#/photos/personnes/${p.id}">
        ${p.cover ? `<img src="/api/photos/faces/${p.cover}.jpg" alt="">` : `<span class="avatar">${esc(p.name[0])}</span>`}<b>${esc(p.name)}</b><small class="meta">${p.count} photo${p.count > 1 ? "s" : ""}</small></a>`).join("")}</div>` : ""}
    ${d.unknown.length ? `<h3 class="ph-month" style="text-transform:none">Qui est-ce ? <small class="meta">${d.unknown_total} visage${d.unknown_total > 1 ? "s" : ""} sans nom</small></h3>
      <div class="pp-faces">${d.unknown.map(f => {
        const s = f.suggestion && d.people.find(p => p.id === f.suggestion.person);
        return `<div class="pp-face" data-f="${f.id}"><img src="/api/photos/faces/${f.id}.jpg" alt="" data-open="${esc(f.photo)}">
          ${s ? `<div class="pp-sugg">${esc(s.name)} ?<span><button class="icon-btn plain" data-yes="${s.id}" title="Oui">${icon("check")}</button><button class="icon-btn plain" data-no title="Non">${icon("x")}</button></span></div>`
            : `<input type="text" list="pp-names" placeholder="Nom…" data-name>`}
          <button class="pp-x" data-ignore title="Pas un visage">${icon("trash")}</button></div>`;
      }).join("")}</div><datalist id="pp-names">${d.people.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist>`
      : d.scanned ? `<div class="card empty">${icon("check")}<b>Tous les visages ont un nom</b></div>` : `<div class="card empty">${icon("users")}<b>Pas encore de visages</b>Lance l'analyse : la première fois, elle peut prendre un moment (environ 1 seconde par photo).</div>`}`;
  if (st.running) { clearTimeout(poll); poll = setTimeout(() => { if (view === "people" && $("#ph-body")) peopleView(body); }, 3000); }
  if (!body.isConnected) return;  // page quittée pendant le chargement
  $("#pp-on").onchange = async e => { await api("/api/photos/people/settings", { method: "PUT", json: { on: e.target.checked } }); peopleView(body); };
  $("#pp-scan").onclick = async () => { await api("/api/photos/people/scan", { json: {} }); setTimeout(() => peopleView(body), 800); };
  const act = async (fid, json) => { await api(`/api/photos/faces/${fid}`, { json }); body.querySelector(`[data-f="${fid}"]`)?.remove(); };
  body.onclick = e => {
    const face = e.target.closest("[data-f]");
    if (!face) return;
    const fid = face.dataset.f;
    if (e.target.closest("[data-yes]")) return act(fid, { person: e.target.closest("[data-yes]").dataset.yes }).then(() => toast("Merci !"));
    if (e.target.closest("[data-no]")) return act(fid, { reject: true }).then(() => peopleView(body));
    if (e.target.closest("[data-ignore]")) return act(fid, { ignore: true });
    const o = e.target.closest("[data-open]");
    if (o) { shown = [all.find(p => p.path === o.dataset.open)].filter(Boolean); if (shown.length) viewer(0); }
  };
  body.querySelectorAll("[data-name]").forEach(inp => inp.onkeydown = async e => {
    if (e.key !== "Enter" || !inp.value.trim()) return;
    await act(inp.closest("[data-f]").dataset.f, { name: inp.value.trim() });
    toast(`Visage nommé « ${inp.value.trim()} »`);
    if (!d.people.some(p => p.name.toLowerCase() === inp.value.trim().toLowerCase())) peopleView(body);
  });
}

async function personView(body, d) {
  const r = await api(`/api/photos/people/${personId}`);
  shown = r.photos.map(path => all.find(p => p.path === path)).filter(Boolean);
  body.innerHTML = `<div class="row" style="margin-top:0"><a class="back" href="#/photos/personnes">${icon("back")}Personnes</a><b class="grow">${esc(r.person.name)}</b>
      <button class="btn ghost small" id="pp-rename">${icon("edit")}Renommer</button><button class="btn ghost small" id="pp-del">${icon("trash")}Oublier</button></div>
    ${r.suggestions.length ? `<div class="card"><div class="card-title">${icon("sparkles")}C'est aussi ${esc(r.person.name)} ?<span class="grow"></span><button class="btn small" id="pp-all">${icon("check")}Oui, tous</button></div>
      <div class="pp-faces">${r.suggestions.map(f => `<div class="pp-face" data-f="${f}"><img src="/api/photos/faces/${f}.jpg" alt=""><div class="pp-sugg"><span><button class="icon-btn plain" data-yes title="Oui">${icon("check")}</button><button class="icon-btn plain" data-no title="Non">${icon("x")}</button></span></div></div>`).join("")}</div></div>` : ""}
    <h3 class="ph-month">${shown.length} photo${shown.length > 1 ? "s" : ""}</h3>
    <div class="ph-grid">${shown.map((p, i) => `<button class="ph" data-i="${i}"><img loading="lazy" src="${thumb(p)}" alt=""></button>`).join("")}</div>`;
  $("#pp-rename").onclick = async () => { const n = prompt("Nouveau nom", r.person.name); if (n) { await api(`/api/photos/people/${personId}`, { method: "PUT", json: { name: n } }); personView(body, d); } };
  $("#pp-del").onclick = async () => { if (confirm(`Oublier ${r.person.name} ? Ses visages redeviennent sans nom.`)) { await api(`/api/photos/people/${personId}`, { method: "DELETE" }); location.hash = "#/photos/personnes"; } };
  $("#pp-all")?.addEventListener("click", async () => { await api(`/api/photos/people/${personId}/accept`, { json: {} }); personView(body, d); });
  body.onclick = async e => {
    const b = e.target.closest(".ph");
    if (b) return viewer(+b.dataset.i);
    const face = e.target.closest("[data-f]");
    if (!face) return;
    if (e.target.closest("[data-yes]")) { await api(`/api/photos/faces/${face.dataset.f}`, { json: { person: personId } }); face.remove(); }
    if (e.target.closest("[data-no]")) { await api(`/api/photos/faces/${face.dataset.f}`, { json: { reject: true } }); face.remove(); }
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
