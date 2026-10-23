// Version anglaise de l'interface : les pages sont écrites en français ; quand l'anglais est
// choisi, ce module remplace à l'affichage les textes (et les attributs placeholder/title…)
// à partir du dictionnaire static/i18n/en.json, y compris les textes ajoutés plus tard.
//   - correspondance exacte ;
//   - puis avec les nombres remplacés par {n} (« 3 fichiers ») ;
//   - puis avec des modèles {x} (« Abonné à {x} ») ;
//   - puis morceau par morceau autour des séparateurs « · ».

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const SKIP = "textarea, input, code, pre, [contenteditable], .notranslate, [translate=no], script, style";
let dict = null, patterns = [], numeric = new Map(), lang = "fr";
const original = new WeakMap();

export function current() { return lang; }

export function stored() {
  try { return localStorage.getItem("bt-lang"); } catch { return null; }
}

export function preferred(serverPref) {
  return serverPref || stored() || ((navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en");
}

const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

function compile(entries) {
  dict = new Map();
  patterns = [];
  numeric = new Map();
  for (const [fr, en] of Object.entries(entries)) {
    dict.set(fr, en);
    if (fr.includes("{x}")) {
      const parts = fr.split("{x}");
      if (parts.every(p => !p.trim())) continue;  // modèle sans texte fixe : trop vague
      const rx = new RegExp("^" + parts.map(esc).join("(.*?)") + "$", "s");
      patterns.push([rx, en, parts.join("").length, fr.includes(" · ")]);
    }
  }
  patterns.sort((a, b) => b[2] - a[2]);  // les modèles les plus précis d'abord
  for (const [fr, en] of dict) if (/\d/.test(fr)) numeric.set(fr.replace(/\d+(?:[.,]\d+)?/g, "{n}"), [fr, en]);
}

function fill(template, values) {
  if (/\{\d\}/.test(template)) return template.replace(/\{(\d)\}/g, (_, n) => values[n - 1] ?? "");  // {1}, {2}… : ordre libre
  let i = 0;
  return template.replace(/\{x\}/g, () => values[i++] ?? "");
}

const UNITS = { o: "B", Ko: "KB", Mo: "MB", Go: "GB", To: "TB" };
const units = t => t.replace(/(\d) (o|Ko|Mo|Go|To)\b/g, (_, d, u) => `${d} ${UNITS[u]}`);

/** Traduit une chaîne (sans les espaces autour), ou renvoie null. */
export function tr(s) {
  if (!dict || lang === "fr") return null;
  const raw = s.replace(/\s+/g, " ").trim();
  if (!raw || !/[A-Za-zÀ-ÿ]/.test(raw)) return null;
  const out = lookup(raw, 0);
  if (out != null) return units(out);
  const t = units(raw);
  return t !== raw ? lookup(t, 0) ?? t : null;
}

function lookup(t, depth) {
  if (dict.has(t)) return dict.get(t);
  if (depth > 4) return null;
  if (t.startsWith("· ")) { const r = lookup(t.slice(2), depth + 1); return r == null ? null : "· " + r; }
  // nombres : « 3 fichiers » ↔ « {n} fichiers »
  const nums = t.match(/\d+(?:[.,]\d+)?/g);
  if (nums) {
    const hit = numeric.get(t.replace(/\d+(?:[.,]\d+)?/g, "{n}"));
    if (hit) { let i = 0; return hit[1].replace(/\d+(?:[.,]\d+)?/g, () => nums[i++] ?? ""); }
  }
  const ago = /^il y a (\d+) (min|h|j)$/.exec(t);
  if (ago) return `${ago[1]} ${{ min: "min", h: "h", j: "d" }[ago[2]]} ago`;
  // modèles qui contiennent eux-mêmes « · » : avant de découper
  if (t.includes(" · ")) for (const [rx, en, , dot] of patterns) {
    if (!dot) continue;
    const m = rx.exec(t);
    if (m) return fill(en, m.slice(1).map(v => (v.trim() ? v.replace(v.trim(), lookup(v.trim(), depth + 1) ?? v.trim()) : v)));
  }
  // morceaux : « a · b · c », phrases successives, listes « a, b, c »
  for (const sep of [" · ", /(?<=[.!?…])\s+(?=[A-ZÀ-Ö«(])/]) {
    const pieces = t.split(sep);
    if (pieces.length < 2) continue;
    const outp = pieces.map(p => lookup(p.trim(), depth + 1) ?? p);
    if (outp.some((p, i) => p !== pieces[i])) return outp.join(typeof sep === "string" ? sep : " ");
  }
  for (const [rx, en] of patterns) {
    const m = rx.exec(t);
    if (m) return fill(en, m.slice(1).map(v => (v.trim() ? v.replace(v.trim(), lookup(v.trim(), depth + 1) ?? v.trim()) : v)));
  }
  if (t.includes(", ")) {  // listes « a, b, c » (noms de dossiers…)
    const pieces = t.split(", ");
    const outp = pieces.map(p => lookup(p, depth + 1) ?? p);
    if (outp.some((p, i) => p !== pieces[i])) return outp.join(", ");
  }
  return null;
}

function translateText(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = node.nodeValue;
  if (!/[A-Za-zÀ-ÿ]/.test(v)) return;
  const prev = original.get(node);
  if (prev && prev.en === v) return;  // déjà traduit
  const out = tr(v);
  if (out == null) return;
  const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
  const en = lead + out + trail;
  original.set(node, { fr: v, en });
  node.nodeValue = en;
}

function translateAttrs(el) {
  if (el.closest?.(".notranslate, [translate=no]")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const out = tr(v);
    if (out != null && out !== v) el.setAttribute(a, out);
  }
}

function walk(root) {
  if (root.nodeType === 3) return translateText(root);
  if (root.nodeType !== 1 || root.matches?.("script, style")) return;
  translateAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? translateText(n) : translateAttrs(n);
}

let observer = null;

function patchLocales() {
  // Dates et nombres : les modules demandent "fr-FR" ; en anglais on affiche au format anglais.
  const swap = loc => (loc === "fr-FR" || loc === "fr" ? "en-GB" : loc);
  for (const [proto, names] of [[Date.prototype, ["toLocaleDateString", "toLocaleString", "toLocaleTimeString"]], [Number.prototype, ["toLocaleString"]]]) {
    for (const name of names) {
      const orig = proto[name];
      if (orig.__bt) continue;
      const f = function (loc, opts) { return orig.call(this, swap(loc), opts); };
      f.__bt = true;
      proto[name] = f;
    }
  }
}

/** Active une langue ("fr" ou "en") pour la page. */
export async function apply(l) {
  lang = l === "en" ? "en" : "fr";
  document.documentElement.lang = lang;
  try { localStorage.setItem("bt-lang", lang); } catch {}
  if (lang === "fr") return;
  if (!dict) {
    try { compile(await (await fetch("/i18n/en.json", { cache: "no-cache" })).json()); } catch { return; }
  }
  patchLocales();
  walk(document.body);
  document.title = tr(document.title) ?? document.title;
  if (!observer) {
    observer = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === "characterData") translateText(m.target);
        else if (m.type === "attributes") translateAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
}
