// Outil « Compresseur vidéo » : taille cible ou qualité, découpe, redimensionnement.
import { $, $$, esc, icon, toast, modal, sizeStr, dropzone, dropHTML } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const PRESETS = [[10, "Discord"], [16, "WhatsApp"], [25, "E-mail"], [50, ""], [100, ""]];
const STATUS = { queued: "En attente", running: "En cours", done: "Terminé", error: "Erreur" };
const enc = encodeURIComponent;
let src = null, timer = null;

export async function render(root, parts, query) {
  root.innerHTML = pageHead("video") + `
    <div class="card" id="vd-src">${dropHTML("vd-drop", { accept: "video/*", title: "Glisse ta vidéo ici", sub: "ou clique pour la choisir · MP4, MOV, MKV, AVI…", tile: "rose" })}</div>
    <div id="vd-edit"></div>
    <div class="card"><div class="card-title">${icon("clock")}Compressions</div><div id="vd-jobs"></div></div>`;
  const z = $("#vd-drop");
  dropzone(z, z.querySelector("input"), files => setSource({ file: files[0], name: files[0].name, size: files[0].size, url: URL.createObjectURL(files[0]) }));
  if (query.path) setSource({ root: query.root, path: query.path, name: query.path.split("/").pop(), url: `/api/fs/raw?root=${enc(query.root)}&path=${enc(query.path)}` });
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, 2000);
}

function setSource(s) {
  src = s;
  $("#vd-src").innerHTML = `<div class="files"><div class="file"><span class="ficon">${icon("film")}</span>
    <div class="name">${esc(s.name)}<small>${s.size ? sizeStr(s.size) : "Fichier du NAS"}</small></div>
    <span class="pick"><button class="btn small ghost" data-change>${icon("file")}Autre vidéo</button></span></div></div>`;
  $("#vd-src [data-change]").onclick = () => { history.replaceState(null, "", "#/video"); render($("#dyn-root"), [], {}); };
  $("#vd-edit").innerHTML = `<div class="card">
    <div class="vd-grid">
      <div>
        <video id="vd-video" src="${s.url}" controls playsinline preload="metadata"></video>
        <div class="trim">
          <div class="trim-bar"><span id="trim-fill"></span><input type="range" id="t-start" min="0" max="100" step="0.1" value="0"><input type="range" id="t-end" min="0" max="100" step="0.1" value="100"></div>
          <div class="row" style="margin:8px 0 0">
            <button class="btn small ghost" data-t="start">${icon("left")}Début ici</button>
            <span class="grow center meta" id="t-label">—</span>
            <button class="btn small ghost" data-t="end">Fin ici${icon("right")}</button>
          </div>
        </div>
      </div>
      <form id="vd-form">
        <label class="field">Objectif</label>
        <div class="seg"><label><input type="radio" name="mode" value="size" checked>${icon("compress")}Taille cible</label>
          <label><input type="radio" name="mode" value="quality">${icon("star")}Qualité</label></div>
        <div data-for="size" style="margin-top:14px">
          <div class="chips presets">${PRESETS.map(([mb, l]) => `<button type="button" class="chip ${mb === 25 ? "on" : ""}" data-mb="${mb}">${mb} Mo${l ? " · " + l : ""}</button>`).join("")}</div>
          <div class="row"><input type="number" name="target_mb" value="25" min="1" step="1" style="width:110px"> <span class="meta">Mo maximum</span></div>
        </div>
        <div data-for="quality" hidden style="margin-top:14px">
          <div class="seg"><label><input type="radio" name="quality" value="haute">Haute</label><label><input type="radio" name="quality" value="bonne" checked>Bonne</label><label><input type="radio" name="quality" value="legere">Légère</label></div>
        </div>
        <label class="field" style="margin-top:14px">Résolution</label>
        <select name="height" style="width:100%"><option value="0">Automatique</option><option value="1080">1080p (Full HD)</option><option value="720">720p (HD)</option><option value="480">480p</option><option value="360">360p</option></select>
        <div class="row"><label class="check"><input type="checkbox" name="mute"> Supprimer le son</label></div>
        <div class="row" style="margin-top:0"><label class="check"><input type="checkbox" name="save" checked> Garder une copie sur le NAS</label></div>
        <button class="btn wide" id="vd-go">${icon("compress")}Compresser</button>
      </form>
    </div></div>`;
  const v = $("#vd-video"), a = $("#t-start"), b = $("#t-end");
  const paint = () => {
    const d = v.duration || 0;
    const s0 = +a.value / 100 * d, s1 = +b.value / 100 * d;
    $("#trim-fill").style.left = a.value + "%";
    $("#trim-fill").style.width = (b.value - a.value) + "%";
    $("#t-label").textContent = d ? `${fmt(s0)} → ${fmt(s1)} · ${fmt(s1 - s0)} gardées` : "—";
  };
  v.addEventListener("loadedmetadata", paint);
  const seek = pct => { if (Number.isFinite(v.duration)) v.currentTime = pct / 100 * v.duration; };
  a.oninput = () => { if (+a.value > +b.value - 1) a.value = +b.value - 1; seek(+a.value); paint(); };
  b.oninput = () => { if (+b.value < +a.value + 1) b.value = +a.value + 1; seek(+b.value); paint(); };
  $$("[data-t]").forEach(btn => btn.onclick = () => {
    if (!Number.isFinite(v.duration)) return;
    const pct = v.currentTime / v.duration * 100;
    btn.dataset.t === "start" ? (a.value = Math.min(pct, +b.value - 1)) : (b.value = Math.max(pct, +a.value + 1));
    paint();
  });
  const form = $("#vd-form");
  form.querySelectorAll("[name=mode]").forEach(r => r.onchange = () => form.querySelectorAll("[data-for]").forEach(d => { d.hidden = d.dataset.for !== r.value; }));
  form.querySelectorAll("[data-mb]").forEach(c => c.onclick = () => {
    form.querySelectorAll("[data-mb]").forEach(x => x.classList.toggle("on", x === c));
    form.target_mb.value = c.dataset.mb;
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const d = v.duration || 0;
    const opts = {
      mode: form.mode.value, target_mb: form.target_mb.value, quality: form.quality.value, height: form.height.value,
      start: d && +a.value > 0 ? (+a.value / 100 * d).toFixed(2) : "", end: d && +b.value < 100 ? (+b.value / 100 * d).toFixed(2) : "",
      mute: form.mute.checked, save: form.save.checked,
    };
    const btn = $("#vd-go");
    btn.disabled = true;
    try {
      if (src.root) await api("/api/video", { json: { root: src.root, path: src.path, ...opts } });
      else await upload(opts, btn);
      toast("Compression lancée : tu seras prévenu à la fin");
      refresh();
    } catch (err) { toast(err.message, "err"); }
    btn.disabled = false;
    btn.innerHTML = `${icon("compress")}Compresser`;
  };
}

function upload(opts, btn) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", src.file);
    Object.entries(opts).forEach(([k, v]) => form.append(k, typeof v === "boolean" ? (v ? "1" : "0") : v));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/video");
    xhr.upload.onprogress = e => { if (e.lengthComputable) btn.textContent = `Envoi… ${Math.round(e.loaded / e.total * 100)} %`; };
    xhr.onload = () => { const d = JSON.parse(xhr.responseText || "{}"); xhr.status === 200 ? resolve(d) : reject(new Error(d.error || "Erreur")); };
    xhr.onerror = () => reject(new Error("Connexion perdue"));
    xhr.send(form);
  });
}

