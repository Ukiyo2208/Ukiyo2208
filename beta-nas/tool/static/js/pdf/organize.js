// Studio PDF · Organiser les pages (réordonner, pivoter, supprimer, insérer).
import { $, esc, icon, toast, dropHTML, dropzone, resultCard, loading, baseName } from "../ui.js";
import { readBytes, openView, openEdit, pdfBlob, renderThumb, toolHead, takeHandoff, PDFDocument, degrees } from "./lib.js";

const COLORS = ["#1f6bff", "#e2384b", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4"];
let S = null;

export function render(container, tool) {
  S = { sources: [], pages: [], tool, container, key: 0, thumbs: new Map() };
  container.innerHTML = toolHead(tool) + `<div class="card" id="or-zone">${dropHTML("or-drop", { multiple: true, sub: "ou clique pour le choisir · plusieurs PDF possibles" })}</div>`;
  const z = $("#or-drop", container);
  dropzone(z, z.querySelector("input"), addFiles);
  const handoff = takeHandoff();
  if (handoff) addFiles([handoff]);
}

async function addFiles(files) {
  const first = !S.sources.length;
  if (first) loading($("#or-zone", S.container), "Lecture des pages…");
  try {
    for (const file of files) {
      const bytes = await readBytes(file);
      const view = await openView(bytes);
      const si = S.sources.push({ name: file.name, bytes, view, color: COLORS[S.sources.length % COLORS.length] }) - 1;
      for (let i = 0; i < view.numPages; i++) S.pages.push({ key: S.key++, src: si, idx: i, rot: 0 });
    }
    if (first) shell();
    draw();
  } catch (e) {
    toast(e.message, "err");
    if (first) render(S.container, S.tool);
  }
}

function shell() {
  $("#or-zone", S.container).outerHTML = `
    <div class="toolbar">
      <label class="tb" style="cursor:pointer">${icon("filePlus")}<span class="lbl">Ajouter un PDF</span><input type="file" accept=".pdf,application/pdf" multiple hidden id="or-add"></label>
      <button class="tb" data-a="blank">${icon("plus")}<span class="lbl">Page blanche</span></button>
      <button class="tb" data-a="rotall">${icon("rotateCw")}<span class="lbl">Tout pivoter</span></button>
      <span class="sep"></span>
      <span class="meta" id="or-count"></span>
      <span style="flex:1"></span>
      <button class="btn small" data-a="save">${icon("save")}Enregistrer le PDF</button>
    </div>
    <div class="card"><div class="thumbs" id="or-thumbs"></div><div id="or-result"></div></div>`;
  const c = S.container;
  $("#or-add", c).addEventListener("change", e => { addFiles([...e.target.files]); e.target.value = ""; });
  c.querySelector(".toolbar").addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "blank") { S.pages.push({ key: S.key++, src: null, rot: 0 }); draw(); }
    if (a === "rotall") { S.pages.forEach(p => { p.rot = (p.rot + 90) % 360; }); draw(); }
    if (a === "save") save();
  });
  const grid = $("#or-thumbs", c);
  grid.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const i = +b.closest(".thumb").dataset.i;
    const act = b.dataset.act;
    if (act === "cw") S.pages[i].rot = (S.pages[i].rot + 90) % 360;
    if (act === "ccw") S.pages[i].rot = (S.pages[i].rot + 270) % 360;
    if (act === "del") S.pages.splice(i, 1);
    if (act === "left" && i > 0) S.pages.splice(i - 1, 0, S.pages.splice(i, 1)[0]);
    if (act === "right" && i < S.pages.length - 1) S.pages.splice(i + 1, 0, S.pages.splice(i, 1)[0]);
    draw();
  });
  // Glisser-déposer pour réordonner
  let dragged = null;
  grid.addEventListener("dragstart", e => { dragged = e.target.closest(".thumb"); dragged?.classList.add("dragging"); });
  grid.addEventListener("dragend", () => { dragged?.classList.remove("dragging"); grid.querySelectorAll(".drop-before").forEach(t => t.classList.remove("drop-before")); });
  grid.addEventListener("dragover", e => {
    e.preventDefault();
    grid.querySelectorAll(".drop-before").forEach(t => t.classList.remove("drop-before"));
    e.target.closest(".thumb")?.classList.add("drop-before");
  });
  grid.addEventListener("drop", e => {
    e.preventDefault();
    const target = e.target.closest(".thumb");
    if (!dragged || !target || target === dragged) return;
    const from = +dragged.dataset.i, to = +target.dataset.i;
    const [p] = S.pages.splice(from, 1);
    S.pages.splice(from < to ? to - 1 : to, 0, p);
    draw();
  });
}

function draw() {
  $("#or-count", S.container).textContent = `${S.pages.length} page${S.pages.length > 1 ? "s" : ""}`;
  const grid = $("#or-thumbs", S.container);
  const multi = S.sources.length > 1;
  grid.innerHTML = S.pages.map((p, i) => `
    <div class="thumb" draggable="true" data-i="${i}">
      ${multi && p.src != null ? `<span class="src-tag" style="background:${S.sources[p.src].color}" title="${esc(S.sources[p.src].name)}">${p.src + 1}</span>` : ""}
      <div class="img" data-key="${p.key}"></div>
      <div class="lbl">${i + 1}${p.src == null ? " · blanche" : ""}</div>
      <div class="acts">
        <button data-act="left" title="Vers la gauche">${icon("left")}</button>
        <button data-act="ccw" title="Pivoter à gauche">${icon("rotateCcw")}</button>
        <button data-act="cw" title="Pivoter à droite">${icon("rotateCw")}</button>
        <button data-act="del" title="Supprimer">${icon("trash")}</button>
        <button data-act="right" title="Vers la droite">${icon("right")}</button>
      </div>
    </div>`).join("");
  S.pages.forEach(async p => {
    const holder = grid.querySelector(`[data-key="${p.key}"]`);
    let canvas = S.thumbs.get(p.key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      S.thumbs.set(p.key, canvas);
      if (p.src == null) { canvas.width = 210; canvas.height = 297; canvas.style.width = "105px"; canvas.style.height = "148px"; }
      else await renderThumb(await S.sources[p.src].view.getPage(p.idx + 1), canvas, 120);
    }
    const w = parseFloat(canvas.style.width), h = parseFloat(canvas.style.height);
    const k = p.rot % 180 ? Math.min(1, 150 / h, 170 / w) : 1;
    canvas.style.transform = `rotate(${p.rot}deg) scale(${k})`;
    holder.replaceChildren(canvas);
  });
}

async function save() {
  if (!S.pages.length) return toast("Il n'y a plus aucune page", "err");
  const btn = S.container.querySelector("[data-a=save]");
  btn.disabled = true;
  try {
    const out = await PDFDocument.create();
    const docs = await Promise.all(S.sources.map(s => openEdit(s.bytes)));
    for (const p of S.pages) {
      if (p.src == null) {
        const ref = S.pages.find(q => q.src != null);
        const size = ref ? docs[ref.src].getPage(ref.idx).getSize() : { width: 595.28, height: 841.89 };
        out.addPage([size.width, size.height]).setRotation(degrees(p.rot));
        continue;
      }
      const [page] = await out.copyPages(docs[p.src], [p.idx]);
      page.setRotation(degrees((page.getRotation().angle + p.rot) % 360));
      out.addPage(page);
    }
    const name = baseName(S.sources[0]?.name || "document") + "-organise.pdf";
    resultCard($("#or-result", S.container), pdfBlob(await out.save()), name);
  } catch (e) { toast(e.message, "err"); }
  btn.disabled = false;
}
