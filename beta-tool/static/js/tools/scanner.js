// Outil « Scanner » : photos de documents → pages redressées et nettoyées → PDF.
import { $, esc, icon, toast } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";
import * as core from "../scan-core.js";

const FILTERS = [["magic", "Document", "sparkles"], ["auto", "Couleurs", "sun"], ["gray", "Gris", "droplet"], ["bw", "Noir et blanc", "type"], ["original", "Original", "image"]];
let pages = [], cur = -1, dest = "nas", stream = null;

export async function render(root, parts, query) {
  if (query?.dest === "paperasse") dest = "paperasse";
  root.innerHTML = pageHead("scanner") + `<div id="sc-body"></div>`;
  paint();
}

function paint() {
  const el = $("#sc-body");
  if (!el) return;
  if (!pages.length) {
    el.innerHTML = `<div class="card sc-start">
      <span class="tile violet sc-big">${icon("scan")}</span>
      <h2>Scanne un document</h2>
      <p class="meta">Pose la feuille sur une surface sombre, bien éclairée, et prends-la en photo. Bêta Tool trouve les bords, redresse la page et la nettoie.</p>
      <div class="sc-actions">
        <label class="btn"><input type="file" accept="image/*" capture="environment" hidden data-in>${icon("camera")}Prendre une photo</label>
        <label class="btn ghost"><input type="file" accept="image/*" multiple hidden data-in>${icon("image")}Choisir des images</label>
        ${navigator.mediaDevices?.getUserMedia && isSecureContext ? `<button class="btn ghost" data-cam>${icon("video")}Caméra en direct</button>` : ""}
      </div>
      <p class="hint">Plusieurs pages ? Ajoute-les une par une : elles forment un seul PDF.</p></div>`;
    bindInputs(el);
    el.querySelector("[data-cam]")?.addEventListener("click", camera);
    return;
  }
  const p = pages[cur];
  el.innerHTML = `<div class="sc-layout">
    <div class="card sc-editor">
      <div class="sc-tools">
        <div class="seg" id="sc-mode"><label><input type="radio" name="scm" value="crop" ${p.mode === "crop" ? "checked" : ""}>${icon("crop")}Bords</label>
          <label><input type="radio" name="scm" value="result" ${p.mode !== "crop" ? "checked" : ""}>${icon("eye")}Résultat</label></div>
        <span class="grow"></span>
        <button class="icon-btn plain" data-a="rotl" title="Pivoter à gauche">${icon("undo")}</button>
        <button class="icon-btn plain" data-a="rotr" title="Pivoter à droite" style="transform:scaleX(-1)">${icon("undo")}</button>
        <button class="icon-btn plain" data-a="full" title="Toute l'image">${icon("square")}</button>
        <button class="icon-btn plain" data-a="auto" title="Détecter les bords">${icon("wand")}</button>
        <button class="icon-btn plain" data-a="del" title="Supprimer la page">${icon("trash")}</button>
      </div>
      <div class="sc-stage" id="sc-stage"></div>
      ${p.mode !== "crop" ? `<div class="chips sc-filters">${FILTERS.map(([id, label, ic]) => `<button class="chip ${p.filter === id ? "on" : ""}" data-f="${id}">${icon(ic)}${label}</button>`).join("")}</div>`
        : `<p class="hint center" style="margin:10px 0 0">Fais glisser les 4 coins sur les angles de la feuille.</p>`}
    </div>
    <div class="sc-side">
      <div class="card">
        <div class="card-title">${icon("layers")}Pages <span class="count">${pages.length}</span></div>
        <div class="sc-pages">${pages.map((pg, i) => `<button class="sc-page ${i === cur ? "on" : ""}" data-i="${i}"><img src="${pg.thumb || ""}" alt=""><span>${i + 1}</span></button>`).join("")}
          <label class="sc-page add"><input type="file" accept="image/*" capture="environment" hidden data-in>${icon("plus")}</label></div>
        <label class="btn ghost small wide" style="margin-top:8px"><input type="file" accept="image/*" multiple hidden data-in>${icon("image")}Ajouter depuis la galerie</label>
      </div>
      <form class="card" id="sc-export">
        <div class="card-title">${icon("pdf")}Créer le PDF</div>
        <label class="field">Nom</label><input type="text" name="name" value="${esc(defaultName())}">
        <label class="field" style="margin-top:12px">Envoyer vers</label>
        <div class="sc-dest">
          ${[["paperasse", "receipt", "Paperasse", "lu, reconnu et rangé tout seul"], ["nas", "nas", "NAS", "dossier PDF / Scans"], ["device", "download", "Mon appareil", "téléchargement direct"]]
            .map(([v, ic, l, s]) => `<label><input type="radio" name="dest" value="${v}" ${dest === v ? "checked" : ""}><span>${icon(ic)}<b>${l}</b><small>${s}</small></span></label>`).join("")}
        </div>
        <label class="check" style="margin-top:12px" id="sc-ocr-row"><input type="checkbox" name="ocr" checked> Texte cherchable (OCR) : tu pourras copier et chercher le texte</label>
        <button class="btn wide" style="margin-top:14px">${icon("check")}Créer le PDF</button>
        <p class="msg" id="sc-msg"></p>
      </form>
    </div></div>`;
  bindInputs(el);
  el.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { cur = +b.dataset.i; paint(); });
  el.querySelector("#sc-mode").onchange = e => { p.mode = e.target.value; paint(); };
  el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { p.filter = b.dataset.f; update(p); });
  el.querySelector(".sc-tools").onclick = e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "rotl" || a === "rotr") { p.rotation = (p.rotation + (a === "rotl" ? -90 : 90) + 360) % 360; update(p); }
    if (a === "full") { p.quad = [[0, 0], [1, 0], [1, 1], [0, 1]]; update(p); }
    if (a === "auto") { p.quad = core.detect(p.src); update(p); }
    if (a === "del") { pages.splice(cur, 1); cur = Math.min(cur, pages.length - 1); paint(); }
  };
  const form = el.querySelector("#sc-export");
  const syncOcr = () => { $("#sc-ocr-row").hidden = form.dest.value === "paperasse"; };
  form.addEventListener("change", e => { if (e.target.name === "dest") { dest = form.dest.value; syncOcr(); } });
  syncOcr();
  form.onsubmit = exportPdf;
  stage(p);
}

