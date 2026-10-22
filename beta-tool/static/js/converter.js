// Outil « Convertisseur ».
import { $, esc, sizeStr, toast, dropzone } from "./ui.js";
import { renderJobs, jobBlock } from "./jobs.js";

const ALIASES = { jpeg: "jpg", tif: "tiff", htm: "html", markdown: "md", heif: "heic", oga: "ogg" };
const LABELS = { queued: "En attente", converting: "Conversion", done: "Terminé", error: "Erreur" };
let engines = [];
let pending = [];  // { file, ext, targets, target, progress }
let timer = null;

const extOf = name => { const m = /\.([^.]+)$/.exec(name); const e = m ? m[1].toLowerCase() : ""; return ALIASES[e] || e; };
function targetsFor(ext) {
  const out = new Set();
  engines.filter(e => e.inputs.includes(ext)).forEach(e => e.outputs.forEach(o => o !== ext && out.add(o)));
  return [...out];
}

export function init() {
  fetch("/api/convert/formats").then(r => r.json()).then(list => {
    engines = list;
    $("#cv-formats").innerHTML = list.map(e =>
      `<dt>${esc(e.label)}</dt><dd>${e.inputs.map(esc).join(", ")} → ${e.outputs.map(esc).join(", ")} <small>(${esc(e.tool)})</small></dd>`).join("");
  });

  dropzone($("#cv-drop"), $("#cv-input"), addFiles);
  $("#cv-files").addEventListener("change", e => { if (e.target.dataset.i) pending[e.target.dataset.i].target = e.target.value; });
  $("#cv-files").addEventListener("click", e => {
    const b = e.target.closest("[data-remove]");
    if (b) { pending.splice(+b.dataset.remove, 1); renderPending(); }
  });
  $("#cv-all").addEventListener("change", e => {
    if (!e.target.value) return;
    pending.forEach(p => { if (p.targets.includes(e.target.value)) p.target = e.target.value; });
    renderPending();
  });
  $("#cv-go").addEventListener("click", convertAll);
}

function addFiles(files) {
  for (const file of files) {
    const ext = extOf(file.name);
    const targets = targetsFor(ext);
    pending.push({ file, ext, targets, target: targets[0] });
  }
  renderPending();
}

function renderPending() {
  $("#cv-pending").hidden = !pending.length;
  $("#cv-files").innerHTML = pending.map((p, i) => `
    <div class="file">
      <span class="ficon">${esc(p.ext.slice(0, 4) || "?")}</span>
      <div class="name">${esc(p.file.name)}<small>${esc(sizeStr(p.file.size))}${p.progress != null ? " · envoi " + p.progress + " %" : ""}</small></div>
      <span class="pick">${p.targets.length
        ? `→ <select data-i="${i}">${p.targets.map(t => `<option ${t === p.target ? "selected" : ""}>${t}</option>`).join("")}</select>`
        : `<span class="bad">Format non pris en charge</span>`}
      <button class="icon-btn plain" data-remove="${i}" title="Retirer">✕</button></span>
    </div>`).join("");
  const ok = pending.filter(p => p.targets.length);
  const common = ok.length ? ok[0].targets.filter(t => ok.every(p => p.targets.includes(t))) : [];
  $("#cv-all").innerHTML = `<option value="">—</option>` + common.map(t => `<option>${t}</option>`).join("");
  $("#cv-go").disabled = !ok.length;
}

function upload(p) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", p.file);
    form.append("target", p.target);
    form.append("nas", $("#cv-nas").checked ? "1" : "0");
    form.append("subfolder", $("#cv-subfolder").value);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/convert");
    xhr.upload.onprogress = e => { if (e.lengthComputable) { p.progress = Math.round(e.loaded * 100 / e.total); renderPending(); } };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status === 200 ? resolve(data) : reject(new Error(data.error || `Erreur ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Connexion perdue"));
    xhr.send(form);
  });
}

async function convertAll() {
  $("#cv-go").disabled = true; $("#cv-msg").textContent = "";
  const errors = [];
  let sent = 0;
  for (const p of pending.filter(p => p.targets.length)) {
    try {
      await upload(p);
      pending.splice(pending.indexOf(p), 1);
      sent++;
      refresh();
    } catch (err) { p.progress = null; errors.push(`${p.file.name} : ${err.message}`); }
    renderPending();
  }
  if (sent) toast(sent > 1 ? `${sent} fichiers envoyés en conversion` : "Fichier envoyé en conversion");
  $("#cv-msg").textContent = errors.join(" · ");
}

async function refresh() {
  try {
    const jobs = await (await fetch("/api/convert/jobs")).json();
    renderJobs($("#cv-jobs"), jobs, j => {
      const parts = [`${j.ext.toUpperCase()} → ${j.target.toUpperCase()}`, j.engine];
      if (j.status === "converting" && j.progress != null) parts.push(j.progress + " %");
      if (j.status === "done") parts.push(sizeStr(j.size), j.saved && "NAS : " + j.saved);
      if (j.error) parts.push(j.error);
      const btn = j.status === "done" ? `<a class="btn small" href="/api/convert/${j.id}/file">Télécharger</a>` : "";
      return jobBlock(j, { title: j.status === "done" ? j.output : j.name, label: LABELS[j.status] || j.status,
                           meta: parts.filter(Boolean).join(" · "), pct: j.progress, extra: btn, glyph: esc(j.target.slice(0, 4)) });
    }, "Aucune conversion pour l'instant. Ajoute un fichier pour commencer.");
  } catch {}
}

export function show() {
  refresh();
  clearInterval(timer);
  timer = setInterval(() => { if (!$("[data-view=convertir]").hidden) refresh(); else clearInterval(timer); }, 1500);
}
