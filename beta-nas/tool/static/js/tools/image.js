// Outil « Studio Image » : retouche (dans le navigateur), traitement par lot, détourage (sur le NAS).
import { $, $$, esc, icon, toast, sizeStr, dropzone, dropHTML, resultCard, loading, baseName } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

const ADJ = [["brightness", "Luminosité", -100, 100], ["contrast", "Contraste", -100, 100], ["saturation", "Saturation", -100, 100],
             ["warmth", "Chaleur", -100, 100], ["hue", "Teinte", -180, 180], ["blur", "Flou", 0, 20], ["vignette", "Vignette", 0, 100]];
const FILTERS = {
  none: ["Aucun", {}], nb: ["Noir & blanc", { saturation: -100 }], sepia: ["Sépia", { sepia: 1 }],
  vintage: ["Vintage", { sepia: .35, contrast: -10, warmth: 15, vignette: 35 }], vif: ["Vif", { saturation: 35, contrast: 15 }],
  froid: ["Froid", { warmth: -30, saturation: -5 }], chaud: ["Chaud", { warmth: 30 }], doux: ["Doux", { contrast: -15, brightness: 8, saturation: -10 }],
};
const RATIOS = [["libre", "Libre", 0], ["1:1", "Carré", 1], ["4:3", "4:3", 4 / 3], ["3:2", "3:2", 3 / 2], ["16:9", "16:9", 16 / 9], ["9:16", "9:16", 9 / 16]];
const BLUR_OK = "filter" in CanvasRenderingContext2D.prototype;
let E = null;

export async function render(root, parts) {
  const tab = ["lot", "detourage"].includes(parts[0]) ? parts[0] : "retouche";
  root.innerHTML = pageHead("image") + `<nav class="tabs">
      <a href="#/image" class="${tab === "retouche" ? "on" : ""}">${icon("wand")}Retouche</a>
      <a href="#/image/lot" class="${tab === "lot" ? "on" : ""}">${icon("layers")}Traitement par lot</a>
      <a href="#/image/detourage" class="${tab === "detourage" ? "on" : ""}">${icon("crop")}Détourage</a></nav>
    <div id="im-body"></div>`;
  ({ retouche, lot, detourage })[tab]($("#im-body"));
}

const loadImage = file => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Image illisible (les photos HEIC passent par le Convertisseur)"));
  img.src = URL.createObjectURL(file);
});

// --- Retouche -----------------------------------------------------------------

function retouche(el) {
  el.innerHTML = `<div class="card">${dropHTML("im-drop", { accept: "image/*", title: "Glisse une image à retoucher", sub: "JPG, PNG, WebP, GIF… ou clique pour la choisir", tile: "violet" })}</div>`;
  const z = $("#im-drop");
  dropzone(z, z.querySelector("input"), files => open(el, files[0]));
  if (window.btHandoff?.type?.startsWith("image/")) { const f = window.btHandoff; window.btHandoff = null; open(el, f); }
}

