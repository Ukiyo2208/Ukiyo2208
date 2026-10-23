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

/** Logo de Bêta Tool : adresse pour les QR codes affichés dans la page. */
export const BRAND_LOGO = "/brand/icon-192.png";

let brandData = null, clipId = 0;
/** Logo de Bêta Tool en data URL (pour les SVG téléchargés, qui doivent se suffire à eux-mêmes). */
export function brandLogo() {
  brandData ||= fetch("/brand/icon.png").then(r => r.blob()).then(b => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(b);
  }));
  return brandData;
}

/** QR code en SVG (texte), avec logo central optionnel (adresse ou data URL). */
export function svg(text, { ecc = "M", fg = "#000000", bg = "#ffffff", margin = 2, px = 8, logo = null } = {}) {
  const m = matrix(text, logo ? "H" : ecc);
  const full = m.size + margin * 2;
  let path = "";
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.dark(x, y)) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  let center = "";
  if (logo) {
    const s = full * .22, x = (full - s) / 2, r = s * .22, id = `qr-logo-${++clipId}`;
    center = `<rect x="${x - 1}" y="${x - 1}" width="${s + 2}" height="${s + 2}" rx="${r + 1}" fill="${bg}"/>`
      + `<clipPath id="${id}"><rect x="${x}" y="${x}" width="${s}" height="${s}" rx="${r}"/></clipPath>`
      + `<image href="${logo}" x="${x}" y="${x}" width="${s}" height="${s}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * px}" height="${full * px}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="${bg}"/><path d="${path}" fill="${fg}"/>${center}</svg>`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
    const s = size * .22, x = (size - s) / 2, r = s * .22;
    ctx.fillStyle = bg;
    roundRect(ctx, x - k, x - k, s + 2 * k, s + 2 * k, r + k);
    ctx.fill();
    ctx.save();
    roundRect(ctx, x, x, s, s, r);
    ctx.clip();
    ctx.drawImage(img, x, x, s, s);
    ctx.restore();
  }
  return c;
}
