// Studio PDF · Éditer & signer.
// Les éléments ajoutés sont gardés dans un modèle (coordonnées en points PDF,
// repère « page affichée ») puis gravés dans le fichier avec pdf-lib à l'export.
import { $, $$, esc, icon, toast, dropHTML, dropzone, resultCard, loading, baseName } from "../ui.js";
import { PDFLib, readBytes, openView, openEdit, pdfBlob, frame, hexColor, safeText, toolHead, fileRow, takeHandoff,
         StandardFonts, degrees, BlendMode } from "./lib.js";
import { chooseSignature } from "./signature.js";

const TOOLS = [
  ["select", "cursor", "Sélection"], ["text", "type", "Texte"], ["signature", "signature", "Signature"], ["image", "image", "Image"],
  ["highlight", "highlight", "Surligner"], ["rect", "square", "Cadre"], ["whiteout", "eraser", "Masquer"], ["draw", "pencil", "Dessin"],
];
const FONTS = {
  helvetica: { css: "Helvetica, Arial, sans-serif", pdf: ["Helvetica", "HelveticaBold"], base: .947, label: "Sans (Helvetica)" },
  times: { css: "'Times New Roman', Times, serif", pdf: ["TimesRoman", "TimesRomanBold"], base: .938, label: "Serif (Times)" },
  courier: { css: "'Courier New', Courier, monospace", pdf: ["Courier", "CourierBold"], base: .867, label: "Machine (Courier)" },
};

let S = null;  // état de l'éditeur ouvert

export function render(container, tool) {
  container.innerHTML = toolHead(tool) + `<div id="ed-zone" class="card">${dropHTML("ed-drop")}</div>`;
  const zone = $("#ed-drop", container);
  dropzone(zone, zone.querySelector("input"), files => open(container, tool, files[0]));
  const handoff = takeHandoff();
  if (handoff) open(container, tool, handoff);
}

async function open(container, tool, file) {
  const zone = $("#ed-zone", container);
  loading(zone, "Ouverture du PDF…");
  try {
    const bytes = await readBytes(file);
    const view = await openView(bytes);
    let fields = [];
    try { fields = readFields((await openEdit(bytes)).getForm()); } catch (e) { if (/mot de passe/.test(e.message)) throw e; }
    S = {
      file, bytes, view, fields, items: [], history: [], pages: [], zoom: 1, mode: "select", sel: null, nextId: 1, pending: null,
      style: { font: "helvetica", size: 14, color: "#111111", bold: false, stroke: "#e2384b", width: 2, mark: "#ffe14d" },
    };
    container.innerHTML = toolHead(tool) + `
      ${fileRow(file, `${view.numPages} page${view.numPages > 1 ? "s" : ""}`)}
      <div class="toolbar" id="ed-toolbar">
        ${TOOLS.map(([k, ic, l]) => `<button class="tb" data-mode="${k}" title="${l}">${icon(ic)}<span class="lbl">${l}</span></button>`).join("")}
        <span class="sep"></span>
        <button class="tb" data-act="undo" title="Annuler (Ctrl+Z)">${icon("undo")}</button>
        <button class="tb" data-act="delete" title="Supprimer (Suppr)">${icon("trash")}</button>
        <span class="sep"></span>
        <button class="tb" data-act="zoomOut" title="Dézoomer">${icon("zoomOut")}</button>
        <span class="zoom" id="ed-zoom">100 %</span>
        <button class="tb" data-act="zoomIn" title="Zoomer">${icon("zoomIn")}</button>
      </div>
      <div class="editor">
        <div class="pages mode-select" id="ed-pages"></div>
        <div class="side">
          <div class="card" id="ed-props"></div>
          ${fields.length ? `<div class="card"><h3>${icon("form")}Formulaire <span class="meta">(${fields.length} champ${fields.length > 1 ? "s" : ""})</span></h3>
            <div class="form-fields" id="ed-form"></div>
            <label class="check" style="margin-top:6px"><input type="checkbox" id="ed-flatten"> Figer le formulaire</label>
            <p class="hint">Figé, il ne sera plus modifiable.</p></div>` : ""}
          <div class="card">
            <button class="btn wide" id="ed-save">${icon("save")}Enregistrer le PDF</button>
            <div id="ed-result"></div>
          </div>
        </div>
      </div>`;
    $("[data-change]", container).onclick = () => render(container, tool);
    $("#ed-toolbar", container).addEventListener("click", onToolbar);
    $("#ed-save", container).onclick = exportPdf;
    if (fields.length) renderForm();
    buildPages();
    setMode("select");
  } catch (e) {
    zone.innerHTML = `<div class="msg">${esc(e.message)}</div>` + dropHTML("ed-drop");
    const z = $("#ed-drop", container);
    dropzone(z, z.querySelector("input"), files => open(container, tool, files[0]));
  }
}

