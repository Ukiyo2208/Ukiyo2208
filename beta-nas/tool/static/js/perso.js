// Réglages › Connexions (tout ce qui est relié à Bêta Tool, au même endroit) et › Apparence (design du compte).
import { $, esc, icon, toast, modal, closePanel } from "./ui.js";
import { api, state } from "./state.js";
import { setTheme, savePrefs } from "./main.js";
import * as push from "./push.js";
import * as design from "./design.js";

const STATUS = { ok: "Connecté", off: "Non configuré", warn: "À vérifier", soon: "Bientôt", info: "Disponible", add: "" };

// --- Connexions ----------------------------------------------------------------------------------------------

export async function connexions(el) {
  el.innerHTML = `<p class="meta"><span class="spinner"></span></p>`;
  const { items } = await api("/api/connections");
  const pushOn = push.active(), pushNo = push.unsupported();
  for (const it of items) {
    if (it.status !== "client") continue;
    it.status = pushOn ? "ok" : pushNo ? "off" : "off";
    it.detail = pushOn ? "Activées sur cet appareil" : pushNo ? pushNo : "Reçois les alertes même Bêta Tool fermé";
  }
  const real = items.filter(i => i.status !== "add" && i.status !== "info");
  const n = s => real.filter(i => i.status === s).length;
  const groups = [...new Set(items.map(i => i.group))];
  el.innerHTML = `<div class="intro"><span class="tile">${icon("link")}</span><p>Tout ce qui est relié à Bêta Tool, au même endroit : boîtes mail, agendas, téléphones,
      services (Parcel, La Poste, météo…) et accès au NAS. Touche une carte pour la régler.</p></div>
    <div class="cx-sum"><span class="chip ok">${icon("check")}${n("ok")} connecté${n("ok") > 1 ? "s" : ""}</span>
      ${n("warn") ? `<span class="chip" style="color:var(--warn)">${icon("alert")}${n("warn")} à vérifier</span>` : ""}
      <span class="chip">${n("off")} non configuré${n("off") > 1 ? "s" : ""}</span></div>
    ${groups.map(g => `<h3 class="cx-group">${esc(g)}</h3><div class="cx-grid">${items.filter(i => i.group === g).map(card).join("")}</div>`).join("")}`;
  el.onclick = e => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    e.preventDefault();
    ({ parcel: parcelPanel, laposte: laposteePanel, meteo: meteoPanel })[b.dataset.action]?.(() => connexions(el));
  };
}

function card(i) {
  const inner = `<span class="tile ${i.tile}">${icon(i.icon)}</span>
    <span class="grow"><b>${esc(i.name)}</b><small class="meta">${esc(i.detail)}</small></span>
    ${STATUS[i.status] ? `<span class="cx-st ${i.status}">${STATUS[i.status]}</span>` : ""}`;
  const cls = `card cx-card ${i.status === "add" ? "add" : ""}`;
  if (i.action) return `<button class="${cls}" data-action="${i.action}">${inner}</button>`;
  if (i.href) return `<a class="${cls}" href="${esc(i.href)}">${inner}</a>`;
  return `<div class="${cls}">${inner}</div>`;
}

async function parcelPanel(done) {
  const c = (await api("/api/colis")).parcel;
  const m = modal("Appli Parcel", `<form>
    <p class="hint" style="margin-top:0">Les colis repérés dans tes mails sont ajoutés à l'appli <b>Parcel</b> (iPhone, iPad, Mac), et son suivi (Amazon compris) revient dans Colis et Ma journée.
      Il faut <b>Parcel Premium</b> ; la clé se crée sur <a href="https://web.parcelapp.net" target="_blank" rel="noopener">web.parcelapp.net</a> › API.</p>
    ${c.on ? `<p class="${c.error ? "pill-warn" : "pill-ok"}">${esc(c.error || "Reliée")}</p>
      <label class="check"><input type="checkbox" name="push" ${c.push ? "checked" : ""}> Ajouter à Parcel les colis trouvés dans mes mails</label>`
    : `<label class="field">Clé d'API Parcel</label><input type="password" name="key" autocomplete="new-password" required>`}
    <div class="modal-foot">${c.on ? `<button type="button" class="btn ghost danger" data-off>${icon("x")}Délier</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}${c.on ? "Enregistrer" : "Relier"}</button></div></form>`, { ic: "send" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    try {
      await api("/api/colis/parcel", { method: "PUT", json: c.on ? { push: f.push.checked } : { key: f.key.value } });
      closePanel(); toast(c.on ? "Enregistré" : "Appli Parcel reliée"); done();
    } catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-off]")?.addEventListener("click", async () => {
    if (!confirm("Délier l'appli Parcel ? Les colis déjà suivis restent dans Bêta Tool.")) return;
    await api("/api/colis/parcel", { method: "PUT", json: { key: "" } }); closePanel(); done();
  });
}

