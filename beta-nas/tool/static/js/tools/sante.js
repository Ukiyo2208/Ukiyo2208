// Outil « Santé » : fiches de la famille, vaccins, rendez-vous médicaux, ordonnances et remboursements.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, tab = "famille";
const TABS = [["famille", "Famille", "users"], ["rdv", "Rendez-vous", "calendar"], ["ordonnances", "Ordonnances", "receipt"], ["remboursements", "Remboursements", "chart"]];
const dfr = d => d ? new Date(d.length > 10 ? d : d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";
const eur = n => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export async function render(root, parts) {
  tab = TABS.some(t => t[0] === parts[0]) ? parts[0] : "famille";
  root.innerHTML = pageHead("sante") + `<div class="seg bg-tabs" id="sa-tabs">${TABS.map(([k, l, ic]) => `<label><input type="radio" name="sat" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div><div id="sa-body"></div>`;
  $("#sa-tabs").onchange = e => { tab = e.target.value; history.replaceState(null, "", `#/sante/${tab}`); paint(); };
  await load();
}
async function load(year) { data = await api(`/api/sante${year ? `?year=${year}` : ""}`); paint(); }
function paint() { const el = $("#sa-body"); if (el) ({ famille, rdv, ordonnances, remboursements })[tab](el); }

function famille(el) {
  el.innerHTML = `${data.due.length ? `<div class="card sa-due"><div class="card-title">${icon("bell")}Vaccins à prévoir</div>${data.due.map(x => `<div class="bg-row"><span class="grow bg-lbl"><b>${esc(x.name)}</b><small class="meta">${esc(x.member || "")}</small></span>
      <span class="cx-st ${x.days < 0 ? "bad" : "warn"}">${x.days < 0 ? "En retard" : `le ${dfr(x.date)}`}</span></div>`).join("")}</div>` : ""}
    <div class="ot-top"><button class="btn" id="sa-addm">${icon("plus")}Ajouter quelqu'un</button></div>
    <div class="pt-loans">${data.members.map(m => `<div class="card sa-member" data-m="${m.id}">
      <div class="pt-loan-h"><span class="avatar">${esc(m.name[0] || "?")}</span><div class="grow"><b>${esc(m.name)}</b><small class="meta">${m.age != null ? `<span>${m.age} ans</span>` : "date de naissance ?"}${m.blood ? ` · <span>groupe ${esc(m.blood)}</span>` : ""}</small></div>
        <button class="icon-btn plain" data-editm title="Modifier">${icon("edit")}</button></div>
      ${m.allergies ? `<div class="im-note">${icon("alert")}Allergies : ${esc(m.allergies)}</div>` : ""}
      ${m.treatments ? `<small class="meta">Traitement : ${esc(m.treatments)}</small>` : ""}${m.doctor ? `<small class="meta">Médecin traitant : ${esc(m.doctor)}</small>` : ""}
      <div class="sa-vax"><b>Vaccins</b>${m.vaccines.map(v => `<div class="bg-row"><span class="grow bg-lbl"><span>${esc(v.name)}</span><small class="meta">${v.date ? `<span>fait le ${dfr(v.date)}</span>` : ""}${v.next ? ` · <span>rappel le ${dfr(v.next)}</span>` : ""}</small></span>
          <button class="icon-btn plain" data-delv="${v.id}" title="Supprimer">${icon("trash")}</button></div>`).join("") || `<small class="meta">Aucun vaccin noté.</small>`}
        ${m.dtp ? `<small class="meta">${icon("clock")} Rappel DTP des ${m.dtp.age} ans prévu vers le ${dfr(m.dtp.date)}</small>` : ""}
        <button class="btn ghost small" data-addv>${icon("plus")}Vaccin</button></div></div>`).join("")}</div>
    <p class="hint">${icon("lock")} Ces informations sont privées : visibles seulement depuis ton compte.</p>`;
  $("#sa-addm").onclick = () => memberForm({});
  el.onclick = async e => {
    const card = e.target.closest("[data-m]");
    if (!card) return;
    const m = data.members.find(x => x.id === card.dataset.m);
    if (e.target.closest("[data-editm]")) return memberForm(m);
    if (e.target.closest("[data-addv]")) return vaccineForm(m);
    const dv = e.target.closest("[data-delv]");
    if (dv && confirm("Supprimer ce vaccin ?")) { await api(`/api/sante/vaccines/${dv.dataset.delv}`, { method: "DELETE" }); load(); }
  };
}

function memberForm(m) {
  const md = modal(m.id ? m.name : "Ajouter quelqu'un", `<form>
    <div class="grid2"><div><label class="field">Prénom</label><input type="text" name="name" value="${esc(m.name || "")}" required></div>
      <div><label class="field">Date de naissance</label><input type="date" name="birth" value="${esc(m.birth || "")}"></div></div>
    <div class="grid2"><div><label class="field">Groupe sanguin</label><select name="blood" style="width:100%">${data.blood.map(b => `<option ${b === (m.blood || "") ? "selected" : ""}>${b}</option>`).join("")}</select></div>
      <div><label class="field">Médecin traitant</label><input type="text" name="doctor" value="${esc(m.doctor || "")}"></div></div>
    <label class="field">Allergies</label><input type="text" name="allergies" value="${esc(m.allergies || "")}" placeholder="Ex. pénicilline, arachides">
    <label class="field">Traitements en cours</label><input type="text" name="treatments" value="${esc(m.treatments || "")}">
    <label class="field">Mutuelle</label><input type="text" name="mutuelle" value="${esc(m.mutuelle || "")}">
    <label class="field">Notes</label><textarea name="notes" rows="2">${esc(m.notes || "")}</textarea>
    <div class="modal-foot">${m.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "heart" });
  const f = md.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    try { await api(m.id ? `/api/sante/members/${m.id}` : "/api/sante/members", { method: m.id ? "PUT" : "POST", json: Object.fromEntries([...new FormData(f)]) }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  md.querySelector("[data-del]")?.addEventListener("click", async () => { if (confirm(`Supprimer la fiche de ${m.name} ?`)) { await api(`/api/sante/members/${m.id}`, { method: "DELETE" }); closePanel(); load(); } });
}

function vaccineForm(m) {
  const md = modal(`Vaccin · ${m.name}`, `<form>
    <label class="field">Vaccin</label><input type="text" name="name" list="sa-vnames" required><datalist id="sa-vnames">${data.vaccine_names.map(v => `<option value="${esc(v)}">`).join("")}</datalist>
    <div class="grid2"><div><label class="field">Fait le</label><input type="date" name="date"></div><div><label class="field">Prochain rappel</label><input type="date" name="next"></div></div>
    <label class="field">Note</label><input type="text" name="note" placeholder="Ex. lot, lieu">
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Ajouter</button></div></form>`, { ic: "heart" });
  md.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/sante/vaccines", { json: { ...Object.fromEntries([...new FormData(e.target)]), member: m.id } }); closePanel(); load(); } catch (err) { toast(err.message, "err"); }
  };
}

function rdv(el) {
  el.innerHTML = `<div class="ot-top"><button class="btn" id="sa-addr">${icon("plus")}Prendre rendez-vous</button><a class="btn ghost" href="https://www.doctolib.fr" target="_blank" rel="noopener">${icon("external")}Doctolib</a></div>
    ${data.appointments.length ? `<div class="card">${data.appointments.map(a => `<a class="bg-row" href="#/agenda?date=${a.start.slice(0, 10)}"><span class="tile rose tp-ic">${icon("calendar")}</span>
      <span class="grow bg-lbl"><b>${esc(a.title)}</b><small class="meta">${new Date(a.start).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(a.allday ? {} : { hour: "2-digit", minute: "2-digit" }) })}${a.location ? ` · ${esc(a.location)}` : ""}</small></span></a>`).join("")}</div>`
      : `<div class="card empty">${icon("calendar")}<b>Aucun rendez-vous médical à venir</b>Les rendez-vous de l'Agenda (dentiste, kiné, médecin…) apparaissent ici. Ceux pris sur Doctolib arrivent aussi si tu reçois le mail de confirmation dans Mails (bouton « Ajouter à l'agenda »).</div>`}`;
  $("#sa-addr").onclick = () => {
    const md = modal("Rendez-vous médical", `<form>
      <label class="field">Avec qui</label><input type="text" name="title" required placeholder="Ex. Dentiste Dr Martin (Léa)">
      <div class="grid2"><div><label class="field">Date et heure</label><input type="datetime-local" name="start" required></div><div><label class="field">Durée (min)</label><input type="number" name="minutes" value="30"></div></div>
      <label class="field">Lieu</label><input type="text" name="location">
      <label class="field">À apporter, questions…</label><textarea name="notes" rows="2" placeholder="Carte Vitale, ordonnance, radios"></textarea>
      <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Ajouter à l'agenda</button></div></form>`, { ic: "calendar" });
    md.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      try { await api("/api/sante/appointments", { json: Object.fromEntries([...new FormData(e.target)]) }); closePanel(); toast("Rendez-vous ajouté à l'agenda, avec un rappel 2 h avant"); load(); } catch (err) { toast(err.message, "err"); }
    };
  };
}