// --- Pages ------------------------------------------------------------------

async function buildPages() {
  const wrap = $("#ed-pages");
  wrap.innerHTML = "";
  S.pages = [];
  for (let i = 1; i <= S.view.numPages; i++) {
    const page = await S.view.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const el = document.createElement("div");
    el.className = "page";
    el.innerHTML = `<span class="num-tag">Page ${i}</span><canvas></canvas><div class="overlay"></div>`;
    wrap.append(el);
    const p = { idx: i - 1, page, w: vp.width, h: vp.height, el, canvas: el.querySelector("canvas"), overlay: el.querySelector(".overlay"), rendered: 0, task: null };
    p.overlay.addEventListener("pointerdown", e => onDown(e, p));
    p.overlay.addEventListener("dblclick", e => onDouble(e));
    S.pages.push(p);
  }
  S.observer = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) paint(S.pages.find(p => p.el === en.target));
  }), { rootMargin: "600px" });
  layout();
}

const baseScale = () => {
  const avail = $("#ed-pages").clientWidth - 40;
  return Math.min(1.6, avail / Math.max(...S.pages.map(p => p.w)));
};
const scale = () => baseScale() * S.zoom;

function layout() {
  const s = scale();
  $("#ed-zoom").textContent = Math.round(S.zoom * 100) + " %";
  for (const p of S.pages) {
    p.el.style.width = p.w * s + "px";
    p.el.style.height = p.h * s + "px";
    p.rendered = 0;
    S.observer.unobserve(p.el);
    S.observer.observe(p.el);
    drawItems(p.idx);
  }
}

async function paint(p) {
  if (!p) return;
  const s = scale();
  if (p.rendered === s) return;
  p.rendered = s;
  p.task?.cancel();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = p.page.getViewport({ scale: s * dpr });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  p.task = p.page.render({ canvasContext: c.getContext("2d"), viewport: vp });
  try {
    await p.task.promise;
    c.style.cssText = p.canvas.style.cssText;
    p.canvas.replaceWith(c);
    p.canvas = c;
  } catch { /* rendu annulé (zoom pendant le rendu) */ }
}

// --- Éléments ---------------------------------------------------------------

const snapshot = () => { S.history.push(JSON.stringify(S.items)); if (S.history.length > 60) S.history.shift(); };
const byId = id => S.items.find(it => it.id === id);

function drawItems(pageIdx) {
  const p = S.pages[pageIdx];
  const s = scale();
  p.overlay.innerHTML = "";
  for (const it of S.items.filter(it => it.page === pageIdx)) p.overlay.append(itemEl(it, s));
}

function itemEl(it, s) {
  const el = document.createElement("div");
  el.className = "el " + it.type + (S.sel === it.id ? " sel" : "");
  el.dataset.id = it.id;
  Object.assign(el.style, { left: it.x * s + "px", top: it.y * s + "px" });
  if (it.type !== "text") Object.assign(el.style, { width: it.w * s + "px", height: it.h * s + "px" });
  if (it.type === "text") {
    Object.assign(el.style, { fontFamily: FONTS[it.font].css, fontSize: it.size * s + "px", color: it.color, fontWeight: it.bold ? 700 : 400 });
    el.textContent = it.text;
  } else if (it.type === "image") {
    el.innerHTML = `<img src="${it.src}" alt="">`;
  } else if (it.type === "highlight") {
    Object.assign(el.style, { background: it.color, opacity: .4, mixBlendMode: "multiply" });
  } else if (it.type === "rect") {
    Object.assign(el.style, { border: `${Math.max(1, it.width * s)}px solid ${it.color}` });
  } else if (it.type === "whiteout") {
    Object.assign(el.style, { background: "#fff", boxShadow: S.sel === it.id ? "" : "inset 0 0 0 1px rgb(0 0 0 / .08)" });
  } else if (it.type === "draw") {
    el.innerHTML = `<svg viewBox="0 0 ${it.ow} ${it.oh}" preserveAspectRatio="none" width="100%" height="100%">
      <path d="${pathOf(it.points)}" fill="none" stroke="${it.color}" stroke-width="${it.width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="stroke-width:${it.width * s}px"/></svg>`;
  }
  el.insertAdjacentHTML("beforeend", `<span class="handle"></span>`);
  return el;
}

