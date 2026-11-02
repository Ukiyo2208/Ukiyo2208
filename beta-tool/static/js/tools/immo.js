// Outil « Immobilier » : annonces suivies, prix du quartier (DVF), location (loyers, quittances, IRL, état des lieux), déclaration.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, tab = "annonces", dvfQuery = null;
const TABS = [["annonces", "Annonces", "search"], ["quartier", "Prix du quartier", "pin"], ["location", "Location", "key"], ["declaration", "Déclaration", "receipt"]];
const eur = (n, dec = 0) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: dec, minimumFractionDigits: dec });
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const mlabel = m => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
const ST = { paye: ["Payé", "ok"], partiel: ["Partiel", "warn"], retard: ["En retard", "bad"], attente: ["À venir", "off"] };
const LSTATUS = { active: "En vente", visite: "Visite prévue", offre: "Offre faite", achete: "Acheté", abandon: "Abandonné", retiree: "Retirée" };

export async function render(root, parts) {
  tab = TABS.some(t => t[0] === parts[0]) ? parts[0] : "annonces";
  root.innerHTML = pageHead("immo") + `<div class="seg bg-tabs" id="im-tabs">${TABS.map(([k, l, ic]) => `<label><input type="radio" name="imt" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div><div id="im-body"></div>`;
  $("#im-tabs").onchange = e => go(e.target.value);
  await load();
}
async function load() { data = await api("/api/immo"); paint(); }
function go(t) { tab = t; document.querySelector(`#im-tabs input[value="${t}"]`).checked = true; history.replaceState(null, "", `#/immo/${t}`); paint(); }
function paint() { const el = $("#im-body"); if (el) ({ annonces, quartier, location: locationTab, declaration })[tab](el); }

// --- Annonces ------------------------------------------------------------------------------------------------------

function annonces(el) {
  const ls = data.listings;
  el.innerHTML = `<form class="card im-add" id="im-add"><div class="card-title">${icon("plus")}Suivre une annonce</div>
      <div class="row"><input type="url" name="url" placeholder="Colle le lien de l'annonce (SeLoger, Leboncoin, PAP, Bien'ici, agence…)" style="flex:1"><button class="btn">${icon("plus")}Ajouter</button></div>
      <p class="hint" style="margin-bottom:0">Le prix, la surface et la ville sont lus sur la page quand le site le permet, puis l'annonce est revérifiée deux fois par jour : tu es prévenu si le prix baisse.
        Certains sites bloquent la lecture automatique : tu complètes alors les chiffres toi-même. <a href="#" id="im-manual">Ajouter sans lien</a></p></form>
    ${ls.length ? `<div class="im-grid">${ls.map(card).join("")}</div>` : `<div class="card empty">${icon("home")}<b>Aucune annonce suivie</b>Ajoute les annonces qui t'intéressent : tu compares le prix au m² avec les ventes du quartier et tu lances la simulation locative en un clic.</div>`}`;
  $("#im-add").onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector(".btn"); b.disabled = true; b.innerHTML = `<span class="spinner"></span>Lecture…`;
    try {
      const r = await api("/api/immo/listings", { json: { url: e.target.url.value } });
      await load();
      if (r.warning || !r.listing.price) { toast(r.warning || "Complète le prix et la surface", "err"); listingForm(data.listings.find(l => l.id === r.listing.id)); }
      else toast("Annonce suivie");
    } catch (err) { toast(err.message, "err"); b.disabled = false; b.innerHTML = `${icon("plus")}Ajouter`; }
  };
  $("#im-manual").onclick = e => { e.preventDefault(); listingForm({}); };
  el.querySelectorAll("[data-l]").forEach(c => c.onclick = e => {
    const l = data.listings.find(x => x.id === c.dataset.l);
    const b = e.target.closest("[data-a]");
    if (!b) return listingForm(l);
    e.stopPropagation();
    if (b.dataset.a === "dvf") { dvfQuery = { q: l.address || [l.postcode, l.city].filter(Boolean).join(" "), pm2: l.price && l.surface ? l.price / l.surface : null, title: l.title }; go("quartier"); }
    if (b.dataset.a === "sim") { try { sessionStorage.setItem("bt-projet", JSON.stringify({ price: l.price || "", rent: l.rent || "", tf: l.tf || 800, copro: l.charges || 600 })); } catch {} location.hash = "#/patrimoine/projet"; }
  });
}