const fmt = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };

async function refresh() {
  const box = $("#vd-jobs");
  if (!box) return clearInterval(timer);
  const jobs = await api("/api/video/jobs").catch(() => []);
  box.innerHTML = jobs.length ? jobs.map(j => {
    const gain = j.size && j.before ? Math.round((1 - j.size / j.before) * 100) : null;
    return `<div class="job ${j.status === "running" ? "" : j.status}">
      <span class="ficon">${icon("film")}</span>
      <div class="body"><div class="head"><div class="title">${esc(j.status === "done" ? j.output : j.name)}</div>
        <span class="status">${STATUS[j.status]}</span>
        ${j.status === "done" ? `<button class="btn small ghost" data-play="${j.id}">${icon("play")}</button><a class="btn small" href="/api/video/${j.id}/file">${icon("download")}Télécharger</a>` : ""}
        ${["done", "error"].includes(j.status) ? `<button class="icon-btn plain" data-del="${j.id}" title="Retirer">${icon("x")}</button>` : ""}</div>
        <div class="meta">${j.status === "done" ? `${sizeStr(j.before)} → <b>${sizeStr(j.size)}</b>${gain != null ? (gain >= 0 ? ` (−${gain} %)` : ` (+${-gain} %)`) : ""} · ${j.duration} s${j.saved ? " · NAS : " + esc(j.saved) : ""}`
          : j.status === "error" ? esc(j.error) : esc(j.step || "En attente…") + (j.progress != null ? ` · ${j.progress} %` : "")} · ${ago(j.created)}</div>
        ${["queued", "running"].includes(j.status) ? `<div class="bar ${j.progress == null ? "indeterminate" : ""}"><div style="width:${j.progress || 0}%"></div></div>` : ""}
      </div></div>`;
  }).join("") : `<div class="empty">${icon("film")}Aucune compression pour l'instant.</div>`;
  box.onclick = async e => {
    const play = e.target.closest("[data-play]")?.dataset.play, del = e.target.closest("[data-del]")?.dataset.del;
    if (play) modal("Aperçu", `<div class="pv pv-video"><video src="/api/video/${play}/file?dl=0" controls autoplay playsinline></video></div>`, { ic: "film", large: true });
    if (del) { await api(`/api/video/${del}`, { method: "DELETE" }); refresh(); }
  };
}

export function leave() { clearInterval(timer); }