const pathOf = pts => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");

function measureText(it) {
  // Taille de la boîte d'un texte, en points (utile pour la sélection et le redimensionnement)
  const lines = it.text.split("\n");
  const ctx = (measureText.c ||= document.createElement("canvas").getContext("2d"));
  ctx.font = `${it.bold ? 700 : 400} ${it.size}px ${FONTS[it.font].css}`;
  it.w = Math.max(8, ...lines.map(l => ctx.measureText(l).width));
  it.h = lines.length * it.size * 1.2;
}

function select(id) {
  S.sel = id;
  $$(".el.sel").forEach(e => e.classList.remove("sel"));
  if (id) $(`.el[data-id="${id}"]`)?.classList.add("sel");
  renderProps();
}

function removeSelected() {
  if (!S.sel) return;
  const it = byId(S.sel);
  snapshot();
  S.items = S.items.filter(x => x !== it);
  S.sel = null;
  drawItems(it.page);
  renderProps();
}

// --- Barre d'outils ---------------------------------------------------------

function setMode(mode) {
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  S.mode = mode;
  $$("#ed-toolbar [data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
  $("#ed-pages").className = "pages mode-" + mode;
  $$(".overlay").forEach(o => o.classList.toggle("placing", mode !== "select"));
  if (mode !== "select") select(null);
  renderProps();
}

async function onToolbar(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.mode === "signature") {
    const src = await chooseSignature();
    if (!src) return;
    S.pending = src;
    toast("Clique sur la page à l'endroit où placer la signature");
  }
  if (b.dataset.mode === "image") {
    const src = await pickImage();
    if (!src) return;
    S.pending = src;
    toast("Clique sur la page à l'endroit où placer l'image");
  }
  if (b.dataset.mode) return setMode(b.dataset.mode);
  const act = b.dataset.act;
  if (act === "undo") undo();
  if (act === "delete") removeSelected();
  if (act === "zoomIn" || act === "zoomOut") {
    S.zoom = Math.min(3, Math.max(.4, S.zoom * (act === "zoomIn" ? 1.2 : 1 / 1.2)));
    layout();
  }
}

function undo() {
  if (!S.history.length) return;
  S.items = JSON.parse(S.history.pop());
  S.sel = null;
  S.pages.forEach(p => drawItems(p.idx));
  renderProps();
}

function pickImage() {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        // Re-encode en PNG (pdf-lib n'accepte que PNG et JPEG)
        const c = document.createElement("canvas");
        const k = Math.min(1, 2000 / Math.max(img.width, img.height));
        c.width = img.width * k; c.height = img.height * k;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(f.type === "image/jpeg" ? "image/jpeg" : "image/png", .92));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => { toast("Image illisible", "err"); resolve(null); };
      img.src = URL.createObjectURL(f);
    };
    input.click();
  });
}

