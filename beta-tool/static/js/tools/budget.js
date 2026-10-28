// Outil « Budget » : import des relevés, dépenses par catégorie, charges fixes et pistes d'économies.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, tab = "apercu", month = null, txFilter = { q: "", category: "" };
const euros = (n, dec = true) => (n ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: dec ? 2 : 0 });
const monthName = m => { const s = new Date(m + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
const shift = (m, n) => { const d = new Date(m + "-15"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const catOf = name => data.categories.find(c => c.name === name) || { icon: "file", color: "" };
const TABS = [["apercu", "Aperçu", "pie"], ["operations", "Opérations", "list"], ["economies", "Économies", "sparkles"], ["fixes", "Charges fixes", "refresh"], ["reglages", "Réglages", "settings"]];

export async function render(root, parts) {
  tab = TABS.some(t => t[0] === parts[0]) ? parts[0] : "apercu";
  root.innerHTML = pageHead("budget", `<button class="btn ghost" id="bg-add">${icon("plus")}Opération</button><button class="btn" id="bg-import">${icon("upload")}Importer un relevé</button>`)
    + `<div class="seg bg-tabs" id="bg-tabs">${TABS.map(([k, l, ic]) => `<label><input type="radio" name="bgt" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div><div id="bg-body"></div>`;
  $("#bg-import").onclick = importPanel;
  $("#bg-add").onclick = addPanel;
  $("#bg-tabs").onchange = e => { tab = e.target.value; history.replaceState(null, "", `#/budget/${tab}`); paint(); };
  await load();
}

async function load() {
  data = await api(`/api/budget${month ? `?month=${month}` : ""}`);
  month = data.month;
  paint();
}

function paint() {
  const el = $("#bg-body");
  if (!el) return;
  if (!data.count && tab !== "reglages") return el.innerHTML = emptyState();
  ({ apercu, operations, economies, fixes, reglages })[tab](el);
}

function emptyState() {
  return `<div class="card empty bg-empty">${icon("chart")}<b>Importe ton premier relevé</b>
    <p>Dans l'espace client de ta banque, télécharge tes opérations au format <b>CSV</b>, <b>OFX</b> ou <b>QIF</b> (souvent « Exporter » ou « Télécharger mes opérations »), puis dépose le fichier ici.
    Prends plusieurs mois (idéalement un an) : les charges fixes et les pistes d'économies seront bien plus justes.</p>
    <button class="btn" onclick="document.getElementById('bg-import').click()">${icon("upload")}Importer un relevé</button>
    <p class="hint">${icon("lock")} Tout reste sur ton NAS : Bêta Tool ne se connecte pas à ta banque et n'envoie rien à personne.</p></div>`;
}

// --- Aperçu -------------------------------------------------------------------------------------------

function apercu(el) {
  const s = data.summary, budgets = data.budgets;
  const totalBudget = Object.values(budgets).reduce((a, b) => a + b, 0);
  const rest = s.income - s.spent;
  const cats = Object.entries(s.by_cat);
  const maxCat = Math.max(1, ...cats.map(([c, v]) => Math.max(v, budgets[c] || 0)));
  const hist = data.history, maxH = Math.max(1, ...hist.map(h => Math.max(h.spent, h.income)));
  el.innerHTML = `<div class="bg-month"><button class="icon-btn plain" data-m="-1" title="Mois précédent">${icon("left")}</button><h2>${monthName(month)}</h2>
      <button class="icon-btn plain" data-m="1" title="Mois suivant">${icon("right")}</button></div>
    <div class="bg-kpis">
      <div class="card bg-kpi"><small class="meta">Rentrées</small><b>${euros(s.income)}</b></div>
      <div class="card bg-kpi"><small class="meta">Dépenses</small><b>${euros(s.spent)}</b>${totalBudget ? `<small class="meta">sur ${euros(totalBudget, false)} prévus</small>` : ""}</div>
      <div class="card bg-kpi ${rest < 0 ? "neg" : ""}"><small class="meta">Reste</small><b>${rest < 0 ? "" : "+"}${euros(rest)}</b></div>
      ${data.savings ? `<button class="card bg-kpi bg-kpi-save" data-goto="economies"><small class="meta">${icon("sparkles")}Économies possibles</small><b>≈ ${euros(data.savings, false)} / an</b><small class="meta">${data.suggestions.length} piste${data.suggestions.length > 1 ? "s" : ""} à regarder</small></button>` : ""}
    </div>
    <div class="bg-cols">
      <div class="card"><div class="card-title">${icon("pie")}Dépenses par catégorie</div>
        ${cats.length ? `<div class="bg-cats">${cats.map(([c, v]) => {
          const b = budgets[c], over = b && v > b;
          return `<button class="bg-cat" data-cat="${esc(c)}"><span class="tile ${catOf(c).color}">${icon(catOf(c).icon)}</span>
            <span class="grow"><span class="bg-cat-l"><b>${esc(c)}</b><span>${euros(v)}${b ? ` <small class="meta">/ ${euros(b, false)}</small>` : ""}</span></span>
              <span class="bg-bar"><i style="width:${(v / maxCat * 100).toFixed(1)}%" class="${over ? "over" : ""}"></i>${b ? `<em style="left:${(b / maxCat * 100).toFixed(1)}%" title="Budget"></em>` : ""}</span>
              ${over ? `<small class="bg-over">${icon("alert")}Budget dépassé de ${euros(v - b)}</small>` : ""}</span></button>`;
        }).join("")}</div>` : `<p class="meta">Aucune dépense ce mois-ci.</p>`}
        <p class="hint">Clique sur une catégorie pour voir ses opérations. Les budgets se règlent dans « Réglages ».</p></div>
      <div class="bg-side">
        <div class="card"><div class="card-title">${icon("chart")}Dépenses des 12 derniers mois</div>
          <div class="bg-hist" id="bg-hist">${hist.map(h => `<button class="bg-hcol ${h.month === month ? "on" : ""}" data-month="${h.month}" data-tip="${esc(monthName(h.month))} : ${esc(euros(h.spent, false))} dépensés, ${esc(euros(h.income, false))} de rentrées">
            <span class="bg-hbar"><i style="height:${(h.spent / maxH * 100).toFixed(1)}%"></i></span><small>${new Date(h.month + "-15").toLocaleDateString("fr-FR", { month: "narrow" })}</small></button>`).join("")}</div>
          <p class="meta bg-tip" id="bg-tip">Survole un mois pour le détail, clique pour l'ouvrir.</p></div>
        ${data.bills.length ? `<div class="card"><div class="card-title">${icon("receipt")}À payer bientôt <a class="jr-more" href="#/paperasse">Paperasse ${icon("right")}</a></div>
          <div class="jr-list">${data.bills.slice(0, 6).map(b => `<a class="jr-item ${b.due < new Date().toISOString().slice(0, 10) ? "late" : ""}" href="#/paperasse/doc/${b.id}"><span class="grow"><b>${esc(b.issuer || "Facture")}</b>
            <small class="meta">le ${new Date(b.due + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</small></span>${b.amount != null ? `<b>${euros(b.amount)}</b>` : ""}</a>`).join("")}</div></div>` : ""}
        <div class="card"><div class="card-title">${icon("refresh")}Charges fixes</div>
          <p class="jr-big"><b>${euros(data.fixed_monthly, false)}</b> par mois</p><small class="meta">${data.recurring.length} prélèvements réguliers repérés</small>
          <button class="btn ghost small wide" data-goto="fixes" style="margin-top:10px">Voir le détail</button></div>
      </div></div>`;
  el.onclick = e => {
    const b = e.target.closest("[data-m],[data-goto],[data-cat],[data-month]");
    if (!b) return;
    if (b.dataset.m) { month = shift(month, +b.dataset.m); return load(); }
    if (b.dataset.month) { month = b.dataset.month; return load(); }
    if (b.dataset.goto) return go(b.dataset.goto);
    if (b.dataset.cat) { txFilter = { q: "", category: b.dataset.cat }; go("operations"); }
  };
  const tip = $("#bg-tip");
  $("#bg-hist").onmouseover = e => { const c = e.target.closest("[data-tip]"); if (c) tip.textContent = c.dataset.tip; };
  $("#bg-hist").onfocusin = $("#bg-hist").onmouseover;
}

function go(t) {
  tab = t;
  document.querySelector(`#bg-tabs input[value="${t}"]`).checked = true;
  history.replaceState(null, "", `#/budget/${t}`);
  paint();
}

// --- Opérations ---------------------------------------------------------------------------------------

async function operations(el) {
  el.innerHTML = `<div class="bg-month"><button class="icon-btn plain" data-m="-1">${icon("left")}</button><h2>${monthName(month)}</h2><button class="icon-btn plain" data-m="1">${icon("right")}</button></div>
    <div class="bg-filters"><div class="ml-search grow">${icon("search")}<input type="search" id="bg-q" placeholder="Chercher (libellé, note)…" value="${esc(txFilter.q)}"></div>
      <select id="bg-fcat"><option value="">Toutes les catégories</option>${data.categories.map(c => `<option ${c.name === txFilter.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <label class="check"><input type="checkbox" id="bg-all" ${txFilter.all ? "checked" : ""}> Tous les mois</label></div>
    <div class="card bg-tx" id="bg-tx"><p class="meta"><span class="spinner"></span></p></div>`;
  el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { month = shift(month, +b.dataset.m); data.month = month; operations(el); });
  let timer;
  $("#bg-q").oninput = e => { clearTimeout(timer); timer = setTimeout(() => { txFilter.q = e.target.value; fillTx(); }, 250); };
  $("#bg-fcat").onchange = e => { txFilter.category = e.target.value; fillTx(); };
  $("#bg-all").onchange = e => { txFilter.all = e.target.checked; fillTx(); };
  fillTx();
}

async function fillTx() {
  const box = $("#bg-tx");
  if (!box) return;
  const p = new URLSearchParams({ q: txFilter.q, category: txFilter.category, ...(txFilter.all ? {} : { month }) });
  const r = await api(`/api/budget/tx?${p}`);
  let lastDay = "";
  box.innerHTML = r.tx.length ? `<div class="bg-txsum"><span class="grow">${r.count} opération${r.count > 1 ? "s" : ""}</span><b class="${r.total < 0 ? "" : "pos"}">${euros(r.total)}</b></div>`
    + r.tx.map(t => {
      const day = t.date !== lastDay ? `<p class="bg-day">${new Date(t.date + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(txFilter.all ? { year: "numeric" } : {}) })}</p>` : "";
      lastDay = t.date;
      return `${day}<div class="bg-row" data-t="${t.id}"><span class="tile ${catOf(t.category).color}">${icon(catOf(t.category).icon)}</span>
        <span class="grow bg-lbl"><b>${esc(t.label)}</b><small class="meta">${esc(t.category)}${t.note ? ` · ${esc(t.note)}` : ""}${data.accounts.length > 1 ? ` · ${esc(t.account_name)}` : ""}</small></span>
        <b class="bg-amt ${t.amount > 0 ? "pos" : ""}">${t.amount > 0 ? "+" : ""}${euros(t.amount)}</b></div>`;
    }).join("") : `<div class="empty">${icon("search")}<b>Aucune opération</b>Change le mois ou le filtre.</div>`;
  box.onclick = e => { const row = e.target.closest("[data-t]"); if (row) editTx(r.tx.find(t => t.id === row.dataset.t)); };
}

function editTx(t) {
  const m = modal(t.label, `<form>
    <p class="hint" style="margin-top:0">${new Date(t.date + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · <b>${euros(t.amount)}</b> · ${esc(t.account_name)}</p>
    <label class="field">Catégorie</label><select name="category" style="width:100%">${data.categories.map(c => `<option ${c.name === t.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <label class="check"><input type="checkbox" name="rule"> Toujours ranger les opérations contenant</label>
    <input type="text" name="match" value="${esc(t.label.replace(/^(CB|PRLV SEPA|PRLV|VIR SEPA|VIR|CARTE)\s+/i, "").replace(/\s+\d{2}\/\d{2}.*$/, "").slice(0, 40))}">
    <label class="field">Note</label><input type="text" name="note" value="${esc(t.note || "")}" placeholder="Ex. cadeau d'anniversaire de Paul">
    <div class="modal-foot"><button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "receipt" });
  const f = m.querySelector("form");
  f.match.oninput = () => { f.rule.checked = true; };
  f.onsubmit = async e => {
    e.preventDefault();
    const r = await api(`/api/budget/tx/${t.id}`, { method: "PUT", json: { category: f.category.value, note: f.note.value, rule: f.rule.checked, match: f.match.value } });
    closePanel();
    if (r.changed > 1) toast(`${r.changed} opérations rangées dans « ${f.category.value} »`);
    data = await api(`/api/budget?month=${month}`); fillTx();
  };
  m.querySelector("[data-del]").onclick = async () => {
    if (!confirm("Supprimer cette opération ?")) return;
    await api(`/api/budget/tx/${t.id}`, { method: "DELETE" }); closePanel(); data = await api(`/api/budget?month=${month}`); fillTx();
  };
}

// --- Économies ----------------------------------------------------------------------------------------

const KIND = { assurance: ["shield", "Assurance"], energie: ["flame", "Énergie"], telecom: ["wifi", "Box et forfait"], abonnements: ["play", "Abonnements"],
  banque: ["landmark", "Banque"], doublon: ["alert", "À vérifier"], hausse: ["chart", "Hausse de prix"], epargne: ["lock", "Épargne"] };

function economies(el) {
  const s = data.suggestions;
  el.innerHTML = `<div class="card bg-save-hero"><span class="tile vert">${icon("sparkles")}</span><div class="grow">
      <h2>${s.length ? `Jusqu'à ≈ ${euros(data.savings, false)} d'économies par an` : "Rien à signaler pour l'instant"}</h2>
      <p class="meta">${s.length ? "Pistes repérées dans tes opérations, de la plus utile à la moins utile. Les montants sont des estimations : à toi de comparer avant de changer." : "Importe plusieurs mois de relevés pour que je repère tes assurances, abonnements et frais."}</p></div></div>
    <div class="bg-sugg">${s.map(x => `<div class="card bg-sg ${x.level}">
      <div class="bg-sg-head"><span class="tile ${x.level === "warn" ? "rose" : x.level === "good" ? "vert" : "bleu"}">${icon(KIND[x.kind]?.[0] || "lightbulb")}</span>
        <div class="grow"><small class="meta">${esc(KIND[x.kind]?.[1] || "")}</small><b>${esc(x.title)}</b></div>
        ${x.saving ? `<span class="bg-gain">${x.level === "warn" ? "" : "≈ "}${euros(x.saving, false)}${x.kind === "doublon" || x.id === "bank-incidents" ? "" : " / an"}</span>` : ""}</div>
      <p>${esc(x.text)}</p>
      <div class="bg-sg-foot">${x.links.map(([l, u]) => `<a class="btn ghost small" href="${esc(u)}" target="_blank" rel="noopener">${icon("external")}${esc(l)}</a>`).join("")}
        <span class="grow"></span><button class="btn ghost small" data-dis="${esc(x.id)}" title="Ne plus afficher">${icon("check")}C'est noté</button></div></div>`).join("")}</div>
    <p class="hint">${icon("lock")} Calculé sur ton NAS à partir de tes relevés, rien n'est envoyé. Ce sont des pistes, pas un conseil financier : les prix moyens cités sont indicatifs.
      <a href="#" id="bg-undis">Réafficher les pistes masquées</a></p>`;
  el.onclick = async e => {
    const b = e.target.closest("[data-dis],#bg-undis");
    if (!b) return;
    if (b.id === "bg-undis") { e.preventDefault(); await api("/api/budget/suggestions/reset", { json: {} }); return load(); }
    await api(`/api/budget/suggestions/${encodeURIComponent(b.dataset.dis)}/dismiss`, { json: {} });
    b.closest(".bg-sg").remove();
    load();
  };
}

// --- Charges fixes ------------------------------------------------------------------------------------

function fixes(el) {
  const r = data.recurring;
  const by = {};
  r.forEach(x => (by[x.category] = by[x.category] || []).push(x));
  el.innerHTML = `<div class="bg-kpis"><div class="card bg-kpi"><small class="meta">Par mois</small><b>${euros(data.fixed_monthly)}</b></div>
      <div class="card bg-kpi"><small class="meta">Par an</small><b>${euros(data.fixed_monthly * 12, false)}</b></div>
      <div class="card bg-kpi"><small class="meta">Prélèvements réguliers</small><b>${r.length}</b></div></div>
    ${r.length ? Object.entries(by).map(([c, xs]) => `<div class="card bg-fix"><div class="card-title"><span class="tile ${catOf(c).color}">${icon(catOf(c).icon)}</span>${esc(c)}
        <span class="grow"></span><small class="meta">${euros(xs.reduce((a, x) => a + x.monthly, 0))} / mois</small></div>
      ${xs.map(x => `<div class="bg-row"><span class="grow bg-lbl"><b>${esc(x.name)}</b><small class="meta">${euros(x.amount)} par ${x.period} · ${x.count} fois depuis le ${new Date(x.first + "T12:00").toLocaleDateString("fr-FR")}${x.next ? ` · prochain vers le ${new Date(x.next + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}</small>
        ${x.increase_pct ? `<small class="bg-over">${icon("chart")}+${x.increase_pct} % depuis le début</small>` : ""}</span><b class="bg-amt">${euros(x.yearly, false)}<small class="meta"> / an</small></b></div>`).join("")}</div>`).join("")
    : `<div class="card empty">${icon("refresh")}<b>Pas encore de charges fixes repérées</b>Il faut au moins deux mois de relevés.</div>`}`;
}

// --- Réglages -----------------------------------------------------------------------------------------

function reglages(el) {
  el.innerHTML = `<div class="bg-cols"><form class="card" id="bg-budgets"><div class="card-title">${icon("pie")}Budget par mois</div>
      <p class="hint" style="margin-top:0">Fixe un plafond pour les catégories que tu veux surveiller : je te préviens dans « Ma journée » quand il est dépassé.</p>
      <div class="bg-bud">${data.categories.filter(c => !["Revenus", "Épargne", "Virements"].includes(c.name)).map(c => `<label><span class="tile ${c.color}">${icon(c.icon)}</span><span class="grow">${esc(c.name)}</span>
        <input type="text" inputmode="decimal" name="${esc(c.name)}" value="${data.budgets[c.name] ?? ""}" placeholder="—"> €</label>`).join("")}</div>
      <div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn">${icon("check")}Enregistrer</button></div></form>
    <div class="bg-side">
      <div class="card"><div class="card-title">${icon("tag")}Mes règles de rangement</div>
        ${data.rules.length ? data.rules.map((r, i) => `<div class="bg-row"><span class="grow">« ${esc(r.match)} » → <b>${esc(r.category)}</b></span><button class="icon-btn plain" data-rule="${i}" title="Supprimer">${icon("trash")}</button></div>`).join("")
          : `<p class="meta">Aucune. Quand tu changes la catégorie d'une opération, coche « Toujours ranger… ».</p>`}
        <button class="btn ghost small" id="bg-recat" style="margin-top:8px">${icon("refresh")}Re-ranger toutes les opérations</button></div>
      <div class="card"><div class="card-title">${icon("landmark")}Comptes</div>
        ${data.accounts.length ? data.accounts.map(a => `<div class="bg-row"><span class="grow"><b>${esc(a.name)}</b></span><button class="icon-btn plain" data-acc="${a.id}" title="Supprimer le compte et ses opérations">${icon("trash")}</button></div>`).join("") : `<p class="meta">Aucun compte : importe un relevé.</p>`}
        ${data.imports.length ? `<p class="meta" style="margin-top:8px">Derniers imports : ${data.imports.map(i => `${esc(i.file || i.account)} (+${i.added})`).join(", ")}</p>` : ""}</div></div></div>`;
  $("#bg-budgets").onsubmit = async e => {
    e.preventDefault();
    const vals = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v.trim()));
    await api("/api/budget/budgets", { method: "PUT", json: vals });
    toast("Budgets enregistrés"); load();
  };
  el.onclick = async e => {
    const b = e.target.closest("[data-rule],[data-acc],#bg-recat");
    if (!b) return;
    if (b.id === "bg-recat") { const r = await api("/api/budget/recategorize", { json: {} }); toast(`${r.n} opération${r.n > 1 ? "s" : ""} re-rangée${r.n > 1 ? "s" : ""}`); return load(); }
    if (b.dataset.rule) { await api(`/api/budget/rules/${b.dataset.rule}`, { method: "DELETE" }); return load(); }
    if (b.dataset.acc && confirm("Supprimer ce compte et toutes ses opérations ?")) { await api(`/api/budget/accounts/${b.dataset.acc}`, { method: "DELETE" }); load(); }
  };
}

// --- Import et ajout ----------------------------------------------------------------------------------

function importPanel() {
  const m = modal("Importer un relevé", `<form>
    <p class="hint" style="margin-top:0">Fichier <b>CSV</b>, <b>OFX</b> ou <b>QIF</b> exporté depuis l'espace client de ta banque. Les opérations déjà importées sont ignorées : tu peux réimporter sans risque de doublon.</p>
    <label class="field">Fichier</label><input type="file" name="file" accept=".csv,.ofx,.qfx,.qif,.txt" required>
    <label class="field">Compte</label><input type="text" name="account" list="bg-accs" placeholder="Ex. Compte joint, Livret A (vide : deviné)">
    <datalist id="bg-accs">${data.accounts.map(a => `<option value="${esc(a.name)}">`).join("")}</datalist>
    <p class="hint">${icon("lock")} Le fichier est lu sur ton NAS ; rien n'est envoyé ailleurs.</p>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("upload")}Importer</button></div></form>`, { ic: "upload" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector(".modal-foot .btn:last-child");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Lecture…`;
    try {
      const r = await api("/api/budget/import", { method: "POST", body: fd });
      closePanel();
      toast(`${r.added} opération${r.added > 1 ? "s" : ""} importée${r.added > 1 ? "s" : ""} dans « ${r.account} »${r.skipped ? ` (${r.skipped} déjà là)` : ""}${r.papers_paid.length ? ` · ${r.papers_paid.length} facture(s) de Paperasse marquée(s) payée(s)` : ""}`);
      month = null; load();
    } catch (err) { toast(err.message, "err"); btn.disabled = false; btn.innerHTML = `${icon("upload")}Importer`; }
  };
}

function addPanel() {
  const m = modal("Nouvelle opération", `<form>
    <div class="seg"><label><input type="radio" name="kind" value="out" checked>Dépense</label><label><input type="radio" name="kind" value="in">Rentrée</label></div>
    <label class="field">Libellé</label><input type="text" name="label" required placeholder="Ex. Marché, cadeau, remboursement de Paul">
    <div class="grid2"><div><label class="field">Montant (€)</label><input type="text" inputmode="decimal" name="amount" required></div>
      <div><label class="field">Date</label><input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
    <div class="grid2"><div><label class="field">Catégorie</label><select name="category" style="width:100%"><option value="">Devinée</option>${data.categories.map(c => `<option>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label class="field">Compte</label><input type="text" name="account" list="bg-accs2" value="Espèces"><datalist id="bg-accs2">${data.accounts.map(a => `<option value="${esc(a.name)}">`).join("")}</datalist></div></div>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Ajouter</button></div></form>`, { ic: "plus" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    try {
      await api("/api/budget/tx", { json: { kind: f.kind.value, label: f.label.value, amount: f.amount.value, date: f.date.value, category: f.category.value, account: f.account.value } });
      closePanel(); toast("Opération ajoutée"); load();
    } catch (err) { toast(err.message, "err"); }
  };
}
