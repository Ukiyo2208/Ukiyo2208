// Fondations du Studio PDF : pdf.js (affichage) + pdf-lib (modification).
import * as pdfjsLib from "../../vendor/pdfjs/pdf.min.mjs";
import { icon, esc } from "../ui.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const VENDOR = new URL("../../vendor/pdfjs/", import.meta.url).href;

export const PDFLib = window.PDFLib;
export const { PDFDocument, StandardFonts, rgb, degrees, BlendMode } = PDFLib;

export const LOCKED = "Ce PDF est protégé par un mot de passe : passe d'abord par « Déverrouiller ».";

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** Ouvre un PDF pour l'affichage (pdf.js consomme une copie des octets). */
export async function openView(bytes) {
  try {
    return await pdfjsLib.getDocument({
      data: bytes.slice(), cMapUrl: VENDOR + "cmaps/", cMapPacked: true, standardFontDataUrl: VENDOR + "standard_fonts/",
    }).promise;
  } catch (e) {
    throw new Error(e?.name === "PasswordException" ? LOCKED : "Impossible de lire ce PDF : " + (e?.message || e));
  }
}

/** Ouvre un PDF pour le modifier. */
export async function openEdit(bytes) {
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    throw new Error(/encrypt/i.test(e?.message) ? LOCKED : "Impossible de lire ce PDF : " + (e?.message || e));
  }
}

export const pdfBlob = bytes => new Blob([bytes], { type: "application/pdf" });

/** Rend une page pdf.js dans un canvas à une largeur CSS donnée. */
export async function renderThumb(page, canvas, cssWidth) {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = base.height * scale + "px";
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}

/**
 * Repère « affiché » d'une page pdf-lib : dimensions telles qu'on voit la page
 * (rotation comprise) et conversion d'un point affiché (origine en haut à
 * gauche, y vers le bas, en points) vers l'espace utilisateur du PDF.
 * `angle` est la rotation à appliquer au contenu pour qu'il apparaisse droit.
 */
export function frame(page) {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: W, height: H } = page.getCropBox();
  const swap = r === 90 || r === 270;
  const toUser = (dx, dy) => {
    const [ux, uy] = r === 90 ? [dy, dx] : r === 180 ? [W - dx, dy] : r === 270 ? [W - dy, H - dx] : [dx, H - dy];
    return { x: x0 + ux, y: y0 + uy };
  };
  return { Dw: swap ? H : W, Dh: swap ? W : H, toUser, angle: r };
}

export function hexColor(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

/** Retire les caractères qu'une police standard PDF ne sait pas encoder. */
export function safeText(font, text) {
  let out = "";
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += ch === "’" ? "'" : "?"; }
  }
  return out;
}

/** « 1-3, 5, 8-fin » → indices 0-based (lève une erreur si invalide). */
export function parseRanges(text, count) {
  const out = [];
  for (const part of String(text).split(",").map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+|fin)\s*(?:-\s*(\d+|fin))?$/i.exec(part);
    if (!m) throw new Error(`Plage invalide : « ${part} »`);
    const num = v => /fin/i.test(v) ? count : parseInt(v, 10);
    const a = num(m[1]), b = m[2] ? num(m[2]) : a;
    if (a < 1 || b > count || a > b) throw new Error(`Plage hors du document (1 à ${count}) : « ${part} »`);
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  if (!out.length) throw new Error("Indique au moins une page");
  return out;
}

/** En-tête commun des outils PDF. */
export function toolHead(t) {
  return `<div class="page-head">
    <span class="tile rose">${icon(t.icon)}</span>
    <div class="grow"><h1>${esc(t.title)}</h1><p>${esc(t.desc)}</p></div>
    <button class="btn ghost" data-help>${icon("help")}Aide</button>
  </div>`;
}

/** Ligne « fichier chargé » avec bouton pour en changer. */
export function fileRow(file, extra = "") {
  return `<div class="files"><div class="file"><span class="ficon">pdf</span>
    <div class="name">${esc(file.name)}<small>${extra}</small></div>
    <span class="pick"><button class="btn small ghost" data-change>${icon("file")}Changer de fichier</button></span></div></div>`;
}

/** Récupère un fichier passé par « Ouvrir dans l'éditeur » depuis un autre outil. */
export function takeHandoff() {
  const f = window.btHandoff;
  window.btHandoff = null;
  return f || null;
}