document.addEventListener("keydown", e => {
  if (!S || !document.body.contains($("#ed-pages")) || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
});

// --- Souris / doigt -----------------------------------------------------------

function pointIn(e, p) {
  const r = p.overlay.getBoundingClientRect();
  const s = scale();
  return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
}

function onDown(e, p) {
  const [x, y] = pointIn(e, p);
  const mode = S.mode;
  const target = e.target.closest(".el");
  if (target?.isContentEditable) return;
  // Un clic ailleurs termine la saisie en cours (preventDefault empêcherait le blur)
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  e.preventDefault();

  if (mode === "select") {
    if (!target) return select(null);
    const it = byId(+target.dataset.id);
    select(it.id);
    const resizing = e.target.classList.contains("handle");
    const start = { x, y, ix: it.x, iy: it.y, iw: it.w, ih: it.h, size: it.size };
    let moved = false;
    return drag(e, p, (mx, my) => {
      if (!moved) { snapshot(); moved = true; }
      if (resizing) {
        if (it.type === "text") {
          it.size = Math.max(4, start.size * Math.max(.1, (start.iw + mx - start.x) / start.iw));
          measureText(it);
        } else {
          const ratio = start.iw / start.ih;
          it.w = Math.max(6, start.iw + mx - start.x);
          it.h = it.type === "image" ? it.w / ratio : Math.max(4, start.ih + my - start.y);
        }
      } else {
        it.x = Math.min(p.w - 4, Math.max(-it.w + 4, start.ix + mx - start.x));
        it.y = Math.min(p.h - 4, Math.max(-it.h + 4, start.iy + my - start.y));
      }
      redraw(it);
    }, () => renderProps());
  }

  if (mode === "text") {
    snapshot();
    const st = S.style;
    const it = { id: S.nextId++, page: p.idx, type: "text", x, y: y - st.size * .6, text: "", font: st.font, size: st.size, color: st.color, bold: st.bold };
    measureText(it);
    S.items.push(it);
    drawItems(p.idx);
    setMode("select");
    select(it.id);
    return editText(it);
  }

  if ((mode === "signature" || mode === "image") && S.pending) {
    const src = S.pending;
    const img = new Image();
    img.onload = () => {
      snapshot();
      const w = Math.min(mode === "signature" ? 170 : 240, p.w * .6), h = w * img.height / img.width;
      const it = { id: S.nextId++, page: p.idx, type: "image", x: x - w / 2, y: y - h / 2, w, h, src };
      S.items.push(it);
      S.pending = null;
      drawItems(p.idx);
      setMode("select");
      select(it.id);
    };
    img.src = src;
    return;
  }

  if (mode === "highlight" || mode === "rect" || mode === "whiteout") {
    snapshot();
    const st = S.style;
    const it = { id: S.nextId++, page: p.idx, type: mode, x, y, w: 0, h: 0,
                 color: mode === "highlight" ? st.mark : st.stroke, width: st.width };
    S.items.push(it);
    return drag(e, p, (mx, my) => {
      Object.assign(it, { x: Math.min(x, mx), y: Math.min(y, my), w: Math.abs(mx - x), h: Math.abs(my - y) });
      redraw(it);
    }, () => {
      if (it.w < 3 || it.h < 3) { S.items = S.items.filter(i => i !== it); S.history.pop(); }
      drawItems(p.idx);
    });
  }

  if (mode === "draw") {
    const pts = [[x, y]];
    const svgNs = "http://www.w3.org/2000/svg";
    const live = document.createElementNS(svgNs, "svg");
    live.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;pointer-events:none");
    const path = document.createElementNS(svgNs, "path");
    const s = scale();
    Object.entries({ fill: "none", stroke: S.style.stroke, "stroke-width": S.style.width * s, "stroke-linecap": "round", "stroke-linejoin": "round" })
      .forEach(([k, v]) => path.setAttribute(k, v));
    live.append(path);
    p.overlay.append(live);
    return drag(e, p, (mx, my) => {
      pts.push([mx, my]);
      path.setAttribute("d", pathOf(pts.map(([a, b]) => [a * s, b * s])));
    }, () => {
      live.remove();
      if (pts.length < 2) return;
      snapshot();
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const pad = S.style.width;
      const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
      const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
      S.items.push({ id: S.nextId++, page: p.idx, type: "draw", x: x0, y: y0, w, h, ow: w, oh: h,
                     points: pts.map(([a, b]) => [a - x0, b - y0]), color: S.style.stroke, width: S.style.width });
      drawItems(p.idx);
    });
  }
}

function drag(e, p, onMove, onUp) {
  const move = ev => { const [mx, my] = pointIn(ev, p); onMove(mx, my); };
  const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); onUp?.(); };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

function redraw(it) {
  const old = $(`.el[data-id="${it.id}"]`);
  const fresh = itemEl(it, scale());
  old ? old.replaceWith(fresh) : S.pages[it.page].overlay.append(fresh);
}

function onDouble(e) {
  const target = e.target.closest(".el.text");
  if (target) editText(byId(+target.dataset.id));
}

function editText(it) {
  const el = $(`.el[data-id="${it.id}"]`);
  el.contentEditable = "true";
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  const before = it.text;
  el.addEventListener("blur", () => {
    it.text = el.innerText.replace(/\n$/, "");
    if (!it.text.trim()) {
      S.items = S.items.filter(i => i !== it);
      if (!before) S.history.pop();
      S.sel = null;
    } else if (it.text !== before && before) snapshot();
    measureText(it);
    drawItems(it.page);
    renderProps();
  }, { once: true });
}