async function open(el, file) {
  let img;
  try { img = await loadImage(file); } catch (e) { return toast(e.message, "err"); }
  E = { img, name: file.name, size: file.size, rot: 0, flipH: false, flipV: false, crop: null, resize: null, filter: "none",
        adj: Object.fromEntries(ADJ.map(a => [a[0], 0])), history: [], cropMode: false, ratio: 0 };
  el.innerHTML = `<div class="im-edit">
    <div class="card im-stage"><div class="im-wrap" id="im-wrap"><canvas id="im-canvas"></canvas><div class="crop-box" id="crop-box" hidden>
      <span class="h nw"></span><span class="h ne"></span><span class="h sw"></span><span class="h se"></span></div></div>
      <p class="meta center" id="im-info"></p></div>
    <div class="im-side">
      <div class="card"><h3>${icon("crop")}Cadrage</h3>
        <div class="row" style="margin:0">
          <button class="icon-btn" data-op="rotl" title="Pivoter à gauche">${icon("rotateCcw")}</button>
          <button class="icon-btn" data-op="rotr" title="Pivoter à droite">${icon("rotateCw")}</button>
          <button class="icon-btn" data-op="flipH" title="Miroir horizontal">${icon("flip")}</button>
          <button class="icon-btn" data-op="flipV" title="Miroir vertical" style="transform:rotate(90deg)">${icon("flip")}</button>
          <button class="btn small ghost" data-op="crop">${icon("crop")}Recadrer</button>
        </div>
        <div id="crop-tools" hidden>
          <div class="chips" style="margin:10px 0">${RATIOS.map(([k, l, r]) => `<button class="chip ${k === "libre" ? "on" : ""}" data-ratio="${r}">${l}</button>`).join("")}</div>
          <div class="row" style="margin:0"><button class="btn small" data-op="crop-ok">${icon("check")}Appliquer</button><button class="btn small ghost" data-op="crop-cancel">Annuler</button></div>
        </div>
      </div>
      <div class="card"><h3>${icon("wand")}Filtres</h3>
        <div class="filters">${Object.entries(FILTERS).map(([k, [l]]) => `<button class="chip ${k === "none" ? "on" : ""}" data-filter="${k}">${l}</button>`).join("")}</div></div>
      <div class="card"><h3>${icon("sliders")}Réglages</h3>
        ${ADJ.map(([k, l, min, max]) => `<div class="adj"><span>${l}</span><input type="range" data-adj="${k}" min="${min}" max="${max}" value="0"><b data-v="${k}">0</b></div>`).join("")}
        ${BLUR_OK ? "" : `<p class="hint">Le flou n'est pas disponible dans ce navigateur.</p>`}</div>
      <div class="card"><h3>${icon("image")}Taille et export</h3>
        <div class="row" style="margin:0 0 10px"><input type="number" id="rs-w" min="1" style="width:92px"> × <input type="number" id="rs-h" min="1" style="width:92px">
          <label class="check"><input type="checkbox" id="rs-lock" checked> Proportions</label></div>
        <div class="row" style="margin:0 0 10px"><select id="ex-fmt"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select>
          <span class="meta">Qualité</span><input type="range" id="ex-q" min="40" max="100" value="90" style="flex:1"></div>
        <div class="row" style="margin:0"><button class="btn small ghost" data-op="undo">${icon("undo")}Annuler</button><button class="btn small ghost" data-op="reset">${icon("refresh")}Tout réinitialiser</button></div>
        <button class="btn wide" data-op="export" style="margin-top:12px">${icon("save")}Enregistrer l'image</button>
        <div id="im-result"></div></div>
    </div></div>`;
  if (/png$/i.test(file.type)) $("#ex-fmt").value = "image/png";
  el.addEventListener("click", onClick);
  el.querySelectorAll("[data-adj]").forEach(r => {
    r.addEventListener("pointerdown", snapshot, { once: false });
    r.oninput = () => { E.adj[r.dataset.adj] = +r.value; $(`[data-v="${r.dataset.adj}"]`).textContent = r.value; schedule(); };
  });
  const lock = () => $("#rs-lock").checked;
  $("#rs-w").oninput = e => { const [w, h] = outSize(false); if (lock()) $("#rs-h").value = Math.round(+e.target.value * h / w); E.resize = { w: +$("#rs-w").value, h: +$("#rs-h").value }; info(); };
  $("#rs-h").oninput = e => { const [w, h] = outSize(false); if (lock()) $("#rs-w").value = Math.round(+e.target.value * w / h); E.resize = { w: +$("#rs-w").value, h: +$("#rs-h").value }; info(); };
  bindCrop();
  draw();
}

const snapshot = () => { E.history.push(JSON.stringify({ rot: E.rot, flipH: E.flipH, flipV: E.flipV, crop: E.crop, resize: E.resize, filter: E.filter, adj: E.adj })); if (E.history.length > 40) E.history.shift(); };

function onClick(e) {
  const op = e.target.closest("[data-op]")?.dataset.op;
  const f = e.target.closest("[data-filter]")?.dataset.filter;
  const r = e.target.closest("[data-ratio]");
  if (f) { snapshot(); E.filter = f; $$("[data-filter]").forEach(c => c.classList.toggle("on", c.dataset.filter === f)); draw(); }
  if (r) { E.ratio = +r.dataset.ratio; $$("[data-ratio]").forEach(c => c.classList.toggle("on", c === r)); fitCropRatio(); }
  if (!op) return;
  if (["rotl", "rotr", "flipH", "flipV"].includes(op)) {
    snapshot();
    if (op === "rotl" || op === "rotr") { E.rot = (E.rot + (op === "rotr" ? 90 : 270)) % 360; E.crop = null; E.resize = null; }
    if (op === "flipH") E.flipH = !E.flipH;
    if (op === "flipV") E.flipV = !E.flipV;
    draw();
  }
  if (op === "crop") startCrop();
  if (op === "crop-ok") applyCrop();
  if (op === "crop-cancel") { E.cropMode = false; $("#crop-tools").hidden = true; $("#crop-box").hidden = true; draw(); }
  if (op === "undo" && E.history.length) { Object.assign(E, JSON.parse(E.history.pop())); syncInputs(); draw(); }
  if (op === "reset") { snapshot(); Object.assign(E, { rot: 0, flipH: false, flipV: false, crop: null, resize: null, filter: "none", adj: Object.fromEntries(ADJ.map(a => [a[0], 0])) }); syncInputs(); draw(); }
  if (op === "export") exportImage();
}

function syncInputs() {
  $$("[data-adj]").forEach(r => { r.value = E.adj[r.dataset.adj]; $(`[data-v="${r.dataset.adj}"]`).textContent = r.value; });
  $$("[data-filter]").forEach(c => c.classList.toggle("on", c.dataset.filter === E.filter));
}

/** Taille de l'image orientée (avant recadrage). */
const oriented = () => E.rot % 180 ? [E.img.naturalHeight, E.img.naturalWidth] : [E.img.naturalWidth, E.img.naturalHeight];
/** Taille de sortie : recadrage puis redimensionnement. */
function outSize(withResize = true) {
  const [ow, oh] = oriented();
  const base = E.crop ? [E.crop.w, E.crop.h] : [ow, oh];
  return withResize && E.resize ? [E.resize.w, E.resize.h] : base.map(Math.round);
}

/** Rend l'image avec toutes les modifications ; maxDim limite la taille (aperçu). */
function pipeline(maxDim, { skipCrop = false } = {}) {
  const [ow, oh] = oriented();
  const crop = skipCrop || !E.crop ? { x: 0, y: 0, w: ow, h: oh } : E.crop;
  let [tw, th] = skipCrop ? [ow, oh] : outSize();
  const k = Math.min(1, maxDim / Math.max(tw, th));
  tw = Math.max(1, Math.round(tw * k)); th = Math.max(1, Math.round(th * k));
  // 1. orientation (rotation + miroirs) dans un canevas intermédiaire à l'échelle de sortie
  const sx = tw / crop.w, sy = th / crop.h;
  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const ctx = c.getContext("2d");
  if (BLUR_OK && E.adj.blur) ctx.filter = `blur(${E.adj.blur * Math.max(sx, sy) * 2}px)`;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate(E.rot * Math.PI / 180);
  ctx.scale(E.flipH ? -1 : 1, E.flipV ? -1 : 1);
  ctx.drawImage(E.img, -E.img.naturalWidth / 2, -E.img.naturalHeight / 2);
  ctx.restore();
  ctx.filter = "none";
  // 2. réglages couleur, pixel par pixel (identique dans tous les navigateurs)
  const a = { ...E.adj, ...Object.fromEntries(Object.entries(FILTERS[E.filter][1]).map(([key, v]) => [key, (key === "sepia" ? 0 : E.adj[key] || 0) + v])) };
  if (a.brightness || a.contrast || a.saturation || a.warmth || a.hue || a.sepia) {
    const data = ctx.getImageData(0, 0, tw, th);
    colorize(data.data, a);
    ctx.putImageData(data, 0, 0);
  }
  // 3. vignette
  if (a.vignette) {
    const g = ctx.createRadialGradient(tw / 2, th / 2, Math.min(tw, th) * .35, tw / 2, th / 2, Math.hypot(tw, th) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${a.vignette / 100 * .8})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, tw, th);
  }
  return c;
}

function colorize(px, a) {
  const b = a.brightness * 2.55, c = a.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c));
  const s = 1 + (a.saturation || 0) / 100, w = (a.warmth || 0) * .6, sep = a.sepia || 0;
  const h = (a.hue || 0) * Math.PI / 180, cos = Math.cos(h), sin = Math.sin(h);
  // matrice de rotation de teinte (luminance préservée)
  const m = [.213 + cos * .787 - sin * .213, .715 - cos * .715 - sin * .715, .072 - cos * .072 + sin * .928,
             .213 - cos * .213 + sin * .143, .715 + cos * .285 + sin * .140, .072 - cos * .072 - sin * .283,
             .213 - cos * .213 - sin * .787, .715 - cos * .715 + sin * .715, .072 + cos * .928 + sin * .072];
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], bl = px[i + 2];
    if (h) { const r0 = r, g0 = g, b0 = bl; r = m[0] * r0 + m[1] * g0 + m[2] * b0; g = m[3] * r0 + m[4] * g0 + m[5] * b0; bl = m[6] * r0 + m[7] * g0 + m[8] * b0; }
    r += b; g += b; bl += b;
    r = f * (r - 128) + 128; g = f * (g - 128) + 128; bl = f * (bl - 128) + 128;
    const gray = .299 * r + .587 * g + .114 * bl;
    r = gray + (r - gray) * s; g = gray + (g - gray) * s; bl = gray + (bl - gray) * s;
    r += w; bl -= w;
    if (sep) {
      const sr = .393 * r + .769 * g + .189 * bl, sg = .349 * r + .686 * g + .168 * bl, sb = .272 * r + .534 * g + .131 * bl;
      r += (sr - r) * sep; g += (sg - g) * sep; bl += (sb - bl) * sep;
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = bl;  // Uint8ClampedArray : bornage automatique 0–255
  }
}

let pending = 0;
const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); };

function draw() {
  const src = pipeline(1400, { skipCrop: E.cropMode });
  const cv = $("#im-canvas");
  if (!cv) return;
  cv.width = src.width; cv.height = src.height;
  cv.getContext("2d").drawImage(src, 0, 0);
  info();
}

function info() {
  const [w, h] = outSize();
  $("#im-info").textContent = `${E.name} · ${w} × ${h} px${E.crop ? " · recadrée" : ""}`;
  if (document.activeElement?.id !== "rs-w" && document.activeElement?.id !== "rs-h") { $("#rs-w").value = w; $("#rs-h").value = h; }
}

// --- Recadrage ------------------------------------------------------------------

let box = null;
function startCrop() {
  E.cropMode = true;
  $("#crop-tools").hidden = false;
  draw();
  const [ow, oh] = oriented();
  box = E.crop ? { ...E.crop } : { x: ow * .1, y: oh * .1, w: ow * .8, h: oh * .8 };
  $("#crop-box").hidden = false;
  paintBox();
}
const scaleK = () => { const [ow] = oriented(); return $("#im-canvas").getBoundingClientRect().width / ow; };
function paintBox() {
  const k = scaleK(), b = $("#crop-box"), cv = $("#im-canvas");
  const off = cv.offsetLeft, top = cv.offsetTop;
  Object.assign(b.style, { left: off + box.x * k + "px", top: top + box.y * k + "px", width: box.w * k + "px", height: box.h * k + "px" });
}
function fitCropRatio() {
  if (!E.ratio || !box) return paintBox();
  const [ow, oh] = oriented();
  let w = box.w, h = w / E.ratio;
  if (h > oh) { h = oh; w = h * E.ratio; }
  if (w > ow) { w = ow; h = w / E.ratio; }
  box = { x: Math.min(box.x, ow - w), y: Math.min(box.y, oh - h), w, h };
  paintBox();
}
function bindCrop() {
  const b = $("#crop-box");
  b.addEventListener("pointerdown", e => {
    e.preventDefault();
    const handle = e.target.classList.contains("h") ? [...e.target.classList].find(c => c.length === 2) : null;
    const k = scaleK(), [ow, oh] = oriented(), start = { ...box }, x0 = e.clientX, y0 = e.clientY;
    const move = ev => {
      const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      if (!handle) { box.x = Math.max(0, Math.min(ow - box.w, start.x + dx)); box.y = Math.max(0, Math.min(oh - box.h, start.y + dy)); }
      else {
        let { x, y, w, h } = start;
        if (handle.includes("e")) w = start.w + dx;
        if (handle.includes("s")) h = start.h + dy;
        if (handle.includes("w")) { w = start.w - dx; x = start.x + dx; }
        if (handle.includes("n")) { h = start.h - dy; y = start.y + dy; }
        if (E.ratio) { h = w / E.ratio; if (handle.includes("n")) y = start.y + start.h - h; }
        if (w > 20 && h > 20 && x >= 0 && y >= 0 && x + w <= ow + .5 && y + h <= oh + .5) box = { x, y, w, h };
      }
      paintBox();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}
function applyCrop() {
  snapshot();
  E.crop = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
  E.resize = null;
  E.cropMode = false;
  $("#crop-tools").hidden = true;
  $("#crop-box").hidden = true;
  draw();
}

function exportImage() {
  const type = $("#ex-fmt").value, q = +$("#ex-q").value / 100;
  const c = pipeline(12000);
  let out = c;
  if (type === "image/jpeg") {  // fond blanc sous la transparence
    out = document.createElement("canvas");
    out.width = c.width; out.height = c.height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(c, 0, 0);
  }
  out.toBlob(blob => {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
    resultCard($("#im-result"), blob, `${baseName(E.name)}-retouche.${ext}`, { info: `${out.width} × ${out.height} px`, editable: false, tool: "image" });
  }, type, q);
}

// --- Traitement par lot ---------------------------------------------------------

function lot(el) {
  let files = [];
  el.innerHTML = `<div class="card">${dropHTML("lot-drop", { accept: "image/*", multiple: true, title: "Glisse tes images", sub: "autant que tu veux · JPG, PNG, WebP, GIF, BMP", tile: "violet" })}
    <div id="lot-list" style="margin:12px 0"></div>
    <div class="grid2">
      <div><label class="field">Taille maximale</label><select id="lot-size" style="width:100%"><option value="0">Ne pas redimensionner</option><option value="3840">3840 px (4K)</option>
        <option value="1920" selected>1920 px (Full HD)</option><option value="1280">1280 px</option><option value="800">800 px</option><option value="400">400 px (vignette)</option></select></div>
      <div><label class="field">Format</label><select id="lot-fmt" style="width:100%"><option value="">Garder le format</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP (plus léger)</option><option value="image/png">PNG</option></select></div>
      <div><label class="field">Qualité : <span id="lot-qv">85</span> %</label><input type="range" id="lot-q" min="40" max="100" value="85" style="width:100%"></div>
      <div><label class="field">Noms des fichiers</label><input type="text" id="lot-name" placeholder="{nom} (ou ex. vacances-{n})"></div>
    </div>
    <p class="hint">Les données cachées (position GPS, appareil…) sont retirées. Tout se fait dans ton navigateur.</p>
    <button class="btn wide" id="lot-go" disabled>${icon("layers")}Traiter les images</button><div id="lot-result"></div></div>`;
  const z = $("#lot-drop");
  const paint = () => {
    $("#lot-list").innerHTML = files.length ? `<p class="meta">${files.length} image${files.length > 1 ? "s" : ""} · ${sizeStr(files.reduce((s, f) => s + f.size, 0))}</p>` : "";
    $("#lot-go").disabled = !files.length;
  };
  dropzone(z, z.querySelector("input"), list => { files = files.concat(list.filter(f => f.type.startsWith("image/"))); paint(); });
  $("#lot-q").oninput = e => { $("#lot-qv").textContent = e.target.value; };
  $("#lot-go").onclick = async () => {
    const max = +$("#lot-size").value, fmt = $("#lot-fmt").value, q = +$("#lot-q").value / 100, pattern = $("#lot-name").value.trim();
    const zip = new window.JSZip();
    const btn = $("#lot-go");
    btn.disabled = true;
    let before = 0, after = 0, done = 0;
    const used = new Set();
    for (const [i, f] of files.entries()) {
      btn.textContent = `Traitement… ${i + 1} / ${files.length}`;
      try {
        const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
        const k = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const ctx = c.getContext("2d");
        const type = fmt || (["image/png", "image/webp", "image/jpeg"].includes(f.type) ? f.type : "image/jpeg");
        if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, type, q));
        const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
        let name = (pattern ? pattern.replace("{nom}", baseName(f.name)).replace("{n}", String(i + 1).padStart(3, "0")) : baseName(f.name)) + "." + ext;
        while (used.has(name)) name = name.replace(/(\.\w+)$/, "-" + i + "$1");
        used.add(name);
        zip.file(name, blob);
        before += f.size; after += blob.size; done++;
      } catch { toast(`${f.name} : illisible`, "err"); }
    }
    const out = await zip.generateAsync({ type: "blob" });
    resultCard($("#lot-result"), out, "images-traitees.zip", { info: `${done} images · ${sizeStr(before)} → ${sizeStr(after)}`, editable: false, tool: "image" });
    btn.disabled = false;
    btn.innerHTML = `${icon("layers")}Traiter les images`;
  };
}

// --- Détourage ------------------------------------------------------------------

async function detourage(el) {
  const st = await api("/api/image/status").catch(() => ({ removebg: false }));
  if (!st.removebg) {
    el.innerHTML = `<div class="card"><div class="empty">${icon("crop")}<b>Détourage indisponible</b>Le moteur rembg n'est pas installé dans l'image Docker.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="card">${dropHTML("bg-drop", { accept: "image/*", title: "Glisse une photo à détourer", sub: "personne, objet, animal… le fond est retiré automatiquement", tile: "violet" })}
    ${st.downloaded ? "" : `<p class="hint">${icon("download")} Première utilisation : le modèle d'intelligence artificielle (≈ 180 Mo) sera téléchargé sur le NAS.</p>`}
    <div id="bg-work"></div></div>`;
  const z = $("#bg-drop");
  dropzone(z, z.querySelector("input"), files => cutout(files[0]));
}

async function cutout(file) {
  const work = $("#bg-work");
  loading(work, "Détourage en cours… (quelques secondes, plus la première fois)");
  try {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/image/removebg", { method: "POST", body: form });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Échec du détourage");
    const cut = await loadImage(await r.blob());
    const orig = await loadImage(file);
    let bg = "transparent", color = "#ffffff";
    work.innerHTML = `<div class="bg-result">
      <div class="bg-view checker"><canvas id="bg-canvas"></canvas></div>
      <div><label class="field">Fond</label>
        <div class="chips">${[["transparent", "Transparent"], ["#ffffff", "Blanc"], ["#000000", "Noir"], ["color", "Couleur"], ["blur", "Flou"]].map(([v, l]) =>
          `<button class="chip ${v === "transparent" ? "on" : ""}" data-bg="${v}">${l}</button>`).join("")}<input type="color" id="bg-color" value="#1f6bff" hidden></div>
        <button class="btn wide" id="bg-save" style="margin-top:14px">${icon("save")}Enregistrer</button><div id="bg-out"></div></div></div>`;
    const compose = () => {
      const c = $("#bg-canvas");
      c.width = cut.naturalWidth; c.height = cut.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      if (bg === "blur") { ctx.filter = `blur(${Math.round(c.width / 60)}px)`; ctx.drawImage(orig, 0, 0, c.width, c.height); ctx.filter = "none"; }
      else if (bg !== "transparent") { ctx.fillStyle = bg === "color" ? color : bg; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(cut, 0, 0);
    };
    work.querySelectorAll("[data-bg]").forEach(b => b.onclick = () => {
      bg = b.dataset.bg;
      work.querySelectorAll("[data-bg]").forEach(x => x.classList.toggle("on", x === b));
      $("#bg-color").hidden = bg !== "color";
      compose();
    });
    $("#bg-color").oninput = e => { color = e.target.value; compose(); };
    $("#bg-save").onclick = () => $("#bg-canvas").toBlob(blob => resultCard($("#bg-out"), blob, `${baseName(file.name)}-detoure.${bg === "transparent" ? "png" : "jpg"}`,
      { editable: false, tool: "image" }), bg === "transparent" ? "image/png" : "image/jpeg", .92);
    compose();
  } catch (e) {
    work.innerHTML = `<div class="msg">${esc(e.message)}</div>`;
  }
}