function laposteePanel(done) {
  const m = modal("Suivi La Poste en direct", `<form>
    <p class="hint" style="margin-top:0">Clé gratuite sur <a href="https://developer.laposte.fr" target="_blank" rel="noopener">developer.laposte.fr</a> (application abonnée à l'API « Suivi v2 »).
      Colissimo et Chronopost sont alors suivis en direct, pour toute la maison.</p>
    <label class="field">Clé d'API La Poste</label><input type="password" name="key" autocomplete="new-password" placeholder="Vide pour la retirer">
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "send" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/colis/config", { method: "PUT", json: { laposte_key: e.target.key.value } }); closePanel(); toast("Clé enregistrée"); done(); }
    catch (err) { toast(err.message, "err"); }
  };
}

async function meteoPanel(done) {
  const p = await api("/api/journee").catch(() => ({}));
  const m = modal("Météo", `<form>
    <label class="field">Ta ville</label><input type="text" name="city" value="${esc(p.city || "")}" placeholder="Ex. Lyon, Rennes, Marseille" required>
    <p class="hint">Prévisions Open-Meteo, gratuites et sans compte : seule la position de la ville est envoyée.</p>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "sun" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/journee/prefs", { method: "PUT", json: { city: e.target.city.value } }); closePanel(); toast("Ville enregistrée"); done(); }
    catch (err) { toast(err.message, "err"); }
  };
}

// --- Apparence -------------------------------------------------------------------------------------------------

const OPTIONS = [
  ["font", "Taille du texte", [["petit", "Petit"], ["normal", "Normal"], ["grand", "Grand"], ["tres-grand", "Très grand"]]],
  ["density", "Densité", [["confort", "Aérée"], ["compact", "Compacte"]]],
  ["radius", "Coins", [["arrondi", "Arrondis"], ["doux", "Doux"], ["carre", "Carrés"]]],
  ["glass", "Panneaux", [["verre", "Effet verre"], ["opaque", "Opaques"]]],
  ["sidebar", "Menu sur ordinateur", [["complet", "Complet"], ["icones", "Icônes seulement"]]],
  ["motion", "Animations", [["normal", "Normales"], ["reduit", "Réduites"]]],
];