// --- Panneau de propriétés ----------------------------------------------------

function renderProps() {
  const box = $("#ed-props");
  if (!box) return;
  delete box.dataset.snap;
  const it = S.sel && byId(S.sel);
  const kind = it ? it.type : S.mode;
  const src = it || S.style;
  const titles = { select: "Sélection", text: "Texte", image: "Image", signature: "Signature", highlight: "Surlignage", rect: "Cadre", whiteout: "Masque blanc", draw: "Dessin" };
  const picked = { text: "Texte sélectionné", image: "Image sélectionnée", highlight: "Surlignage sélectionné", rect: "Cadre sélectionné", whiteout: "Masque sélectionné", draw: "Dessin sélectionné" };
  let html = `<h3>${icon(it ? "edit" : "cursor")}${it ? picked[kind] : "Outil : " + titles[kind]}</h3>`;
  if (kind === "text") {
    html += `<div class="prop"><span>Police</span><select data-p="font">${Object.entries(FONTS).map(([k, f]) => `<option value="${k}" ${src.font === k ? "selected" : ""}>${f.label}</option>`).join("")}</select></div>
      <div class="prop"><span>Taille</span><input type="number" data-p="size" min="4" max="200" value="${Math.round(src.size)}"></div>
      <div class="prop"><span>Couleur</span><input type="color" data-p="color" value="${src.color}"><label class="check"><input type="checkbox" data-p="bold" ${src.bold ? "checked" : ""}> Gras</label></div>
      ${it ? `<p class="hint">Double-clique sur le texte pour le modifier.</p>` : `<p class="hint">Clique sur la page pour écrire.</p>`}`;
  } else if (kind === "highlight") {
    html += `<div class="prop"><span>Couleur</span><input type="color" data-p="${it ? "color" : "mark"}" value="${it ? it.color : src.mark}"></div>
      ${it ? "" : `<p class="hint">Trace un rectangle sur le passage à surligner.</p>`}`;
  } else if (kind === "rect" || kind === "draw") {
    html += `<div class="prop"><span>Couleur</span><input type="color" data-p="${it ? "color" : "stroke"}" value="${it ? it.color : src.stroke}"></div>
      <div class="prop"><span>Épaisseur</span><input type="range" data-p="width" min="1" max="12" step=".5" value="${src.width}"></div>
      ${it ? "" : `<p class="hint">${kind === "rect" ? "Trace un rectangle sur la page." : "Dessine librement sur la page."}</p>`}`;
  } else if (kind === "whiteout") {
    html += `<p class="hint">${it ? "Rectangle blanc opaque." : "Trace un rectangle pour cacher un passage."}</p>`;
  } else if (kind === "image" || kind === "signature") {
    html += `<p class="hint">${it ? "Déplace-la, ou agrandis-la avec la poignée bleue." : "Clique sur la page pour la placer."}</p>`;
  } else {
    html += `<p class="hint">Clique sur un élément pour le sélectionner, le déplacer ou le redimensionner. Choisis un outil dans la barre pour ajouter du contenu.</p>
      <p class="hint">${S.items.length} élément${S.items.length > 1 ? "s" : ""} ajouté${S.items.length > 1 ? "s" : ""}.</p>`;
  }
  if (it) html += `<button class="btn small danger" data-a="del" style="margin-top:8px">${icon("trash")}Supprimer</button>`;
  box.innerHTML = html;
  box.querySelector("[data-a=del]")?.addEventListener("click", removeSelected);
  box.querySelectorAll("[data-p]").forEach(input => input.addEventListener("input", () => {
    const key = input.dataset.p;
    const val = input.type === "checkbox" ? input.checked : input.type === "number" || input.type === "range" ? +input.value : input.value;
    if (it) {
      if (!box.dataset.snap) { snapshot(); box.dataset.snap = "1"; }
      it[key] = val;
      if (it.type === "text") measureText(it);
      redraw(it);
    } else {
      S.style[key] = val;
    }
  }));
}

// --- Formulaires --------------------------------------------------------------

function readFields(form) {
  const L = PDFLib;
  return form.getFields().map(f => {
    const name = f.getName();
    if (f instanceof L.PDFTextField) return { name, kind: "text", value: f.getText() || "", multi: f.isMultiline() };
    if (f instanceof L.PDFCheckBox) return { name, kind: "check", value: f.isChecked() };
    if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) return { name, kind: "choice", value: f.getSelected()[0] || "", options: f.getOptions() };
    if (f instanceof L.PDFRadioGroup) return { name, kind: "choice", value: f.getSelected() || "", options: f.getOptions() };
    return null;
  }).filter(Boolean);
}

