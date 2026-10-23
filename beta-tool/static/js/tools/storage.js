// Outil « Stockage » : carte de l'espace, doublons, suggestions de rangement.
import { $, esc, icon, toast, sizeStr } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const COLORS = { video: "#ef4444", photo: "#8b5cf6", audio: "#10b981", doc: "#3b82f6", archive: "#f59e0b", app: "#ec4899", other: "#64748b" };
let timer = null, nav = { root: null, path: "" }, tidyForm = { root: "", path: "", recursive: false, read_docs: true };

export async function render(root, parts) {
  const tab = ["doublons", "rangement"].includes(parts[0]) ? parts[0] : "carte";
  root.innerHTML = pageHead("stockage") + `
    <nav class="tabs"><a href="#/stockage" class="${tab === "carte" ? "on" : ""}">${icon("pie")}Où part la place</a>
      <a href="#/stockage/doublons" class="${tab === "doublons" ? "on" : ""}">${icon("copy")}Doublons</a>
      <a href="#/stockage/rangement" class="${tab === "rangement" ? "on" : ""}">${icon("sparkles")}Rangement</a></nav>
    <div id="st-body"></div>`;
  clearInterval(timer);
  ({ carte, doublons, rangement })[tab]($("#st-body"));
}

function watch(kind, el, fn) {
  clearInterval(timer);
  timer = setInterval(async () => {
    if (!document.body.contains(el)) return clearInterval(timer);
    const d = await api("/api/storage").catch(() => null);
    if (!d) return;
    const st = d.state[kind];
    const bar = el.querySelector(".st-progress");
    if (bar && st.status === "running") { bar.querySelector("span").textContent = st.step || ""; bar.querySelector(".bar div").style.width = (st.progress || 0) + "%"; }
    if (st.status !== "running") { clearInterval(timer); fn(); }
  }, 1200);
}
const progressBox = (st, label) => `<div class="card st-progress"><div class="row" style="margin:0"><span class="spinner"></span><b>${label}</b><span class="meta grow">${esc(st.step || "")}</span></div>
  <div class="bar"><div style="width:${st.progress || 0}%"></div></div></div>`;

// --- Carte ------------------------------------------------------------------
async function carte(el) {
  const d = await api("/api/storage");
  const s = d.space, st = d.state.scan;
  if (st.status === "running") { el.innerHTML = progressBox(st, "Analyse de l'espace…"); return watch("scan", el, () => carte(el)); }
  if (!s) {
    el.innerHTML = `<div class="card"><div class="empty">${icon("pie")}<b>Où est passée la place ?</b>Bêta Tool parcourt tes dossiers et te montre ce qui prend le plus d'espace.
      <button class="btn" id="st-scan">${icon("search")}Analyser</button></div></div>`;
    $("#st-scan").onclick = async () => { await api("/api/storage/scan", { json: {} }); carte(el); };
    return;
  }
  const totalTyped = Object.values(s.types).reduce((a, b) => a + b, 0) || 1;
  const disks = Object.values(s.roots.reduce((acc, r) => { (acc[r.dev] ||= { total: r.disk_total, free: r.disk_free, roots: [] }).roots.push(r); return acc; }, {}));
  nav.root = nav.root && s.roots.some(r => r.id === nav.root) ? nav.root : s.roots[0]?.id;
  el.innerHTML = `
    <div class="st-head"><span class="meta">Analysé ${ago(s.at)} · ${s.files.toLocaleString("fr-FR")} fichiers</span>
      <button class="btn ghost small" id="st-scan">${icon("refresh")}Réanalyser</button></div>
    <div class="st-disks">${disks.map(k => {
      const used = k.total - k.free;
      return `<div class="card st-disk"><div class="w-head">${icon("nas")}<b>${k.roots.map(r => esc(r.label)).join(", ")}</b></div>
        <div class="st-stack">${k.roots.map(r => `<div style="width:${r.size / k.total * 100}%" title="${esc(r.label)} · ${sizeStr(r.size)}"></div>`).join("")}
          <div class="other" style="width:${Math.max(0, used - k.roots.reduce((a, r) => a + r.size, 0)) / k.total * 100}%" title="Autres données du disque"></div></div>
        <p class="meta">${sizeStr(k.free)} libres sur ${sizeStr(k.total)} · ${Math.round(used / k.total * 100)} % utilisés</p></div>`;
    }).join("")}</div>
    <div class="card"><div class="card-title">${icon("chart")}Par type de fichier</div>
      <div class="st-types-bar">${Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div style="width:${v / totalTyped * 100}%;background:${COLORS[k]}" title="${esc(d.groups[k])} · ${sizeStr(v)}"></div>`).join("")}</div>
      <div class="st-legend">${Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span><i style="background:${COLORS[k]}"></i>${esc(d.groups[k])}<b>${sizeStr(v)}</b></span>`).join("")}</div></div>
    <div class="card"><div class="card-title">${icon("grid")}Carte des dossiers</div>
      <div class="st-crumbs" id="st-crumbs"></div>
      <div class="st-map" id="st-map"></div></div>
    <div class="card"><div class="card-title">${icon("file")}Plus gros fichiers</div>
      ${s.largest.slice(0, 25).map(f => fileRow(f, d.groups)).join("") || `<p class="hint">Aucun fichier de plus de 20 Mo.</p>`}</div>
    ${s.old.length ? `<div class="card"><div class="card-title">${icon("clock")}Gros fichiers oubliés <span class="count">plus de 2 ans sans modification</span></div>
      ${s.old.slice(0, 15).map(f => fileRow(f, d.groups)).join("")}</div>` : ""}`;
  $("#st-scan").onclick = async () => { await api("/api/storage/scan", { json: {} }); carte(el); };
  el.addEventListener("click", deleteHandler(() => carte(el)));
  map(s);
}