function ordonnances(el) {
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = data.prescriptions.length ? `<div class="card">${data.prescriptions.map(p => `<a class="bg-row" href="#/paperasse/doc/${p.id}"><span class="tile tp-ic">${icon("receipt")}</span>
      <span class="grow bg-lbl"><b>${esc(p.title || "Ordonnance")}</b><small class="meta">${esc(p.issuer || "")}${p.date ? ` · du ${dfr(p.date)}` : ""}</small></span>
      ${p.until ? `<span class="cx-st ${p.until >= today ? "ok" : "off"}">${p.until >= today ? `valable jusqu'au ${new Date(p.until + "T12:00").toLocaleDateString("fr-FR")}` : "expirée"}</span>` : ""}</a>`).join("")}</div>
      <p class="hint">Validité indicative de 3 mois pour la première délivrance en pharmacie ; certains médicaments ont des règles différentes.</p>`
    : `<div class="card empty">${icon("receipt")}<b>Aucune ordonnance</b>Scanne ou dépose tes ordonnances dans Paperasse : elles sont reconnues et listées ici, avec leur date de validité.</div>`;
}

function remboursements(el) {
  const mo = data.money;
  el.innerHTML = `<div class="ot-top"><select id="sa-year" style="width:auto">${[0, 1, 2].map(k => new Date().getFullYear() - k).map(y => `<option ${y === data.year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
    ${mo ? `<div class="bg-kpis"><div class="card bg-kpi"><small class="meta">Dépenses de santé</small><b>${eur(mo.spent)}</b></div>
        <div class="card bg-kpi"><small class="meta">Remboursé (Assurance maladie, mutuelle)</small><b class="pt-up">${eur(mo.refunded)}</b></div>
        <div class="card bg-kpi ${mo.rest > 0 ? "neg" : ""}"><small class="meta">Reste à charge</small><b>${eur(Math.max(0, mo.rest))}</b></div></div>
      <div class="card"><div class="card-title">${icon("list")}Derniers remboursements</div>${mo.refunds.map(r => `<div class="bg-row"><span class="grow bg-lbl"><b>${esc(r.label)}</b><small class="meta">${dfr(r.date)}</small></span><b class="pt-up">+${eur(r.amount)}</b></div>`).join("") || `<p class="meta">Aucun remboursement repéré dans tes relevés.</p>`}</div>`
      : `<div class="card empty">${icon("chart")}<b>Importe tes relevés dans le Budget</b>Les dépenses de santé et les remboursements de l'Assurance maladie et de ta mutuelle sont repérés tout seuls.</div>`}
    ${data.refund_docs.length ? `<div class="card"><div class="card-title">${icon("receipt")}Décomptes (Paperasse)</div>${data.refund_docs.map(d => `<a class="bg-row" href="#/paperasse/doc/${d.id}"><span class="grow bg-lbl"><b>${esc(d.issuer || d.title || "Décompte")}</b><small class="meta">${dfr(d.date)}</small></span>${d.amount != null ? `<b>${eur(d.amount)}</b>` : ""}</a>`).join("")}</div>` : ""}
    <p class="hint">Pour le détail de chaque remboursement : ameli.fr (Mon compte) et l'espace de ta mutuelle.</p>`;
  $("#sa-year").onchange = e => load(+e.target.value);
}