function renderForm() {
  const pretty = n => n.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  $("#ed-form").innerHTML = S.fields.map((f, i) => `<div class="ff">
    ${f.kind === "check" ? `<label class="check"><input type="checkbox" data-f="${i}" ${f.value ? "checked" : ""}> ${esc(pretty(f.name))}</label>`
      : `<label>${esc(pretty(f.name))}</label>${f.kind === "text"
        ? (f.multi ? `<textarea data-f="${i}" rows="3">${esc(f.value)}</textarea>` : `<input type="text" data-f="${i}" value="${esc(f.value)}">`)
        : `<select data-f="${i}"><option value=""></option>${f.options.map(o => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`}`}
  </div>`).join("");
  $("#ed-form").addEventListener("input", e => {
    const f = S.fields[e.target.dataset.f];
    if (f) f.value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  });
}

function applyForm(doc) {
  const form = doc.getForm();
  const L = PDFLib;
  for (const f of S.fields) {
    try {
      const field = form.getField(f.name);
      if (field instanceof L.PDFTextField) field.setText(f.value || undefined);
      else if (field instanceof L.PDFCheckBox) f.value ? field.check() : field.uncheck();
      else if (f.value && (field instanceof L.PDFDropdown || field instanceof L.PDFOptionList || field instanceof L.PDFRadioGroup)) field.select(f.value);
    } catch (e) { console.warn("Champ ignoré", f.name, e); }
  }
  if ($("#ed-flatten")?.checked) form.flatten();
}

// --- Export -------------------------------------------------------------------

async function exportPdf() {
  document.activeElement?.blur();
  const btn = $("#ed-save");
  btn.disabled = true;
  try {
    const doc = await openEdit(S.bytes);
    if (S.fields.length) applyForm(doc);
    const fonts = {};
    const font = async name => (fonts[name] ||= await doc.embedFont(StandardFonts[name]));
    const images = {};
    for (const it of S.items) {
      const page = doc.getPage(it.page);
      const f = frame(page);
      const rotate = degrees(f.angle);
      if (it.type === "text") {
        const spec = FONTS[it.font];
        const fnt = await font(spec.pdf[it.bold ? 1 : 0]);
        it.text.split("\n").forEach((line, i) => {
          const at = f.toUser(it.x, it.y + (i * 1.2 + spec.base) * it.size);
          page.drawText(safeText(fnt, line), { ...at, size: it.size, font: fnt, color: hexColor(it.color), rotate });
        });
      } else if (it.type === "image") {
        const img = images[it.src] ||= await (it.src.startsWith("data:image/jpeg") ? doc.embedJpg(it.src) : doc.embedPng(it.src));
        page.drawImage(img, { ...f.toUser(it.x, it.y + it.h), width: it.w, height: it.h, rotate });
      } else if (it.type === "highlight") {
        page.drawRectangle({ ...f.toUser(it.x, it.y + it.h), width: it.w, height: it.h, rotate, color: hexColor(it.color), opacity: .4, blendMode: BlendMode.Multiply });
      } else if (it.type === "whiteout") {
        page.drawRectangle({ ...f.toUser(it.x, it.y + it.h), width: it.w, height: it.h, rotate, color: hexColor("#ffffff") });
      } else if (it.type === "rect") {
        const bw = it.width;
        page.drawRectangle({ ...f.toUser(it.x + bw / 2, it.y + it.h - bw / 2), width: it.w - bw, height: it.h - bw, rotate,
                             borderColor: hexColor(it.color), borderWidth: bw });
      } else if (it.type === "draw") {
        const sx = it.w / it.ow, sy = it.h / it.oh;
        page.drawSvgPath(pathOf(it.points.map(([a, b]) => [a * sx, b * sy])), { ...f.toUser(it.x, it.y), rotate,
                         borderColor: hexColor(it.color), borderWidth: it.width });
      }
    }
    const out = await doc.save();
    resultCard($("#ed-result"), pdfBlob(out), baseName(S.file.name) + "-modifie.pdf", { editable: false });
  } catch (e) {
    toast(e.message, "err");
  }
  btn.disabled = false;
}
