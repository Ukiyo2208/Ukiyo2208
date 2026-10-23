// Outil « Transcription » : audio / vidéo → texte et sous-titres, en local.
import { $, esc, icon, toast, modal, sizeStr, dropzone, dropHTML } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const LANGS = [["fr", "Français"], ["en", "Anglais"], ["es", "Espagnol"], ["de", "Allemand"], ["it", "Italien"], ["pt", "Portugais"],
               ["nl", "Néerlandais"], ["ar", "Arabe"], ["ja", "Japonais"], ["zh", "Chinois"], ["", "Détection automatique"]];
const STATUS = { queued: "En attente", running: "En cours", done: "Terminé", error: "Erreur" };
const enc = encodeURIComponent;
let src = null, timer = null;

export async function render(root, parts, query) {
  const info = await api("/api/transcribe/models").catch(() => ({ available: false }));
  root.innerHTML = pageHead("transcription") + (info.available ? `
    <div class="card" id="tr-src">${dropHTML("tr-drop", { accept: "audio/*,video/*", title: "Glisse un audio ou une vidéo", sub: "MP3, M4A, WAV, MP4, MKV… ou clique pour choisir", tile: "vert" })}</div>
    <form class="card" id="tr-form">
      <div class="grid2">
        <div><label class="field">Langue parlée</label><select name="language" style="width:100%">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div><label class="field">Précision</label><select name="model" style="width:100%">${Object.entries(info.models).map(([k, d]) =>
          `<option value="${esc(k)}" ${k === info.default ? "selected" : ""}>${esc(k.split("/").pop())} · ${esc(d)}${info.downloaded.includes(k) || k.includes("/") ? "" : " (téléchargé au 1er usage)"}</option>`).join("")}</select></div>
      </div>
      <div class="row"><div class="seg"><label><input type="radio" name="task" value="transcribe" checked>Transcrire</label>
        <label><input type="radio" name="task" value="translate">Traduire en anglais</label></div></div>
      <div class="row" style="margin-top:0"><label class="check"><input type="checkbox" name="save" checked> <span id="tr-save-label">Enregistrer les sous-titres sur le NAS</span></label>
        <select name="save_format"><option value="srt">.srt</option><option value="vtt">.vtt</option><option value="txt">.txt</option></select></div>
      <button class="btn wide" id="tr-go" disabled>${icon("mic")}Lancer la transcription</button>
      <p class="hint">Tout se fait sur le NAS. Compte environ la durée du fichier avec la précision « small » sur un NAS récent.</p>
    </form>
    <div class="card"><div class="card-title">${icon("clock")}Transcriptions</div><div id="tr-jobs"></div></div>`
    : `<div class="card"><div class="empty">${icon("mic")}<b>Moteur de transcription absent</b>Reconstruis l'image Docker (faster-whisper est inclus dans requirements.txt).</div></div>`);
  if (!info.available) return;
  const z = $("#tr-drop");
  dropzone(z, z.querySelector("input"), files => setSource({ file: files[0], name: files[0].name, size: files[0].size }));
  if (query.path) setSource({ root: query.root, path: query.path, name: query.path.split("/").pop() });
  $("#tr-form").onsubmit = submit;
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, 2500);
}

function setSource(s) {
  src = s;
  $("#tr-src").innerHTML = `<div class="files"><div class="file"><span class="ficon">${icon(s.name.match(/\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i) ? "music" : "film")}</span>
    <div class="name">${esc(s.name)}<small>${s.size ? sizeStr(s.size) : "Fichier du NAS"}</small></div>
    <span class="pick"><button class="btn small ghost" data-change>${icon("file")}Autre fichier</button></span></div></div>`;
  $("#tr-src [data-change]").onclick = () => { history.replaceState(null, "", "#/transcription"); render($("#dyn-root"), [], {}); };
  $("#tr-save-label").textContent = s.root ? "Enregistrer les sous-titres à côté du fichier (Plex, Jellyfin, VLC les trouvent tout seuls)" : "Enregistrer aussi dans Conversions / Transcriptions";
  $("#tr-go").disabled = false;
}

async function submit(e) {
  e.preventDefault();
  const f = e.target;
  const opts = { language: f.language.value, model: f.model.value, task: f.task.value, save: f.save.checked, save_format: f.save_format.value };
  const btn = $("#tr-go");
  btn.disabled = true;
  try {
    if (src.root) await api("/api/transcribe", { json: { root: src.root, path: src.path, ...opts } });
    else {
      const form = new FormData();
      form.append("file", src.file);
      Object.entries(opts).forEach(([k, v]) => form.append(k, typeof v === "boolean" ? (v ? "1" : "0") : v));
      await api("/api/transcribe", { method: "POST", body: form });
    }
    toast("Transcription lancée : tu seras prévenu à la fin");
    refresh();
  } catch (err) { toast(err.message, "err"); }
  btn.disabled = false;
}

const t = s => { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };

async function refresh() {
  const box = $("#tr-jobs");
  if (!box) return clearInterval(timer);
  const jobs = await api("/api/transcribe/jobs").catch(() => []);
  box.innerHTML = jobs.length ? jobs.map(j => `<div class="job ${j.status === "running" ? "" : j.status}">
    <span class="ficon">${icon("mic")}</span>
    <div class="body"><div class="head"><div class="title">${esc(j.name)}</div><span class="status">${STATUS[j.status]}</span>
      ${j.status === "done" ? `<button class="btn small" data-view="${j.id}">${icon("eye")}Lire</button>
        ${["txt", "srt", "vtt"].map(f => `<a class="btn small ghost" href="/api/transcribe/${j.id}/${f}">${f.toUpperCase()}</a>`).join("")}` : ""}
      ${["done", "error"].includes(j.status) ? `<button class="icon-btn plain" data-del="${j.id}" title="Retirer">${icon("x")}</button>` : ""}</div>
      <div class="meta">${j.status === "done" ? `${j.words} mots · ${t(j.duration)} · langue : ${esc(j.language)}${j.saved ? " · enregistré : " + esc(j.saved) : ""}`
        : j.status === "error" ? esc(j.error) : esc(j.step || "En attente…") + (j.progress != null ? ` · ${j.progress} %` : "")} · ${ago(j.created)}</div>
      ${["queued", "running"].includes(j.status) ? `<div class="bar ${j.progress == null ? "indeterminate" : ""}"><div style="width:${j.progress || 0}%"></div></div>` : ""}
    </div></div>`).join("") : `<div class="empty">${icon("mic")}Aucune transcription pour l'instant.</div>`;
  box.onclick = async e => {
    const view = e.target.closest("[data-view]")?.dataset.view, del = e.target.closest("[data-del]")?.dataset.del;
    if (del) { await api(`/api/transcribe/${del}`, { method: "DELETE" }); refresh(); }
    if (view) {
      const d = await api(`/api/transcribe/${view}`);
      const text = d.segments.map(s => s.text).join("\n");
      const m = modal("Transcription", `<div class="segs">${d.segments.map(s => `<p><span class="ts">${t(s.start)}</span>${esc(s.text)}</p>`).join("")}</div>
        <div class="modal-foot"><button class="btn" data-copy>${icon("copy")}Copier le texte</button></div>`, { ic: "mic", large: true });
      m.querySelector("[data-copy]").onclick = async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast("Texte copié"); };
    }
  };
}

export function leave() { clearInterval(timer); }
