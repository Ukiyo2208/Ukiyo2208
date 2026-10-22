// Studio PDF · Découper / extraire des pages.
import { $, esc, icon, toast, dropHTML, dropzone, resultCard, baseName } from "../ui.js";
import { readBytes, openEdit, pdfBlob, toolHead, fileRow, parseRanges, PDFDocument } from "./lib.js";

export function render(container, tool) {
  container.innerHTML = toolHead(tool) + `<div class="card" id="sp-zone">${dropHTML("sp-drop")}</div>`;
  const z = $("#sp-drop", container);
  dropzone(z, z.querySelector("input"), files => open(container, tool, files[0]));
}

async function open(container, tool, file) {
  let doc, bytes;
  try { bytes = await readBytes(file); doc = await openEdit(bytes); }
  catch (e) { return toast(e.message, "err"); }
  const n = doc.getPageCount();
  $("#sp-zone", container).innerHTML = fileRow(file, `${n} page${n > 1 ? "s" : ""}`) + `
    <label class="field" style="margin-top:18px">Mode</label>
    <div class="seg">
      <label><input type="radio" name="sp-mode" value="extract" checked>Extraire des pages</label>
      <label><input type="radio" name="sp-mode" value="each">Une page par fichier</label>
      <label><input type="radio" name="sp-mode" value="every">Par groupes</label>
      <label><input type="radio" name="sp-mode" value="ranges">Selon des plages</label>
    </div>
    <div class="grid2">
      <div data-for="extract"><label class="field">Pages à extraire</label><input type="text" id="sp-pages" placeholder="ex. 1-3, 5, 8-fin"></div>
      <div data-for="every" hidden><label class="field">Pages par fichier</label><input type="number" id="sp-n" min="1" max="${n}" value="2"></div>
      <div data-for="ranges" hidden><label class="field">Plages (une par fichier, séparées par « ; »)</label><input type="text" id="sp-ranges" placeholder="ex. 1-3 ; 4-6 ; 7-fin"></div>
    </div>
    <button class="btn wide" id="sp-go">${icon("scissors")}Découper</button>
    <div id="sp-result"></div>`;
  $("[data-change]", container).onclick = () => render(container, tool);
  container.querySelectorAll("[name=sp-mode]").forEach(r => r.addEventListener("change", () => {
    container.querySelectorAll("[data-for]").forEach(d => { d.hidden = d.dataset.for !== r.value; });
  }));
  $("#sp-go", container).onclick = async () => {
    const mode = container.querySelector("[name=sp-mode]:checked").value;
    try {
      let groups;
      if (mode === "extract") groups = [parseRanges($("#sp-pages", container).value, n)];
      if (mode === "each") groups = doc.getPageIndices().map(i => [i]);
      if (mode === "every") {
        const k = Math.max(1, parseInt($("#sp-n", container).value, 10) || 1);
        groups = [];
        for (let i = 0; i < n; i += k) groups.push(doc.getPageIndices().slice(i, i + k));
      }
      if (mode === "ranges") groups = $("#sp-ranges", container).value.split(";").map(s => s.trim()).filter(Boolean).map(s => parseRanges(s, n));
      if (!groups?.length) throw new Error("Indique au moins une plage");
      const stem = baseName(file.name);
      const label = g => g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
      const outs = [];
      for (const g of groups) {
        const out = await PDFDocument.create();
        (await out.copyPages(doc, g)).forEach(p => out.addPage(p));
        outs.push([`${stem}-${label(g)}.pdf`, await out.save()]);
      }
      if (outs.length === 1) return resultCard($("#sp-result", container), pdfBlob(outs[0][1]), outs[0][0]);
      const zip = new window.JSZip();
      outs.forEach(([name, data]) => zip.file(name, data));
      const blob = await zip.generateAsync({ type: "blob" });
      resultCard($("#sp-result", container), blob, `${stem}-decoupe.zip`, { info: `${outs.length} fichiers PDF`, editable: false });
    } catch (e) { toast(e.message, "err"); }
  };
}
