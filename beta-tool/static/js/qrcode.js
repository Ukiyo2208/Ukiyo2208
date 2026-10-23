// Génération de QR codes (bibliothèque qrcode-generator, en UTF-8).
import qrcode from "../vendor/qrcode.mjs";

qrcode.stringToBytes = s => Array.from(new TextEncoder().encode(s));

/** Matrice du QR code : { size, dark(x, y) }. ecc : L, M, Q ou H. */
export function matrix(text, ecc = "M") {
  const qr = qrcode(0, ecc);
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return { size: n, dark: (x, y) => qr.isDark(y, x) };
}

/** QR code en SVG (texte). */
export function svg(text, { ecc = "M", fg = "#000000", bg = "#ffffff", margin = 2, px = 8 } = {}) {
  const m = matrix(text, ecc);
  const full = m.size + margin * 2;
  let path = "";
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.dark(x, y)) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * px}" height="${full * px}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}

/** QR code dessiné dans un canvas (pour l'export PNG), avec logo central optionnel. */
export async function canvas(text, { ecc = "M", fg = "#000000", bg = "#ffffff", margin = 2, size = 1024, logo = null, rounded = false } = {}) {
  const m = matrix(text, logo ? "H" : ecc);
  const full = m.size + margin * 2;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const k = size / full;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
    if (!m.dark(x, y)) continue;
    const px = (x + margin) * k, py = (y + margin) * k;
    if (rounded) { ctx.beginPath(); ctx.arc(px + k / 2, py + k / 2, k * .48, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(k), Math.ceil(k));
  }
  if (logo) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = logo; });
    const s = size * .22, x = (size - s) / 2;
    ctx.fillStyle = bg;
    ctx.fillRect(x - k, x - k, s + 2 * k, s + 2 * k);
    ctx.drawImage(img, x, x, s, s);
  }
  return c;
}
