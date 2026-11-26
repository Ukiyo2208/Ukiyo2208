// Outil « Paperasse » : classement automatique des papiers, recherche, échéances.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let timer = null, cats = [], filters = { category: "", year: "", q: "" };
const fmtDate = d => d ? new Date(d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
const money = v => v == null ? "" : v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const catOf = name => cats.find(c => c[0] === name) || ["Autres", "file", ""];
const daysLeft = d => Math.round((new Date(d + "T12:00") - new Date(new Date().toDateString() + " 12:00")) / 86400000);

export async function render(root, parts) {
  const tab = ["docs", "echeances", "doc", "nas"].includes(parts[0]) ? parts[0] : "inbox";
  const [d, nasEtat] = await Promise.all([api("/api/papers?status=inbox"), api("/api/explorateur").catch(() => null)]);
  cats = d.categories;
  root.innerHTML = pageHead("paperasse", `<a class="btn ghost" href="#/scanner?dest=paperasse">${icon("scan")}Scanner</a>
      <label class="btn"><input type="file" id="pp-files" multiple accept=".pdf,image/*" hidden>${icon("upload")}Ajouter</label>`) + `
    <div id="pp-processing"></div>
    <nav class="tabs"><a href="#/paperasse" class="${tab === "inbox" ? "on" : ""}">${icon("inbox")}À valider ${d.counts.inbox ? `<span class="count">${d.counts.inbox}</span>` : ""}</a>
      <a href="#/paperasse/docs" class="${tab === "docs" || tab === "doc" ? "on" : ""}">${icon("folder")}Documents</a>
      <a href="#/paperasse/echeances" class="${tab === "echeances" ? "on" : ""}">${icon("calendar")}Échéances</a>
      ${nasEtat ? `<a href="#/paperasse/nas" class="${tab === "nas" ? "on" : ""}">${icon("search")}Sur le NAS ${nasEtat.total ? `<span class="count nas-count">${nasEtat.total}</span>` : ""}</a>` : ""}</nav>
    <div id="pp-body"></div>`;
  $("#pp-files").onchange = e => upload([...e.target.files]);
  const zone = root;
  zone.ondragover = e => { e.preventDefault(); };
  zone.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); };
  processing(d.processing, root, parts);
  if (tab === "inbox") inbox($("#pp-body"), d, root, parts);
  if (tab === "docs") docs($("#pp-body"), d);
  if (tab === "doc") { docs($("#pp-body"), d); detail(parts[1]); }
  if (tab === "echeances") deadlines($("#pp-body"));
  if (tab === "nas") nas($("#pp-body"), nasEtat, root, parts);
}