function defaultName() {
  const d = new Date();
  return `Scan ${d.toLocaleDateString("fr-FR").replace(/\//g, "-")} ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}

function bindInputs(el) {
  el.querySelectorAll("[data-in]").forEach(inp => inp.onchange = async () => {
    const files = [...inp.files];
    inp.value = "";
    await addFiles(files);
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) { toast(`${f.name} n'est pas une image`, "err"); continue; }
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
      await addSource(core.toCanvas(bmp, 3200));
    } catch { toast(`Impossible de lire ${f.name} (format non pris en charge par le navigateur)`, "err"); }
  }
  paint();
}

async function addSource(src) {
  const p = { src, quad: core.detect(src), rotation: 0, filter: "magic", mode: "result", thumb: null, preview: null };
  pages.push(p);
  cur = pages.length - 1;
  await update(p, false);
}

/** Recalcule l'aperçu d'une page (taille réduite pour rester fluide). */
async function update(p, repaint = true) {
  await new Promise(r => setTimeout(r, 0));
  p.preview = core.filter(core.warp(core.toCanvas(p.src, 1400), p.quad, 1400, p.rotation), p.filter);
  p.thumb = core.toCanvas(p.preview, 200).toDataURL("image/jpeg", .7);
  if (repaint) paint();
}

