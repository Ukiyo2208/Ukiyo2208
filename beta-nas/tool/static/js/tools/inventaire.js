// Outil « Inventaire » : objets de la maison par pièce, garanties, péremptions, export pour l'assurance.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let data = null, room = "", cat = "", watch = false, query = "";
const euros = n => (n ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const LEVEL = { ok: "", warn: "warn", bad: "bad", off: "off" };

export async function render(root, parts) {
  root.innerHTML = pageHead("inventaire", `<a class="btn ghost" href="/api/inventory/export.csv" download>${icon("download")}Liste pour l'assurance</a>
    <button class="btn ghost" id="iv-papers">${icon("receipt")}Depuis Paperasse</button><button class="btn" id="iv-add">${icon("plus")}Ajouter</button>`)
    + `<div id="iv-body"></div>`;
  $("#iv-add").onclick = () => edit();
  $("#iv-papers").onclick = fromPapers;
  await load();
  if (parts[0]) { const it = data.items.find(i => i.id === parts[0]); if (it) edit(it); }
}

async function load() {
  data = await api("/api/inventory");
  paint();
}

function shown() {
  const q = query.toLowerCase();
  return data.items.filter(i => (!room || i.room === room) && (!cat || i.category === cat)
    && (!watch || i.status.some(s => s.level === "warn" || s.level === "bad"))
    && (!q || [i.name, i.brand, i.model, i.serial, i.place, i.notes].join(" ").toLowerCase().includes(q)));
}

function paint() {
  const el = $("#iv-body");
  if (!el) return;
  const used = [...new Set(data.items.map(i => i.room).filter(Boolean))];
  const nWatch = data.items.filter(i => i.status.some(s => s.level === "warn" || s.level === "bad")).length;
  const items = shown();
  const catIcon = c => data.categories.find(x => x.name === c)?.icon || "tag";
  el.innerHTML = `<div class="iv-top">
      <div class="ml-search grow">${icon("search")}<input type="search" id="iv-q" placeholder="Chercher un objet, une marque, un n° de série…" value="${esc(query)}"></div>
      <select id="iv-cat"><option value="">Toutes les catégories</option>${data.categories.map(c => `<option ${c.name === cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <div class="iv-total"><small class="meta">Valeur totale</small><b>${euros(data.total)}</b></div></div>
    <div class="chips iv-rooms"><button class="chip ${!room && !watch ? "on" : ""}" data-room="">Tout (${data.items.length})</button>
      ${nWatch ? `<button class="chip ${watch ? "on" : ""}" data-watch>${icon("alert")}À surveiller (${nWatch})</button>` : ""}
      ${used.map(r => `<button class="chip ${room === r ? "on" : ""}" data-room="${esc(r)}">${esc(r)} (${data.items.filter(i => i.room === r).length})</button>`).join("")}</div>
    ${items.length ? `<div class="iv-grid">${items.map(i => `<button class="card iv-card" data-id="${i.id}">
        <div class="iv-ph">${i.photo_url ? `<img src="${i.photo_url}" alt="" loading="lazy">` : icon(catIcon(i.category))}${i.qty > 1 ? `<span class="iv-qty">×${i.qty}</span>` : ""}</div>
        <div class="iv-info"><b>${esc(i.name)}</b><small class="meta">${esc([i.room, i.place].filter(Boolean).join(" · ") || "Rangement non indiqué")}</small>
          <div class="iv-tags">${i.price != null ? `<span>${euros(i.price)}</span>` : ""}${i.status.map(s => `<span class="${LEVEL[s.level]}">${esc(s.text)}</span>`).join("")}${i.paper ? `<span>${icon("receipt")}Facture</span>` : ""}</div></div></button>`).join("")}</div>`
      : `<div class="card empty">${icon("archive")}<b>${data.items.length ? "Rien ne correspond" : "Ton inventaire est vide"}</b>${data.items.length ? "Change le filtre ou la recherche." : "Ajoute tes objets de valeur (télé, ordinateur, vélo, bijoux…) avec une photo et leur facture : en cas de vol ou de sinistre, la liste pour l'assurance est prête. Tu peux aussi suivre le congélateur ou la pharmacie avec les dates de péremption."}</div>`}`;
  const q = $("#iv-q");
  q.oninput = () => { query = q.value; const pos = q.selectionStart; paint(); const n = $("#iv-q"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#iv-cat").onchange = e => { cat = e.target.value; paint(); };
  el.querySelector(".iv-rooms").onclick = e => {
    const b = e.target.closest("[data-room],[data-watch]");
    if (!b) return;
    if (b.dataset.watch !== undefined) { watch = !watch; room = ""; } else { room = b.dataset.room; watch = false; }
    paint();
  };
  el.querySelectorAll(".iv-card").forEach(c => c.onclick = () => edit(data.items.find(i => i.id === c.dataset.id)));
}

function edit(it = {}, prefill = {}) {
  const v = { ...it, ...prefill };
  const m = modal(it.id ? v.name : "Nouvel objet", `<form class="iv-form">
    <div class="iv-photo">${it.photo_url ? `<img src="${it.photo_url}" alt="">` : icon("camera")}
      <label class="btn ghost small"><input type="file" name="photo" accept="image/*" capture="environment" hidden>${icon("camera")}${it.photo_url ? "Changer la photo" : "Photo"}</label></div>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(v.name || "")}" required placeholder="Ex. Télévision, lave-linge, vélo électrique">
    <div class="grid2"><div><label class="field">Pièce</label><input type="text" name="room" list="iv-roomlist" value="${esc(v.room || "")}" placeholder="Salon">
        <datalist id="iv-roomlist">${data.rooms.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
      <div><label class="field">Où exactement</label><input type="text" name="place" value="${esc(v.place || "")}" placeholder="Ex. étagère du haut, congélateur"></div></div>
    <div class="grid2"><div><label class="field">Catégorie</label><select name="category" style="width:100%"><option value="">—</option>${data.categories.map(c => `<option ${c.name === v.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label class="field">Quantité</label><input type="number" name="qty" min="0" value="${v.qty ?? 1}"></div></div>
    <div class="grid2"><div><label class="field">Marque</label><input type="text" name="brand" value="${esc(v.brand || "")}"></div>
      <div><label class="field">Modèle</label><input type="text" name="model" value="${esc(v.model || "")}"></div></div>
    <label class="field">N° de série</label><input type="text" name="serial" value="${esc(v.serial || "")}" placeholder="Utile en cas de vol ou pour le SAV">
    <div class="grid2"><div><label class="field">Prix d'achat (€)</label><input type="text" inputmode="decimal" name="price" value="${v.price ?? ""}"></div>
      <div><label class="field">Acheté le</label><input type="date" name="bought" value="${esc(v.bought || "")}"></div></div>
    <div class="grid2"><div><label class="field">Garantie jusqu'au</label><input type="date" name="warranty" value="${esc(v.warranty || "")}">
        <div class="iv-quick">${[1, 2, 3, 5].map(y => `<button type="button" class="chip" data-wy="${y}">${y} an${y > 1 ? "s" : ""}</button>`).join("")}</div></div>
      <div><label class="field">À consommer avant</label><input type="date" name="expires" value="${esc(v.expires || "")}"><small class="meta">Congélateur, pharmacie…</small></div></div>
    <label class="field">Acheté chez</label><input type="text" name="shop" value="${esc(v.shop || "")}">
    <label class="field">Notes</label><textarea name="notes" rows="2">${esc(v.notes || "")}</textarea>
    ${v.paper ? `<p class="hint">${icon("receipt")} <a href="#/paperasse/doc/${esc(v.paper)}">Voir la facture dans Paperasse</a></p>` : ""}
    <input type="hidden" name="paper" value="${esc(v.paper || "")}">
    <div class="modal-foot">${it.id ? `<button type="button" class="btn ghost danger" data-del>${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "archive", large: true });
  const f = m.querySelector("form");
  let photo = null;
  f.photo.onchange = () => {
    photo = f.photo.files[0];
    if (photo) m.querySelector(".iv-photo").firstChild.replaceWith(Object.assign(document.createElement("img"), { src: URL.createObjectURL(photo) }));
  };
  m.querySelector(".iv-quick").onclick = e => {
    const b = e.target.closest("[data-wy]");
    if (!b) return;
    const d = f.bought.value ? new Date(f.bought.value + "T12:00") : new Date();
    if (!f.bought.value) f.bought.value = d.toISOString().slice(0, 10);
    d.setFullYear(d.getFullYear() + +b.dataset.wy);
    f.warranty.value = d.toISOString().slice(0, 10);
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(["name", "room", "place", "category", "qty", "brand", "model", "serial", "price", "bought", "warranty", "expires", "shop", "notes", "paper"].map(k => [k, f[k].value]));
    try {
      const r = it.id ? await api(`/api/inventory/${it.id}`, { method: "PUT", json: body }) : await api("/api/inventory", { json: body });
      if (photo) { const fd = new FormData(); fd.append("photo", photo); await api(`/api/inventory/${r.id}/photo`, { method: "POST", body: fd }); }
      closePanel(); toast(it.id ? "Objet modifié" : "Objet ajouté"); load();
    } catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${it.name} » de l'inventaire ?`)) return;
    await api(`/api/inventory/${it.id}`, { method: "DELETE" }); closePanel(); load();
  });
}

async function fromPapers() {
  const docs = await api("/api/inventory/papers");
  const m = modal("Depuis Paperasse", docs.length ? `<p class="hint" style="margin-top:0">Tes tickets et factures d'achat : choisis-en un pour créer l'objet avec son prix, sa date et la facture jointe.</p>
    <div class="ml-dates">${docs.map(d => `<button class="acc-prov" data-d="${d.id}">${icon("receipt")}<span class="grow"><b>${esc(d.title || "Document")}</b>
      <small>${esc([d.issuer, d.date && new Date(d.date + "T12:00").toLocaleDateString("fr-FR"), d.amount != null && euros(d.amount)].filter(Boolean).join(" · "))}</small></span></button>`).join("")}</div>`
    : `<div class="empty">${icon("receipt")}<b>Aucun ticket ni facture d'achat</b>Dépose tes factures dans Paperasse : elles apparaîtront ici.</div>`, { ic: "receipt" });
  m.onclick = e => {
    const b = e.target.closest("[data-d]");
    if (!b) return;
    const d = docs.find(x => x.id === b.dataset.d);
    closePanel();
    setTimeout(() => edit({}, { name: d.title || "", price: d.amount, bought: d.date || "", shop: d.issuer || "", paper: d.id }), 250);
  };
}