// --- Sur le NAS : les papiers trouvés dans les dossiers du NAS, à ranger dans le bon outil ----------------
let nasTimer = null;
const quand = t => t ? new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais";
function nas(el, e, root, parts) {
  if (!e) { el.innerHTML = `<div class="card"><div class="empty">${icon("lock")}<b>Réservé aux administrateurs</b></div></div>`; return; }
  const enCours = e.en_cours.en_cours;
  const props = e.propositions;
  const ligne = p => {
    const [, ic, tile] = catOf(p.categorie);
    const details = [p.type, p.emetteur, p.date ? fmtDate(p.date) : "", p.montant != null ? money(p.montant) : "", p.operations ? `${p.operations} opérations` : ""].filter(Boolean).join(" · ");
    return `<div class="card nas-row" data-id="${p.id}">
      <input type="checkbox" class="nas-sel" aria-label="Choisir">
      <a class="nas-thumb" href="/api/explorateur/${p.id}/fichier" target="_blank" title="Ouvrir">${p.outil === "budget" ? `<span class="tile vert">${icon("chart")}</span>`
        : `<span class="tile ${tile}" style="position:absolute">${icon(ic)}</span><img src="/api/explorateur/${p.id}/miniature" alt="" loading="lazy" style="position:relative" onerror="this.remove()">`}</a>
      <div class="nas-txt"><b>${esc(p.titre || p.nom)}</b><small class="meta">${esc(details)}</small>
        <small class="meta nas-chemin" title="${esc(p.affiche)}">${icon("folder")} ${esc(p.affiche)}</small></div>
      <div class="nas-dest">${p.outil === "budget" ? `<span class="badge">→ Budget · ${esc(p.compte || "")}</span>`
        : `<label class="meta">→ Paperasse ${catSelect(p.categorie, "categorie")}</label>`}
        <span class="pp-conf ${p.confiance}" title="Reconnu par ${esc(p.reconnu_par || "mots-clés")}">${p.confiance === "haute" ? "✓" : p.confiance === "moyenne" ? "~" : "?"}</span></div>
      <div class="nas-btns"><button class="btn ghost small" data-a="ignorer">Ignorer</button><button class="btn small" data-a="ajouter">${icon("check")}Ajouter</button></div></div>`;
  };
  el.innerHTML = `<div class="card nas-tete">
      <div class="txt"><b>Les papiers rangés n'importe où sur le NAS</b>
        <small class="meta">Factures, impôts, fiches de paie, santé, banque… trouvés dans ${esc(e.racines.join(", ") || "aucun dossier")}.
        Rien ne bouge sans toi : « Ajouter » les range dans Paperasse (ou le Budget pour les relevés CSV/OFX).</small>
        <small class="meta">Dernière analyse : ${esc(quand(e.dernier?.fin))}${e.dernier ? ` · ${e.dernier.fichiers} fichiers regardés` : ""} · ${e.analyses} documents déjà lus
          ${e.ia ? " · IA locale pour les cas difficiles" : ""}</small>
        ${enCours ? `<small class="meta"><span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></span>
          Analyse en cours : ${e.en_cours.fichiers} fichiers · ${esc(e.en_cours.dossier || "")}</small>` : ""}</div>
      <button class="btn" id="nas-go" ${enCours ? "disabled" : ""}>${icon("search")}Analyser maintenant</button></div>
    <div class="card set-row nas-reglages"><span class="tile">${icon("settings")}</span>
      <div class="txt"><b>Quand j'ajoute un papier</b><small>Déplacé dans Paperasse (rangé et renommé), ou copié en laissant l'original à sa place.</small></div>
      <select id="nas-dep"><option value="1" ${e.settings.deplacer ? "selected" : ""}>Le déplacer</option><option value="0" ${!e.settings.deplacer ? "selected" : ""}>Le copier</option></select>
      <label class="meta" style="display:flex;gap:6px;align-items:center">Chaque nuit à <input type="time" id="nas-heure" value="${esc(e.settings.heure)}"></label>
      <label class="switch" title="Analyse automatique chaque nuit"><input type="checkbox" id="nas-actif" ${e.settings.actif ? "checked" : ""}><span></span></label></div>
    ${props.length ? `<div class="pp-bar"><label class="meta" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nas-tout"> Tout choisir</label>
        <span class="grow"></span><button class="btn ghost small" id="nas-ign">Ignorer la sélection</button>
        <button class="btn small" id="nas-add">${icon("check")}Ajouter la sélection</button>
        <button class="btn small" id="nas-all">${icon("sparkles")}Tout ajouter (${e.total})</button></div>
      ${props.map(ligne).join("")}${e.total > props.length ? `<p class="hint">Et ${e.total - props.length} autres : ajoute ou ignore ceux-ci pour voir la suite.</p>` : ""}`
    : `<div class="card"><div class="empty">${icon("check")}<b>Rien à ranger pour l'instant</b>${enCours ? "L'analyse est en cours…" : "Lance une analyse, ou attends celle de la nuit."}</div></div>`}`;

  const recharger = () => render(root, parts);
  const envoyer = async (action, ids) => {
    if (!ids.length) return toast("Choisis au moins un document", "err");
    const categories = {};
    ids.forEach(id => { const s = el.querySelector(`.nas-row[data-id="${id}"] select`); if (s) categories[id] = s.value; });
    try {
      const r = await api(`/api/explorateur/${action}`, { json: { ids, categories } });
      if (action === "accepter") toast(`${r.faits} document${r.faits > 1 ? "s" : ""} ajouté${r.faits > 1 ? "s" : ""}${r.erreurs.length ? ` · ${r.erreurs[0]}` : ""}`, r.erreurs.length ? "err" : "ok");
      else toast(`${r.ignores} ignoré${r.ignores > 1 ? "s" : ""} : ils ne seront plus proposés`);
    } catch (err) { toast(err.message, "err"); }
    recharger();
  };
  const choisis = () => [...el.querySelectorAll(".nas-sel:checked")].map(c => c.closest(".nas-row").dataset.id);
  el.querySelector("#nas-go").onclick = async () => {
    try { await api("/api/explorateur/analyser", { json: {} }); toast("Analyse lancée : les papiers trouvés apparaissent ici"); setTimeout(recharger, 1500); }
    catch (err) { toast(err.message, "err"); }
  };
  el.querySelector("#nas-tout")?.addEventListener("change", ev => el.querySelectorAll(".nas-sel").forEach(c => { c.checked = ev.target.checked; }));
  el.querySelector("#nas-add")?.addEventListener("click", () => envoyer("accepter", choisis()));
  el.querySelector("#nas-ign")?.addEventListener("click", () => envoyer("ignorer", choisis()));
  el.querySelector("#nas-all")?.addEventListener("click", () => {
    if (confirm(`Ajouter les ${props.length} documents affichés à Paperasse et au Budget ?`)) envoyer("accepter", props.map(p => p.id));
  });
  el.querySelectorAll(".nas-row [data-a]").forEach(b => b.onclick = () => envoyer(b.dataset.a === "ajouter" ? "accepter" : "ignorer", [b.closest(".nas-row").dataset.id]));
  const reglage = async patch => { try { await api("/api/explorateur/reglages", { method: "PUT", json: patch }); toast("Enregistré"); } catch (err) { toast(err.message, "err"); } };
  el.querySelector("#nas-dep").onchange = ev => reglage({ deplacer: ev.target.value === "1" });
  el.querySelector("#nas-heure").onchange = ev => reglage({ heure: ev.target.value });
  el.querySelector("#nas-actif").onchange = ev => reglage({ actif: ev.target.checked });
  clearTimeout(nasTimer);
  if (enCours) nasTimer = setTimeout(() => { if (location.hash.startsWith("#/paperasse/nas")) recharger(); }, 4000);
}