export function apparence(el) {
  const d = { ...design.DEFAULTS, ...(state.config.prefs?.design || {}) };
  const theme = (() => { try { return localStorage.getItem("bt-theme") || "auto"; } catch { return "auto"; } })();
  const custom = /^#/.test(d.accent) ? d.accent : "#ff3d7f";
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${k}" value="${v}" ${d[k] === v ? "checked" : ""}>${l}</label>`).join("")}</div>`;
  el.innerHTML = `<div class="ap-grid">
    <div class="card"><div class="card-title">${icon("sun")}Couleurs</div>
      <div class="ap-row"><b>Thème</b><div class="seg">${[["auto", "Automatique", "monitor"], ["light", "Clair", "sun"], ["dark", "Sombre", "moon"]].map(([v, l, i]) =>
        `<label><input type="radio" name="th" value="${v}" ${theme === v ? "checked" : ""}>${icon(i)}${l}</label>`).join("")}</div></div>
      <div class="ap-row"><b>Couleur principale</b><div class="ap-swatches">
        ${Object.entries(design.ACCENTS).map(([k, [a, b, l]]) => `<button data-accent="${k}" class="${d.accent === k ? "on" : ""}" style="background:linear-gradient(135deg, ${a}, ${b})" title="${l}"></button>`).join("")}
        <label class="ap-custom" title="Couleur au choix"><input type="color" id="ap-color" value="${custom}">Autre</label></div></div>
      <div class="ap-row"><b>Fond</b><div class="ap-bgs">${[["grille", "Grille"], ["uni", "Uni"], ["aurore", "Aurore"], ["points", "Points"]].map(([v, l]) =>
        `<label><input type="radio" name="background" value="${v}" ${d.background === v ? "checked" : ""}><i class="bg-${v}"></i>${l}</label>`).join("")}</div></div></div>
    <div class="card"><div class="card-title">${icon("sliders")}Affichage</div>
      ${OPTIONS.map(([k, l, opts]) => `<div class="ap-row"><b>${l}</b>${seg(k, opts)}</div>`).join("")}</div>
  </div>
  <div class="card ap-preview"><div class="card-title">${icon("eye")}Aperçu</div>
    <div class="row"><button class="btn">${icon("check")}Bouton</button><button class="btn ghost">Secondaire</button><span class="chip">Étiquette</span><span class="chip on">Choisie</span>
      <label class="check"><input type="checkbox" checked> Case cochée</label></div>
    <div class="row"><input type="text" placeholder="Champ de saisie" style="max-width:280px"><span class="tile">${icon("star")}</span><span class="tile vert">${icon("check")}</span><span class="tile rose">${icon("heart")}</span></div>
    <p class="hint" style="margin:0">Tes choix sont enregistrés pour ton compte : ils te suivent sur ton téléphone, ta tablette et ton ordinateur.</p>
    <div class="row"><button class="btn ghost small" id="ap-reset">${icon("refresh")}Revenir à l'apparence d'origine</button></div></div>
  <div class="card"><div class="card-title">${icon("phone")}Installer l'application</div>
    <p class="hint" style="margin-top:-6px">Une vraie icône sur ton téléphone ou ton ordinateur, en plein écran. Bonus : « Partager → Bêta Tool » depuis YouTube lance le téléchargement.</p>
    ${window.btInstall ? `<button class="btn" id="pwa">${icon("download")}Installer Bêta Tool</button>`
      : ios ? `<p>Sur iPhone / iPad : bouton <b>Partager</b> de Safari → <b>Sur l'écran d'accueil</b>.</p>`
      : `<p>Menu du navigateur → <b>Installer l'application</b> (ou « Ajouter à l'écran d'accueil »).</p>`}
    ${isSecureContext ? "" : `<p class="hint">${icon("alert")} L'installation complète demande une adresse en HTTPS (Réglages › Accès sécurisé).</p>`}</div>`;
  const set = async patch => {
    design.apply({ ...(state.config.prefs?.design || {}), ...patch });
    await savePrefs({ design: patch });
  };
  el.querySelectorAll("[name=th]").forEach(r => r.onchange = () => { setTheme(r.value); savePrefs({ theme: r.value }); });
  el.querySelectorAll("input[type=radio]:not([name=th])").forEach(r => r.onchange = () => set({ [r.name]: r.value }));
  el.querySelectorAll("[data-accent]").forEach(b => b.onclick = () => {
    set({ accent: b.dataset.accent });
    el.querySelectorAll("[data-accent]").forEach(x => x.classList.toggle("on", x === b));
  });
  $("#ap-color").oninput = e => design.apply({ ...(state.config.prefs?.design || {}), accent: e.target.value });
  $("#ap-color").onchange = e => { set({ accent: e.target.value }); el.querySelectorAll("[data-accent]").forEach(x => x.classList.remove("on")); };
  $("#ap-reset").onclick = async () => { design.apply({}); await savePrefs({ reset_design: true }); toast("Apparence d'origine"); apparence(el); };
  $("#pwa")?.addEventListener("click", async () => { window.btInstall.prompt(); window.btInstall = null; });
}
