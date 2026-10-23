// Traitement d'image du Scanner, entièrement dans le navigateur :
// détection des bords de la feuille, redressement (perspective) et filtres « scan ».

/** Image → canvas, avec une taille maximale (côté le plus long). */
export function toCanvas(src, max) {
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const lum = (d, i) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(g) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v | 0]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** Coins de la feuille [[x,y]×4] (haut-gauche, haut-droit, bas-droit, bas-gauche), en coordonnées 0‥1. */
export function detect(source) {
  const c = toCanvas(source, 420);
  const w = c.width, h = c.height;
  const d = c.getContext("2d").getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = lum(d, i * 4);
  const b = boxBlur(boxBlur(g, w, h, 2), w, h, 2);
  const thr = otsu(b);
  // Plus grande zone claire d'un seul tenant (la feuille, en général plus claire que la table)
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = b[i] > thr ? 1 : 0;
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0, bestTouches = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0, id = 0; start < w * h; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    let sp = 0, size = 0, touches = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches++;
      if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && label[p - w] === -1) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && label[p + w] === -1) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; bestTouches = touches; }
    id++;
  }
  const fallback = [[.04, .04], [.96, .04], [.96, .96], [.04, .96]];
  const ratio = bestSize / (w * h);
  if (bestId < 0 || ratio < .12 || ratio > .97 || bestTouches > (w + h) * .9) return fallback;
  // Coins = points extrêmes selon les diagonales
  let tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
  for (let p = 0; p < w * h; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w, y = (p / w) | 0, s = x + y, df = x - y;
    if (s < tl[2]) tl = [x, y, s];
    if (s > br[2]) br = [x, y, s];
    if (df > tr[2]) tr = [x, y, df];
    if (df < bl[2]) bl = [x, y, df];
  }
  const quad = [tl, tr, br, bl].map(([x, y]) => [x / (w - 1), y / (h - 1)]);
  return area(quad) > .1 ? quad : fallback;
}

export function area(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

/** Homographie qui envoie le rectangle (0,0)-(w,h) sur le quadrilatère q (pixels). */
function homography(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let i = 0; i < 8; i++) {  // élimination de Gauss avec pivot
    let piv = i;
    for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [B[i], B[piv]] = [B[piv], B[i]];
    for (let r = 0; r < 8; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let k = i; k < 8; k++) A[r][k] -= f * A[i][k];
      B[r] -= f * B[i];
    }
  }
  return B.map((b, i) => b / A[i][i]);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Redresse la zone q (coins 0‥1) de l'image source → canvas (côté le plus long ≤ max). */
export function warp(source, quad, max = 2400, rotation = 0) {
  const sw = source.width, sh = source.height;
  const q = quad.map(([x, y]) => [x * sw, y * sh]);
  let ow = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, oh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const k = Math.min(1, max / Math.max(ow, oh));
  ow = Math.max(1, Math.round(ow * k)); oh = Math.max(1, Math.round(oh * k));
  const H = homography(ow, oh, q);
  const sc = source instanceof HTMLCanvasElement ? source : toCanvas(source, Math.max(sw, sh));
  const sd = sc.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas");
  out.width = ow; out.height = oh;
  const octx = out.getContext("2d");
  const img = octx.createImageData(ow, oh), od = img.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const den = H[6] * x + H[7] * y + 1;
      const u = (H[0] * x + H[1] * y + H[2]) / den, v = (H[3] * x + H[4] * y + H[5]) / den;
      const x0 = Math.min(sw - 2, Math.max(0, u | 0)), y0 = Math.min(sh - 2, Math.max(0, v | 0));
      const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, o = (y * ow + x) * 4;
      for (let c = 0; c < 3; c++) {
        od[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return rotation ? rotate(out, rotation) : out;
}

export function rotate(canvas, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return canvas;
  const c = document.createElement("canvas");
  c.width = r % 180 ? canvas.height : canvas.width;
  c.height = r % 180 ? canvas.width : canvas.height;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(r * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

/** Filtres : original, auto (couleurs), magic (document couleur), gray, bw (noir et blanc). */
export function filter(canvas, mode) {
  if (mode === "original") return canvas;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h;
  if (mode === "auto") {
    for (let c = 0; c < 3; c++) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[d[i * 4 + c]]++;
      let lo = 0, hi = 255, acc = 0;
      while (acc < n * .005 && lo < 254) acc += hist[lo++];
      acc = 0;
      while (acc < n * .005 && hi > 1) acc += hist[hi--];
      const span = Math.max(1, hi - lo);
      for (let i = 0; i < n; i++) d[i * 4 + c] = Math.min(255, Math.max(0, (d[i * 4 + c] - lo) * 255 / span));
    }
  } else {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = lum(d, i * 4);
    // Fond estimé (éclairage) : grand flou ; on divise pour blanchir le papier et gommer les ombres
    const r = Math.max(8, Math.round(Math.max(w, h) / 40));
    const small = Math.max(1, Math.round(Math.max(w, h) / 600));  // calcul sur une version réduite pour aller vite
    const sw = Math.ceil(w / small), sh = Math.ceil(h / small), gs = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) gs[y * sw + x] = g[Math.min(h - 1, y * small) * w + Math.min(w - 1, x * small)];
    // fond = maximum local adouci (le papier est la partie la plus claire)
    const bgS = boxBlur(dilate(gs, sw, sh, Math.max(2, Math.round(r / small / 2))), sw, sh, Math.max(2, Math.round(r / small)));
    const bgAt = (x, y) => bgS[Math.min(sh - 1, (y / small) | 0) * sw + Math.min(sw - 1, (x / small) | 0)];
    if (mode === "bw") {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = g[i] / Math.max(1, bgAt(x, y));
        const o = v > .78 ? 255 : v < .6 ? 0 : (v - .6) / .18 * 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = o;
      }
    } else {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, k = 245 / Math.max(30, bgAt(x, y));
        if (mode === "gray") {
          const v = curve(g[i] * k);
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        } else {
          for (let c = 0; c < 3; c++) d[i * 4 + c] = curve(d[i * 4 + c] * k);
        }
      }
    }
  }
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").putImageData(img, 0, 0);
  return out;
}

const curve = v => {  // renforce le contraste du texte, blanchit le papier
  const t = Math.min(1, Math.max(0, v / 255));
  return Math.round(255 * Math.min(1, Math.pow(t, 1.6) * 1.08));
};

function dilate(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
    tmp[y * w + x] = m;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let m = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
    out[y * w + x] = m;
  }
  return out;
}

/** Pages (canvas) → PDF (octets), au format A4 si la page y ressemble. */
export async function makePdf(pages, { quality = .86 } = {}) {
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  for (const c of pages) {
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", quality));
    const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const portrait = c.height >= c.width;
    const a4 = portrait ? [595.28, 841.89] : [841.89, 595.28];
    const ratio = c.width / c.height, a4r = a4[0] / a4[1];
    const size = Math.abs(ratio - a4r) / a4r < .18 ? a4 : portrait ? [595.28, 595.28 / ratio] : [841.89, 841.89 / ratio];
    const page = pdf.addPage(size);
    const k = Math.min(size[0] / c.width, size[1] / c.height);
    const dw = c.width * k, dh = c.height * k;
    page.drawImage(img, { x: (size[0] - dw) / 2, y: (size[1] - dh) / 2, width: dw, height: dh });
  }
  pdf.setTitle("Document scanné");
  pdf.setCreator("Bêta Tool · Scanner");
  return pdf.save();
}
