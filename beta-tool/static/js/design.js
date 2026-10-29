import { esc } from "./ui.js";

// Apparence personnalisée de chaque compte : couleur d'accent, taille du texte, densité, arrondis, fond,
// menu, effet verre, animations. Appliquée sur <html> (attributs data-* et variables CSS) et gardée en
// local pour s'afficher tout de suite au chargement suivant.

export const ACCENTS = {
  bleu: ["#1f6bff", "#13b6f5", "Bleu"], violet: ["#7c4dff", "#c06bff", "Violet"], rose: ["#e8457c", "#ff8db4", "Rose"],
  rouge: ["#e5383b", "#ff7a59", "Rouge"], orange: ["#f06a1d", "#ffb02e", "Orange"], ambre: ["#d99100", "#ffd23f", "Ambre"],
  vert: ["#12a150", "#5ad67d", "Vert"], turquoise: ["#0aa5a5", "#3fe0c5", "Turquoise"], ardoise: ["#4b5d7a", "#8aa0c4", "Ardoise"],
};
export const DEFAULTS = { accent: "bleu", density: "confort", font: "normal", radius: "arrondi", background: "grille", sidebar: "complet", motion: "normal", glass: "verre" };

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** Deuxième couleur du dégradé pour une couleur choisie librement : plus claire et un peu décalée. */
function companion(h) {
  const [r, g, b] = hex2rgb(h);
  return rgb2hex([r + (255 - r) * .45, g + (255 - g) * .35, b + (255 - b) * .25]);
}

export function apply(design = {}) {
  const d = { ...DEFAULTS, ...design };
  const root = document.documentElement;
  for (const k of ["density", "font", "radius", "background", "sidebar", "motion", "glass"]) {
    if (d[k] === DEFAULTS[k]) delete root.dataset[k]; else root.dataset[k] = d[k];
  }
  const [a1, a2] = ACCENTS[d.accent] || (/^#[0-9a-f]{6}$/i.test(d.accent) ? [d.accent, companion(d.accent)] : ACCENTS.bleu);
  if (d.accent === "bleu") {
    ["--accent", "--accent-2", "--accent-soft", "--glow", "--user-accent"].forEach(v => root.style.removeProperty(v));
    delete root.dataset.accent;
  } else {
    const [r, g, b] = hex2rgb(a1);
    root.dataset.accent = "1";
    root.style.setProperty("--accent", a1);
    root.style.setProperty("--accent-2", a2);
    root.style.setProperty("--accent-soft", `rgb(${r} ${g} ${b} / .12)`);
    root.style.setProperty("--glow", `0 8px 24px rgb(${r} ${g} ${b} / .32)`);
    root.style.setProperty("--user-accent", `${r} ${g} ${b}`);
  }
  try { localStorage.setItem("bt-design", JSON.stringify(d)); } catch {}
  return d;
}

/** Au tout début du chargement : dernière apparence connue sur cet appareil (évite un flash). */
export function applyCached() {
  try { const d = JSON.parse(localStorage.getItem("bt-design") || "null"); if (d) apply(d); } catch {}
}

/** Pastille de profil : photo, emoji ou initiale sur la couleur choisie. */
export function avatarHTML(user, prefs = {}, cls = "avatar") {
  const name = prefs.display_name || user.name || "?";
  const initial = esc((name[0] || "?").toUpperCase());
  if (prefs.avatar) return `<span class="${cls} has-photo"><img src="/api/avatar/${encodeURIComponent(user.name)}?v=${prefs.avatar}" alt=""></span>`;
  const style = prefs.avatar_color ? ` style="background:${prefs.avatar_color}"` : "";
  return `<span class="${cls}"${style}>${prefs.avatar_emoji ? `<span class="emoji">${esc(prefs.avatar_emoji)}</span>` : initial}</span>`;
}
