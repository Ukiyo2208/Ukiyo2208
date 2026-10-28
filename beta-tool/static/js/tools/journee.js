// Outil « Ma journée » : le résumé du jour et les réglages de la notification du matin.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, enabled } from "../state.js";
import { pageHead } from "../main.js";

let day = null;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function render(root) {
  day = new Date();
  root.innerHTML = pageHead("journee", `<button class="btn ghost" id="jr-set">${icon("settings")}Réglages</button>`) + `<div id="jr-body"></div>`;
  $("#jr-set").onclick = settingsPanel;
  await paint();
}

async function paint() {
  const body = $("#jr-body");
  if (!body) return;
  body.innerHTML = `<p class="meta"><span class="spinner"></span>Je prépare ta journée…</p>`;
  const b = await api(`/api/journee?date=${iso(day)}`);
  const isToday = iso(day) === iso(new Date());
  const title = day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const w = b.weather;
  const list = (items, empty) => items?.length ? `<div class="jr-list">${items.map(x => `<a class="jr-item ${x.late ? "late" : ""}" ${x.link ? `href="${esc(x.link)}"` : ""}>
      ${x.time ? `<b class="jr-time">${esc(x.time)}</b>` : ""}<span class="grow"><b>${esc(x.text)}</b>${x.sub ? `<small class="meta">${esc(x.sub)}</small>` : ""}</span>${x.done !== undefined ? "" : ""}</a>`).join("")}</div>`
    : `<p class="meta jr-empty">${empty}</p>`;
  const card = (ic, name, inner, link, extra = "") => `<div class="card jr-card"><div class="card-title">${icon(ic)}${name}${extra}${link ? `<a class="jr-more" href="${link}">Ouvrir ${icon("right")}</a>` : ""}</div>${inner}</div>`;
  body.innerHTML = `
    <div class="jr-hero card">
      <div class="grow"><div class="jr-nav"><button class="icon-btn plain" data-d="-1" title="Veille">${icon("left")}</button>
          <h2>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h2><button class="icon-btn plain" data-d="1" title="Lendemain">${icon("right")}</button>
          ${isToday ? "" : `<button class="btn ghost small" data-d="0">Aujourd'hui</button>`}</div>
        ${b.fete ? `<p class="jr-fete">🌸 Bonne fête aux <b>${esc(b.fete)}</b></p>` : ""}
        <p class="jr-sum">${esc(b.summary)}</p></div>
      ${w ? `<div class="jr-weather"><span class="jr-wicon">${w.emoji}</span><div><b>${w.min}° / ${w.max}°</b><small>${esc(w.label)}${w.rain >= 20 ? ` · pluie ${w.rain} %` : ""}</small><small class="meta">${esc(w.city || "")}</small></div></div>`
        : `<button class="btn ghost small" id="jr-city">${icon("sun")}Ajouter la météo</button>`}
    </div>
    ${b.bins?.length ? `<div class="jr-bins">${icon("trash")}<span><b>Ce soir, sors :</b> ${b.bins.map(esc).join(", ")}</span></div>` : ""}
    ${b.birthdays?.length ? `<div class="jr-bins jr-bday">${icon("heart")}<span>${b.birthdays.map(esc).join(" · ")}</span></div>` : ""}
    <div class="jr-grid">
      ${enabled("agenda") ? card("calendar", "Rendez-vous", list(b.events, "Aucun rendez-vous."), `#/agenda?date=${iso(day)}`) : ""}
      ${b.tasks !== undefined ? card("check", "Tâches", list(b.tasks, "Rien à faire, profites-en !"), "#/taches") : ""}
      ${b.mail ? card("mail", "Mails", `<p class="jr-big"><b>${b.mail.unread}</b> non lu${b.mail.unread > 1 ? "s" : ""}</p>${b.mail.important.length ? `<small class="meta">De tes contacts :</small>${list(b.mail.important)}` : ""}`, "#/mails") : ""}
      ${b.stock?.length ? card("archive", "Inventaire", list(b.stock, ""), "#/inventaire") : ""}
      ${b.parcels !== undefined ? card("send", "Colis", list(b.parcels, "Aucun colis en route."), "#/colis") : ""}
      ${b.papers !== undefined ? card("receipt", "À payer cette semaine", list(b.papers, "Rien à payer cette semaine."), "#/paperasse") : ""}
      ${b.budget ? card("chart", "Budget du mois", `<p class="jr-big"><b>${esc(b.budget.spent)}</b> dépensés</p><small class="meta">${esc(b.budget.sub)}</small>`, "#/budget") : ""}
    </div>`;
  body.onclick = e => {
    const n = e.target.closest("[data-d]");
    if (n) { const d = +n.dataset.d; day = d ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + d) : new Date(); paint(); }
    if (e.target.closest("#jr-city")) settingsPanel();
  };
}

async function settingsPanel() {
  const { prefs: p } = await api(`/api/journee?date=${iso(new Date())}`);
  const m = modal("Ma journée : réglages", `<form>
    <label class="field">Ville (pour la météo)</label><input type="text" name="city" value="${esc((p.city || "").replace(/ \(.*\)$/, ""))}" placeholder="Ex. Lyon, Rennes, Marseille">
    <p class="hint">Prévisions Open-Meteo (gratuit, sans compte) : seule la position de la ville est envoyée.</p>
    <label class="check"><input type="checkbox" name="push" ${p.push ? "checked" : ""}> M'envoyer le résumé chaque matin</label>
    <label class="field">À</label><input type="time" name="time" value="${esc(p.time)}" style="width:auto">
    <p class="hint">Active les notifications sur ton téléphone (Réglages → Notifications) pour le recevoir même Bêta Tool fermé.</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-a="test">${icon("bell")}Essayer maintenant</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "sun" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/journee/prefs", { method: "PUT", json: { city: f.city.value, push: f.push.checked, time: f.time.value } }); closePanel(); toast("Enregistré"); paint(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-a=test]").onclick = async () => { await api("/api/journee/test", { json: {} }); toast("Résumé envoyé : regarde tes notifications"); };
}
