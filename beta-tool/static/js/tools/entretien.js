// Outil « Entretien » : voiture, chaudière, logement, jardin… entretiens réguliers, kilométrage, historique et factures.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null;
const ST = { late: ["En retard", "bad"], soon: ["Bientôt", "warn"], ok: ["À jour", "ok"], unknown: ["À renseigner", "off"] };
const dfr = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const eur = n => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export async function render(root) {
  root.innerHTML = pageHead("entretien", `<button class="btn" id="en-add">${icon("plus")}Ajouter</button>`) + `<div id="en-body"></div>`;
  $("#en-add").onclick = itemForm;
  await load();
}

async function load() { data = await api("/api/upkeep"); paint(); }

function when(s) {
  const parts = [];
  if (s.days != null) parts.push(s.days < 0 ? `en retard de ${-s.days} j` : s.days === 0 ? "aujourd'hui" : `le ${new Date(s.next_date + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`);
  if (s.km_left != null) parts.push(s.km_left < 0 ? `dépassé de ${(-s.km_left).toLocaleString("fr-FR")} km` : `dans ${s.km_left.toLocaleString("fr-FR")} km`);
  return parts.map(x => `<span>${x}</span>`).join(" · ") || "<span>date du dernier entretien inconnue</span>";
}

function paint() {
  const el = $("#en-body");
  if (!el) return;
  el.innerHTML = data.items.length ? data.items.map(it => `<div class="card en-item" data-i="${it.id}">
      <div class="pt-loan-h"><span class="tile bleu-vert">${icon(data.kinds[it.kind]?.icon || "tag")}</span><div class="grow"><b>${esc(it.name)}</b>
        <small class="meta">${esc(data.kinds[it.kind]?.name || "")}${it.details ? ` · ${esc(it.details)}` : ""}${it.km ? ` · ${it.km.toLocaleString("fr-FR")} km` : ""}</small></div>
        ${it.kind === "voiture" ? `<button class="btn ghost small" data-km>${icon("edit")}Kilométrage</button>` : ""}<button class="icon-btn plain" data-edit title="Modifier">${icon("settings")}</button></div>
      <div class="en-tasks">${it.tasks.map(t => `<button class="en-task" data-t="${t.id}"><span class="cx-st ${ST[t.state.status][1]}">${ST[t.state.status][0]}</span>
          <span class="grow bg-lbl"><b>${esc(t.name)}</b><small class="meta">${when(t.state)}${t.every_months ? ` · <span>tous les ${t.every_months} mois</span>` : ""}${t.every_km ? ` <span>/ ${t.every_km.toLocaleString("fr-FR")} km</span>` : ""}</small></span>
          <span class="btn ghost small" data-done>${icon("check")}Fait</span></button>`).join("") || `<p class="meta">Aucun entretien : ajoute-en un.</p>`}</div>
      <button class="btn ghost small" data-addtask>${icon("plus")}Entretien</button></div>`).join("")
    : `<div class="card empty">${icon("settings")}<b>Rien à entretenir pour l'instant</b>Ajoute ta voiture, ta chaudière ou ton logement : les entretiens habituels (vidange, contrôle technique, entretien annuel de la chaudière, ramonage…) sont proposés, avec un rappel avant chaque échéance.</div>`;
  el.onclick = e => {
    const box = e.target.closest("[data-i]");
    if (!box) return;
    const it = data.items.find(x => x.id === box.dataset.i);
    if (e.target.closest("[data-km]")) return kmForm(it);
    if (e.target.closest("[data-edit]")) return itemEdit(it);
    if (e.target.closest("[data-addtask]")) return taskForm(it, {});
    const tb = e.target.closest("[data-t]");
    if (!tb) return;
    const t = it.tasks.find(x => x.id === tb.dataset.t);
    if (e.target.closest("[data-done]")) return doneForm(it, t);
    taskForm(it, t);
  };
}

