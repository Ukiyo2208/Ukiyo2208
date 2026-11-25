const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sizeStr = b => b == null ? "" : b < 1024 ? b + " o" : b < 1024 ** 2 ? (b / 1024).toFixed(0) + " Ko" : b < 1024 ** 3 ? (b / 1024 ** 2).toFixed(1) + " Mo" : (b / 1024 ** 3).toFixed(2) + " Go";

// --- Navigation -------------------------------------------------------------
function route() {
  const view = location.hash.replace(/^#\/?/, "") || "home";
  const known = ["home", "telecharger", "convertir"].includes(view) ? view : "home";
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== "view-" + known);
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.view === known));
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);
route();

function renderJobs(el, jobs, row) {
  if (jobs.length) el.innerHTML = jobs.map(row).join("");
}
function jobBlock(j, title, meta, pct, extra = "") {
  const indet = pct == null && !["done", "error", "queued"].includes(j.status);
  return `<div class="job ${j.status}"><div class="head"><div class="title">${esc(title)}</div>${extra}</div>
    <div class="meta">${esc(meta)}</div>
    <div class="bar ${indet ? "indeterminate" : ""}"><div style="width:${j.status === "done" ? 100 : pct || 0}%"></div></div></div>`;
}

// --- Téléchargeur -----------------------------------------------------------
const dlLabels = { queued:"En attente", starting:"Démarrage…", downloading:"Téléchargement", processing:"Fusion / conversion…", done:"Terminé ✔", error:"Erreur" };

$("dl-url").addEventListener("focus", async () => {
  if ($("dl-url").value) return;
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (/^https?:\/\//.test(t)) $("dl-url").value = t;
  } catch {}
});

$("dl-form").addEventListener("submit", async e => {
  e.preventDefault();
  $("dl-go").disabled = true; $("dl-msg").textContent = "";
  try {
    const r = await fetch("/api/download", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: $("dl-url").value, mode: document.querySelector("[name=dl-mode]:checked").value, subfolder: $("dl-subfolder").value })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Erreur");
    $("dl-url").value = "";
    refreshDownloads();
  } catch (err) { $("dl-msg").textContent = err.message; }
  $("dl-go").disabled = false;
});

async function refreshDownloads() {
  try {
    const jobs = await (await fetch("/api/download/jobs")).json();
    renderJobs($("dl-jobs"), jobs, j => {
      let meta = dlLabels[j.status] || j.status;
      if (j.status === "downloading") meta += ` · ${j.progress ?? "?"}%${j.speed ? " · " + j.speed : ""}${j.eta ? " · reste " + j.eta : ""}`;
      if (j.error) meta += " — " + j.error;
      meta += ` · ${j.mode === "audio" ? "Audio" : "Vidéo"}${j.subfolder ? " → " + j.subfolder : ""}`;
      return jobBlock(j, j.title, meta, j.progress);
    });
  } catch {}
}

// --- Convertisseur ----------------------------------------------------------
const ALIASES = { jpeg:"jpg", tif:"tiff", htm:"html", markdown:"md", heif:"heic", oga:"ogg" };
let engines = [];
let pending = [];  // { file, ext, targets, target }

const extOf = name => { const m = /\.([^.]+)$/.exec(name); const e = m ? m[1].toLowerCase() : ""; return ALIASES[e] || e; };
function targetsFor(ext) {
  const out = new Set();
  engines.filter(e => e.inputs.includes(ext)).forEach(e => e.outputs.forEach(o => o !== ext && out.add(o)));
  return [...out];
}

fetch("/api/convert/formats").then(r => r.json()).then(list => {
  engines = list;
  $("cv-formats").innerHTML = list.map(e =>
    `<dt>${esc(e.label)}</dt><dd>${e.inputs.map(esc).join(", ")} → ${e.outputs.map(esc).join(", ")} <small>(${esc(e.tool)})</small></dd>`).join("");
});

function addFiles(files) {
  for (const file of files) {
    const ext = extOf(file.name);
    const targets = targetsFor(ext);
    pending.push({ file, ext, targets, target: targets[0] });
  }
  renderPending();
}

function renderPending() {
  $("cv-pending").hidden = !pending.length;
  $("cv-files").innerHTML = pending.map((p, i) => `
    <div class="file">
      <div class="name">${esc(p.file.name)}<small>${esc(sizeStr(p.file.size))}${p.progress != null ? " · envoi " + p.progress + "%" : ""}</small></div>
      <span class="pick">${p.targets.length
        ? `→ <select data-i="${i}">${p.targets.map(t => `<option ${t === p.target ? "selected" : ""}>${t}</option>`).join("")}</select>`
        : `<span class="bad">Format non pris en charge</span>`}
      <button class="link" data-remove="${i}" title="Retirer">✕</button></span>
    </div>`).join("");
  // « Tout convertir en » : formats communs à tous les fichiers pris en charge
  const ok = pending.filter(p => p.targets.length);
  const common = ok.length ? ok[0].targets.filter(t => ok.every(p => p.targets.includes(t))) : [];
  $("cv-all").innerHTML = `<option value="">—</option>` + common.map(t => `<option>${t}</option>`).join("");
  $("cv-go").disabled = !ok.length;
}

$("cv-files").addEventListener("change", e => { if (e.target.dataset.i) pending[e.target.dataset.i].target = e.target.value; });
$("cv-files").addEventListener("click", e => {
  if (e.target.dataset.remove != null) { pending.splice(+e.target.dataset.remove, 1); renderPending(); }
});
$("cv-all").addEventListener("change", e => {
  if (!e.target.value) return;
  pending.forEach(p => { if (p.targets.includes(e.target.value)) p.target = e.target.value; });
  renderPending();
});
$("cv-input").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
const drop = $("cv-drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));

function upload(p) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", p.file);
    form.append("target", p.target);
    form.append("nas", $("cv-nas").checked ? "1" : "0");
    form.append("subfolder", $("cv-subfolder").value);
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

$("cv-go").addEventListener("click", async () => {
  $("cv-go").disabled = true; $("cv-msg").textContent = "";
  const errors = [];
  for (const p of pending.filter(p => p.targets.length)) {
    try {
      await upload(p);
      pending.splice(pending.indexOf(p), 1);
      refreshConversions();
    } catch (err) { p.progress = null; errors.push(`${p.file.name} : ${err.message}`); }
    renderPending();
  }
  $("cv-msg").textContent = errors.join(" · ");
});

const cvLabels = { queued:"En attente", converting:"Conversion…", done:"Terminé ✔", error:"Erreur" };
async function refreshConversions() {
  try {
    const jobs = await (await fetch("/api/convert/jobs")).json();
    renderJobs($("cv-jobs"), jobs, j => {
      let meta = `${j.ext.toUpperCase()} → ${j.target.toUpperCase()} · ${cvLabels[j.status] || j.status}`;
      if (j.status === "converting" && j.progress != null) meta += ` · ${j.progress}%`;
      if (j.status === "done") meta += ` · ${sizeStr(j.size)}${j.saved ? " · sur le NAS : " + j.saved : ""}`;
      if (j.error) meta += " — " + j.error;
      const btn = j.status === "done" ? `<a class="btn small" href="/api/convert/${j.id}/file">Télécharger</a>` : "";
      return jobBlock(j, j.status === "done" ? j.output : j.name, meta, j.progress, btn);
    });
  } catch {}
}

refreshDownloads();
refreshConversions();
setInterval(() => {
  const view = location.hash.replace(/^#\/?/, "");
  if (view === "telecharger") refreshDownloads();
  if (view === "convertir") refreshConversions();
}, 1500);