function card(l) {
  const pm2 = l.price && l.surface ? l.price / l.surface : null;
  const first = l.history?.[0]?.price, drop = first && l.price && l.price < first ? first - l.price : 0;
  return `<div class="card im-card ${l.status !== "active" ? "dim" : ""}" data-l="${l.id}">
    ${l.image ? `<div class="im-img"><img src="${esc(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ""}
    <div class="im-body"><div class="im-top"><b>${l.price ? eur(l.price) : "Prix ?"}</b>${drop ? `<span class="cx-st ok">−${eur(drop)}</span>` : ""}<span class="grow"></span><span class="cx-st ${l.status === "active" ? "soon" : "off"}">${LSTATUS[l.status] || l.status}</span></div>
      <span class="im-title">${esc(l.title || "Annonce")}</span>
      <small class="meta">${[l.surface && `${l.surface} m²`, l.rooms && `${l.rooms} pièce${l.rooms > 1 ? "s" : ""}`, pm2 && `${eur(pm2)} / m²`, l.city].filter(Boolean).map(esc).join(" · ")}</small>
      ${l.rent ? `<small class="meta">Loyer estimé ${eur(l.rent)} / mois · rendement brut ${(l.rent * 12 / l.price * 100).toFixed(1).replace(".", ",")} %</small>` : ""}
      <div class="row">${l.url ? `<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${icon("external")}Annonce</a>` : ""}
        <button class="btn ghost small" data-a="dvf">${icon("pin")}Prix du quartier</button><button class="btn small" data-a="sim">${icon("key")}Simuler</button></div></div></div>`;
}

function listingForm(l) {
  const f = (k, lab, ph = "") => `<div><label class="field">${lab}</label><input type="text" inputmode="decimal" name="${k}" value="${l[k] ?? ""}" placeholder="${ph}"></div>`;
  const m = modal(l.id ? (l.title || "Annonce") : "Ajouter une annonce", `<form>
    <label class="field">Titre</label><input type="text" name="title" value="${esc(l.title || "")}" placeholder="Ex. T2 lumineux avec balcon">
    <div class="grid2">${f("price", "Prix (€)")}${f("surface", "Surface (m²)")}</div>
    <div class="grid2">${f("rooms", "Pièces")}<div><label class="field">Code postal et ville</label><div class="row"><input type="text" name="postcode" value="${esc(l.postcode || "")}" placeholder="69100" style="width:90px"><input type="text" name="city" value="${esc(l.city || "")}" placeholder="Villeurbanne" style="flex:1"></div></div></div>
    <label class="field">Adresse ou rue (pour comparer avec les ventes voisines)</label><input type="text" name="address" value="${esc(l.address || "")}" placeholder="Ex. 12 rue Francis de Pressensé, Villeurbanne">
    <div class="grid2">${f("rent", "Loyer estimé (€ / mois)", "Pour la simulation")}${f("tf", "Taxe foncière (€ / an)")}</div>
    ${f("charges", "Charges de copro non récupérables (€ / an)")}
    ${l.id ? `<label class="field">Où en es-tu</label><select name="status" style="width:100%">${Object.entries(LSTATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}
    <label class="field">Notes</label><textarea name="note" rows="3" placeholder="Visite, points forts, travaux à prévoir…">${esc(l.note || "")}</textarea>
    ${l.history?.length > 1 ? `<p class="hint">Historique du prix : ${l.history.map(h => `${eur(h.price)} (${new Date(h.at * 1000).toLocaleDateString("fr-FR")})`).join(" → ")}</p>` : ""}
    <div class="modal-foot">${l.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Ne plus suivre</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "home" });
  const form = m.querySelector("form");
  form.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(form)]);
    try { await api(l.id ? `/api/immo/listings/${l.id}` : "/api/immo/listings", { method: l.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { await api(`/api/immo/listings/${l.id}`, { method: "DELETE" }); closePanel(); load(); });
}

// --- Prix du quartier ---------------------------------------------------------------------------------------------

function quartier(el) {
  const q = dvfQuery || {};
  el.innerHTML = `<form class="card" id="im-dvf"><div class="card-title">${icon("pin")}Prix des ventes réelles</div>
      <div class="row"><input type="text" name="q" value="${esc(q.q || "")}" placeholder="Adresse, rue ou ville (ex. 12 rue de la République, Lyon)" style="flex:1" required>
        <select name="kind" style="width:auto"><option>Appartement</option><option>Maison</option></select>
        <select name="radius" style="width:auto"><option value="">Autour (auto)</option><option value="300">300 m</option><option value="500">500 m</option><option value="1000">1 km</option><option value="2000">2 km</option></select>
        <button class="btn">${icon("search")}Voir</button></div>
      <p class="hint" style="margin-bottom:0">Ventes enregistrées par les notaires (données publiques DVF, mises à jour tous les 6 mois), sur les 3 dernières années disponibles.</p></form>
    <div id="im-dvf-res"></div>`;
  const f = $("#im-dvf");
  f.onsubmit = async e => {
    e.preventDefault();
    const res = $("#im-dvf-res");
    res.innerHTML = `<p class="meta"><span class="spinner"></span>Je cherche les ventes…</p>`;
    try {
      const r = await api(`/api/immo/dvf?${new URLSearchParams({ q: f.q.value, kind: f.kind.value, radius: f.radius.value })}`);
      const max = Math.max(...Object.values(r.trend));
      const cmp = q.pm2 && f.q.value === q.q ? (q.pm2 / r.median - 1) * 100 : null;
      res.innerHTML = `<div class="bg-kpis">
          <div class="card bg-kpi"><small class="meta">Prix médian</small><b>${eur(r.median)} / m²</b><small class="meta">${r.kind === "Maison" ? "maisons" : "appartements"} · ${r.count} ventes</small></div>
          <div class="card bg-kpi"><small class="meta">La moitié des ventes entre</small><b>${eur(r.q1)} et ${eur(r.q3)}</b><small class="meta">par m²</small></div>
          ${cmp != null ? `<div class="card bg-kpi"><small class="meta">L'annonce « ${esc((q.title || "").slice(0, 30))} »</small><b class="${cmp > 10 ? "pt-down" : cmp < -5 ? "pt-up" : ""}">${eur(q.pm2)} / m²</b><small class="meta">${cmp > 0 ? "+" : ""}${cmp.toFixed(0)} % par rapport au quartier</small></div>` : ""}
        </div>
        <div class="bg-cols"><div class="card"><div class="card-title">${icon("list")}Ventes récentes</div>
            ${r.recent.map(s => `<div class="bg-row"><span class="grow bg-lbl"><b>${esc(s.address || r.city)}</b><small class="meta">${new Date(s.date).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} · ${s.surface} m² · ${s.rooms || "?"} p.</small></span>
              <span class="pt-val"><b>${eur(s.price)}</b><small class="meta">${eur(s.pm2)} / m²</small></span></div>`).join("")}</div>
          <div class="bg-side"><div class="card"><div class="card-title">${icon("chart")}Évolution (médiane)</div>
              <div class="bg-hist" style="height:120px;grid-template-columns:repeat(${Object.keys(r.trend).length},1fr)">${Object.entries(r.trend).map(([y, v]) => `<div class="bg-hcol" title="${y} : ${eur(v)} / m²"><span class="bg-hbar"><i style="height:${(v / max * 100).toFixed(0)}%;opacity:.8"></i></span><small>${y}</small></div>`).join("")}</div></div>
            <div class="card"><div class="card-title">${icon("home")}Par nombre de pièces</div>
              ${Object.entries(r.by_rooms).map(([k, v]) => `<div class="bg-row"><span class="grow">${k === "?" ? "Inconnu" : k === "5" ? "5 pièces et +" : `${k} pièce${k > 1 ? "s" : ""}`} <small class="meta">· ${v.count} ventes</small></span><b>${eur(v.median)} / m²</b></div>`).join("")}</div></div></div>
        <p class="hint">${esc(r.place)} · ${r.radius ? `ventes à moins de ${r.radius} m` : "toute la commune"} · années ${r.years.join(", ")}. Le prix médian ne tient pas compte de l'étage, de l'état ni des travaux.</p>`;
    } catch (err) { res.innerHTML = `<div class="card empty">${icon("alert")}<b>${esc(err.message)}</b></div>`; }
  };
  if (q.q) f.requestSubmit();
}

// --- Location -----------------------------------------------------------------------------------------------------

function locationTab(el) {
  const ts = data.tenants;
  el.innerHTML = `<div class="ot-top"><button class="btn" id="im-addt">${icon("plus")}Ajouter un locataire</button><button class="btn ghost" id="im-land">${icon("user")}Bailleur : ${esc(data.landlord.name || "à compléter")}</button></div>
    ${ts.length ? ts.map(t => {
      const rev = t.revision, dd = t.deposit_deadline;
      return `<div class="card im-tenant"><div class="pt-loan-h"><span class="tile ambre">${icon("user")}</span><div class="grow"><b>${esc(t.name)}</b>
          <small class="meta">${esc(data.properties.find(p => p.id === t.property)?.name || t.address || "")} · ${eur(t.rent, 2)} + ${eur(t.charges || 0, 2)} de charges · le ${t.pay_day || 5} du mois${t.furnished ? " · meublé" : ""}${t.status === "ended" ? " · parti" : ""}</small></div>
          <button class="icon-btn plain" data-edit="${t.id}" title="Modifier">${icon("edit")}</button></div>
        <div class="im-months">${t.months.map(m => `<button class="im-m ${ST[m.status][1]}" data-t="${t.id}" data-month="${m.month}" title="${ST[m.status][0]}${m.got ? ` · ${eur(m.got, 2)}` : ""}${m.sent ? " · quittance envoyée" : ""}">
          <small>${mlabel(m.month)}</small><b>${m.status === "paye" ? icon("check") : m.status === "retard" ? "!" : m.status === "partiel" ? "½" : "·"}</b></button>`).join("")}</div>
        ${rev?.rent ? `<div class="im-note ok">${icon("chart")}Révision possible avec l'IRL ${rev.quarter} : nouveau loyer <b>${eur(rev.rent, 2)}</b> (${rev.delta >= 0 ? "+" : ""}${eur(rev.delta, 2)}) <button class="btn small" data-rev="${t.id}">Appliquer</button></div>`
          : rev?.waiting ? `<div class="im-note">${icon("clock")}Révision : l'indice IRL ${rev.waiting} n'est pas encore connu.</div>` : !t.irl_quarter ? `<div class="im-note">${icon("alert")}Indique l'indice IRL du bail (trimestre et valeur) pour calculer la révision annuelle.</div>` : ""}
        ${dd ? `<div class="im-note">${icon("lock")}Dépôt de garantie ${eur(t.deposit)} : à rendre avant le ${new Date(dd.conforme).toLocaleDateString("fr-FR")} si l'état des lieux de sortie est conforme, le ${new Date(dd.reserves).toLocaleDateString("fr-FR")} sinon${t.deposit_returned != null ? ` · rendu : ${eur(t.deposit_returned)}` : ""}.</div>` : t.deposit ? `<small class="meta">Dépôt de garantie : ${eur(t.deposit)}</small>` : ""}
        <div class="row">${t.edl.map(e => `<button class="btn ghost small" data-edl="${e.id}">${icon("clipboard")}État des lieux ${e.type === "sortie" ? "de sortie" : "d'entrée"} · ${new Date(e.date).toLocaleDateString("fr-FR")}</button>`).join("")}
          <button class="btn ghost small" data-newedl="${t.id}">${icon("plus")}État des lieux</button></div></div>`;
    }).join("") : `<div class="card empty">${icon("key")}<b>Aucun locataire</b>Ajoute ton locataire : les loyers reçus sont repérés tout seuls dans tes relevés (Budget), les quittances sont prêtes chaque mois et peuvent partir par mail, et la révision annuelle est calculée avec l'indice IRL.</div>`}
    ${!Object.keys(data.irl).length ? `<p class="hint">${icon("alert")} L'indice IRL de l'INSEE n'a pas pu être récupéré : <a href="#" id="im-irl">saisis les valeurs à la main</a>.</p>` : `<p class="hint">Derniers IRL connus : ${Object.entries(data.irl).slice(-4).map(([k, v]) => `${k} : ${v}`).join(" · ")}</p>`}`;
  $("#im-addt").onclick = () => tenantForm({});
  $("#im-land").onclick = landlordForm;
  $("#im-irl")?.addEventListener("click", e => { e.preventDefault(); irlForm(); });
  el.onclick = async e => {
    const b = e.target.closest("[data-edit],[data-month],[data-rev],[data-edl],[data-newedl]");
    if (!b) return;
    if (b.dataset.edit) return tenantForm(data.tenants.find(t => t.id === b.dataset.edit));
    if (b.dataset.month) return monthPanel(data.tenants.find(t => t.id === b.dataset.t), b.dataset.month);
    if (b.dataset.rev) { await api(`/api/immo/tenants/${b.dataset.rev}`, { method: "PUT", json: { apply_revision: true } }); toast("Nouveau loyer appliqué"); return load(); }
    if (b.dataset.edl) return edlPanel(data.tenants.flatMap(t => t.edl).find(x => x.id === b.dataset.edl));
    if (b.dataset.newedl) {
      const t = data.tenants.find(x => x.id === b.dataset.newedl);
      const e2 = await api(`/api/immo/tenants/${t.id}/edl`, { json: { type: t.edl.some(x => x.type === "entree") ? "sortie" : "entree" } });
      await load(); edlPanel(e2);
    }
  };
}

function monthPanel(t, month) {
  const m = t.months.find(x => x.month === month);
  const due = (t.rent || 0) + (t.charges || 0);
  const md = modal(`${t.name} · ${mlabel(month)}`, `<form>
    <p><span class="cx-st ${ST[m.status][1]}">${ST[m.status][0]}</span> ${m.got ? `${eur(m.got, 2)} reçus sur ${eur(due, 2)}` : `${eur(due, 2)} attendus`}</p>
    ${m.status !== "paye" ? `<div class="grid2"><div><label class="field">Montant reçu</label><input type="text" inputmode="decimal" name="amount" value="${due - (m.got || 0)}"></div>
      <div><label class="field">Reçu le</label><input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <button class="btn" style="margin-top:10px">${icon("check")}Marquer comme reçu</button>` : ""}
    ${m.got ? `<div class="row" style="margin-top:14px"><a class="btn ghost" href="/api/immo/tenants/${t.id}/quittance/${month}" target="_blank">${icon("pdf")}Quittance PDF</a>
      <button type="button" class="btn ghost" data-send>${icon("send")}${m.sent ? "Renvoyer" : "Envoyer"} par mail</button><button type="button" class="btn ghost danger" data-del>${icon("trash")}Effacer le paiement</button></div>` : ""}
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Fermer</button></div></form>`, { ic: "receipt" });
  const f = md.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const r = await api(`/api/immo/tenants/${t.id}/payments`, { json: { month, amount: f.amount.value, date: f.date.value } });
    closePanel(); toast(r.sent ? "Loyer enregistré · quittance envoyée" : "Loyer enregistré"); load();
  };
  md.querySelector("[data-send]")?.addEventListener("click", async () => {
    try { await api(`/api/immo/tenants/${t.id}/quittance/${month}/send`, { json: {} }); closePanel(); toast(`Quittance envoyée à ${t.email}`); load(); } catch (err) { toast(err.message, "err"); }
  });
  md.querySelector("[data-del]")?.addEventListener("click", async () => { await api(`/api/immo/tenants/${t.id}/payments/${month}`, { method: "DELETE" }); closePanel(); load(); });
}

function tenantForm(t) {
  const f = (k, lab, ph = "", type = "text") => `<div><label class="field">${lab}</label><input type="${type}" ${type === "text" ? 'inputmode="decimal"' : ""} name="${k}" value="${esc(t[k] ?? "")}" placeholder="${ph}"></div>`;
  const m = modal(t.id ? t.name : "Nouveau locataire", `<form>
    <div class="grid2"><div><label class="field">Nom du ou des locataires</label><input type="text" name="name" value="${esc(t.name || "")}" required></div>
      <div><label class="field">Logement</label><select name="property" style="width:100%"><option value="">—</option>${data.properties.map(p => `<option value="${p.id}" ${p.id === t.property ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
    <label class="field">Adresse du logement (sur la quittance)</label><input type="text" name="address" value="${esc(t.address || "")}">
    <div class="grid2"><div><label class="field">Mail</label><input type="email" name="email" value="${esc(t.email || "")}"></div><div><label class="field">Téléphone</label><input type="tel" name="phone" value="${esc(t.phone || "")}"></div></div>
    <div class="grid2">${f("start", "Entrée", "", "date")}${f("end", "Sortie (si parti)", "", "date")}</div>
    <div class="grid2">${f("rent", "Loyer hors charges (€)")}${f("charges", "Provision pour charges (€)")}</div>
    <div class="grid2">${f("pay_day", "Jour de paiement", "5")}${f("deposit", "Dépôt de garantie (€)")}</div>
    <div class="grid2"><div><label class="field">IRL de référence du bail</label><input type="text" name="irl_quarter" value="${esc(t.irl_quarter || "")}" placeholder="Ex. 2025-T2"></div>${f("irl_value", "Valeur de cet IRL", "Ex. 146,68")}</div>
    <label class="check"><input type="checkbox" name="furnished" ${t.furnished ? "checked" : ""}> Location meublée</label>
    <label class="check"><input type="checkbox" name="auto_send" ${t.auto_send ? "checked" : ""}> Envoyer la quittance par mail dès que le loyer est reçu</label>
    ${t.end ? `<div class="grid2">${f("deposit_returned", "Dépôt rendu (€)")}${f("deposit_returned_on", "Rendu le", "", "date")}</div>` : ""}
    <div class="modal-foot">${t.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "user", large: true });
  const form = m.querySelector("form");
  form.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(form)]);
    body.furnished = form.furnished.checked; body.auto_send = form.auto_send.checked;
    body.status = body.end && body.end <= new Date().toISOString().slice(0, 10) ? "ended" : "active";
    try { await api(t.id ? `/api/immo/tenants/${t.id}` : "/api/immo/tenants", { method: t.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { if (confirm("Supprimer ce locataire et ses paiements ?")) { await api(`/api/immo/tenants/${t.id}`, { method: "DELETE" }); closePanel(); load(); } });
}

function landlordForm() {
  const m = modal("Bailleur", `<form><p class="hint" style="margin-top:0">Ton nom et ton adresse, imprimés sur les quittances et les états des lieux.</p>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(data.landlord.name || "")}" required>
    <label class="field">Adresse</label><textarea name="address" rows="2">${esc(data.landlord.address || "")}</textarea>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "user" });
  m.querySelector("form").onsubmit = async e => { e.preventDefault(); await api("/api/immo/landlord", { method: "PUT", json: { name: e.target.name.value, address: e.target.address.value } }); closePanel(); load(); };
}

function irlForm() {
  const m = modal("Indice de référence des loyers", `<form><p class="hint" style="margin-top:0">Valeurs publiées par l'INSEE chaque trimestre (insee.fr › IRL). Une ligne par trimestre : <code>2025-T2 146,68</code>.</p>
    <textarea name="vals" rows="6" placeholder="2024-T2 145,17\n2025-T2 146,68"></textarea>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "chart" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const vals = Object.fromEntries(e.target.vals.value.split("\n").map(l => l.trim().match(/^(\d{4}-T[1-4])\s+([\d,.]+)/)).filter(Boolean).map(x => [x[1], x[2]]));
    await api("/api/immo/irl", { method: "PUT", json: vals }); closePanel(); load();
  };
}

function edlPanel(e) {
  const m = modal(`État des lieux ${e.type === "sortie" ? "de sortie" : "d'entrée"}`, `<form class="im-edl">
    <div class="grid2"><div><label class="field">Date</label><input type="date" name="date" value="${esc(e.date)}"></div><div><label class="field">Clés remises</label><input type="text" name="keys" value="${esc(e.keys || "")}" placeholder="Ex. 2 clés + 1 badge"></div></div>
    <div class="grid2"><div><label class="field">Compteur électricité</label><input type="text" name="elec" value="${esc(e.meters.elec || "")}"></div><div><label class="field">Compteur eau</label><input type="text" name="eau" value="${esc(e.meters.eau || "")}"></div></div>
    <label class="field">Compteur gaz</label><input type="text" name="gaz" value="${esc(e.meters.gaz || "")}">
    ${e.rooms.map((r, i) => `<div class="im-room" data-i="${i}"><div class="row"><input type="text" name="rname" value="${esc(r.name)}" style="flex:1;font-weight:600">
        <select name="rstate" style="width:auto">${Object.entries(data.states).map(([k, v]) => `<option value="${k}" ${k === r.state ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <textarea name="rnote" rows="2" placeholder="Murs, sols, plafond, équipements, défauts…">${esc(r.note || "")}</textarea>
      <div class="im-photos">${r.photos.map(p => `<img src="/api/immo/edl/${e.id}/photo/${p}" alt="">`).join("")}
        <label class="btn ghost small"><input type="file" accept="image/*" capture="environment" hidden data-room="${esc(r.name)}">${icon("camera")}Photo</label></div></div>`).join("")}
    <button type="button" class="btn ghost small" data-addroom>${icon("plus")}Ajouter une pièce</button>
    <label class="field">Remarques</label><textarea name="note" rows="2">${esc(e.note || "")}</textarea>
    <div class="modal-foot"><button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button><span class="grow"></span>
      <a class="btn ghost" href="/api/immo/edl/${e.id}/pdf" target="_blank">${icon("pdf")}PDF à signer</a><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "clipboard", large: true });
  const f = m.querySelector("form");
  const collect = () => ({ date: f.date.value, keys: f.keys.value, note: f.note.value, meters: { elec: f.elec.value, eau: f.eau.value, gaz: f.gaz.value },
    rooms: [...f.querySelectorAll(".im-room")].map(r => ({ name: r.querySelector("[name=rname]").value, state: r.querySelector("[name=rstate]").value, note: r.querySelector("[name=rnote]").value })) });
  const save = () => api(`/api/immo/edl/${e.id}`, { method: "PUT", json: collect() });
  f.onsubmit = async ev => { ev.preventDefault(); await save(); closePanel(); toast("État des lieux enregistré"); load(); };
  f.querySelector("[data-addroom]").onclick = async () => {
    const d = collect(); d.rooms.push({ name: `Pièce ${d.rooms.length + 1}`, state: "bon", note: "" });
    await api(`/api/immo/edl/${e.id}`, { method: "PUT", json: d }); data = await api("/api/immo"); closePanel(); setTimeout(() => edlPanel(data.tenants.flatMap(t => t.edl).find(x => x.id === e.id)), 250);
  };
  f.querySelectorAll("[data-room]").forEach(inp => inp.onchange = async () => {
    await save();
    const fd = new FormData(); fd.append("photo", inp.files[0]); fd.append("room", inp.closest(".im-room").querySelector("[name=rname]").value);
    try { await api(`/api/immo/edl/${e.id}/photo`, { method: "POST", body: fd }); } catch (err) { return toast(err.message, "err"); }
    data = await api("/api/immo"); closePanel(); setTimeout(() => edlPanel(data.tenants.flatMap(t => t.edl).find(x => x.id === e.id)), 250);
  });
  m.querySelector("[data-del]").onclick = async () => { if (confirm("Supprimer cet état des lieux ?")) { await api(`/api/immo/edl/${e.id}`, { method: "DELETE" }); closePanel(); load(); } };
}

// --- Déclaration --------------------------------------------------------------------------------------------------

async function declaration(el, year) {
  year = year || new Date().getFullYear() - 1;
  el.innerHTML = `<p class="meta"><span class="spinner"></span></p>`;
  const r = await api(`/api/immo/declaration?year=${year}`);
  el.innerHTML = `<div class="ot-top"><select id="im-year" style="width:auto">${[0, 1, 2, 3].map(k => new Date().getFullYear() - k).map(y => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select>
      <span class="meta">Revenus ${year}, à déclarer au printemps ${year + 1}</span></div>
    ${r.properties.length ? r.properties.map(p => `<div class="card"><div class="card-title">${icon("home")}${esc(p.name)} <span class="chip">${p.furnished ? "Meublé" : "Location nue"}</span></div>
      <div class="bg-cols"><div><div class="bg-row"><span class="grow"><b>Loyers encaissés (hors charges)</b></span><b>${eur(p.rents)}</b></div>
          ${Object.entries(p.charges).map(([k, v]) => `<div class="bg-row"><span class="grow meta">${esc(k)}${k.startsWith("Travaux") ? ` <button class="btn ghost small" data-works="${p.property}">${icon("edit")}</button>` : ""}</span><span>${eur(v)}</span></div>`).join("")}
          <div class="bg-row"><span class="grow"><b>Total des charges</b></span><b>${eur(p.total_charges)}</b></div></div>
        <div class="im-regimes">${Object.entries(p.regimes).map(([k, g]) => `<div class="im-reg ${k === p.best ? "best" : ""}">${k === p.best ? `<span class="cx-st ok">Le plus avantageux</span>` : ""}
          <b>${esc(g.name)}</b>${g.taxable != null ? `<span>Revenu imposable : <b>${eur(g.taxable)}</b></span>` : ""}${g.possible === false ? `<small class="pt-down">Impossible au-delà de 15 000 € de loyers par an</small>` : ""}
          <small class="meta">${esc(g.box)}${g.amount != null ? ` : <b>${eur(g.amount)}</b>` : ""}</small></div>`).join("")}</div></div></div>`).join("")
      : `<div class="card empty">${icon("receipt")}<b>Aucun bien en location</b>Ajoute ton bien dans Patrimoine (usage « Locatif ») et ton locataire dans l'onglet Location : les loyers reçus remplissent ce récapitulatif.</div>`}
    <p class="hint">${icon("lightbulb")} Récapitulatif indicatif : la taxe foncière hors part « ordures ménagères », les charges réellement payées et le choix du régime (engagement de 3 ans pour le réel) sont à vérifier sur impots.gouv.fr ou avec un comptable.</p>`;
  $("#im-year").onchange = e => declaration(el, +e.target.value);
  el.querySelectorAll("[data-works]").forEach(b => b.onclick = async () => {
    const v = prompt(`Travaux payés en ${year} (€)`);
    if (v == null) return;
    await api("/api/immo/works", { method: "PUT", json: { property: b.dataset.works, year, amount: v } }); declaration(el, year);
  });
}
