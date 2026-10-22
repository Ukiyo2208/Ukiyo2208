// Studio PDF · Fusionner plusieurs PDF.
import { $, esc, icon, toast, dropHTML, dropzone, resultCard, sizeStr } from "../ui.js";
import { readBytes, openEdit, pdfBlob, toolHead, PDFDocument } from "./lib.js";

let S = null;

export function render(container, tool) {
  S = { files: [], container };
  container.innerHTML = toolHead(tool) + `<div class="card">
    ${dropHTML("mg-drop", { multiple: true, title: "Glisse tes PDF ici", sub: "ou clique pour les choisir · ajoute-en autant que tu veux" })}
    <div id="mg-list" style="margin-top:16px"></div>
    <button class="btn wide" id="mg-go" disabled style="margin-top:12px">${icon("merge")}Fusionner</button>
    <div id="mg-result"></div></div>`;
  const z = $("#mg-drop", container);
  dropzone(z, z.querySelector("input"), add);
  $("#mg-go", container).onclick = merge;
  $("#mg-list", container).addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const i = +b.closest(".file").dataset.i;
    if (b.dataset.act === "up" && i > 0) S.files.splice(i - 1, 0, S.files.splice(i, 1)[0]);
    if (b.dataset.act === "down" && i < S.files.length - 1) S.files.splice(i + 1, 0, S.files.splice(i, 1)[0]);
    if (b.dataset.act === "del") S.files.splice(i, 1);
    list();
  });
  let dragged = null;
  const l = $("#mg-list", container);
  l.addEventListener("dragstart", e => { dragged = +e.target.closest(".file").dataset.i; });
  l.addEventListener("dragover", e => e.preventDefault());
  l.addEventListener("drop", e => {
    e.preventDefault();
    const t = e.target.closest(".file");
    if (dragged == null || !t) return;
    S.files.splice(+t.dataset.i, 0, S.files.splice(dragged, 1)[0]);
    dragged = null;
    list();
  });
}

async function add(files) {
  for (const file of files) {
    try {
      const bytes = await readBytes(file);
      const doc = await openEdit(bytes);
      S.files.push({ name: file.name, size: file.size, bytes, pages: doc.getPageCount() });
    } catch (e) { toast(`${file.name} : ${e.message}`, "err"); }
  }
  list();
}

function list() {
  const total = S.files.reduce((n, f) => n + f.pages, 0);
  $("#mg-list", S.container).innerHTML = S.files.length ? `<div class="card-title">Ordre de fusion <span class="count">${S.files.length} fichiers · ${total} pages</span></div>
    <div class="files">${S.files.map((f, i) => `
    <div class="file" draggable="true" data-i="${i}" style="cursor:grab">
      <span class="ficon">${i + 1}</span>
      <div class="name">${esc(f.name)}<small>${f.pages} page${f.pages > 1 ? "s" : ""} · ${sizeStr(f.size)}</small></div>
      <span class="pick">
        <button class="icon-btn" data-act="up" title="Monter">▲</button>
        <button class="icon-btn" data-act="down" title="Descendre">▼</button>
        <button class="icon-btn" data-act="del" title="Retirer">${icon("trash")}</button>
      </span>
    </div>`).join("")}</div>` : "";
  $("#mg-go", S.container).disabled = S.files.length < 2;
}

async function merge() {
  const btn = $("#mg-go", S.container);
  btn.disabled = true;
  try {
    const out = await PDFDocument.create();
    for (const f of S.files) {
      const doc = await openEdit(f.bytes);
      (await out.copyPages(doc, doc.getPageIndices())).forEach(p => out.addPage(p));
    }
    resultCard($("#mg-result", S.container), pdfBlob(await out.save()), "fusion.pdf", { info: `${out.getPageCount()} pages` });
  } catch (e) { toast(e.message, "err"); }
  btn.disabled = false;
}