function stage(p) {
  const st = $("#sc-stage");
  if (p.mode !== "crop") {
    st.innerHTML = "";
    const c = p.preview;
    c.className = "sc-result";
    st.append(c);
    return;
  }
  const view = core.toCanvas(p.src, 1400);
  view.className = "sc-src";
  st.innerHTML = `<div class="sc-crop"></div>`;
  const box = st.firstChild;
  box.append(view);
  box.insertAdjacentHTML("beforeend", `<svg class="sc-poly" viewBox="0 0 1 1" preserveAspectRatio="none"><path d="" /></svg>
    ${p.quad.map((_, i) => `<span class="sc-handle" data-h="${i}"></span>`).join("")}`);
  const draw = () => {
    const [a, b, c, d] = p.quad;
    box.querySelector("path").setAttribute("d", `M0 0H1V1H0Z M${a} L${b} L${c} L${d} Z`.replace(/(\d\.?\d*),(\d\.?\d*)/g, "$1 $2"));
    box.querySelectorAll(".sc-handle").forEach((h, i) => { h.style.left = p.quad[i][0] * 100 + "%"; h.style.top = p.quad[i][1] * 100 + "%"; });
  };
  draw();
  let drag = -1;
  box.addEventListener("pointerdown", e => {
    const h = e.target.closest(".sc-handle");
    if (!h) return;
    drag = +h.dataset.h;
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener("pointermove", e => {
    if (drag < 0) return;
    const r = view.getBoundingClientRect();
    p.quad[drag] = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    draw();
  });
  const end = () => { if (drag >= 0) { drag = -1; update(p, false).then(() => { const t = $(`.sc-page[data-i="${cur}"] img`); if (t) t.src = p.thumb; }); } };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
}

async function exportPdf(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector(".btn");
  btn.disabled = true;
  const msg = $("#sc-msg");
  try {
    msg.textContent = "Préparation des pages en haute qualité…";
    const full = [];
    for (const [i, p] of pages.entries()) {
      msg.textContent = `Page ${i + 1} sur ${pages.length}…`;
      await new Promise(r => setTimeout(r, 0));
      full.push(core.filter(core.warp(p.src, p.quad, 2480, p.rotation), p.filter));
    }
    const bytes = await core.makePdf(full, { quality: pages.every(p => p.filter === "bw") ? .8 : .86 });
    const name = (f.name.value.trim() || defaultName()).replace(/[\\/:*?"<>|]+/g, " ") + ".pdf";
    const blob = new Blob([bytes], { type: "application/pdf" });
    if (f.dest.value === "device" && !f.ocr.checked) {
      download(blob, name);
      msg.textContent = "";
      toast("PDF créé");
    } else {
      msg.textContent = f.dest.value === "paperasse" ? "Envoi à Paperasse…" : f.ocr.checked ? "Lecture du texte (OCR), quelques secondes par page…" : "Enregistrement…";
      const fd = new FormData();
      fd.append("file", blob, name);
      fd.append("dest", f.dest.value);
      fd.append("ocr", f.ocr.checked ? "1" : "0");
      const r = await fetch("/api/scan/save", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Échec de l'enregistrement");
      if (f.dest.value === "device") { download(await r.blob(), name); toast("PDF créé (texte cherchable)"); }
      else {
        const d = await r.json();
        if (f.dest.value === "paperasse") { toast("Envoyé à Paperasse : il sera lu et classé"); location.hash = "#/paperasse"; }
        else toast(`Enregistré sur le NAS : PDF / ${d.saved}`);
      }
      msg.textContent = "";
    }
    pages = []; cur = -1;
    if (location.hash.startsWith("#/scanner")) paint();
  } catch (err) { msg.textContent = err.message; }
  btn.disabled = false;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function camera() {
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } } }); }
  catch { return toast("Caméra inaccessible : autorise-la dans le navigateur, ou utilise « Prendre une photo »", "err"); }
  const el = $("#sc-body");
  el.innerHTML = `<div class="card sc-cam"><video autoplay playsinline muted></video>
    <div class="sc-cam-bar"><button class="btn ghost" data-a="stop">${icon("x")}Terminer</button><button class="sc-shutter" data-a="shot" title="Prendre la photo"></button>
    <span class="meta" id="sc-count">${pages.length} page${pages.length > 1 ? "s" : ""}</span></div></div>`;
  const video = el.querySelector("video");
  video.srcObject = stream;
  el.querySelector("[data-a=shot]").onclick = async () => {
    const c = document.createElement("canvas");
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    await addSource(core.toCanvas(c, 3200));
    $("#sc-count").textContent = `${pages.length} page${pages.length > 1 ? "s" : ""}`;
    toast(`Page ${pages.length} ajoutée`);
  };
  el.querySelector("[data-a=stop]").onclick = () => { stopCam(); paint(); };
}

function stopCam() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

export function leave() { stopCam(); }