function fileRow(f, groups) {
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
  return `<div class="set-row st-file" data-root="${f.root}" data-path="${esc(f.path)}"><span class="st-dot" style="background:${COLORS[groupOf(f.path)]}"></span>
    <div class="txt"><b>${esc(f.path.split("/").pop())}</b><small>${esc(f.label)}${dir ? " / " + esc(dir) : ""} · ${ago(f.mtime)}</small></div>
    <b class="st-size">${sizeStr(f.size)}</b>
    <a class="icon-btn plain" href="#/fichiers/${f.root}/${esc(dir)}?voir=${encodeURIComponent(f.path.split("/").pop())}" title="Voir dans Fichiers">${icon("folder")}</a>
    <button class="icon-btn plain" data-del title="Mettre à la corbeille">${icon("trash")}</button></div>`;
}

const EXT = { video: /\.(mp4|mkv|mov|avi|webm|m4v|wmv|flv|mpe?g|ts|3gp|m2ts)$/i, photo: /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif|raw|cr2|nef|arw|dng|svg)$/i,
  audio: /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff|alac)$/i, doc: /\.(pdf|docx?|odt|rtf|txt|md|xlsx?|ods|csv|pptx?|odp|epub)$/i,
  archive: /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|img|dmg)$/i, app: /\.(exe|msi|apk|deb|rpm|pkg|appimage)$/i };
const groupOf = p => Object.keys(EXT).find(k => EXT[k].test(p)) || "other";

function deleteHandler(after) {
  return async e => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const row = b.closest("[data-path]");
    if (!confirm(`Mettre « ${row.dataset.path.split("/").pop()} » à la corbeille ?`)) return;
    try { const r = await api("/api/storage/delete", { json: { items: [{ root: row.dataset.root, path: row.dataset.path }] } }); toast(`${sizeStr(r.freed)} libérés (dans la corbeille)`); row.remove(); }
    catch (err) { toast(err.message, "err"); }
  };
}

