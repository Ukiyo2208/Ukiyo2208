// Outil « Patrimoine » : placements (Revolut, actions de l'entreprise), crédits, immobilier, projet locatif.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, tab = "synthese";
const TABS = [["synthese", "Synthèse", "pie"], ["placements", "Placements", "chart"], ["credits", "Crédits", "landmark"], ["immobilier", "Immobilier", "home"], ["projet", "Projet locatif", "key"]];
const eur = (n, dec = 0) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: dec, minimumFractionDigits: dec });
const money = (n, cur) => n == null ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: cur || "EUR", maximumFractionDigits: 2 });
const pct = n => n == null || isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const dfr = d => d ? new Date(d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";

export async function render(root, parts) {
  tab = TABS.some(t => t[0] === parts[0]) ? parts[0] : "synthese";
  root.innerHTML = pageHead("patrimoine") + `<div class="seg bg-tabs" id="pt-tabs">${TABS.map(([k, l, ic]) => `<label><input type="radio" name="ptt" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div><div id="pt-body"></div>`;
  $("#pt-tabs").onchange = e => go(e.target.value);
  await load();
}

async function load() { data = await api("/api/patrimoine"); paint(); }
function go(t) { tab = t; document.querySelector(`#pt-tabs input[value="${t}"]`).checked = true; history.replaceState(null, "", `#/patrimoine/${t}`); paint(); }
function paint() { const el = $("#pt-body"); if (el) ({ synthese, placements, credits, immobilier, projet: x => projet(x, prefill()) })[tab](el); }
function prefill() {  // annonce envoyée depuis l'outil Immobilier
  try { const p = JSON.parse(sessionStorage.getItem("bt-projet") || "null"); sessionStorage.removeItem("bt-projet"); return p ? Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v != null)) : null; } catch { return null; }
}

// --- Synthèse ----------------------------------------------------------------------------------------------------

