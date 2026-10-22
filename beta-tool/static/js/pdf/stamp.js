// Studio PDF · Filigrane et numérotation des pages.
import { $, icon, toast, dropHTML, dropzone, resultCard, baseName } from "../ui.js";
import { readBytes, openEdit, pdfBlob, toolHead, fileRow, takeHandoff, frame, hexColor, safeText, StandardFonts, degrees } from "./lib.js";

const OPTIONS = {
  watermark: `
    <div class="grid2">
      <div><label class="field">Texte</label><input type="text" id="st-text" value="CONFIDENTIEL"></div>
      <div><label class="field">Disposition</label><div class="seg">
        <label><input type="radio" name="st-layout" value="center" checked>Au centre</label>
        <label><input type="radio" name="st-layout" value="tile">Mosaïque</label></div></div>
    </div>
    <div class="grid2">
      <div><label class="field">Taille : <span id="st-size-v">64</span> pt</label><input type="range" id="st-size" min="16" max="160" value="64" style="width:100%"></div>
      <div><label class="field">Transparence : <span id="st-op-v">20</span> %</label><input type="range" id="st-op" min="5" max="100" value="20" style="width:100%"></div>
      <div><label class="field">Angle : <span id="st-angle-v">45</span>°</label><input type="range" id="st-angle" min="-90" max="90" value="45" style="width:100%"></div>
      <div><label class="field">Couleur</label><input type="color" id="st-color" value="#e2384b"></div>
    </div>`,
  numbers: `
    <div class="grid2">
      <div><label class="field">Format</label><select id="st-format" style="width:100%">
        <option value="{n}">1</option><option value="Page {n}">Page 1</option><option value="Page {n} sur {total}" selected>Page 1 sur 12</option>
        <option value="{n} / {total}">1 / 12</option><option value="- {n} -">- 1 -</option></select></div>
      <div><label class="field">Position</label><select id="st-pos" style="width:100%">
        <option value="bl">En bas à gauche</option><option value="bc" selected>En bas au centre</option><option value="br">En bas à droite</option>
        <option value="tl">En haut à gauche</option><option value="tc">En haut au centre</option><option value="tr">En haut à droite</option></select></div>
      <div><label class="field">Commencer à</label><input type="number" id="st-start" value="1" min="0"></div>
      <div><label class="field">Taille du texte</label><input type="number" id="st-nsize" value="10" min="6" max="40"></div>
    </div>
    <label class="check"><input type="checkbox" id="st-skip"> Ne pas numéroter la première page (page de garde)</label>`,
};

export function render(container, tool, kind) {
  container.innerHTML = toolHead(tool) + `<div class="card" id="st-zone">${dropHTML("st-drop")}</div>`;
  const z = $("#st-drop", container);
  dropzone(z, z.querySelector("input"), files => open(container, tool, kind, files[0]));
  const handoff = takeHandoff();
  if (handoff) open(container, tool, kind, handoff);
}

async function open(container, tool, kind, file) {
  let bytes, n;
  try { bytes = await readBytes(file); n = (await openEdit(bytes)).getPageCount(); }
  catch (e) { return toast(e.message, "err"); }
  $("#st-zone", container).innerHTML = fileRow(file, `${n} page${n > 1 ? "s" : ""}`) + `<div style="margin-top:16px">${OPTIONS[kind]}</div>
    <button class="btn wide" id="st-go" style="margin-top:16px">${icon(kind === "watermark" ? "droplet" : "hash")}${kind === "watermark" ? "Appliquer le filigrane" : "Numéroter"}</button>
    <div id="st-result"></div>`;
  $("[data-change]", container).onclick = () => render(container, tool, kind);
  container.querySelectorAll("input[type=range]").forEach(r => r.addEventListener("input", () => { $(`#${r.id}-v`, container).textContent = r.value; }));
  $("#st-go", container).onclick = async () => {
    try {
      const doc = await openEdit(bytes);
      if (kind === "watermark") await watermark(doc, container); else await numbers(doc, container);
      resultCard($("#st-result", container), pdfBlob(await doc.save()), baseName(file.name) + (kind === "watermark" ? "-filigrane.pdf" : "-numerote.pdf"));
    } catch (e) { toast(e.message, "err"); }
  };
}

async function watermark(doc, c) {
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = safeText(font, $("#st-text", c).value.trim());
  if (!text) throw new Error("Écris le texte du filigrane");
  const size = +$("#st-size", c).value, opacity = +$("#st-op", c).value / 100, theta = +$("#st-angle", c).value;
  const color = hexColor($("#st-color", c).value), tile = c.querySelector("[name=st-layout]:checked").value === "tile";
  const tw = font.widthOfTextAtSize(text, size), th = size * .72;
  const rad = theta * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  for (const page of doc.getPages()) {
    const f = frame(page);
    const centers = [];
    if (tile) {
      const sx = tw * .8 + size * 2, sy = size * 3.2;
      for (let row = 0, y = -f.Dh * .5; y < f.Dh * 1.5; row++, y += sy)
        for (let x = -f.Dw * .5 + (row % 2 ? sx / 2 : 0); x < f.Dw * 1.5; x += sx) centers.push([x, y]);
    } else centers.push([f.Dw / 2, f.Dh / 2]);
    for (const [cx, cyUp] of centers) {
      // Point de départ du texte pour que son centre tombe sur (cx, cy), en repère « y vers le haut »
      const sxUp = cx - (tw / 2 * cos - th / 2 * sin), syUp = cyUp - (tw / 2 * sin + th / 2 * cos);
      const at = f.toUser(sxUp, f.Dh - syUp);
      page.drawText(text, { ...at, size, font, color, opacity, rotate: degrees(f.angle + theta) });
    }
  }
}

async function numbers(doc, c) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fmt = $("#st-format", c).value, pos = $("#st-pos", c).value;
  const start = parseInt($("#st-start", c).value, 10) || 0, size = +$("#st-nsize", c).value || 10, skip = $("#st-skip", c).checked;
  const pages = doc.getPages();
  const total = start + pages.length - 1;
  pages.forEach((page, i) => {
    if (skip && i === 0) return;
    const f = frame(page);
    const text = fmt.replace("{n}", start + i).replace("{total}", total);
    const tw = font.widthOfTextAtSize(text, size), m = 28;
    const x = pos[1] === "l" ? m : pos[1] === "r" ? f.Dw - m - tw : (f.Dw - tw) / 2;
    const y = pos[0] === "b" ? f.Dh - m + size * .2 : m + size * .8;
    page.drawText(text, { ...f.toUser(x, y), size, font, color: hexColor("#333333"), rotate: degrees(f.angle) });
  });
}