async function map(s) {
  const crumbs = $("#st-crumbs"), box = $("#st-map");
  if (!box) return;
  const r = s.roots.find(x => x.id === nav.root);
  const t = await api(`/api/storage/tree?root=${nav.root}&path=${encodeURIComponent(nav.path)}`).catch(() => null);
  if (!t) { box.innerHTML = `<p class="hint">Réanalyse pour voir la carte.</p>`; return; }
  const parts = nav.path ? nav.path.split("/") : [];
  crumbs.innerHTML = `<select id="st-root">${s.roots.map(x => `<option value="${x.id}" ${x.id === nav.root ? "selected" : ""}>${esc(x.label)} · ${sizeStr(x.size)}</option>`).join("")}</select>
    ${parts.map((p, i) => `<span>›</span><button data-go="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</button>`).join("")}
    <span class="meta">${sizeStr(t.total)}</span>`;
  $("#st-root").onchange = e => { nav = { root: e.target.value, path: "" }; map(s); };
  crumbs.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { nav.path = b.dataset.go; map(s); });
  if (nav.path) crumbs.insertAdjacentHTML("afterbegin", `<button class="icon-btn plain" data-up title="Remonter">${icon("back")}</button>`);
  crumbs.querySelector("[data-up]")?.addEventListener("click", () => { nav.path = parts.slice(0, -1).join("/"); map(s); });
  const items = t.items.filter(i => i.size > 0);
  if (!items.length) { box.innerHTML = `<p class="hint">Dossier vide.</p>`; return; }
  const W = box.clientWidth || 800, H = Math.max(260, Math.min(460, W * .5));
  box.style.height = H + "px";
  const shown = items.slice(0, 40);
  const rest = items.slice(40).reduce((a, i) => a + i.size, 0);
  if (rest) shown.push({ name: `${items.length - 40} autres`, size: rest, other: true });
  const rects = squarify(shown, 0, 0, W, H);
  box.innerHTML = rects.map(({ item: i, x, y, w, h }) => `<div class="st-cell ${i.dir ? "dir" : ""}" ${i.dir ? `data-path="${esc(i.path)}"` : ""}
      style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;--c:${i.dir ? "var(--accent)" : COLORS[i.group || "other"]}" title="${esc(i.name)} · ${sizeStr(i.size)}">
      ${w > 70 && h > 34 ? `<b>${i.dir ? icon("folder") : ""}${esc(i.name)}</b><small>${sizeStr(i.size)}</small>` : ""}</div>`).join("");
  box.onclick = e => { const c = e.target.closest(".st-cell.dir"); if (c) { nav.path = c.dataset.path; map(s); } };
  void r;
}

/** Treemap « squarified » : des rectangles aussi carrés que possible. */
function squarify(items, x, y, w, h) {
  const total = items.reduce((a, i) => a + i.size, 0);
  const scale = w * h / total;
  const nodes = items.map(i => ({ item: i, area: i.size * scale }));
  const out = [];
  const worst = (row, side) => {
    const s = row.reduce((a, n) => a + n.area, 0);
    const max = Math.max(...row.map(n => n.area)), min = Math.min(...row.map(n => n.area));
    return Math.max(side * side * max / (s * s), s * s / (side * side * min));
  };
  let row = [];
  const layout = (row, rx, ry, rw, rh) => {
    const s = row.reduce((a, n) => a + n.area, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      row.forEach(n => { const ch = n.area / cw; out.push({ item: n.item, x: rx, y: cy, w: cw, h: ch }); cy += ch; });
      return [rx + cw, ry, rw - cw, rh];
    }
    const ch = s / rw;
    let cx = rx;
    row.forEach(n => { const cw = n.area / ch; out.push({ item: n.item, x: cx, y: ry, w: cw, h: ch }); cx += cw; });
    return [rx, ry + ch, rw, rh - ch];
  };
  let rect = [x, y, w, h];
  for (const n of nodes) {
    const side = Math.min(rect[2], rect[3]);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { rect = layout(row, ...rect); row = [n]; }
  }
  if (row.length) layout(row, ...rect);
  return out.map(r => ({ ...r, x: Math.round(r.x) + 1, y: Math.round(r.y) + 1, w: Math.max(0, Math.round(r.w) - 2), h: Math.max(0, Math.round(r.h) - 2) }));
}

// --- Doublons ---------------------------------------------------------------
async function doublons(el) {
  const st = await api("/api/storage/dupes");
  if (st.status === "running") { el.innerHTML = progressBox(st, "Recherche des doublons…"); return watch("dupes", el, () => doublons(el)); }
  const res = st.result;
  el.innerHTML = `<form class="card st-dupes-form" id="st-df"><div class="row" style="margin:0">
      <span class="tile">${icon("copy")}</span><div class="grow"><b>Fichiers en double</b><small class="meta" style="display:block">Bêta Tool compare le contenu des fichiers (pas seulement le nom).</small></div>
      <label class="meta">Taille minimale <select name="min"><option value="0.1">100 Ko</option><option value="1" selected>1 Mo</option><option value="10">10 Mo</option><option value="100">100 Mo</option></select></label>
      <button class="btn">${icon("search")}${res ? "Relancer" : "Chercher"}</button></div></form>
    ${st.status === "error" ? `<p class="msg">${esc(st.error)}</p>` : ""}
    <div id="st-dres"></div>`;
  $("#st-df").onsubmit = async e => { e.preventDefault(); await api("/api/storage/dupes", { json: { min_mb: e.target.min.value } }); doublons(el); };
  if (!res) return;
  const out = $("#st-dres");
  if (!res.groups.length) { out.innerHTML = `<div class="card"><div class="empty">${icon("check")}<b>Aucun doublon</b>Tes fichiers sont tous uniques. 👍</div></div>`; return; }
  out.innerHTML = `<div class="card st-dsum"><b>${res.count} fichier${res.count > 1 ? "s" : ""} en plusieurs exemplaires</b> · <span>${sizeStr(res.wasted)} récupérables</span>
      <span class="grow"></span><span class="meta" id="st-dsel"></span><button class="btn danger" id="st-ddel">${icon("trash")}Mettre la sélection à la corbeille</button></div>
    ${res.groups.map((grp, gi) => `<div class="card st-group"><div class="st-ghead"><span class="st-dot" style="background:${COLORS[groupOf(grp.files[0].path)]}"></span>
      <b>${esc(grp.files[0].path.split("/").pop())}</b><span class="meta">${grp.files.length} × ${sizeStr(grp.size)}</span></div>
      ${grp.files.map((f, i) => `<label class="st-dfile"><input type="checkbox" data-g="${gi}" data-root="${f.root}" data-path="${esc(f.path)}" ${i ? "checked" : ""}>
        <span class="grow"><b>${esc(f.label)} / ${esc(f.path)}</b><small>${new Date(f.mtime * 1000).toLocaleDateString("fr-FR")}${i === 0 ? " · le plus ancien" : ""}</small></span></label>`).join("")}</div>`).join("")}`;
  const sync = () => {
    const sel = [...out.querySelectorAll("input:checked")];
    const size = sel.reduce((a, cb) => a + res.groups[cb.dataset.g].size, 0);
    $("#st-dsel").textContent = `${sel.length} sélectionné${sel.length > 1 ? "s" : ""} · ${sizeStr(size)}`;
    out.querySelectorAll(".st-group").forEach(gEl => gEl.classList.toggle("allsel", [...gEl.querySelectorAll("input")].every(c => c.checked)));
  };
  out.addEventListener("change", sync);
  sync();
  $("#st-ddel").onclick = async () => {
    const sel = [...out.querySelectorAll("input:checked")];
    if (out.querySelector(".st-group.allsel") && !confirm("Dans certains groupes, tous les exemplaires sont cochés : il n'en restera aucun. Continuer ?")) return;
    try {
      const r = await api("/api/storage/delete", { json: { items: sel.map(cb => ({ root: cb.dataset.root, path: cb.dataset.path })) } });
      toast(`${r.count} fichier${r.count > 1 ? "s" : ""} à la corbeille · ${sizeStr(r.freed)} libérés`);
      doublons(el);
    } catch (err) { toast(err.message, "err"); }
  };
}

// --- Rangement --------------------------------------------------------------
const ACTION = { move: ["Déplacer", "move"], delete: ["Corbeille", "trash"], rmdir: ["Supprimer", "trash"], paperasse: ["Paperasse", "receipt"], info: ["À vérifier", "eye"] };

async function rangement(el) {
  const [st, rts] = await Promise.all([api("/api/storage/tidy"), api("/api/files/roots").catch(() => [])]);
  const list = Array.isArray(rts) ? rts : rts.roots || [];
  if (!tidyForm.root) tidyForm.root = list.find(r => r.id === "telechargements")?.id || list[0]?.id || "";
  if (st.status === "running") { el.innerHTML = progressBox(st, "Analyse du dossier…"); return watch("tidy", el, () => rangement(el)); }
  el.innerHTML = `<form class="card" id="st-tf">
      <div class="card-title">${icon("sparkles")}Ranger un dossier</div>
      <p class="hint" style="margin-top:-6px">Bêta Tool regarde chaque fichier (type, date des photos, contenu des documents…) et te propose où le ranger. Rien ne bouge sans ton accord.</p>
      <div class="row"><select name="root">${list.map(r => `<option value="${r.id}" ${r.id === tidyForm.root ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
        <input type="text" name="path" class="grow" placeholder="Sous-dossier (vide = tout le dossier)" value="${esc(tidyForm.path)}">
        <button class="btn">${icon("search")}Analyser</button></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="recursive" ${tidyForm.recursive ? "checked" : ""}> Inclure les sous-dossiers</label>
        <label class="check"><input type="checkbox" name="read_docs" ${tidyForm.read_docs ? "checked" : ""}> Lire les documents (factures, fiches de paie… → Paperasse)</label></div>
    </form>
    ${st.status === "error" ? `<p class="msg">${esc(st.error)}</p>` : ""}
    <div id="st-plan"></div>`;
  $("#st-tf").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    tidyForm = { root: f.root.value, path: f.path.value, recursive: f.recursive.checked, read_docs: f.read_docs.checked };
    try { await api("/api/storage/tidy", { json: tidyForm }); rangement(el); } catch (err) { toast(err.message, "err"); }
  };
  const res = st.result;
  if (!res) return;
  const items = res.items.filter(i => !i.applied);
  const plan = $("#st-plan");
  if (!items.length) { plan.innerHTML = `<div class="card"><div class="empty">${icon("check")}<b>Tout est déjà bien rangé</b>Aucune suggestion pour ce dossier.</div></div>`; return; }
  const groups = {};
  items.forEach(i => (groups[i.group] ||= []).push(i));
  const order = Object.keys(groups).sort((a, b) => (a === "À supprimer") - (b === "À supprimer") || (a === "À vérifier") - (b === "À vérifier") || groups[b].length - groups[a].length);
  plan.innerHTML = `<div class="card st-dsum"><b>${items.length} suggestion${items.length > 1 ? "s" : ""}</b><span class="grow"></span>
      <span class="meta" id="st-tsel"></span><button class="btn ghost small" id="st-undo">${icon("undo")}Annuler le dernier rangement</button>
      <button class="btn" id="st-apply">${icon("check")}Appliquer</button></div>
    ${order.map(gname => {
      const its = groups[gname];
      const first = its[0];
      const dest = first.action === "move" ? `${first.dest_root === res.root ? "" : first.dest_root + " / "}${its.every(i => i.dest_path === first.dest_path) ? first.dest_path : first.dest_path.split("/").slice(0, -1).join("/") + "/…"}` : "";
      return `<div class="card st-tgroup"><label class="st-ghead"><input type="checkbox" data-group="${esc(gname)}" ${first.action === "info" ? "" : "checked"}>
          <span class="tile ${first.action === "delete" || first.action === "rmdir" ? "rose" : first.action === "paperasse" ? "bleu-vert" : ""}">${icon(ACTION[first.action][1])}</span>
          <b>${esc(gname)}</b><span class="meta">${its.length} élément${its.length > 1 ? "s" : ""}${dest ? ` → ${esc(dest)}` : ""}</span></label>
        <div class="st-titems">${its.map(i => `<label class="st-dfile"><input type="checkbox" data-id="${i.id}" data-g="${esc(gname)}" ${i.action === "info" ? "disabled" : "checked"}>
          <span class="grow"><b>${esc(i.name)}</b><small>${esc(i.reason)}${i.action === "move" && its.some(x => x.dest_path !== i.dest_path) ? ` → ${esc(i.dest_path)}` : ""}</small></span>
          <span class="meta">${i.size ? sizeStr(i.size) : ""}</span></label>`).join("")}</div></div>`;
    }).join("")}`;
  const sync = () => { $("#st-tsel").textContent = `${plan.querySelectorAll("[data-id]:checked").length} sélectionné(s)`; };
  plan.addEventListener("change", e => {
    if (e.target.dataset.group) plan.querySelectorAll(`[data-g="${CSS.escape(e.target.dataset.group)}"]:not(:disabled)`).forEach(cb => { cb.checked = e.target.checked; });
    sync();
  });
  sync();
  $("#st-apply").onclick = async () => {
    const ids = [...plan.querySelectorAll("[data-id]:checked")].map(cb => cb.dataset.id);
    if (!ids.length) return toast("Rien de sélectionné", "err");
    try {
      const r = await api("/api/storage/tidy/apply", { json: { ids } });
      toast(`${r.done} élément${r.done > 1 ? "s" : ""} rangé${r.done > 1 ? "s" : ""}${r.errors.length ? ` · ${r.errors.length} erreur(s)` : ""}`, r.errors.length ? "err" : "ok");
      rangement(el);
    } catch (err) { toast(err.message, "err"); }
  };
  $("#st-undo").onclick = async () => {
    const r = await api("/api/storage/tidy/undo", { json: {} });
    toast(r.restored ? `${r.restored} fichier${r.restored > 1 ? "s" : ""} remis à leur place` : "Rien à annuler");
  };
}

export function leave() { clearInterval(timer); }