function synthese(el) {
  const t = data.totals, inc = data.income;
  const ratio = inc ? t.monthly_debt / inc * 100 : null;
  const assets = t.investments + t.real_estate;
  const empty = !data.positions.length && !data.loans.length && !data.properties.length;
  el.innerHTML = `${empty ? `<div class="intro"><span class="tile violet">${icon("landmark")}</span><p>Commence par <a href="#" data-go="placements">importer ton relevé Revolut</a> ou ajouter tes actions de l'entreprise,
      puis <a href="#" data-go="credits">tes crédits</a> et <a href="#" data-go="immobilier">ton logement</a>. Le <a href="#" data-go="projet">simulateur de projet locatif</a> marche tout de suite.</p></div>` : ""}
    <div class="bg-kpis">
      <div class="card bg-kpi"><small class="meta">Patrimoine net</small><b>${eur(t.net)}</b><small class="meta">ce que tu possèdes moins ce que tu dois</small></div>
      <div class="card bg-kpi"><small class="meta">Placements</small><b>${eur(t.investments)}</b><small class="meta ${t.gain >= 0 ? "pt-up" : "pt-down"}">${t.gain ? `${t.gain > 0 ? "+" : ""}${eur(t.gain)} de plus-value` : ""}</small></div>
      <div class="card bg-kpi"><small class="meta">Immobilier</small><b>${eur(t.real_estate)}</b></div>
      <div class="card bg-kpi ${t.debt ? "neg" : ""}"><small class="meta">Reste à rembourser</small><b>${eur(t.debt)}</b><small class="meta">${t.monthly_debt ? `${eur(t.monthly_debt, 2)} par mois` : ""}</small></div>
    </div>
    <div class="bg-cols"><div>
      ${assets || t.debt ? `<div class="card"><div class="card-title">${icon("pie")}Répartition</div>
        <div class="pt-bar">${[["Placements", t.investments, "a"], ["Immobilier", t.real_estate, "b"]].filter(x => x[1] > 0).map(([l, v, c]) => `<i class="${c}" style="flex:${v}" title="${l} : ${eur(v)}"></i>`).join("")}</div>
        <div class="pt-legend"><span><i class="a"></i>Placements ${assets ? Math.round(t.investments / assets * 100) : 0} %</span><span><i class="b"></i>Immobilier ${assets ? Math.round(t.real_estate / assets * 100) : 0} %</span>
          ${t.locked ? `<span>${icon("lock")}${eur(t.locked)} bloqués (épargne salariale)</span>` : ""}</div>
        ${t.debt ? `<p class="meta" style="margin:12px 0 0">Dettes : ${eur(t.debt)}, soit ${assets ? Math.round(t.debt / assets * 100) : 100} % de ce que tu possèdes.</p>` : ""}</div>` : ""}
      ${data.loan_hints.length ? `<div class="card"><div class="card-title">${icon("alert")}Prêts repérés dans ton Budget</div>
        ${data.loan_hints.map(h => `<div class="bg-row"><span class="grow bg-lbl"><b>${esc(h.label)}</b><small class="meta">${eur(h.amount, 2)} par mois depuis ${dfr(h.since)}</small></span>
          <button class="btn ghost small" data-hint="${esc(h.label)}" data-amount="${h.amount}">${icon("plus")}Ajouter</button></div>`).join("")}</div>` : ""}
    </div><div class="bg-side">
      <div class="card"><div class="card-title">${icon("landmark")}Endettement</div>
        ${inc ? `<p class="jr-big"><b>${ratio.toFixed(1).replace(".", ",")} %</b> de tes revenus</p>
          <div class="bg-bar"><i style="width:${Math.min(100, ratio / 50 * 100)}%" class="${ratio > 35 ? "over" : ""}"></i><em style="left:70%" title="35 %"></em></div>
          <small class="meta">Revenus moyens ${eur(inc)} / mois (Budget) · les banques prêtent en général jusqu'à 35 %, assurance comprise.</small>`
          : `<p class="meta">Importe tes relevés dans le <a href="#/budget">Budget</a> pour calculer ton taux d'endettement.</p>`}</div>
      <div class="card"><div class="card-title">${icon("receipt")}Taxe foncière</div>
        ${data.taxes.length ? data.taxes.slice(0, 4).map(x => `<a class="bg-row" href="#/paperasse/doc/${x.id}"><span class="grow bg-lbl"><b>${esc(x.year || "?")}</b><small class="meta">${x.due ? `à payer le ${dfr(x.due)}` : esc(x.title || "")}${x.paid ? " · payée" : ""}</small></span><b>${eur(x.amount)}</b></a>`).join("")
          : `<p class="meta">Dépose ton avis de taxe foncière dans <a href="#/paperasse">Paperasse</a> : il apparaîtra ici avec son échéance.</p>`}
        ${data.properties.some(p => p.taxe_fonciere) ? `<small class="meta">Total saisi pour tes biens : ${eur(data.properties.reduce((a, p) => a + (p.taxe_fonciere || 0), 0))} par an</small>` : ""}</div>
    </div></div>`;
  el.onclick = e => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); return go(g.dataset.go); }
    const h = e.target.closest("[data-hint]");
    if (h) loanForm({ name: h.dataset.hint, payment: +h.dataset.amount });
  };
}

// --- Placements --------------------------------------------------------------------------------------------------

function placements(el) {
  const by = {};
  data.positions.forEach(p => (by[p.account || "Autres"] = by[p.account || "Autres"] || []).push(p));
  el.innerHTML = `<div class="ot-top"><button class="btn" id="pt-import">${icon("upload")}Importer un relevé Revolut</button>
      <button class="btn ghost" id="pt-add">${icon("plus")}Ajouter une ligne</button><button class="btn ghost" id="pt-quotes">${icon("refresh")}Mettre à jour les cours</button></div>
    ${Object.keys(by).length ? Object.entries(by).map(([acc, ps]) => {
      const tot = ps.reduce((a, p) => a + (p.value_eur || 0), 0), gain = ps.reduce((a, p) => a + (p.gain_eur || 0), 0);
      return `<div class="card bg-fix"><div class="card-title">${icon("chart")}${esc(acc)}<span class="grow"></span><b>${eur(tot)}</b>${gain ? `<small class="${gain >= 0 ? "pt-up" : "pt-down"}">&nbsp;${gain > 0 ? "+" : ""}${eur(gain)}</small>` : ""}</div>
        <div class="pt-table">${ps.sort((a, b) => (b.value_eur || 0) - (a.value_eur || 0)).map(p => `<button class="pt-line" data-p="${p.id}">
          <span class="grow bg-lbl"><b>${esc(p.name)}${p.ticker && p.ticker !== p.name ? ` <small class="meta">${esc(p.ticker)}</small>` : ""}</b>
            <small class="meta">${esc(data.kinds[p.kind] || "")} · ${Number(p.qty).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} × ${p.price != null ? money(p.price, p.price_currency) : "cours inconnu"}${p.pru ? ` · prix de revient ${money(p.pru, p.currency)}` : ""}
            ${p.locked ? ` · ${icon("lock")} disponible le ${dfr(p.available)}` : ""}${p.dividends ? ` · ${money(p.dividends, p.currency)} de dividendes` : ""}${p.quote_error ? ` · ${icon("alert")} cours introuvable : indique le symbole ou le cours à la main` : ""}</small></span>
          <span class="pt-val"><b>${eur(p.value_eur)}</b><small class="${(p.gain_pct || 0) >= 0 ? "pt-up" : "pt-down"}">${p.gain_pct != null ? pct(p.gain_pct) : ""}</small></span></button>`).join("")}</div></div>`;
    }).join("") : `<div class="card empty">${icon("chart")}<b>Aucun placement</b><p>Dans l'appli Revolut : onglet <b>Investir</b> › <b>…</b> › <b>Documents</b> › <b>Relevé de compte</b>, format <b>Excel / CSV</b>, toute la période. Dépose le fichier ici : tes actions, leur prix de revient et tes dividendes sont recalculés.
      Pour les actions de ton entreprise (PEE, RSU, ESPP), « Ajouter une ligne » avec le nombre de parts de ton relevé et la date de disponibilité.</p></div>`}
    <p class="hint">${icon("lock")} Les cours viennent de Yahoo Finance (seuls les symboles sont envoyés) et sont convertis en euros avec les taux de la BCE. Valeurs indicatives, avec un léger différé.</p>`;
  $("#pt-import").onclick = importPanel;
  $("#pt-add").onclick = () => positionForm();
  $("#pt-quotes").onclick = async e => { e.target.disabled = true; const r = await api("/api/patrimoine/quotes", { json: {} }); toast(`${r.updated} cours mis à jour`); load(); };
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => positionForm(data.positions.find(p => p.id === b.dataset.p)));
}

function importPanel() {
  const m = modal("Importer un relevé Revolut", `<form>
    <ol class="tuto"><li><b>Dans l'appli Revolut</b><span>Onglet <b>Investir</b> › <b>…</b> (Plus) › <b>Documents</b> › compte d'actions › <b>Relevé de compte</b>.</span></li>
      <li><b>Format Excel / CSV</b><span>Choisis toute la période depuis l'ouverture du compte, puis enregistre ou envoie-toi le fichier.</span></li>
      <li><b>Dépose-le ici</b><span>Achats, ventes, divisions et dividendes sont lus ; réimporter ne crée pas de doublons.</span></li></ol>
    <label class="field">Fichier CSV</label><input type="file" name="file" accept=".csv,text/csv" required>
    <label class="field">Nom du compte</label><input type="text" name="account" value="Revolut">
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("upload")}Importer</button></div></form>`, { ic: "upload" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector(".modal-foot .btn:last-child"); b.disabled = true;
    try {
      const r = await api("/api/patrimoine/import", { method: "POST", body: new FormData(e.target) });
      closePanel(); toast(`${r.added} opération${r.added > 1 ? "s" : ""} importée${r.added > 1 ? "s" : ""} · ${r.lines} ligne${r.lines > 1 ? "s" : ""} dans le portefeuille`); load();
    } catch (err) { toast(err.message, "err"); b.disabled = false; }
  };
}

function positionForm(p = {}) {
  const m = modal(p.id ? p.name : "Ajouter un placement", `<form>
    <div class="grid2"><div><label class="field">Type</label><select name="kind" style="width:100%">${Object.entries(data.kinds).map(([k, v]) => `<option value="${k}" ${k === (p.kind || "action") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div><label class="field">Compte</label><input type="text" name="account" value="${esc(p.account || "")}" placeholder="Ex. Revolut, PEE Amundi, Fidelity"></div></div>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(p.name || "")}" required placeholder="Ex. Apple, Fonds Actions de l'entreprise">
    <div class="grid2"><div><label class="field">Quantité (actions ou parts)</label><input type="text" inputmode="decimal" name="qty" value="${p.qty ?? ""}" required></div>
      <div><label class="field">Prix de revient unitaire</label><input type="text" inputmode="decimal" name="pru" value="${p.pru ?? ""}" placeholder="Facultatif"></div></div>
    <div class="grid2"><div><label class="field">Symbole de cotation</label><input type="text" name="symbol" value="${esc(p.symbol || p.ticker || "")}" placeholder="Ex. AAPL, MC.PA, CW8.PA">
        <small class="meta">Pour le cours automatique (symbole Yahoo Finance)</small></div>
      <div><label class="field">Devise</label><select name="currency" style="width:100%">${["EUR", "USD", "GBP", "CHF", "CAD", "JPY"].map(c => `<option ${c === (p.currency || "EUR") ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
    <div class="grid2"><div><label class="field">Cours à la main</label><input type="text" inputmode="decimal" name="price_manual" value="${p.price_manual ?? ""}" placeholder="Ex. valeur de la part du relevé"></div>
      <div><label class="field">Disponible le</label><input type="date" name="available" value="${esc(p.available || "")}"><small class="meta">Épargne salariale : fin de blocage</small></div></div>
    <label class="field">Note</label><input type="text" name="note" value="${esc(p.note || "")}">
    ${p.auto ? `<p class="hint">${icon("refresh")} Ligne calculée depuis ton relevé ${esc(p.account)} : la quantité sera recalculée au prochain import.</p>` : ""}
    <div class="modal-foot">${p.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "chart" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(["kind", "account", "name", "qty", "pru", "symbol", "currency", "price_manual", "available", "note"].map(k => [k, f[k].value]));
    body.ticker = p.ticker || body.symbol.split(".")[0];
    try { await api(p.id ? `/api/patrimoine/positions/${p.id}` : "/api/patrimoine/positions", { method: p.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { if (confirm("Supprimer cette ligne ?")) { await api(`/api/patrimoine/positions/${p.id}`, { method: "DELETE" }); closePanel(); load(); } });
}

// --- Crédits -----------------------------------------------------------------------------------------------------

function credits(el) {
  const live = data.loans.filter(l => !l.state.done);
  el.innerHTML = `<div class="ot-top"><button class="btn" id="pt-addloan">${icon("plus")}Ajouter un crédit</button>
      ${live.length ? `<span class="chip">${eur(data.totals.debt)} à rembourser · ${eur(data.totals.monthly_debt, 2)} / mois</span>` : ""}</div>
    ${data.loans.length ? `<div class="pt-loans">${data.loans.map(l => {
      const s = l.state, max = Math.max(...(s.yearly || [1]), 1);
      return `<button class="card pt-loan" data-l="${l.id}"><div class="pt-loan-h"><span class="tile violet">${icon("landmark")}</span><div class="grow"><b>${esc(l.name)}</b>
          <small class="meta">${esc(data.loan_kinds[l.kind] || "")}${l.lender ? ` · ${esc(l.lender)}` : ""} · ${eur(l.capital)} à ${String(l.rate).replace(".", ",")} % sur ${Math.round(l.months / 12 * 10) / 10} ans</small></div>
          ${s.done ? `<span class="cx-st ok">Remboursé</span>` : ""}</div>
        <div class="pt-loan-k"><div><small class="meta">Reste à rembourser</small><b>${eur(s.remaining)}</b></div><div><small class="meta">Mensualité</small><b>${eur(s.monthly, 2)}</b></div>
          <div><small class="meta">Fin</small><b>${dfr(s.end)}</b></div></div>
        <div class="bg-bar"><i style="width:${s.progress}%"></i></div><small class="meta">${s.progress} % remboursé · ${s.left_months} mensualités restantes · ${eur(s.interest_left)} d'intérêts restants${s.insurance ? ` + ${eur(s.insurance_left)} d'assurance` : ""}</small>
        <div class="pt-spark" title="Capital restant dû en fin de chaque année">${(s.yearly || []).map(v => `<i style="height:${(v / max * 100).toFixed(0)}%"></i>`).join("")}</div></button>`;
    }).join("")}</div>`
    : `<div class="card empty">${icon("landmark")}<b>Aucun crédit</b><p>Ajoute tes prêts avec les chiffres de l'offre de prêt ou du tableau d'amortissement (montant, taux, durée, date de la première échéance) : le capital restant dû, les intérêts restants et la date de fin sont calculés.</p></div>`}
    ${data.loan_hints.length ? `<p class="hint">${icon("alert")} Repéré dans ton Budget : ${data.loan_hints.map(h => `${esc(h.label)} (${eur(h.amount, 2)} / mois)`).join(", ")}.</p>` : ""}`;
  $("#pt-addloan").onclick = () => loanForm();
  el.querySelectorAll("[data-l]").forEach(b => b.onclick = () => loanForm(data.loans.find(l => l.id === b.dataset.l)));
}

function loanForm(l = {}) {
  const m = modal(l.id ? l.name : "Ajouter un crédit", `<form>
    <div class="grid2"><div><label class="field">Nom</label><input type="text" name="name" value="${esc(l.name || "")}" required placeholder="Ex. Prêt appartement"></div>
      <div><label class="field">Type</label><select name="kind" style="width:100%">${Object.entries(data.loan_kinds).map(([k, v]) => `<option value="${k}" ${k === (l.kind || "immo") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div></div>
    <div class="grid2"><div><label class="field">Banque</label><input type="text" name="lender" value="${esc(l.lender || "")}" placeholder="Ex. Crédit Agricole"></div>
      <div><label class="field">Montant emprunté (€)</label><input type="text" inputmode="decimal" name="capital" value="${l.capital ?? ""}" required></div></div>
    <div class="grid2"><div><label class="field">Taux nominal (% par an)</label><input type="text" inputmode="decimal" name="rate" value="${l.rate ?? ""}" required placeholder="Ex. 3,45"></div>
      <div><label class="field">Durée (mois)</label><input type="number" name="months" value="${l.months ?? 240}" required></div></div>
    <div class="grid2"><div><label class="field">Première échéance</label><input type="date" name="start" value="${esc(l.start || "")}" required></div>
      <div><label class="field">Assurance (€ / mois)</label><input type="text" inputmode="decimal" name="insurance" value="${l.insurance ?? ""}"></div></div>
    <label class="field">Mensualité du contrat (hors assurance)</label><input type="text" inputmode="decimal" name="payment" value="${l.payment ?? ""}" placeholder="Facultatif : calculée sinon">
    <label class="field">Bien financé</label><select name="property" style="width:100%"><option value="">—</option>${data.properties.map(p => `<option value="${p.id}" ${p.id === l.property ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    <div class="modal-foot">${l.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "landmark" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(["name", "kind", "lender", "capital", "rate", "months", "start", "insurance", "payment", "property"].map(k => [k, f[k].value]));
    try { await api(l.id ? `/api/patrimoine/loans/${l.id}` : "/api/patrimoine/loans", { method: l.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { if (confirm("Supprimer ce crédit ?")) { await api(`/api/patrimoine/loans/${l.id}`, { method: "DELETE" }); closePanel(); load(); } });
}

// --- Immobilier --------------------------------------------------------------------------------------------------

function propStats(p) {
  const cost = (p.price || 0) + (p.fees || 0) + (p.works || 0);
  const yearCharges = (p.charges || 0) + (p.taxe_fonciere || 0) + (p.pno || 0);
  const loans = data.loans.filter(l => l.property === p.id && !l.state.done);
  const monthlyLoan = loans.reduce((a, l) => a + l.state.monthly, 0), owed = loans.reduce((a, l) => a + l.state.remaining, 0);
  const rentY = (p.rent || 0) * 12;
  return { cost, yearCharges, monthlyLoan, owed, gross: cost && rentY ? rentY / cost * 100 : null, net: cost && rentY ? (rentY - yearCharges) / cost * 100 : null,
    cashflow: p.rent ? p.rent - yearCharges / 12 - monthlyLoan : null, equity: (p.value || p.price || 0) - owed };
}

function immobilier(el) {
  el.innerHTML = `<div class="ot-top"><button class="btn" id="pt-addprop">${icon("plus")}Ajouter un bien</button></div>
    ${data.properties.length ? `<div class="pt-loans">${data.properties.map(p => {
      const s = propStats(p);
      return `<button class="card pt-loan" data-pr="${p.id}"><div class="pt-loan-h"><span class="tile ambre">${icon("home")}</span><div class="grow"><b>${esc(p.name)}</b>
          <small class="meta">${esc(data.prop_kinds[p.kind] || "")}${p.city ? ` · ${esc(p.city)}` : ""}${p.surface ? ` · ${p.surface} m²` : ""}</small></div></div>
        <div class="pt-loan-k"><div><small class="meta">Valeur</small><b>${eur(p.value || p.price)}</b></div><div><small class="meta">Reste dû</small><b>${eur(s.owed)}</b></div><div><small class="meta">Part à toi</small><b>${eur(s.equity)}</b></div></div>
        <small class="meta">Taxe foncière ${eur(p.taxe_fonciere)} / an · charges ${eur(p.charges)} / an${p.pno ? ` · assurance ${eur(p.pno)} / an` : ""}</small>
        ${p.rent ? `<small class="meta">Loyer ${eur(p.rent)} / mois · rendement brut ${pct(s.gross).replace("+", "")} · net ${pct(s.net).replace("+", "")} · <b class="${s.cashflow >= 0 ? "pt-up" : "pt-down"}">cash-flow ${eur(s.cashflow)} / mois</b></small>` : ""}</button>`;
    }).join("")}</div>`
    : `<div class="card empty">${icon("home")}<b>Aucun bien</b><p>Ajoute ton logement ou un bien en location : prix, frais, valeur estimée, loyer, taxe foncière, charges. Relie le crédit qui le finance pour voir ce qu'il te reste à rembourser et ton cash-flow.</p></div>`}
    ${data.taxes.length ? `<div class="card"><div class="card-title">${icon("receipt")}Avis de taxe foncière (Paperasse)</div>${data.taxes.map(x => `<a class="bg-row" href="#/paperasse/doc/${x.id}"><span class="grow bg-lbl"><b>${esc(x.year || "?")}</b><small class="meta">${esc(x.title || "")}${x.due ? ` · échéance ${dfr(x.due)}` : ""}</small></span><b>${eur(x.amount)}</b></a>`).join("")}</div>` : ""}`;
  $("#pt-addprop").onclick = () => propForm();
  el.querySelectorAll("[data-pr]").forEach(b => b.onclick = () => propForm(data.properties.find(p => p.id === b.dataset.pr)));
}

function propForm(p = {}) {
  const field = (k, l, ph = "") => `<div><label class="field">${l}</label><input type="text" inputmode="decimal" name="${k}" value="${p[k] ?? ""}" placeholder="${ph}"></div>`;
  const m = modal(p.id ? p.name : "Ajouter un bien", `<form>
    <div class="grid2"><div><label class="field">Nom</label><input type="text" name="name" value="${esc(p.name || "")}" required placeholder="Ex. Appartement Lyon 3e"></div>
      <div><label class="field">Usage</label><select name="kind" style="width:100%">${Object.entries(data.prop_kinds).map(([k, v]) => `<option value="${k}" ${k === (p.kind || "principale") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div></div>
    <div class="grid2"><div><label class="field">Ville</label><input type="text" name="city" value="${esc(p.city || "")}"></div>${field("surface", "Surface (m²)")}</div>
    <div class="grid2">${field("price", "Prix d'achat (€)")}<div><label class="field">Acheté le</label><input type="date" name="bought" value="${esc(p.bought || "")}"></div></div>
    <div class="grid2">${field("fees", "Frais de notaire (€)")}${field("works", "Travaux (€)")}</div>
    <div class="grid2">${field("value", "Valeur estimée aujourd'hui (€)", "Ex. selon les prix DVF du quartier")}${field("rent", "Loyer hors charges (€ / mois)", "Si loué")}</div>
    <div class="grid2">${field("taxe_fonciere", "Taxe foncière (€ / an)")}${field("charges", "Charges non récupérables (€ / an)")}</div>
    ${field("pno", "Assurance (€ / an)", "Habitation ou PNO")}
    <div class="modal-foot">${p.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "home", large: true });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(["name", "kind", "city", "surface", "price", "bought", "fees", "works", "value", "rent", "taxe_fonciere", "charges", "pno"].map(k => [k, f[k].value]));
    try { await api(p.id ? `/api/patrimoine/properties/${p.id}` : "/api/patrimoine/properties", { method: p.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { if (confirm("Supprimer ce bien ?")) { await api(`/api/patrimoine/properties/${p.id}`, { method: "DELETE" }); closePanel(); load(); } });
}

// --- Projet locatif ----------------------------------------------------------------------------------------------

const DEF = { price: 150000, neuf: "ancien", works: 0, furniture: 0, guarantee: "", apport: 15000, rate: 3.4, years: 20, ins: 0.3, rent: 650, vacancy: 1,
  copro: 600, tf: 800, pno: 150, gestion: 0, entretien: 5, regime: "nu", tmi: 30, ps: 17.2, income: "", debts: "" };

function compute(v) {
  const n = k => Number(String(v[k] ?? "").replace(",", ".")) || 0;
  const price = n("price"), notary = price * (v.neuf === "neuf" ? .025 : .075);
  const guarantee = v.guarantee === "" ? Math.round(price * .01) : n("guarantee");
  const cost = price + notary + n("works") + n("furniture") + guarantee;
  const loan = Math.max(0, cost - n("apport"));
  const r = n("rate") / 1200, m = n("years") * 12;
  const pay = !loan || !m ? 0 : r ? loan * r / (1 - (1 + r) ** -m) : loan / m;
  const insM = loan * n("ins") / 1200, monthly = pay + insM;
  const rentY = n("rent") * Math.max(0, 12 - n("vacancy"));
  const charges = n("copro") + n("tf") + n("pno") + rentY * (n("gestion") + n("entretien")) / 100;
  const noi = rentY - charges;
  const abat = v.regime === "nu" ? .3 : v.regime === "lmnp" ? .5 : null;
  const tax = abat == null ? 0 : rentY * (1 - abat) * (n("tmi") + n("ps")) / 100;
  const income = n("income") || data.income || 0, debts = v.debts === "" ? data.totals.monthly_debt : n("debts");
  const before = income ? debts / income * 100 : null;
  const after = income ? (debts + monthly) / (income + .7 * n("rent")) * 100 : null;
  const room = income ? .35 * (income + .7 * n("rent")) - debts : null;
  const maxLoan = room > 0 && m ? room / ((r ? r / (1 - (1 + r) ** -m) : 1 / m) + n("ins") / 1200) : 0;
  return { price, notary, guarantee, cost, loan, pay, insM, monthly, rentY, charges, noi, tax, income, debts, before, after, maxLoan, m,
    gross: price ? n("rent") * 12 / price * 100 : 0, net: cost ? noi / cost * 100 : 0, cash: noi / 12 - monthly, cashTax: (noi - tax) / 12 - monthly,
    interest: pay * m - loan, insTotal: insM * m, microOver: v.regime === "nu" && rentY > 15000 };
}

function projet(el, inputs) {
  const v = { ...DEF, ...(inputs || {}) };
  const num = (k, l, unit = "€", step = "any", hint = "") => `<div><label class="field">${l}</label><div class="pt-in"><input type="number" step="${step}" name="${k}" value="${v[k]}" ${hint ? `placeholder="${hint}"` : ""}><span>${unit}</span></div></div>`;
  el.innerHTML = `<div class="pt-proj">
    <form class="card" id="pt-form"><div class="card-title">${icon("home")}Le bien${data.projects.length ? `<span class="grow"></span><select id="pt-load" style="width:auto"><option value="">Projets enregistrés…</option>${data.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>` : ""}</div>
      <div class="grid2">${num("price", "Prix affiché")}<div><label class="field">Logement</label><select name="neuf" style="width:100%"><option value="ancien" ${v.neuf === "ancien" ? "selected" : ""}>Ancien (notaire ≈ 7,5 %)</option><option value="neuf" ${v.neuf === "neuf" ? "selected" : ""}>Neuf (notaire ≈ 2,5 %)</option></select></div></div>
      <div class="grid2">${num("works", "Travaux")}${num("furniture", "Meubles (si meublé)")}</div>
      <div class="card-title" style="margin-top:14px">${icon("landmark")}Le crédit</div>
      <div class="grid2">${num("apport", "Apport")}${num("guarantee", "Garantie et frais de dossier", "€", "any", "≈ 1 % du prix")}</div>
      <div class="grid2">${num("rate", "Taux", "%", "0.01")}${num("years", "Durée", "ans", "1")}</div>
      ${num("ins", "Assurance emprunteur", "% / an", "0.01")}
      <div class="card-title" style="margin-top:14px">${icon("key")}La location</div>
      <div class="grid2">${num("rent", "Loyer hors charges", "€ / mois")}${num("vacancy", "Vacance locative", "mois / an", "0.5")}</div>
      <div class="grid2">${num("tf", "Taxe foncière", "€ / an")}${num("copro", "Charges non récupérables", "€ / an")}</div>
      <div class="grid2">${num("pno", "Assurance PNO", "€ / an")}${num("gestion", "Gestion par une agence", "% loyers", "0.5")}</div>
      ${num("entretien", "Entretien et imprévus", "% loyers", "0.5")}
      <div class="card-title" style="margin-top:14px">${icon("user")}Toi</div>
      <div class="grid2">${num("income", "Revenus nets", "€ / mois", "any", data.income ? `${Math.round(data.income)} (Budget)` : "")}${num("debts", "Crédits en cours", "€ / mois", "any", `${Math.round(data.totals.monthly_debt)} (tes crédits)`)}</div>
      <div class="grid2"><div><label class="field">Fiscalité</label><select name="regime" style="width:100%"><option value="nu" ${v.regime === "nu" ? "selected" : ""}>Location nue · micro-foncier (−30 %)</option>
          <option value="lmnp" ${v.regime === "lmnp" ? "selected" : ""}>Meublé LMNP · micro-BIC (−50 %)</option><option value="aucun" ${v.regime === "aucun" ? "selected" : ""}>Ne pas estimer l'impôt</option></select></div>
        <div><label class="field">Tranche d'impôt</label><select name="tmi" style="width:100%">${[0, 11, 30, 41, 45].map(t => `<option ${+v.tmi === t ? "selected" : ""} value="${t}">${t} %</option>`).join("")}</select></div></div>
      ${num("ps", "Prélèvements sociaux", "%", "0.1")}
      <div class="row" style="margin-top:12px"><input type="text" id="pt-pname" placeholder="Nom du projet (ex. T2 Villeurbanne)" style="flex:1"><button type="button" class="btn ghost" id="pt-save">${icon("save")}Enregistrer</button></div>
    </form>
    <div class="pt-res" id="pt-res"></div></div>`;
  const f = $("#pt-form");
  const read = () => Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, x]));
  const show = () => {
    const c = compute(read());
    const ok = c.after == null ? "" : c.after <= 33 ? "ok" : c.after <= 35 ? "warn" : "bad";
    $("#pt-res").innerHTML = `<div class="card"><div class="card-title">${icon("landmark")}Financement</div>
        <div class="pt-loan-k"><div><small class="meta">Coût total</small><b>${eur(c.cost)}</b></div><div><small class="meta">À emprunter</small><b>${eur(c.loan)}</b></div><div><small class="meta">Mensualité</small><b>${eur(c.monthly)}</b></div></div>
        <small class="meta">Dont notaire ${eur(c.notary)}, garantie ${eur(c.guarantee)} · crédit ${eur(c.pay)} + assurance ${eur(c.insM)} par mois · coût du crédit ${eur(c.interest + c.insTotal)} (intérêts ${eur(c.interest)})</small></div>
      <div class="card"><div class="card-title">${icon("chart")}Rentabilité</div>
        <div class="pt-loan-k"><div><small class="meta">Rendement brut</small><b>${pct(c.gross).replace("+", "")}</b></div><div><small class="meta">Rendement net</small><b>${pct(c.net).replace("+", "")}</b></div>
          <div><small class="meta">Cash-flow</small><b class="${c.cash >= 0 ? "pt-up" : "pt-down"}">${c.cash >= 0 ? "+" : ""}${eur(c.cash)}</b><small class="meta">par mois avant impôt</small></div></div>
        <div class="pt-flow">${[["Loyers encaissés", c.rentY / 12, "in"], ["Mensualité du crédit", -c.monthly, "out"], ["Taxe foncière, charges, assurance, entretien", -c.charges / 12, "out"], ...(c.tax ? [["Impôt estimé", -c.tax / 12, "out"]] : [])]
          .map(([l, x, k]) => `<div class="pt-fl ${k}"><span class="grow">${l}</span><b>${x >= 0 ? "+" : ""}${eur(x)}</b></div>`).join("")}
          <div class="pt-fl total"><span class="grow">Il te reste ${c.tax ? "après impôt" : ""}</span><b class="${c.cashTax >= 0 ? "pt-up" : "pt-down"}">${c.cashTax >= 0 ? "+" : ""}${eur(c.cashTax)} / mois</b></div></div>
        ${c.cashTax < 0 ? `<p class="hint">Effort d'épargne : ${eur(-c.cashTax)} par mois à ajouter de ta poche, compensé à terme par le capital remboursé (${eur(c.pay - c.loan * (+read().rate) / 1200)} le premier mois).</p>` : ""}
        ${c.microOver ? `<p class="hint">${icon("alert")} Plus de 15 000 € de loyers par an : le micro-foncier ne s'applique plus, c'est le régime réel.</p>` : ""}</div>
      <div class="card"><div class="card-title">${icon("user")}Ton dossier pour la banque</div>
        ${c.income ? `<div class="pt-loan-k"><div><small class="meta">Endettement aujourd'hui</small><b>${c.before.toFixed(1).replace(".", ",")} %</b></div>
          <div><small class="meta">Avec ce projet</small><b class="pt-${ok}">${c.after.toFixed(1).replace(".", ",")} %</b></div><div><small class="meta">Emprunt possible</small><b>${eur(c.maxLoan)}</b></div></div>
          <div class="bg-bar"><i style="width:${Math.min(100, c.after / 50 * 100)}%" class="${ok === "bad" ? "over" : ""}"></i><em style="left:70%" title="35 %"></em></div>
          <small class="meta">Les banques retiennent en général 70 % du loyer dans tes revenus et limitent l'endettement à 35 % assurance comprise, sur 25 ans au plus (27 dans le neuf ou avec beaucoup de travaux).
          ${ok === "bad" ? "Au-dessus : augmente l'apport, allonge la durée ou vise moins cher." : ok === "warn" ? "Juste à la limite : un apport un peu plus élevé rassurera la banque." : "Dans les clous."}${+read().years > 25 ? " La durée dépasse 25 ans." : ""}</small>`
          : `<p class="meta">Indique tes revenus nets (ou importe tes relevés dans le Budget) pour calculer ton taux d'endettement et ce que tu peux emprunter.</p>`}</div>
      <p class="hint">${icon("lightbulb")} Simulation indicative : taux, frais de notaire et fiscalité varient (le régime réel ou le LMNP au réel avec amortissement réduisent souvent l'impôt). Vérifie avec ta banque, un courtier ou un notaire avant de signer.</p>`;
  };
  f.oninput = show;
  $("#pt-save").onclick = async () => {
    const name = $("#pt-pname").value.trim() || `Projet ${eur(+read().price)}`;
    await api("/api/patrimoine/projects", { json: { name, inputs: read() } });
    toast("Projet enregistré"); data = await api("/api/patrimoine"); projet(el, read());
  };
  $("#pt-load")?.addEventListener("change", e => { const p = data.projects.find(x => x.id === e.target.value); if (p) projet(el, p.inputs); });
  show();
}
