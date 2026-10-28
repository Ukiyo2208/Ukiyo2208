// Outil « Contacts » : carnets Perso, Pro, Famille (partagé)… synchronisés avec les téléphones (CardDAV).
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

const TYPES = {
  phones: [["CELL", "Mobile"], ["HOME", "Domicile"], ["WORK", "Travail"], ["OTHER", "Autre"]],
  emails: [["HOME", "Perso"], ["WORK", "Travail"], ["OTHER", "Autre"]],
  addresses: [["HOME", "Domicile"], ["WORK", "Travail"], ["OTHER", "Autre"]],
};
const label = (field, t) => (TYPES[field].find(x => x[0] === t) || TYPES[field].at(-1))[1];
let books = [], items = [], groups = [], book = "", group = "", query = "", current = null, root = null;
const hue = s => [...(s || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = c => ((c.first || "").charAt(0) + (c.last || "").charAt(0)).toUpperCase() || (c.name || "?").charAt(0).toUpperCase();

export async function render(el, parts) {
  root = el;
  root.innerHTML = pageHead("contacts", `<button class="btn ghost" id="ct-sync">${icon("phone")}Synchroniser</button>
    <button class="btn" id="ct-new">${icon("plus")}Contact</button>`) + `
    <div class="ml-layout ct-layout" data-pane="list">
      <aside class="ml-side card">
        <div class="card-title">${icon("users")}Carnets</div>
        <nav class="ml-folders" id="ct-books"></nav>
        <button class="btn ghost small wide" id="ct-addbook">${icon("plus")}Nouveau carnet</button>
        <button class="btn ghost small wide" style="margin-top:6px" id="ct-fetch">${icon("download")}Récupérer des contacts</button>
        <button class="btn ghost small wide" style="margin-top:6px" id="ct-dupes">${icon("users")}Doublons</button>
        <a class="btn ghost small wide" id="ct-export" style="margin-top:6px">${icon("upload")}Exporter (.vcf)</a>
      </aside>
      <section class="ml-list card">
        <div class="ml-bar"><button class="icon-btn plain ml-only-mobile" id="ct-menu" title="Carnets">${icon("menu")}</button>
          <div class="ml-search grow">${icon("search")}<input type="search" id="ct-q" placeholder="Nom, téléphone, mail, entreprise…"></div></div>
        <div class="ct-gbar" id="ct-gbar" hidden></div>
        <div id="ct-items" class="ml-items"></div>
      </section>
      <section class="ml-read card" id="ct-card"><div class="empty">${icon("user")}<b>Choisis un contact</b>Sa fiche s'affiche ici.</div></section>
    </div>`;
  $("#ct-new").onclick = () => edit({ book: book || books.find(b => !b.shared)?.id });
  $("#ct-sync").onclick = syncPanel;
  $("#ct-addbook").onclick = addBook;
  $("#ct-menu").onclick = () => $(".ct-layout").dataset.pane = "side";
  $("#ct-fetch").onclick = fetchPanel;
  $("#ct-dupes").onclick = dupesPanel;
  let t = null;
  $("#ct-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); load(); }, 250); };
  await load();
  if (parts[0]) show(parts[0]);
}

async function load() {
  ({ books, contacts: items, groups } = await api(`/api/contacts?book=${encodeURIComponent(book)}&group=${encodeURIComponent(group)}&q=${encodeURIComponent(query)}`));
  paintBooks();
  paintList();
}

function paintBooks() {
  const total = books.reduce((n, b) => n + b.count, 0);
  $("#ct-books").innerHTML = `<button class="ml-folder ${book ? "" : "on"}" data-book="">${icon("users")}<span class="grow">Tous les contacts</span><span class="count">${total}</span></button>`
    + books.map(b => `<button class="ml-folder ${b.id === book ? "on" : ""}" data-book="${b.id}">${icon(b.shared ? "home" : /pro/i.test(b.name) ? "briefcase" : "user")}
      <span class="grow">${esc(b.name)}${b.shared ? ` <small class="meta">· partagé</small>` : ""}</span><span class="count">${b.count}</span>
      <span class="ct-bedit" data-bedit="${b.id}" title="Renommer">${icon("edit")}</span></button>`).join("");
  const shown = groups.filter(gr => !book || gr.book === book);
  $("#ct-books").innerHTML += `<div class="ct-gtitle"><small class="meta">Groupes</small><button class="icon-btn plain" data-gnew title="Nouveau groupe">${icon("plus")}</button></div>`
    + (shown.length ? shown.map(gr => `<button class="ml-folder ${gr.id === group ? "on" : ""}" data-group="${gr.id}" style="--d:1">${icon("users")}
      <span class="grow">${esc(gr.name)}</span><span class="count">${gr.members.length}</span>
      <span class="ct-bedit" data-gedit="${gr.id}" title="Modifier le groupe">${icon("edit")}</span></button>`).join("") : `<p class="meta ct-gempty">Aucun groupe</p>`);
  $("#ct-export").href = `/api/contacts/export${book ? "?book=" + encodeURIComponent(book) : ""}`;
  $("#ct-books").onclick = e => {
    const ed = e.target.closest("[data-bedit]");
    if (ed) { e.stopPropagation(); return editBook(books.find(b => b.id === ed.dataset.bedit)); }
    const ge = e.target.closest("[data-gedit]");
    if (ge) { e.stopPropagation(); return groupPanel(groups.find(x => x.id === ge.dataset.gedit)); }
    if (e.target.closest("[data-gnew]")) return groupPanel(null);
    const gb = e.target.closest("[data-group]");
    if (gb) { group = gb.dataset.group === group ? "" : gb.dataset.group; $(".ct-layout").dataset.pane = "list"; return load(); }
    const b = e.target.closest("[data-book]");
    if (!b) return;
    book = b.dataset.book;
    group = "";
    $(".ct-layout").dataset.pane = "list";
    load();
  };
  paintGroupBar();
}

/** Bandeau du groupe affiché : écrire à tout le groupe. */
function paintGroupBar() {
  const bar = $("#ct-gbar"), gr = groups.find(x => x.id === group);
  if (!bar) return;
  bar.hidden = !gr;
  if (!gr) return;
  const mails = items.filter(c => gr.members.includes(c.id) && c.emails[0]).map(c => c.emails[0].value);
  bar.innerHTML = `${icon("users")}<b class="grow">${esc(gr.name)}</b>
    ${mails.length ? `<a class="btn small" href="#/mails?to=${encodeURIComponent(mails.join(", "))}">${icon("mail")}Écrire au groupe</a>` : ""}
    <button class="icon-btn plain" data-gx title="Voir tous les contacts">${icon("x")}</button>`;
  bar.querySelector("[data-gx]").onclick = () => { group = ""; load(); };
}

function groupPanel(gr) {
  const bookId = gr?.book || book || books.find(b => !b.shared)?.id;
  const people = [...items].length && !group ? items : null;
  (people ? Promise.resolve(people) : api(`/api/contacts?book=${encodeURIComponent(bookId)}`).then(r => r.contacts)).then(all => {
    const list = all.filter(c => c.book === bookId);
    const m = modal(gr ? gr.name : "Nouveau groupe", `<form>
      <div class="grid2"><div><label class="field">Nom</label><input type="text" name="name" value="${esc(gr?.name || "")}" required placeholder="Ex. Club de foot, Parents de l'école"></div>
        <div><label class="field">Carnet</label><select name="book" ${gr ? "disabled" : ""} style="width:100%">${books.map(b => `<option value="${b.id}" ${b.id === bookId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div></div>
      <label class="field">Membres</label><input type="search" class="ct-gsearch" placeholder="Filtrer…">
      <div class="ct-gmembers">${list.map(c => `<label class="check"><input type="checkbox" name="m" value="${c.id}" ${gr?.members.includes(c.id) ? "checked" : ""}> ${esc(c.name)}
        <small class="meta">${esc(c.emails[0]?.value || c.phones[0]?.value || "")}</small></label>`).join("") || `<p class="meta">Aucun contact dans ce carnet.</p>`}</div>
      <div class="modal-foot">${gr ? `<button type="button" class="btn danger ghost" data-a="del">${icon("trash")}Supprimer</button>` : ""}<span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "users", large: true });
    const f = m.querySelector("form");
    m.querySelector(".ct-gsearch").oninput = e => { const q = e.target.value.toLowerCase(); m.querySelectorAll(".ct-gmembers label").forEach(l => { l.hidden = !l.textContent.toLowerCase().includes(q); }); };
    f.onsubmit = async e => {
      e.preventDefault();
      const members = [...f.querySelectorAll("[name=m]:checked")].map(x => x.value);
      try {
        await api(gr ? `/api/contacts/groups/${gr.id}` : "/api/contacts/groups", { method: gr ? "PUT" : "POST", json: { name: f.name.value, book: f.book.value, members } });
        closePanel(); toast(gr ? "Groupe enregistré" : "Groupe créé"); load();
      } catch (err) { toast(err.message, "err"); }
    };
    m.querySelector("[data-a=del]")?.addEventListener("click", async () => {
      if (!confirm(`Supprimer le groupe « ${gr.name} » ? Les contacts sont gardés.`)) return;
      await api(`/api/contacts/groups/${gr.id}`, { method: "DELETE" });
      closePanel(); if (group === gr.id) group = ""; load();
    });
  });
}

function paintList() {
  const list = $("#ct-items");
  if (!items.length) {
    list.innerHTML = `<div class="empty">${icon(query ? "search" : "users")}<b>${query ? "Aucun résultat" : "Aucun contact"}</b>${query ? "" : "Ajoute un contact, importe un fichier .vcf, ou synchronise ton téléphone."}</div>`;
    return;
  }
  let letter = "";
  list.innerHTML = items.map((c, i) => {
    const l = ((c.last || c.name).charAt(0) || "#").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const head = l !== letter ? `<div class="ct-letter">${esc(letter = l)}</div>` : "";
    return `${head}<div class="ml-item ${current === c.id ? "on" : ""}" data-i="${i}">
      <span class="ml-av" style="--h:${hue(c.name)}">${initials(c)}</span>
      <div class="grow ml-lines"><div class="ml-l1"><b class="grow">${esc(c.name)}</b>${book ? "" : `<small class="meta">${esc(c.book_name)}</small>`}</div>
        <div class="ml-l2"><span class="grow">${esc([c.org, c.phones[0]?.value, c.emails[0]?.value].filter(Boolean).join(" · "))}</span></div></div></div>`;
  }).join("");
  list.onclick = e => { const it = e.target.closest("[data-i]"); if (it) show(items[+it.dataset.i].id); };
}

async function show(id) {
  current = id;
  document.querySelectorAll("#ct-items .ml-item").forEach(x => x.classList.toggle("on", items[+x.dataset.i]?.id === id));
  $(".ct-layout").dataset.pane = "read";
  let c;
  try { c = await api(`/api/contacts/${encodeURIComponent(id)}`); } catch (err) { return toast(err.message, "err"); }
  const row = (ic, title, value, href, sub = "") => `<a class="ct-row" ${href ? `href="${esc(href)}"` : ""} ${href?.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
    ${icon(ic)}<span class="grow"><small class="meta">${esc(title)}</small><b>${esc(value)}</b>${sub}</span></a>`;
  const bd = c.birthday ? new Date((c.birthday.length === 5 ? "2000-" : "") + c.birthday + "T12:00") : null;
  $("#ct-card").innerHTML = `<div class="ml-rbar"><button class="icon-btn plain ml-only-mobile" data-c="back">${icon("left")}</button><span class="grow"></span>
      <button class="btn ghost small" data-c="edit">${icon("edit")}Modifier</button>
      <button class="icon-btn plain" data-c="del" title="Supprimer">${icon("trash")}</button></div>
    <div class="ct-head"><span class="ml-av ct-big" style="--h:${hue(c.name)}">${c.photo ? `<img src="${c.photo}" alt="">` : initials(c)}</span>
      <h2>${esc(c.name)}</h2>${c.org || c.title ? `<p class="meta">${esc([c.title, c.org].filter(Boolean).join(" · "))}</p>` : ""}
      <span class="chip">${icon(c.shared ? "home" : "user")}${esc(c.book_name)}</span></div>
    <div class="ct-actions">${c.phones[0] ? `<a class="btn small" href="tel:${esc(c.phones[0].value.replace(/\s/g, ""))}">${icon("phone")}Appeler</a>` : ""}
      ${c.emails[0] ? `<a class="btn small ghost" href="#/mails?to=${encodeURIComponent(c.emails[0].value)}">${icon("mail")}Écrire</a>` : ""}</div>
    <div class="ct-rows">
      ${c.phones.map(p => row("phone", label("phones", p.type), p.value, "tel:" + p.value.replace(/\s/g, ""))).join("")}
      ${c.emails.map(m => row("mail", label("emails", m.type), m.value, `#/mails?to=${encodeURIComponent(m.value)}`)).join("")}
      ${c.addresses.map(a => { const txt = [a.street, [a.code, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
        return row("pin", label("addresses", a.type), txt, "https://www.openstreetmap.org/search?query=" + encodeURIComponent(txt)); }).join("")}
      ${bd ? row("calendar", "Anniversaire", bd.toLocaleDateString("fr-FR", { day: "numeric", month: "long", ...(c.birthday.length === 10 ? { year: "numeric" } : {}) })) : ""}
      ${c.url ? row("link", "Site web", c.url, /^https?:/.test(c.url) ? c.url : "https://" + c.url) : ""}
      ${c.notes ? `<div class="ag-notes">${esc(c.notes)}</div>` : ""}</div>`;
  $("#ct-card").onclick = async e => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    if (b.dataset.c === "back") { $(".ct-layout").dataset.pane = "list"; return; }
    if (b.dataset.c === "edit") return edit(c);
    if (b.dataset.c === "del" && confirm(`Supprimer ${c.name} ?${c.shared ? " (carnet partagé : pour tout le monde)" : ""}`)) {
      await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      toast("Contact supprimé");
      current = null;
      $("#ct-card").innerHTML = `<div class="empty">${icon("user")}<b>Choisis un contact</b>Sa fiche s'affiche ici.</div>`;
      load();
    }
  };
}

function rows(field, list) {
  const one = (x = {}) => field === "addresses"
    ? `<div class="ct-erow ct-adr"><select data-k="type">${TYPES[field].map(([v, l]) => `<option value="${v}" ${x.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input type="text" data-k="street" placeholder="Rue" value="${esc(x.street || "")}"><input type="text" data-k="code" placeholder="Code postal" value="${esc(x.code || "")}">
        <input type="text" data-k="city" placeholder="Ville" value="${esc(x.city || "")}"><input type="text" data-k="country" placeholder="Pays" value="${esc(x.country || "")}">
        <button type="button" class="icon-btn plain" data-rm title="Retirer">${icon("x")}</button></div>`
    : `<div class="ct-erow"><select data-k="type">${TYPES[field].map(([v, l]) => `<option value="${v}" ${x.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input type="${field === "emails" ? "email" : "tel"}" data-k="value" value="${esc(x.value || "")}" placeholder="${field === "emails" ? "prenom@exemple.fr" : "06 12 34 56 78"}">
        <button type="button" class="icon-btn plain" data-rm title="Retirer">${icon("x")}</button></div>`;
  return { html: (list.length ? list : [{}]).map(one).join(""), one };
}

/** Fiche de contact (création ou modification). Exportée pour « Ajouter aux contacts » dans Mails. */
export async function edit(c = {}, after) {
  if (!books.length) ({ books, groups } = await api("/api/contacts?q=%00"));
  const isNew = !c.id;
  const parts = { phones: rows("phones", c.phones || []), emails: rows("emails", c.emails || []), addresses: rows("addresses", c.addresses || []) };
  const m = modal(isNew ? "Nouveau contact" : "Modifier le contact", `<form class="ct-form">
    <div class="grid2"><div><label class="field">Prénom</label><input type="text" name="first" value="${esc(c.first || "")}"></div>
      <div><label class="field">Nom</label><input type="text" name="last" value="${esc(c.last || "")}"></div>
      <div><label class="field">Entreprise</label><input type="text" name="org" value="${esc(c.org || "")}"></div>
      <div><label class="field">Fonction</label><input type="text" name="title" value="${esc(c.title || "")}"></div></div>
    ${["phones", "emails", "addresses"].map(f => `<label class="field">${{ phones: "Téléphones", emails: "Adresses mail", addresses: "Adresses postales" }[f]}</label>
      <div class="ct-list" data-f="${f}">${parts[f].html}</div><button type="button" class="btn ghost small" data-add="${f}">${icon("plus")}Ajouter</button>`).join("")}
    <div class="grid2"><div><label class="field">Anniversaire</label><input type="date" name="birthday" value="${esc(c.birthday?.length === 10 ? c.birthday : "")}"></div>
      <div><label class="field">Carnet</label><select name="book" style="width:100%">${books.map(b => `<option value="${b.id}" ${b.id === (c.book || books[0]?.id) ? "selected" : ""}>${esc(b.name)}${b.shared ? " (partagé)" : ""}</option>`).join("")}</select></div></div>
    ${groups.length ? `<label class="field">Groupes</label><div class="ct-ggroups">${groups.map(gr => `<label class="check" data-gbook="${gr.book}"><input type="checkbox" name="grp" value="${gr.id}" ${(c.groups || []).includes(gr.id) ? "checked" : ""}> ${esc(gr.name)}</label>`).join("")}</div>` : ""}
    <label class="field">Site web</label><input type="url" name="url" value="${esc(c.url || "")}" placeholder="https://…">
    <label class="field">Notes</label><textarea name="notes" rows="2">${esc(c.notes || "")}</textarea>
    <div class="modal-foot"><span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "user", large: true });
  const f = m.querySelector("form");
  m.addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    if (add) { m.querySelector(`[data-f=${add.dataset.add}]`).insertAdjacentHTML("beforeend", parts[add.dataset.add].one()); return; }
    const rm = e.target.closest("[data-rm]");
    if (rm) rm.closest(".ct-erow").remove();
  });
  const syncGroups = () => m.querySelectorAll("[data-gbook]").forEach(l => { l.hidden = l.dataset.gbook !== f.book.value; });
  f.book.addEventListener("change", syncGroups);
  syncGroups();
  f.first.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const collect = field => [...m.querySelectorAll(`[data-f=${field}] .ct-erow`)].map(r => Object.fromEntries([...r.querySelectorAll("[data-k]")].map(x => [x.dataset.k, x.value.trim()])));
    const body = { first: f.first.value, last: f.last.value, org: f.org.value, title: f.title.value, book: f.book.value, url: f.url.value, notes: f.notes.value,
      birthday: f.birthday.value || (c.birthday?.length === 5 ? c.birthday : ""), phones: collect("phones"), emails: collect("emails"), addresses: collect("addresses") };
    if (groups.length) body.groups = [...f.querySelectorAll("[name=grp]:checked")].filter(x => x.closest("[data-gbook]").dataset.gbook === f.book.value).map(x => x.value);
    try {
      const r = await api(isNew ? "/api/contacts" : `/api/contacts/${encodeURIComponent(c.id)}`, { method: isNew ? "POST" : "PUT", json: body });
      closePanel();
      toast(isNew ? "Contact ajouté" : "Contact enregistré");
      if (after) return after(r);
      if ($("#ct-items")) { await load(); show(r.id); }
    } catch (err) { toast(err.message, "err"); }
  };
}

function addBook() {
  const m = modal("Nouveau carnet", `<form><label class="field">Nom</label><input type="text" name="name" required placeholder="Ex. Club de foot, École, Clients">
    <p class="hint">Il apparaîtra aussi dans les contacts de tes téléphones synchronisés.</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Créer</button></div></form>`, { ic: "users" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try { const r = await api("/api/contacts/books", { json: { name: e.target.name.value } }); closePanel(); book = r.id; load(); }
    catch (err) { toast(err.message, "err"); }
  };
}

function editBook(b) {
  const m = modal(b.name, `<form><label class="field">Nom</label><input type="text" name="name" value="${esc(b.name)}" required>
    ${b.shared ? `<p class="hint">Carnet partagé par toute la maison : le nom change pour tout le monde.</p>` : ""}
    <div class="modal-foot">${b.shared ? "" : `<button type="button" class="btn danger ghost" data-a="del">${icon("trash")}Supprimer</button>`}<span class="grow"></span>
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "users" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    await api(`/api/contacts/books/${b.id}`, { method: "PUT", json: { name: e.target.name.value } });
    closePanel(); load();
  };
  m.querySelector("[data-a=del]")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer le carnet « ${b.name} » et ses ${b.count} contact${b.count > 1 ? "s" : ""} ?`)) return;
    try { await api(`/api/contacts/books/${b.id}`, { method: "DELETE" }); closePanel(); book = ""; load(); }
    catch (err) { toast(err.message, "err"); }
  });
}

const bookSelect = () => `<select name="book">${books.map(b => `<option value="${b.id}" ${b.id === (book || books.find(x => !x.shared)?.id) ? "selected" : ""}>${esc(b.name)}${b.shared ? " (partagé)" : ""}</option>`).join("")}</select>`;
const report = r => `${r.added} ajouté${r.added > 1 ? "s" : ""}, ${r.merged} complété${r.merged > 1 ? "s" : ""}${r.same ? `, ${r.same} déjà présent${r.same > 1 ? "s" : ""}` : ""}`;

/** Récupérer des contacts : fichiers trouvés sur le NAS, fichier de l'ordinateur, autre serveur CardDAV. */
function fetchPanel() {
  const m = modal("Récupérer des contacts", `<div class="ct-fetch">
    <div class="row ct-into"><span class="meta">Dans le carnet</span>${bookSelect()}<small class="meta">Les doublons (même mail, téléphone ou nom) sont fusionnés.</small></div>
    <nav class="tabs small"><a class="on" data-t="nas">${icon("nas")}Sur le NAS</a><a data-t="file">${icon("upload")}Fichier</a><a data-t="dav">${icon("server")}Autre serveur</a></nav>
    <div data-p="nas"><p class="meta"><span class="spinner"></span>Je cherche les fichiers de contacts (.vcf, .csv) sur le NAS…</p></div>
    <div data-p="file" hidden><p class="hint" style="margin-top:0">Un fichier .vcf ou .csv : export d'iCloud (icloud.com → Contacts → Exporter), de Google Contacts, d'Outlook, ou sauvegarde du téléphone.</p>
      <label class="btn"><input type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" hidden id="ct-file">${icon("upload")}Choisir le fichier</label></div>
    <div data-p="dav" hidden><form><p class="hint" style="margin-top:0">Copie les contacts d'un autre serveur CardDAV : Radicale ou Baïkal installé dans Docker sur ton NAS UGREEN, Nextcloud, Synology Contacts…</p>
      <label class="field">Adresse du serveur</label><input type="url" name="url" required placeholder="http://192.168.1.20:5232/ ou https://cloud.exemple.fr/remote.php/dav">
      <div class="grid2"><div><label class="field">Identifiant</label><input type="text" name="username" autocomplete="off"></div>
        <div><label class="field">Mot de passe</label><input type="password" name="password" autocomplete="new-password"></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn">${icon("download")}Copier les contacts</button></div></form></div></div>`, { ic: "download", large: true });
  const target = () => m.querySelector("[name=book]").value;
  m.querySelector(".tabs").onclick = e => {
    const t = e.target.closest("[data-t]");
    if (!t) return;
    m.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a === t));
    m.querySelectorAll("[data-p]").forEach(p => { p.hidden = p.dataset.p !== t.dataset.t; });
  };
  const done = async r => { toast(`Contacts récupérés : ${report(r)}`); await load(); };
  api("/api/contacts/scan").then(r => {
    const el = m.querySelector("[data-p=nas]");
    el.innerHTML = r.files.length ? `<p class="hint" style="margin-top:0">Fichiers trouvés dans ${esc(r.roots.join(", "))} :</p><div class="ct-files">${r.files.map((f, i) => `<div class="acc-row">
        <span class="tile ${f.name.toLowerCase().endsWith(".csv") ? "vert" : "violet"}">${icon("users")}</span>
        <div class="grow"><b>${esc(f.name)}</b><small class="meta">${esc(f.root_label)} / ${esc(f.path)}</small>
          <small class="meta">≈ ${f.count} contact${f.count > 1 ? "s" : ""} · ${new Date(f.mtime * 1000).toLocaleDateString("fr-FR")}</small></div>
        <button class="btn small" data-imp="${i}">${icon("download")}Importer</button></div>`).join("")}</div>`
      : `<div class="empty">${icon("search")}<b>Aucun fichier de contacts trouvé</b>Bêta Tool ne voit que les dossiers montés dans docker-compose.yml (${esc(r.roots.join(", "))}).
        Sur un NAS UGREEN, ajoute le dossier où ton téléphone sauvegarde ses contacts (ex. <code>/volume1/Sauvegardes</code>) dans EXTRA_ROOTS, ou utilise l'onglet « Fichier ».</div>`;
    el.onclick = async e => {
      const b = e.target.closest("[data-imp]");
      if (!b) return;
      const f = r.files[+b.dataset.imp];
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>Import…`;
      try { const res = await api("/api/contacts/import-path", { json: { root: f.root, path: f.path, book: target() } }); b.innerHTML = `${icon("check")}${report(res)}`; done(res); }
      catch (err) { toast(err.message, "err"); b.disabled = false; b.innerHTML = `${icon("download")}Importer`; }
    };
  }).catch(err => { m.querySelector("[data-p=nas]").innerHTML = `<p class="hint">${icon("alert")} ${esc(err.message)}</p>`; });
  m.querySelector("#ct-file").onchange = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("book", target());
    try { done(await api("/api/contacts/import", { method: "POST", body: fd })); closePanel(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-p=dav] form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector(".btn");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Copie…`;
    try { const r = await api("/api/contacts/carddav-import", { json: { url: f.url.value, username: f.username.value, password: f.password.value, book: target() } }); done(r); closePanel(); }
    catch (err) { toast(err.message, "err"); btn.disabled = false; btn.innerHTML = `${icon("download")}Copier les contacts`; }
  };
}

async function dupesPanel() {
  const groups = await api(`/api/contacts/duplicates${book ? "?book=" + encodeURIComponent(book) : ""}`);
  const m = modal("Doublons", groups.length ? `<p class="hint" style="margin-top:0">Ces fiches ont le même mail, le même téléphone ou le même nom. La fusion garde une seule fiche avec toutes les infos.</p>
    <div class="ct-files">${groups.map(gr => `<div class="acc-row"><span class="tile ambre">${icon("users")}</span><div class="grow"><b>${gr.names.map(esc).join(" · ")}</b>
      <small class="meta">${esc(gr.book_name)} · ${esc(gr.detail)}</small></div></div>`).join("")}</div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn" data-merge>${icon("check")}Fusionner ${groups.length} groupe${groups.length > 1 ? "s" : ""}</button></div>`
    : `<div class="empty">${icon("check")}<b>Aucun doublon</b>Tous tes contacts sont uniques.</div>`, { ic: "users", large: true });
  m.querySelector("[data-merge]")?.addEventListener("click", async () => {
    const r = await api("/api/contacts/dedupe", { json: { book } });
    closePanel(); toast(`${r.merged} fiche${r.merged > 1 ? "s" : ""} fusionnée${r.merged > 1 ? "s" : ""}`); load();
  });
}

async function syncPanel() {
  const info = await api("/api/contacts/sync");
  const server = `${location.origin}/dav/`;
  const m = modal("Synchroniser les contacts", `<div class="ag-sync">
    <p class="hint" style="margin-top:0">Tes carnets apparaissent dans l'appli Contacts du téléphone, et ce que tu y ajoutes revient ici. C'est le même compte que pour l'Agenda : si tu l'as déjà configuré sur Android (DAVx⁵), les contacts arrivent tout seuls.</p>
    <dl class="kv ag-creds">
      <dt>Serveur</dt><dd><code>${esc(server)}</code></dd>
      <dt>Identifiant</dt><dd><code>${esc(info.login)}</code></dd>
      <dt>Mot de passe</dt><dd id="ct-pw">${info.configured ? `<span class="meta">déjà créé (le même que pour l'Agenda)</span> ` : ""}<button class="btn small" id="ct-genpw">${icon("key")}${info.configured ? "En créer un nouveau" : "Créer le mot de passe"}</button></dd>
    </dl>
    <details class="formats" open><summary>${icon("phone")}iPhone et iPad</summary><ol class="tuto">
      <li><b>Réglages → Contacts → Comptes → Ajouter un compte</b><span>« Autre », puis « Ajouter un compte CardDAV ».</span></li>
      <li><b>Remplis les champs</b><span>Serveur : <code>${esc(location.host)}</code>, puis l'identifiant et le mot de passe ci-dessus.</span></li>
      <li><b>Ouvre l'appli Contacts → Listes</b><span>Les carnets Perso, Pro et Famille apparaissent.</span></li></ol></details>
    <details class="formats"><summary>${icon("phone")}Android</summary><p class="hint">Dans DAVx⁵ (le même compte que l'Agenda), onglet CardDAV : coche les carnets à synchroniser.</p></details>
    <details class="formats"><summary>${icon("monitor")}Ordinateur</summary><p class="hint">Thunderbird (carnet d'adresses CardDAV), Contacts macOS (compte CardDAV) : même adresse, identifiant et mot de passe.</p></details></div>`, { ic: "phone", large: true });
  m.querySelector("#ct-genpw").onclick = async () => {
    if (info.configured && !confirm("Créer un nouveau mot de passe déconnecte les téléphones déjà configurés (agenda et contacts). Continuer ?")) return;
    const r = await api("/api/contacts/sync-password", { json: {} });
    m.querySelector("#ct-pw").innerHTML = `<code class="ag-pwd">${esc(r.password)}</code><small class="meta" style="display:block">Note-le maintenant : il ne sera plus affiché.</small>`;
  };
}

export function leave() {}