function itemForm() {
  const order = ["voiture", "chauffage", "logement", "jardin", "appareil", "autre"];
  const kinds = Object.entries(data.kinds).sort(([a], [b]) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const m = modal("Ajouter un équipement", `<form>
    <label class="field">Type</label><div class="en-kinds">${kinds.map(([k, v], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? "checked" : ""}><span>${icon(v.icon)}${esc(v.name)}</span></label>`).join("")}</div>
    <div class="grid2"><div><label class="field">Nom</label><input type="text" name="name" required placeholder="Ex. Clio, Chaudière Saunier Duval"></div>
      <div><label class="field">Détails</label><input type="text" name="details" placeholder="Ex. immatriculation, modèle"></div></div>
    <div id="en-km"><label class="field">Kilométrage actuel</label><input type="number" name="km"></div>
    <label class="field">Entretiens à suivre</label><div id="en-tpl" class="en-tpl"></div>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Ajouter</button></div></form>`, { ic: "settings" });
  const f = m.querySelector("form");
  const tpl = () => {
    const k = f.kind.value;
    $("#en-km").hidden = k !== "voiture";
    $("#en-tpl").innerHTML = (data.templates[k] || []).map(t => `<label class="check"><input type="checkbox" name="tpl" value="${esc(t.name)}" checked> ${esc(t.name)}
      <small class="meta">${t.every_months ? `tous les ${t.every_months} mois` : ""}${t.every_km ? ` / ${t.every_km.toLocaleString("fr-FR")} km` : ""}${t.note ? ` · ${esc(t.note)}` : ""}</small></label>`).join("") || `<p class="meta">Tu ajouteras les entretiens ensuite.</p>`;
  };
  f.onchange = e => { if (e.target.name === "kind") tpl(); };
  tpl();
  f.onsubmit = async e => {
    e.preventDefault();
    try {
      await api("/api/upkeep/items", { json: { kind: f.kind.value, name: f.name.value, details: f.details.value, km: f.km.value, templates: [...f.querySelectorAll("[name=tpl]:checked")].map(x => x.value) } });
      closePanel(); load();
    } catch (err) { toast(err.message, "err"); }
  };
}

function itemEdit(it) {
  const m = modal(it.name, `<form><label class="field">Nom</label><input type="text" name="name" value="${esc(it.name)}">
    <label class="field">Détails</label><input type="text" name="details" value="${esc(it.details || "")}">
    <div class="modal-foot"><button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "settings" });
  m.querySelector("form").onsubmit = async e => { e.preventDefault(); await api(`/api/upkeep/items/${it.id}`, { method: "PUT", json: { name: e.target.name.value, details: e.target.details.value } }); closePanel(); load(); };
  m.querySelector("[data-del]").onclick = async () => { if (confirm(`Supprimer « ${it.name} » et son historique ?`)) { await api(`/api/upkeep/items/${it.id}`, { method: "DELETE" }); closePanel(); load(); } };
}

function kmForm(it) {
  const m = modal(`Kilométrage · ${it.name}`, `<form><label class="field">Compteur aujourd'hui</label><input type="number" name="km" value="${it.km || ""}" required autofocus>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "car" });
  m.querySelector("form").onsubmit = async e => { e.preventDefault(); await api(`/api/upkeep/items/${it.id}`, { method: "PUT", json: { km: e.target.km.value } }); closePanel(); toast("Kilométrage enregistré"); load(); };
}

function taskForm(it, t) {
  const m = modal(t.id ? t.name : "Nouvel entretien", `<form>
    <label class="field">Entretien</label><input type="text" name="name" value="${esc(t.name || "")}" required>
    <div class="grid2"><div><label class="field">Tous les (mois)</label><input type="number" name="every_months" value="${t.every_months ?? ""}"></div>
      <div><label class="field">Tous les (km)</label><input type="number" name="every_km" value="${t.every_km ?? ""}"></div></div>
    ${!t.last_date ? `<label class="field">Prochaine échéance (si tu la connais)</label><input type="date" name="due_date" value="${esc(t.due_date || "")}">` : ""}
    <label class="field">Note</label><input type="text" name="note" value="${esc(t.note || "")}">
    ${t.history?.length ? `<label class="field">Historique</label><div class="en-hist">${t.history.map(h => `<div class="bg-row"><span class="grow bg-lbl"><b>${dfr(h.date)}</b><small class="meta">${[h.km && `${h.km.toLocaleString("fr-FR")} km`, h.by, h.note].filter(Boolean).map(esc).join(" · ")}</small></span>
      ${h.cost ? `<b>${eur(h.cost)}</b>` : ""}${h.paper ? `<a class="icon-btn plain" href="#/paperasse/doc/${esc(h.paper)}" title="Facture">${icon("receipt")}</a>` : ""}</div>`).join("")}
      <small class="meta">Total dépensé : ${eur(t.history.reduce((a, h) => a + (h.cost || 0), 0))}</small></div>` : ""}
    <div class="modal-foot">${t.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "settings" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(f)]);
    try { await api(t.id ? `/api/upkeep/items/${it.id}/tasks/${t.id}` : `/api/upkeep/items/${it.id}/tasks`, { method: t.id ? "PUT" : "POST", json: body }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => { await api(`/api/upkeep/items/${it.id}/tasks/${t.id}`, { method: "DELETE" }); closePanel(); load(); });
}

async function doneForm(it, t) {
  const papers = await api("/api/upkeep/papers").catch(() => []);
  const m = modal(`${t.name} · fait`, `<form>
    <div class="grid2"><div><label class="field">Date</label><input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      ${it.kind === "voiture" || t.every_km ? `<div><label class="field">Kilométrage</label><input type="number" name="km" value="${it.km || ""}"></div>` : `<div><label class="field">Prix (€)</label><input type="text" inputmode="decimal" name="cost"></div>`}</div>
    ${it.kind === "voiture" || t.every_km ? `<label class="field">Prix (€)</label><input type="text" inputmode="decimal" name="cost">` : ""}
    <label class="field">Fait par</label><input type="text" name="by" placeholder="Ex. Garage Martin, moi">
    <label class="field">Facture (Paperasse)</label><select name="paper" style="width:100%"><option value="">—</option>${papers.map(p => `<option value="${p.id}">${esc([p.date, p.issuer || p.title, p.amount != null && eur(p.amount)].filter(Boolean).join(" · "))}</option>`).join("")}</select>
    <label class="field">Note</label><input type="text" name="note">
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "check" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    await api(`/api/upkeep/items/${it.id}/tasks/${t.id}/done`, { json: Object.fromEntries([...new FormData(e.target)]) });
    closePanel(); toast("C'est noté : prochaine échéance recalculée"); load();
  };
}