async function upload(files) {
  const fd = new FormData();
  files.forEach(f => fd.append("files", f));
  try {
    const r = await api("/api/papers/upload", { method: "POST", body: fd });
    toast(`${r.jobs.length} document${r.jobs.length > 1 ? "s" : ""} en cours de lecture…`);
    location.hash = "#/paperasse";
    poll();
  } catch (err) { toast(err.message, "err"); }
}

function processing(list, root, parts) {
  const el = $("#pp-processing");
  if (!el) return;
  el.innerHTML = list.length ? `<div class="card pp-proc">${list.map(p => `<div class="pp-proc-row">
      ${p.done ? icon(p.error ? "alert" : "check") : `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>`}
      <b>${esc(p.name)}</b><span class="meta">${esc(p.error || p.step)}</span></div>`).join("")}</div>` : "";
  clearInterval(timer);
  if (list.some(p => !p.done)) timer = setInterval(async () => {
    if (!$("#pp-processing")) return clearInterval(timer);
    const d = await api("/api/papers?status=inbox").catch(() => null);
    if (!d) return;
    if (d.processing.every(p => p.done) || d.counts.inbox !== +($(".tabs .count")?.textContent || 0)) { clearInterval(timer); render(root, parts); }
    else processing(d.processing, root, parts);
  }, 2000);
}
function poll() { setTimeout(() => { if ($("#pp-body")) window.dispatchEvent(new HashChangeEvent("hashchange")); }, 400); }

