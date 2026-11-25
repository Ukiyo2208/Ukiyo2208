// Outil « Suivi des prix » : produits suivis, historique, comparaison avec les autres boutiques, alertes.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, tab = "suivis";
const TABS = [["suivis", "Produits suivis", "star"], ["tous", "Tous les produits vus", "list"], ["reglages", "Réglages", "settings"]];
const eur = n => n == null ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const dshort = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const COLORS = ["var(--accent)", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export async function render(root, parts) {
  tab = TABS.some(t => t[0] === parts[0]) ? parts[0] : "suivis";
  root.innerHTML = pageHead("prix", `<button class="btn" id="px-add">${icon("plus")}Suivre un lien</button>`)
    + `<div class="seg bg-tabs" id="px-tabs">${TABS.map(([k, l, ic]) => `<label><input type="radio" name="pxt" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div><div id="px-body"></div>`;
  $("#px-tabs").onchange = e => { tab = e.target.value; history.replaceState(null, "", `#/prix/${tab}`); load(); };
  $("#px-add").onclick = addForm;
  await load();
  const pid = parts[0] && !TABS.some(t => t[0] === parts[0]) ? parts[0] : null;
  if (pid) detail(pid);
}

async function load() {
  data = await api("/api/prix" + (tab === "tous" ? "?all=1" : ""));
  paint();
}

function spark(o, w = 120, h = 32) {
  const hs = (o?.history || []).slice(-90);
  if (hs.length < 2) return "";
  const v = hs.map(x => x[1]), lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = v.map((p, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 3 - (p - lo) / r * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg class="px-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

function card(p) {
  const b = p.best, cur = p.offers[0];
  const v = (b || cur)?.verdict;
  return `<button class="card px-card" data-p="${p.id}">
    <span class="px-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon("tag")}</span>
    <span class="grow px-info"><b>${esc(p.title)}</b>
      <small class="meta">${p.offers.length} boutique${p.offers.length > 1 ? "s" : ""}${p.target ? ` · cible ${eur(p.target)}` : ""}</small>
      ${v ? `<span class="cx-st ${v.level === "info" ? "off" : v.level}">${esc(v.text)}</span>` : ""}</span>
    <span class="px-price"><b>${eur(b?.price ?? cur?.price)}</b><small class="meta">${esc((b || cur)?.shop || "")}</small>${spark(b || cur)}</span></button>`;
}

function paint() {
  const el = $("#px-body");
  if (!el) return;
  if (tab === "reglages") return settingsView(el);
  const list = data.products;
  el.innerHTML = list.length ? `<div class="px-list">${list.map(card).join("")}</div>`
    : `<div class="card empty">${icon("tag")}<b>${tab === "suivis" ? "Aucun produit suivi" : "Aucun produit vu pour l'instant"}</b>
      Avec l'extension de navigateur (Réglages › Extension), le prix de chaque fiche produit que tu ouvres est noté : clique sur « Suivre » pour être prévenu des baisses et comparer avec les autres boutiques.
      Sans l'extension, colle le lien d'un produit avec « Suivre un lien ».</div>`;
  el.querySelectorAll(".px-img img").forEach(i => i.addEventListener("error", () => i.remove()));
  el.onclick = e => { const b = e.target.closest("[data-p]"); if (b) detail(b.dataset.p); };
}

function chart(p) {
  const offers = p.offers.filter(o => o.history.length);
  const all = offers.flatMap(o => o.history);
  if (all.length < 2) return `<p class="meta">La courbe apparaît après quelques jours de relevés.</p>`;
  const days = [...new Set(all.map(x => x[0]))].sort(), d0 = new Date(days[0]).getTime(), d1 = new Date(days.at(-1)).getTime() || d0 + 1;
  const vals = all.map(x => x[1]), lo = Math.min(...vals) * .97, hi = Math.max(...vals) * 1.03, W = 600, H = 180;
  const X = d => 40 + (new Date(d).getTime() - d0) / Math.max(1, d1 - d0) * (W - 50), Y = v => H - 22 - (v - lo) / (hi - lo || 1) * (H - 34);
  const lines = offers.map((o, i) => {
    const pts = o.history.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`);
    if (pts.length === 1) pts.push(`${(W - 10).toFixed(1)},${Y(o.history[0][1]).toFixed(1)}`);
    return `<polyline points="${pts.join(" ")}" style="stroke:${COLORS[i % COLORS.length]}"/>`;
  }).join("");
  const ticks = [lo / .97, (lo / .97 + hi / 1.03) / 2, hi / 1.03].map(v => `<text x="2" y="${Y(v) + 4}">${Math.round(v)} €</text><line x1="40" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("");
  return `<svg class="px-chart" viewBox="0 0 ${W} ${H}">${ticks}${lines}<text x="40" y="${H - 4}">${dshort(days[0])}</text><text x="${W - 10}" y="${H - 4}" text-anchor="end">${dshort(days.at(-1))}</text></svg>
    <div class="px-legend">${offers.map((o, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(o.shop)}</span>`).join("")}</div>`;
}

async function detail(pid) {
  let p;
  try { p = await api(`/api/prix/${pid}`); } catch (err) { return toast(err.message, "err"); }
  const m = modal(p.title, `<div class="px-detail">
    <div class="px-head">${p.image ? `<img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer">` : ""}<div class="grow">
      ${p.brand ? `<small class="meta">${esc(p.brand)}</small>` : ""}${p.gtin ? `<small class="meta">EAN ${esc(p.gtin)}</small>` : ""}
      <div class="px-best">${p.best ? `Meilleur prix : <b>${eur(p.best.price)}</b> chez ${esc(p.best.shop)}` : "Prix inconnu"}</div>
      ${p.best?.verdict ? `<span class="cx-st ${p.best.verdict.level === "info" ? "off" : p.best.verdict.level}">${esc(p.best.verdict.text)}</span>` : ""}</div></div>
    ${chart(p)}
    <div class="card-title">${icon("list")}Boutiques</div>
    <div class="px-offers">${p.offers.map(o => `<div class="bg-row"><span class="grow bg-lbl"><a href="${esc(o.url)}" target="_blank" rel="noopener"><b>${esc(o.shop)}</b></a>
        <small class="meta">${o.available === false ? "indisponible · " : ""}${o.stats?.low != null ? `bas ${eur(o.stats.low)} · haut ${eur(o.stats.high)} (90 j)` : ""}${o.checked ? ` · vu le ${new Date(o.checked * 1000).toLocaleDateString("fr-FR")}` : ""}${o.error ? ` · ${esc(o.error)}` : ""}</small></span>
        <b>${eur(o.price)}</b><button class="icon-btn plain" data-del-offer="${o.id}" title="Retirer cette boutique">${icon("x")}</button></div>`).join("")}</div>
    <div class="row"><button class="btn ghost small" id="px-cmp">${icon("search")}Chercher chez les autres boutiques</button>
      ${p.links.map(l => `<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${icon("external")}${esc(l.name)}</a>`).join("")}</div>
    <small class="meta">Depuis l'extension, la recherche passe par ton navigateur et marche sur plus de boutiques.</small>
    <form id="px-form" class="grid2">
      <label class="check"><input type="checkbox" name="followed" ${p.followed ? "checked" : ""}> Suivre ce produit (relu chaque jour, alerte si le prix baisse)</label>
      <div><label class="field">Prix cible (€)</label><input type="text" inputmode="decimal" name="target" value="${p.target ?? ""}" placeholder="Prévenir sous ce prix"></div>
    </form>
    <div class="modal-foot"><button type="button" class="btn ghost danger" id="px-del">${icon("trash")}Supprimer</button><span class="grow"></span>
      <button type="button" class="btn" data-close>${icon("check")}Fermer</button></div></div>`, { ic: "tag", large: true });
  m.querySelectorAll("img").forEach(i => i.addEventListener("error", () => i.remove()));
  const f = m.querySelector("#px-form");
  f.onchange = async () => {
    try { await api(`/api/prix/${pid}`, { method: "PUT", json: { followed: f.followed.checked, target: f.target.value } }); toast("Enregistré"); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("#px-cmp").onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = `<span class="spinner"></span> Recherche…`;
    try {
      const r = await api(`/api/prix/${pid}/compare`, { method: "POST" });
      toast(r.found.length ? `${r.found.length} boutique(s) trouvée(s)` : "Rien trouvé depuis le NAS : essaie depuis l'extension", r.found.length ? "ok" : "err");
      closePanel(); detail(pid); load();
    } catch (err) { toast(err.message, "err"); b.disabled = false; }
  };
  m.querySelectorAll("[data-del-offer]").forEach(b => b.onclick = async () => { await api(`/api/prix/${pid}/offers/${b.dataset.delOffer}`, { method: "DELETE" }); closePanel(); detail(pid); load(); });
  m.querySelector("#px-del").onclick = async () => { if (confirm("Supprimer ce produit et son historique ?")) { await api(`/api/prix/${pid}`, { method: "DELETE" }); closePanel(); load(); } };
}

function addForm() {
  const m = modal("Suivre un produit", `<form><label class="field">Lien de la fiche produit</label><input type="url" name="url" required placeholder="https://www.fnac.com/…" autofocus>
    <p class="hint">Le NAS lit le prix sur la page. Certains sites (Amazon souvent) bloquent le NAS : passe alors par l'extension.</p>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Suivre</button></div></form>`, { ic: "tag" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector("button:not([type])"); b.disabled = true;
    try { const p = await api("/api/prix/add", { json: { url: e.target.url.value } }); closePanel(); toast("Produit suivi"); await load(); detail(p.id); }
    catch (err) { toast(err.message, "err"); b.disabled = false; }
  };
}

function settingsView(el) {
  const s = data.settings;
  if (!el.isConnected) return;
  el.innerHTML = `<div class="card"><div class="card-title">${icon("settings")}Suivi</div><form id="px-set" class="ns-set">
      <label class="check"><input type="checkbox" name="record_all" ${s.record_all ? "checked" : ""}> Noter le prix de toutes les fiches produit que j'ouvre (pour avoir l'historique quand je reviens)</label>
      <label class="check"><input type="checkbox" name="notify_drop" ${s.notify_drop ? "checked" : ""}> Me prévenir quand un produit suivi baisse</label>
      <div><label class="field">Baisse minimale (%)</label><input type="number" name="min_drop_pct" min="0" max="50" step="0.5" value="${s.min_drop_pct}" style="max-width:140px"></div>
    </form><small class="meta">Tout reste sur le NAS. Les fiches produit sont reconnues par l'extension sur la plupart des boutiques.</small></div>
    <div class="card"><div class="card-title">${icon("search")}Boutiques pour la comparaison</div>
      <p class="hint">Le produit (code EAN, sinon le nom) est cherché dans chacune ; seules les fiches qui correspondent vraiment sont gardées.</p>
      <div class="px-shops">${data.shops.map(x => `<label class="check"><input type="checkbox" data-shop="${esc(x.id)}" ${x.on !== false ? "checked" : ""}> ${esc(x.name)} <small class="meta">${esc(x.host)}</small></label>`).join("")}</div>
      <details class="px-custom"><summary>Ajouter une boutique</summary>
        <form id="px-shop" class="grid3"><div><label class="field">Nom</label><input name="name" required placeholder="Ex. Leroy Merlin"></div>
          <div><label class="field">Lien de recherche ({q} = produit)</label><input name="search" required placeholder="https://www.exemple.fr/recherche?q={q}"></div>
          <div><label class="field">Forme des liens produit (expression régulière)</label><input name="product" required placeholder="exemple\\.fr/produit/"></div>
          <button class="btn small">${icon("plus")}Ajouter</button></form></details></div>`;
  if (!$("#px-set")) return;  // page quittée entre-temps
  $("#px-set").onchange = async e => {
    const f = e.currentTarget;
    await api("/api/prix/settings", { method: "PUT", json: { record_all: f.record_all.checked, notify_drop: f.notify_drop.checked, min_drop_pct: f.min_drop_pct.value } });
    toast("Enregistré");
  };
  el.querySelectorAll("[data-shop]").forEach(c => c.onchange = () => api("/api/prix/settings", { method: "PUT", json: { shops: { [c.dataset.shop]: c.checked } } }).then(() => toast("Enregistré")));
  $("#px-shop").onsubmit = async e => {
    e.preventDefault();
    const custom = data.shops.filter(x => x.custom).map(({ name, search, product }) => ({ name, search, product }));
    custom.push(Object.fromEntries(new FormData(e.target)));
    try { await api("/api/prix/settings", { method: "PUT", json: { custom } }); toast("Boutique ajoutée"); load(); }
    catch (err) { toast(err.message, "err"); }
  };
}
