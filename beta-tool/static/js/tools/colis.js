// Outil « Colis » : colis repérés dans les mails, avancement, suivi chez le transporteur.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago, isAdmin } from "../state.js";
import { pageHead } from "../main.js";

const STEPS = [["prepare", "Préparation"], ["expedie", "Expédié"], ["transit", "En route"], ["tournee", "En livraison"], ["relais", "À retirer"], ["livre", "Livré"]];
let data = null, showOld = false;

export async function render(root) {
  root.innerHTML = pageHead("colis", `<button class="btn ghost" id="cl-parcel">${icon("phone")}Appli Parcel</button><button class="btn ghost" id="cl-scan">${icon("search")}Chercher dans mes mails</button>
    <button class="btn" id="cl-add">${icon("plus")}Ajouter</button>`) + `<div id="cl-body"></div>`;
  $("#cl-add").onclick = add;
  $("#cl-scan").onclick = scan;
  $("#cl-parcel").onclick = parcelPanel;
  await load();
}

async function load() {
  data = await api("/api/colis");
  paint();
}

function paint() {
  const el = $("#cl-body");
  if (!el) return;
  const active = data.parcels.filter(p => !p.archived), old = data.parcels.filter(p => p.archived);
  const card = p => {
    const idx = STEPS.findIndex(s => s[0] === p.status);
    const track = p.status === "relais" ? STEPS.filter(s => s[0] !== "tournee") : STEPS.filter(s => s[0] !== "relais");
    const pos = track.findIndex(s => s[0] === p.status);
    return `<div class="card cl-card ${p.status}">
      <div class="cl-head"><span class="tile ${p.status === "livre" ? "vert" : p.status === "incident" ? "rose" : "ambre"}">${icon(p.status === "livre" ? "check" : "send")}</span>
        <div class="grow"><b>${esc(p.label)}</b><small class="meta">${esc(p.carrier_name)} · <code>${esc(p.number)}</code></small></div>
        <span class="cl-status">${esc(p.status_label)}</span></div>
      ${p.expected && p.status !== "livre" ? `<p class="cl-expected">${icon("calendar")}Livraison prévue ${esc(expected(p))}</p>` : ""}
      ${p.status === "incident" || p.status === "inconnu" ? "" : `<div class="cl-track">${track.map((s, i) => `<span class="${i <= pos ? "on" : ""} ${i === pos ? "now" : ""}"><i></i><small>${s[1]}</small></span>`).join("")}</div>`}
      ${p.steps.length ? `<details class="cl-steps"><summary>Historique (${p.steps.length})</summary>${p.steps.slice().reverse().map(s => `<p><small class="meta">${ago(s.at)}</small> ${esc(s.text)}</p>`).join("")}</details>` : ""}
      <div class="cl-actions"><a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">${icon("external")}Suivre chez ${esc(p.carrier_name)}</a>
        ${p.link ? `<a class="btn ghost small" href="${esc(p.link)}">${icon("mail")}Le mail</a>` : ""}
        ${p.parcel ? `<span class="chip" title="Suivi aussi dans l'appli Parcel">Parcel</span>` : ""}
        <span class="grow"></span>
        <button class="icon-btn plain" data-edit="${p.id}" title="Modifier">${icon("edit")}</button>
        ${p.archived ? `<button class="icon-btn plain" data-del="${p.id}" title="Supprimer">${icon("trash")}</button>` : `<button class="icon-btn plain" data-arch="${p.id}" title="Ranger dans l'historique">${icon("archive")}</button>`}</div></div>`;
  };
  el.innerHTML = `${active.length ? `<div class="cl-grid">${active.map(card).join("")}</div>`
      : `<div class="card empty">${icon("send")}<b>Aucun colis en route</b>Quand un mail parle d'un colis (commande expédiée, numéro de suivi), il apparaît ici tout seul. Tu peux aussi « Chercher dans mes mails » ou ajouter un numéro.</div>`}
    ${old.length ? `<button class="btn ghost small" id="cl-old">${icon("archive")}${showOld ? "Masquer" : "Voir"} l'historique (${old.length})</button>${showOld ? `<div class="cl-grid" style="margin-top:12px">${old.map(card).join("")}</div>` : ""}` : ""}
    <p class="hint">${icon("lock")} Seuls tes mails servent au suivi : rien n'est demandé aux transporteurs${data.laposte ? ", sauf La Poste / Colissimo / Chronopost (clé d'API configurée)" : ""}${data.parcel.on ? ". Suivi aussi par ton appli Parcel" : ""}.
      ${isAdmin() && !data.laposte ? `<a href="#" id="cl-key">Ajouter une clé La Poste</a> pour un suivi en direct des Colissimo.` : ""}</p>`;
  el.onclick = async e => {
    const b = e.target.closest("[data-edit],[data-arch],[data-del],#cl-old,#cl-key");
    if (!b) return;
    if (b.id === "cl-old") { showOld = !showOld; return paint(); }
    if (b.id === "cl-key") { e.preventDefault(); return keyPanel(); }
    if (b.dataset.arch) { await api(`/api/colis/${b.dataset.arch}`, { method: "PUT", json: { archived: true } }); return load(); }
    if (b.dataset.del && confirm("Supprimer ce colis ?")) { await api(`/api/colis/${b.dataset.del}`, { method: "DELETE" }); return load(); }
    if (b.dataset.edit) edit(data.parcels.find(p => p.id === b.dataset.edit));
  };
}

function add() {
  const m = modal("Suivre un colis", `<form>
    <label class="field">Numéro de suivi</label><input type="text" name="number" required placeholder="Ex. 6A12345678901" autocomplete="off">
    <div class="grid2"><div><label class="field">Transporteur</label><select name="carrier" style="width:100%"><option value="">Deviner</option>
      ${Object.entries(data.carriers).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <div><label class="field">Nom</label><input type="text" name="label" placeholder="Ex. Chaussures, cadeau de Léa"></div></div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Suivre</button></div></form>`, { ic: "send" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try { await api("/api/colis", { json: { number: f.number.value, carrier: f.carrier.value, label: f.label.value || "Colis" } }); closePanel(); load(); }
    catch (err) { toast(err.message, "err"); }
  };
}

function edit(p) {
  const m = modal(p.label, `<form>
    <label class="field">Nom</label><input type="text" name="label" value="${esc(p.label)}">
    <div class="grid2"><div><label class="field">Transporteur</label><select name="carrier" style="width:100%">${Object.entries(data.carriers).map(([k, v]) => `<option value="${k}" ${k === p.carrier ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div><label class="field">État</label><select name="status" style="width:100%">${[...STEPS, ["incident", "Incident"]].map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "send" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await api(`/api/colis/${p.id}`, { method: "PUT", json: { label: f.label.value, carrier: f.carrier.value, ...(f.status.value !== p.status ? { status: f.status.value } : {}) } });
    closePanel(); load();
  };
}

async function scan() {
  const b = $("#cl-scan");
  b.disabled = true; b.innerHTML = `<span class="spinner"></span>Recherche…`;
  try { const r = await api("/api/colis/scan", { json: {} }); toast(r.found ? `${r.found} mention${r.found > 1 ? "s" : ""} de colis trouvée${r.found > 1 ? "s" : ""}` : "Aucun colis trouvé dans les mails des 60 derniers jours"); await load(); }
  catch (err) { toast(err.message, "err"); }
  b.disabled = false; b.innerHTML = `${icon("search")}Chercher dans mes mails`;
}

function expected(p) {
  const d = new Date(p.expected.length > 10 ? p.expected.replace(" ", "T") : p.expected + "T12:00");
  if (isNaN(d)) return p.expected;
  const day = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const hasTime = p.expected.length > 10 && !/[ T]00:00(:00)?$/.test(p.expected);
  const end = p.expected_end && p.expected_end.length > 10 ? new Date(p.expected_end.replace(" ", "T")) : null;
  return `le ${day}${hasTime ? ` entre ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${end && !isNaN(end) ? ` et ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}` : ""}`;
}

function parcelPanel() {
  const pc = data.parcel;
  const m = modal("Appli Parcel", `<form>
    <p class="hint" style="margin-top:0">Relie Bêta Tool à l'appli <b>Parcel</b> (iPhone, iPad, Mac) : les colis repérés dans tes mails y sont ajoutés tout seuls,
      et le suivi de Parcel (tous les transporteurs, y compris tes commandes Amazon reliées dans Parcel) revient ici et dans « Ma journée ».</p>
    ${pc.on ? `<p class="${pc.error ? "pill-warn" : "pill-ok"}" style="display:inline-flex;gap:6px;align-items:center">${icon(pc.error ? "alert" : "check")}${pc.error ? esc(pc.error)
      : `Relié${pc.last ? ` · synchronisé ${new Date(pc.last * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}${pc.count != null ? ` · ${pc.count} colis dans Parcel` : ""}`}</p>
      <label class="check"><input type="checkbox" name="push" ${pc.push ? "checked" : ""}> Ajouter à Parcel les colis trouvés dans mes mails</label>`
    : `<ol class="tuto"><li><b>Parcel Premium</b><span>L'API demande l'abonnement Premium de l'appli Parcel.</span></li>
        <li><b>Crée une clé</b><span>Sur <a href="https://web.parcelapp.net" target="_blank" rel="noopener">web.parcelapp.net</a> › API › « Create a Key » (ou sur Mac : Réglages › Intégrations).</span></li>
        <li><b>Colle-la ici</b><span>Elle est gardée chiffrée sur le NAS, pour ton compte seulement.</span></li></ol>
      <label class="field">Clé d'API Parcel</label><input type="password" name="key" autocomplete="new-password" required>`}
    <p class="hint">Parcel limite son API à 20 requêtes par heure : la synchro se fait toutes les 30 minutes. Colissimo et Chronopost restent aussi suivis par La Poste si la clé est configurée.</p>
    <div class="modal-foot">${pc.on ? `<button type="button" class="btn ghost danger" data-off>${icon("x")}Délier</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-sync>${icon("refresh")}Synchroniser</button>` : `<span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button>`}
      <button class="btn">${icon("check")}${pc.on ? "Enregistrer" : "Relier"}</button></div></form>`, { ic: "phone" });
  const f = m.querySelector("form");
  const done = r => toast(`Parcel : ${r.added || 0} colis ajouté(s) ici, ${r.updated || 0} mis à jour, ${r.pushed || 0} envoyé(s) à Parcel`);
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector(".modal-foot .btn:last-child");
    b.disabled = true;
    try {
      if (pc.on) await api("/api/colis/parcel", { method: "PUT", json: { push: f.push.checked } });
      else done(await api("/api/colis/parcel", { method: "PUT", json: { key: f.key.value } }));
      closePanel(); load();
    } catch (err) { toast(err.message, "err"); b.disabled = false; }
  };
  m.querySelector("[data-sync]")?.addEventListener("click", async () => {
    try { done(await api("/api/colis/parcel/sync", { json: {} })); closePanel(); load(); } catch (err) { toast(err.message, "err"); }
  });
  m.querySelector("[data-off]")?.addEventListener("click", async () => {
    if (!confirm("Délier l'appli Parcel ? Les colis déjà suivis restent ici.")) return;
    await api("/api/colis/parcel", { method: "PUT", json: { key: "" } }); closePanel(); load();
  });
}

function keyPanel() {
  const m = modal("Suivi La Poste en direct", `<form><ol class="tuto">
      <li><b>Crée un compte gratuit</b><span>Sur <a href="https://developer.laposte.fr" target="_blank" rel="noopener">developer.laposte.fr</a>, puis « Mes applications » → nouvelle application.</span></li>
      <li><b>Abonne-la à l'API « Suivi v2 »</b><span>Gratuite jusqu'à 1 000 suivis par jour, largement assez pour une famille.</span></li>
      <li><b>Copie la clé (X-Okapi-Key)</b><span>Colle-la ci-dessous.</span></li></ol>
    <label class="field">Clé d'API La Poste</label><input type="password" name="key" autocomplete="new-password">
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "key" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    await api("/api/colis/config", { method: "PUT", json: { laposte_key: e.target.key.value } });
    closePanel(); toast("Clé enregistrée"); load();
  };
}