const catSelect = (sel, name = "category") => `<select name="${name}">${cats.map(([c]) => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;

function inbox(el, d, root, parts) {
  const docs = d.docs;
  el.innerHTML = docs.length ? `<div class="pp-bar"><p class="hint" style="margin:0">Vérifie ce que Bêta Tool a reconnu, corrige si besoin, puis clique « Classer ».</p>
      <button class="btn ghost small" id="pp-all">${icon("check")}Tout classer tel quel</button></div>
    ${docs.map(doc => inboxCard(doc)).join("")}${autoSwitch(d)}`
    : `<div class="card"><div class="empty">${icon("receipt")}<b>Rien à valider</b>Ajoute une facture, une fiche de paie, un avis d'impôt…
        en PDF ou en photo : Bêta Tool la lit, la reconnaît, la renomme et la range pour toi.
        <span class="hint">Astuce : tout ce qui arrive dans le dossier <b>${esc(d.watch)}</b> du NAS (scanner réseau, appli du téléphone…) est traité automatiquement.</span></div></div>${autoSwitch(d)}`;
  el.querySelector("[data-auto]").onchange = async e => {
    await api("/api/papers/settings", { method: "PUT", json: { auto: e.target.checked } });
    toast(e.target.checked ? "Classement automatique activé" : "Chaque document sera à valider");
  };
  el.querySelector("#pp-all")?.addEventListener("click", async () => {
    const r = await api("/api/papers/approve-all", { json: {} });
    toast(`${r.filed} document${r.filed > 1 ? "s" : ""} classé${r.filed > 1 ? "s" : ""}`);
    render(root, parts);
  });
  el.querySelectorAll(".pp-inbox").forEach(card => {
    const f = card.querySelector("form");
    const id = card.dataset.id;
    const nameInput = f.elements.name;
    let touched = false;
    nameInput.addEventListener("input", () => { touched = true; });
    const refreshName = () => {
      if (!touched) {
        const date = f.elements.date.value || new Date().toISOString().slice(0, 10);
        const label = [f.elements.issuer.value.trim(), f.elements.type.value.trim()].filter(Boolean).join(" - ") || "Document";
        nameInput.value = `${date} ${label}`.replace(/[\\/:*?"<>|]+/g, " ") + ".pdf";
      }
      card.querySelector(".pp-dest").textContent = `Paperasse / ${f.elements.category.value} / ${(f.elements.date.value || String(new Date().getFullYear())).slice(0, 4)} /`;
    };
    f.addEventListener("input", e => { if (e.target !== nameInput) refreshName(); });
    f.addEventListener("change", e => { if (e.target !== nameInput) refreshName(); });
    refreshName();
    f.onsubmit = async e => {
      e.preventDefault();
      try {
        const doc = await api(`/api/papers/${id}`, { method: "PUT", json: { ...Object.fromEntries(new FormData(f)), file: true } });
        toast(`Classé dans ${doc.folder}`);
        card.remove();
        if (!el.querySelector(".pp-inbox")) render(root, parts);
        else { const c = $(".tabs .count"); if (c) c.textContent = +c.textContent - 1; }
      } catch (err) { toast(err.message, "err"); }
    };
    card.querySelector("[data-a=del]").onclick = async () => {
      await api(`/api/papers/${id}`, { method: "DELETE" });
      toast("Document supprimé (dans la corbeille de Documents)");
      card.remove();
    };
  });
}

const autoSwitch = d => `<div class="card set-row" style="margin-top:16px"><span class="tile">${icon("sparkles")}</span>
  <div class="txt"><b>Classer automatiquement</b><small>Quand la reconnaissance est sûre, le document est rangé directement, sans passer par « À valider ».</small></div>
  <label class="switch"><input type="checkbox" data-auto ${d.settings.auto ? "checked" : ""}><span></span></label></div>`;

function inboxCard(doc) {
  const [, ic, tile] = catOf(doc.category);
  return `<div class="card pp-inbox" data-id="${doc.id}">
    <a class="pp-thumb" href="/api/papers/${doc.id}/pdf" target="_blank" title="Ouvrir le PDF"><img src="/api/papers/${doc.id}/thumb" alt="" loading="lazy">
      ${doc.pages > 1 ? `<span class="sb-dur">${doc.pages} pages</span>` : ""}</a>
    <form>
      <div class="pp-guess"><span class="tile ${tile}">${icon(ic)}</span><div><b>${esc(doc.title)}</b>
        <small class="meta">${esc(doc.original)} · reconnaissance ${doc.confidence === "haute" ? "sûre" : doc.confidence === "moyenne" ? "probable" : "incertaine"}</small></div>
        <span class="pp-conf ${doc.confidence}">${doc.confidence === "haute" ? "✓" : doc.confidence === "moyenne" ? "~" : "?"}</span></div>
      <div class="pp-fields">
        <label>Catégorie ${catSelect(doc.category)}</label>
        <label>Type <input type="text" name="type" value="${esc(doc.type || "")}"></label>
        <label>Émetteur <input type="text" name="issuer" value="${esc(doc.issuer || "")}" placeholder="EDF, employeur, banque…"></label>
        <label>Date <input type="date" name="date" value="${esc(doc.date || "")}"></label>
        <label>Montant (€) <input type="text" inputmode="decimal" name="amount" value="${doc.amount != null ? String(doc.amount).replace(".", ",") : ""}"></label>
        <label>À payer avant <input type="date" name="due" value="${esc(doc.due || "")}"></label>
      </div>
      <label class="pp-name">Nom du fichier <input type="text" name="name" value="${esc(doc.name || "")}"></label>
      <div class="pp-foot"><span class="meta pp-dest"></span><span class="grow"></span>
        <button type="button" class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button>
        <button class="btn">${icon("check")}Classer</button></div>
    </form></div>`;
}

async function docs(el, base) {
  const qs = new URLSearchParams({ status: "filed", ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  const d = await api("/api/papers?" + qs);
  const total = Object.values(d.counts.categories).reduce((a, b) => a + b, 0);
  el.innerHTML = `<div class="pp-layout">
    <aside class="pp-cats">
      <button class="pp-cat ${!filters.category ? "on" : ""}" data-cat=""><span class="tile">${icon("folder")}</span>Tout<b>${total}</b></button>
      ${cats.filter(([c]) => d.counts.categories[c]).map(([c, ic, tile]) => `<button class="pp-cat ${filters.category === c ? "on" : ""}" data-cat="${esc(c)}">
        <span class="tile ${tile}">${icon(ic)}</span>${esc(c)}<b>${d.counts.categories[c]}</b></button>`).join("")}
    </aside>
    <div class="grow" style="min-width:0">
      <div class="pp-search"><div class="search-box grow">${icon("search")}<input type="search" id="pp-q" placeholder="Chercher dans le texte de tes documents (ex. « kWh », « Orange », « 2025 »)" value="${esc(filters.q)}"></div>
        <select id="pp-year"><option value="">Toutes les années</option>${d.counts.years.map(y => `<option ${filters.year === y ? "selected" : ""}>${y}</option>`).join("")}</select></div>
      ${d.docs.length ? `<div class="pp-list">${d.docs.map(doc => {
        const [, ic, tile] = catOf(doc.category);
        return `<a class="pp-row" href="#/paperasse/doc/${doc.id}"><img src="/api/papers/${doc.id}/thumb" alt="" loading="lazy">
          <div class="grow"><b>${esc(doc.issuer || doc.title)}</b><small>${esc(doc.type || "")}${doc.date ? " · " + fmtDate(doc.date) : ""}</small>
            <small class="meta">${icon(ic)}${esc(doc.folder)}</small></div>
          ${doc.amount != null ? `<span class="pp-amount">${money(doc.amount)}</span>` : ""}
          ${doc.due && !doc.paid ? `<span class="${daysLeft(doc.due) < 0 ? "pill-err" : "pill-warn"}">${icon("clock")}${fmtDate(doc.due)}</span>` : ""}</a>`;
      }).join("")}</div>` : `<div class="card"><div class="empty">${icon("search")}${filters.q || filters.category || filters.year ? "Aucun document ne correspond." : "Aucun document classé pour l'instant."}</div></div>`}
    </div></div>`;
  el.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { filters.category = b.dataset.cat; docs(el, base); });
  $("#pp-year").onchange = e => { filters.year = e.target.value; docs(el, base); };
  let t;
  $("#pp-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { filters.q = e.target.value.trim(); docs(el, base).then(() => { const i = $("#pp-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
}

async function detail(id) {
  const doc = await api("/api/papers/" + id).catch(err => { toast(err.message, "err"); return null; });
  if (!doc) return;
  const m = modal(doc.name, `<div class="pp-detail">
      <a class="pp-preview" href="/api/papers/${doc.id}/pdf" target="_blank"><img src="/api/papers/${doc.id}/thumb" alt=""></a>
      <form>
        <div class="pp-fields">
          <label>Catégorie ${catSelect(doc.category)}</label>
          <label>Type <input type="text" name="type" value="${esc(doc.type || "")}"></label>
          <label>Émetteur <input type="text" name="issuer" value="${esc(doc.issuer || "")}"></label>
          <label>Date <input type="date" name="date" value="${esc(doc.date || "")}"></label>
          <label>Montant (€) <input type="text" name="amount" value="${doc.amount != null ? String(doc.amount).replace(".", ",") : ""}"></label>
          <label>À payer avant <input type="date" name="due" value="${esc(doc.due || "")}"></label>
        </div>
        <label class="pp-name">Nom du fichier <input type="text" name="name" value="${esc(doc.name)}"></label>
        <label class="pp-name">Notes <textarea name="notes" rows="2" placeholder="Ex. payé par virement le…">${esc(doc.notes || "")}</textarea></label>
        ${doc.due ? `<label class="check"><input type="checkbox" name="paid" ${doc.paid ? "checked" : ""}> Payé / réglé</label>` : ""}
        <p class="meta">${icon("folder")} Paperasse / ${esc(doc.folder || "")} · ajouté par ${esc(doc.added_by === "*" ? "le dossier À classer" : doc.added_by)}</p>
        <div class="modal-foot">
          <button type="button" class="btn danger ghost" data-a="del">${icon("trash")}</button>
          <a class="btn ghost" href="/api/papers/${doc.id}/pdf?dl=1">${icon("download")}Télécharger</a>
          <a class="btn ghost" href="/api/papers/${doc.id}/pdf" target="_blank">${icon("external")}Ouvrir</a>
          <button class="btn">${icon("check")}Enregistrer</button></div>
      </form></div>
      ${doc.text ? `<details class="formats"><summary>Texte reconnu</summary><pre class="pp-text">${esc(doc.text)}</pre></details>` : ""}`, { ic: catOf(doc.category)[1], large: true });
  m.addEventListener("closed", () => { if (location.hash.includes("/doc/")) history.replaceState(null, "", "#/paperasse/docs"); });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    data.paid = !!f.elements.paid?.checked;
    try { await api(`/api/papers/${id}`, { method: "PUT", json: data }); closePanel(); toast("Enregistré"); location.hash = "#/paperasse/docs"; }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-a=del]").onclick = async () => {
    await api(`/api/papers/${id}`, { method: "DELETE" });
    closePanel();
    toast("Document mis à la corbeille");
    location.hash = "#/paperasse/docs";
  };
}

async function deadlines(el) {
  const list = await api("/api/papers/deadlines");
  const groups = { late: [], soon: [], later: [], paid: [] };
  list.forEach(d => {
    const left = daysLeft(d.due);
    groups[d.paid ? "paid" : left < 0 ? "late" : left <= 14 ? "soon" : "later"].push(d);
  });
  const row = d => {
    const left = daysLeft(d.due);
    return `<div class="set-row pp-due ${d.paid ? "paid" : ""}" data-id="${d.id}">
      <span class="pp-day ${d.paid ? "" : left < 0 ? "late" : left <= 7 ? "soon" : ""}"><b>${new Date(d.due + "T12:00").getDate()}</b>${new Date(d.due + "T12:00").toLocaleDateString("fr-FR", { month: "short" })}</span>
      <div class="txt"><b>${esc(d.issuer || d.title)}</b><small>${esc(d.type || "")} · ${d.paid ? "réglé" : left < 0 ? `en retard de ${-left} jour${left < -1 ? "s" : ""}` : left === 0 ? "aujourd'hui" : `dans ${left} jour${left > 1 ? "s" : ""}`}</small></div>
      ${d.amount != null ? `<span class="pp-amount">${money(d.amount)}</span>` : ""}
      <label class="check" title="Payé"><input type="checkbox" data-paid ${d.paid ? "checked" : ""}> Payé</label>
      <a class="icon-btn plain" href="#/paperasse/doc/${d.id}" title="Voir">${icon("eye")}</a></div>`;
  };
  const section = (title, items, cls = "") => items.length ? `<div class="home-cat ${cls}">${title}</div><div class="card">${items.map(row).join("")}</div>` : "";
  el.innerHTML = list.length ? section("En retard", groups.late, "late") + section("Dans les 2 semaines", groups.soon) + section("Plus tard", groups.later) + section("Réglées", groups.paid)
    : `<div class="card"><div class="empty">${icon("calendar")}<b>Aucune échéance</b>Les dates « à payer avant le… » trouvées dans tes factures apparaîtront ici, avec un rappel 7 jours avant.</div></div>`;
  el.querySelectorAll("[data-paid]").forEach(cb => cb.onchange = async () => {
    await api(`/api/papers/${cb.closest("[data-id]").dataset.id}`, { method: "PUT", json: { paid: cb.checked } });
    toast(cb.checked ? "Marqué comme payé" : "Marqué comme à payer");
    deadlines(el);
  });
}

export function leave() { clearInterval(timer); }
