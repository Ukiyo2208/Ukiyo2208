// Outil « Mails » : boîtes iCloud, Gmail, Outlook, Orange… dans Bêta Tool (IMAP / SMTP).
import { $, esc, icon, toast, modal, closePanel, sizeStr } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";
import { connect } from "../accounts.js";

let accs = [], acc = null, folders = [], folder = "INBOX", page = 0, query = "", unread = false;
let msgs = [], more = false, total = 0, current = null, selected = new Set(), timer = null, root = null;
const FOLDER_ICON = { inbox: "inbox", sent: "send", drafts: "edit", trash: "trash", junk: "alert", archive: "archive", all: "layers", flagged: "star" };

const when = ts => {
  if (!ts) return "";
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};
const who = list => (list && list[0]) ? (list[0].name || list[0].email) : "?";
const initial = s => (s || "?").trim().charAt(0).toUpperCase();
const hue = s => [...(s || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const addr = list => (list || []).map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(", ");

export async function render(el, parts, q) {
  root = el;
  ({ accounts: accs } = await api("/api/mail"));
  root.innerHTML = pageHead("mails", accs.length ? `<button class="btn ghost" id="ml-away">${icon("sun")}Absence</button><button class="btn ghost" id="ml-rules">${icon("sliders")}Règles</button><button class="btn ghost" id="ml-acc">${icon("settings")}Comptes</button><button class="btn" id="ml-write">${icon("edit")}Écrire</button>` : "")
    + `<div id="ml-body"></div>`;
  if (!accs.length) return empty();
  acc = accs.find(a => a.id === parts[0]) || accs.find(a => a.id === acc?.id) || accs[0];
  if (parts[0] && q?.uid) folder = "INBOX";
  history.replaceState(null, "", "#/mails");
  $("#ml-body").innerHTML = `<div class="ml-layout" data-pane="list">
      <aside class="ml-side card"><div id="ml-accs"></div>
        <button class="btn ghost small wide" id="ml-add">${icon("plus")}Ajouter une boîte mail</button></aside>
      <section class="ml-list card">
        <div class="ml-bar">
          <button class="icon-btn plain ml-only-mobile" id="ml-menu" title="Dossiers">${icon("menu")}</button>
          <div class="ml-search grow">${icon("search")}<input type="search" id="ml-q" placeholder="Rechercher dans les mails…"></div>
          <button class="icon-btn plain" id="ml-refresh" title="Actualiser">${icon("refresh")}</button>
        </div>
        <div class="ml-sub"><b id="ml-fname"></b><span class="grow"></span>
          <div class="seg small" id="ml-filter"><label><input type="radio" name="mlf" value="0" checked>Tous</label><label><input type="radio" name="mlf" value="1">Non lus</label></div></div>
        <div class="ml-bulk" id="ml-bulk" hidden></div>
        <div id="ml-items" class="ml-items"></div>
      </section>
      <section class="ml-read card" id="ml-read"><div class="empty">${icon("mail")}<b>Choisis un mail</b>Il s'affiche ici.</div></section>
    </div>`;
  $("#ml-write").onclick = () => compose({});
  $("#ml-acc").onclick = () => location.hash = "#/reglages/enligne";
  $("#ml-rules").onclick = rulesPanel;
  $("#ml-away").onclick = awayPanel;
  $("#ml-add").onclick = () => connect({ want: "mail", onDone: a => { acc = a; render(root, [a.id]); } });
  $("#ml-menu").onclick = () => $(".ml-layout").dataset.pane = "side";
  $("#ml-refresh").onclick = () => { loadFolders(); loadList(); };
  let t = null;
  $("#ml-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); page = 0; loadList(); }, 400); };
  $("#ml-filter").onchange = e => { unread = e.target.value === "1"; page = 0; loadList(); };
  paintAccounts();
  await Promise.all([loadFolders(), loadList(), loadScheduledCount()]);
  if (q?.uid) openMessage(q.uid);
  if (q?.to) compose({ to: q.to });
  clearInterval(timer);
  timer = setInterval(() => {
    if (!$("#ml-items")) return clearInterval(timer);
    if (!document.hidden && page === 0 && !query) loadList(true);
  }, 60000);
}

export function leave() { clearInterval(timer); }

function empty() {
  $("#ml-body").innerHTML = `<div class="card ml-hero"><span class="tile bleu-vert big">${icon("mail")}</span>
    <h2>Tes mails, dans Bêta Tool</h2>
    <p class="hint">Raccorde ta boîte iCloud, Gmail, Outlook, Orange, Free… Les mails restent chez ton fournisseur ; tu les lis ici, tu réponds, tu ranges tes pièces jointes sur le NAS ou dans Paperasse, et tu es prévenu des nouveaux.</p>
    <button class="btn" id="ml-first">${icon("plus")}Ajouter une boîte mail</button></div>`;
  $("#ml-first").onclick = () => connect({ want: "mail", onDone: a => render(root, [a.id]) });
}

function paintAccounts() {
  $("#ml-accs").innerHTML = accs.map(a => `<div class="ml-acc ${a.id === acc.id ? "on" : ""}">
      <button class="ml-acc-head" data-acc="${a.id}"><span class="ml-av" style="--h:${hue(a.label)}">${initial(a.label)}</span>
        <span class="grow"><b>${esc(a.label)}</b><small class="meta">${esc(a.provider_label)}</small></span>${a.unread ? `<span class="count">${a.unread}</span>` : ""}</button>
      ${a.id === acc.id ? `<nav class="ml-folders" id="ml-folders"><p class="meta"><span class="spinner"></span></p></nav>` : ""}</div>`).join("");
  $("#ml-accs").onclick = e => {
    const h = e.target.closest("[data-acc]");
    if (h && h.dataset.acc !== acc.id) {
      acc = accs.find(a => a.id === h.dataset.acc);
      folder = "INBOX"; page = 0; query = ""; $("#ml-q").value = "";
      paintAccounts(); loadFolders(); loadList(); showReader(null);
      return;
    }
    const f = e.target.closest("[data-folder]");
    if (f) {
      folder = f.dataset.folder; page = 0;
      $(".ml-layout").dataset.pane = "list";
      paintFolders(); loadList(); showReader(null);
    }
    if (e.target.closest("[data-newfolder]")) newFolder();
  };
}

async function loadFolders() {
  try { ({ folders } = await api(`/api/mail/${acc.id}/folders`)); }
  catch (err) { $("#ml-folders") && ($("#ml-folders").innerHTML = `<p class="hint">${icon("alert")} ${esc(err.message)}</p>`); return; }
  const inbox = folders.find(f => f.role === "inbox");
  acc.unread = inbox?.unread || 0;
  paintFolders();
}

const SCHEDULED = "__programmes__";
let scheduledCount = 0;

function paintFolders() {
  const el = $("#ml-folders");
  if (!el) return;
  el.innerHTML = folders.map(f => `<button class="ml-folder ${f.name === folder ? "on" : ""}" data-folder="${esc(f.name)}" style="--d:${Math.min(f.depth, 3)}">
      ${icon(FOLDER_ICON[f.role] || "folder")}<span class="grow">${esc(f.label)}</span>${f.unread ? `<span class="count">${f.unread}</span>` : ""}</button>`).join("")
    + `<button class="ml-folder ${folder === SCHEDULED ? "on" : ""}" data-folder="${SCHEDULED}">${icon("clock")}<span class="grow">Programmés</span>${scheduledCount ? `<span class="count">${scheduledCount}</span>` : ""}</button>`
    + `<button class="ml-folder" data-newfolder>${icon("plus")}<span class="grow meta">Nouveau dossier</span></button>`;
  const cur = folders.find(f => f.name === folder);
  $("#ml-fname").textContent = cur?.label || folder;
  const head = $(`.ml-acc.on .count`);
  if (head) head.textContent = acc.unread || "";
}

const role = () => folders.find(f => f.name === folder)?.role;

async function loadScheduledCount() {
  try { scheduledCount = (await api("/api/mail/scheduled")).filter(x => x.account === acc.id).length; paintFolders(); } catch {}
}

async function loadScheduled() {
  const list = $("#ml-items");
  const items = (await api("/api/mail/scheduled")).filter(x => x.account === acc.id);
  scheduledCount = items.length;
  msgs = []; selected.clear(); paintBulk();
  list.innerHTML = items.length ? items.map(x => `<div class="ml-item ml-sched">
      <span class="ml-av" style="--h:200">${icon("clock")}</span>
      <div class="grow ml-lines"><div class="ml-l1"><b class="grow">À : ${esc(x.to)}</b><small class="meta">${new Date(x.at * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
        <div class="ml-l2"><span class="grow">${esc(x.subject)}</span>
          <button class="btn ghost small" data-snow="${x.id}">${icon("send")}Envoyer</button><button class="icon-btn plain" data-sdel="${x.id}" title="Annuler">${icon("trash")}</button></div></div></div>`).join("")
    : `<div class="empty">${icon("clock")}<b>Aucun mail programmé</b>Dans un nouveau mail, coche « Envoyer plus tard ».</div>`;
  list.onclick = async e => {
    const b = e.target.closest("[data-snow],[data-sdel]");
    if (!b) return;
    if (b.dataset.sdel) { if (!confirm("Annuler l'envoi de ce mail ?")) return; await api(`/api/mail/scheduled/${b.dataset.sdel}`, { method: "DELETE" }); toast("Envoi annulé"); }
    else { await api(`/api/mail/scheduled/${b.dataset.snow}/now`, { json: {} }); toast("Mail envoyé"); }
    loadScheduled(); paintFolders();
  };
}

async function loadList(quiet = false) {
  if (folder === SCHEDULED) return loadScheduled();
  const list = $("#ml-items");
  if (!quiet) list.innerHTML = `<p class="meta" style="padding:16px"><span class="spinner"></span></p>`;
  try {
    const r = await api(`/api/mail/${acc.id}/messages?folder=${encodeURIComponent(folder)}&page=${page}&q=${encodeURIComponent(query)}&unread=${unread ? 1 : 0}`);
    msgs = page ? msgs.concat(r.messages) : r.messages;
    more = r.more; total = r.total;
  } catch (err) { list.innerHTML = `<div class="empty">${icon("alert")}<b>Boîte inaccessible</b>${esc(err.message)}</div>`; return; }
  if (quiet && current == null) selected.clear();
  paintList();
}

function paintList() {
  const list = $("#ml-items");
  const sentLike = ["sent", "drafts"].includes(role());
  if (!msgs.length) {
    list.innerHTML = `<div class="empty">${icon(query ? "search" : "inbox")}<b>${query ? "Aucun résultat" : unread ? "Tout est lu" : "Aucun mail"}</b>${query ? "Essaie d'autres mots." : ""}</div>`;
    paintBulk();
    return;
  }
  list.innerHTML = msgs.map((m, i) => {
    const name = sentLike ? "À : " + who(m.to) : who(m.from);
    return `<div class="ml-item ${m.seen ? "" : "unread"} ${current === m.uid ? "on" : ""} ${selected.has(m.uid) ? "sel" : ""}" data-i="${i}">
      <label class="ml-check" title="Sélectionner"><input type="checkbox" data-sel="${m.uid}" ${selected.has(m.uid) ? "checked" : ""}><span class="ml-av" style="--h:${hue(name)}">${initial(name.replace("À : ", ""))}</span></label>
      <div class="grow ml-lines"><div class="ml-l1"><b class="grow">${esc(name)}</b><small class="meta">${when(m.date)}</small></div>
        <div class="ml-l2"><span class="grow">${m.answered ? icon("back") : ""}${esc(m.subject)}</span>${secBadge(m.security)}${m.attach ? icon("link", "ml-pj") : ""}
          <button class="icon-btn plain ml-star ${m.flagged ? "on" : ""}" data-star="${m.uid}" title="${m.flagged ? "Ne plus suivre" : "Suivre"}">${icon("star")}</button></div></div></div>`;
  }).join("") + (more ? `<button class="btn ghost small wide" id="ml-more">Afficher plus (${total - msgs.length} restants)</button>` : "");
  list.onclick = e => {
    const st = e.target.closest("[data-star]");
    if (st) { e.stopPropagation(); const m = msgs.find(x => x.uid === st.dataset.star); act(m.flagged ? "unstar" : "star", [m.uid]); return; }
    if (e.target.closest(".ml-check")) return;
    const it = e.target.closest("[data-i]");
    if (it) openMessage(msgs[+it.dataset.i].uid);
  };
  list.onchange = e => {
    const c = e.target.closest("[data-sel]");
    if (!c) return;
    c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel);
    c.closest(".ml-item").classList.toggle("sel", c.checked);
    paintBulk();
  };
  $("#ml-more")?.addEventListener("click", () => { page++; loadList(true); });
  paintBulk();
}

function paintBulk() {
  const bar = $("#ml-bulk");
  selected = new Set([...selected].filter(u => msgs.some(m => m.uid === u)));
  bar.hidden = !selected.size;
  if (!selected.size) return;
  const inTrash = role() === "trash", inJunk = role() === "junk";
  bar.innerHTML = `<b>${selected.size} sélectionné${selected.size > 1 ? "s" : ""}</b><span class="grow"></span>
    <button class="icon-btn plain" data-b="read" title="Marquer comme lu">${icon("eye")}</button>
    <button class="icon-btn plain" data-b="unread" title="Marquer comme non lu">${icon("mail")}</button>
    ${inTrash ? "" : `<button class="icon-btn plain" data-b="archive" title="Archiver">${icon("archive")}</button>`}
    <button class="icon-btn plain" data-b="${inJunk ? "notjunk" : "junk"}" title="${inJunk ? "Pas un indésirable" : "Indésirable"}">${icon("alert")}</button>
    <button class="icon-btn plain" data-b="move" title="Déplacer">${icon("move")}</button>
    <button class="icon-btn plain" data-b="trash" title="${inTrash ? "Supprimer définitivement" : "Corbeille"}">${icon("trash")}</button>
    <button class="icon-btn plain" data-b="none" title="Annuler la sélection">${icon("x")}</button>`;
  bar.onclick = e => {
    const b = e.target.closest("[data-b]");
    if (!b) return;
    const uids = [...selected];
    if (b.dataset.b === "none") { selected.clear(); paintList(); return; }
    if (b.dataset.b === "move") return moveDialog(uids);
    act(b.dataset.b, uids);
  };
}

async function act(op, uids, extra = {}) {
  if (op === "trash" && role() === "trash" && !confirm(`Supprimer définitivement ${uids.length > 1 ? `ces ${uids.length} mails` : "ce mail"} ?`)) return;
  try { await api(`/api/mail/${acc.id}/action`, { json: { folder, uids, op, ...extra } }); }
  catch (err) { return toast(err.message, "err"); }
  const flag = { read: ["seen", true], unread: ["seen", false], star: ["flagged", true], unstar: ["flagged", false] }[op];
  if (flag) {
    msgs.forEach(m => { if (uids.includes(m.uid)) m[flag[0]] = flag[1]; });
  } else {
    msgs = msgs.filter(m => !uids.includes(m.uid));
    total -= uids.length;
    toast({ trash: role() === "trash" ? "Supprimé" : "Mis à la corbeille", archive: "Archivé", junk: "Déplacé dans Indésirables", notjunk: "Remis dans la boîte de réception", move: "Déplacé", delete: "Supprimé" }[op] || "Fait");
    if (uids.includes(current)) showReader(null);
  }
  uids.forEach(u => selected.delete(u));
  paintList();
  if (["read", "unread"].includes(op) || !flag) loadFolders();
}

function moveDialog(uids) {
  const m = modal("Déplacer vers…", `<div class="ml-movelist">${folders.filter(f => f.name !== folder).map(f =>
    `<button class="ml-folder" data-to="${esc(f.name)}" style="--d:${Math.min(f.depth, 3)}">${icon(FOLDER_ICON[f.role] || "folder")}<span class="grow">${esc(f.label)}</span></button>`).join("")}</div>`, { ic: "move" });
  m.onclick = e => { const b = e.target.closest("[data-to]"); if (b) { closePanel(); act("move", uids, { to: b.dataset.to }); } };
}

async function newFolder() {
  const name = prompt("Nom du nouveau dossier");
  if (!name?.trim()) return;
  try { await api(`/api/mail/${acc.id}/folders`, { json: { name: name.trim() } }); toast("Dossier créé"); loadFolders(); }
  catch (err) { toast(err.message, "err"); }
}

// --- Lecture --------------------------------------------------------------------------

function showReader(html) {
  const r = $("#ml-read");
  if (!r) return;
  if (html == null) {
    current = null;
    r.innerHTML = `<div class="empty">${icon("mail")}<b>Choisis un mail</b>Il s'affiche ici.</div>`;
    $(".ml-layout").dataset.pane = "list";
    $$items().forEach(x => x.classList.remove("on"));
    return;
  }
  r.innerHTML = html;
}
const $$items = () => [...document.querySelectorAll(".ml-item")];

async function openMessage(uid, images = false) {
  current = String(uid);
  $$items().forEach(x => x.classList.toggle("on", msgs[+x.dataset.i]?.uid === current));
  $(".ml-layout").dataset.pane = "read";
  showReader(`<p class="meta" style="padding:20px"><span class="spinner"></span></p>`);
  let d;
  try { d = await api(`/api/mail/${acc.id}/message?folder=${encodeURIComponent(folder)}&uid=${uid}`); }
  catch (err) { return showReader(`<div class="empty">${icon("alert")}<b>Mail introuvable</b>${esc(err.message)}</div>`); }
  if (current !== String(uid)) return;
  const m = msgs.find(x => x.uid === current);
  if (m && !m.seen) { m.seen = true; paintList(); loadFolders(); }
  const inTrash = role() === "trash";
  showReader(`<div class="ml-rbar">
      <button class="icon-btn plain ml-only-mobile" data-r="back" title="Retour">${icon("left")}</button>
      <button class="btn small" data-r="reply">${icon("back")}Répondre</button>
      ${d.to.length + d.cc.length > 1 ? `<button class="btn ghost small" data-r="replyall">${icon("users")}<span class="ml-hide-s">Répondre à tous</span></button>` : ""}
      <button class="btn ghost small" data-r="forward">${icon("send")}<span class="ml-hide-s">Transférer</span></button><span class="grow"></span>
      ${inTrash ? "" : `<button class="icon-btn plain" data-r="archive" title="Archiver">${icon("archive")}</button>`}
      <button class="icon-btn plain" data-r="trash" title="${inTrash ? "Supprimer définitivement" : "Corbeille"}">${icon("trash")}</button>
      <button class="icon-btn plain" data-r="unread" title="Marquer comme non lu">${icon("mail")}</button>
      <button class="icon-btn plain" data-r="move" title="Déplacer">${icon("move")}</button>
      <button class="icon-btn plain" data-r="rule" title="Créer une règle pour ces mails">${icon("sliders")}</button>
      <button class="icon-btn plain" data-r="event" title="Ajouter à l'agenda">${icon("calendar")}</button></div>
    <div class="ml-rhead"><h2>${esc(d.subject)}</h2>
      <div class="ml-from"><span class="ml-av big" style="--h:${hue(who(d.from))}">${initial(who(d.from))}</span>
        <div class="grow"><b>${esc(who(d.from))}</b> <small class="meta">${esc(d.from[0]?.email || "")}</small>
          ${d.from[0]?.email && !d.security?.trusted && d.security?.level !== "phishing" ? `<button class="ml-addct" data-r="addcontact" title="Ajouter aux contacts">${icon("plus")}Contact</button>` : ""}
          <small class="meta ml-to">À : ${esc(addr(d.to)) || "—"}${d.cc.length ? ` · Cc : ${esc(addr(d.cc))}` : ""}</small></div>
        <small class="meta">${d.date ? new Date(d.date * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</small></div></div>
    ${inviteBanner(d.invite)}
    ${unsubBanner(d.unsubscribe)}
    ${secBanner(d.security)}
    ${d.remote_images && !images && d.security?.level !== "phishing" ? `<div class="ml-imgs">${icon("eye")}<span class="grow">Images distantes bloquées pour protéger ta vie privée (elles servent souvent à savoir si tu as ouvert le mail).</span><button class="btn ghost small" data-r="images">Afficher les images</button></div>` : ""}
    ${d.attachments.length ? `<div class="ml-atts">${d.attachments.map(a => `<div class="ml-att">${icon(a.type === "application/pdf" ? "pdf" : a.type.startsWith("image/") ? "image" : "file")}
      <a class="grow" href="/api/mail/${acc.id}/part?folder=${encodeURIComponent(folder)}&uid=${d.uid}&n=${a.n}&inline=1" target="_blank" rel="noopener" title="Ouvrir"><b>${esc(a.name)}</b><small class="meta">${sizeStr(a.size)}</small></a>
      <a class="icon-btn plain" href="/api/mail/${acc.id}/part?folder=${encodeURIComponent(folder)}&uid=${d.uid}&n=${a.n}" title="Télécharger">${icon("download")}</a>
      <button class="icon-btn plain" data-save="${a.n}" title="Enregistrer sur le NAS">${icon("nas")}</button>
      ${/pdf|image\/(jpe?g|png|heic)/.test(a.type) ? `<button class="icon-btn plain" data-paper="${a.n}" title="Envoyer à Paperasse">${icon("receipt")}</button>` : ""}</div>`).join("")}</div>` : ""}
    <div class="ml-frame-wrap"><iframe class="ml-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Contenu du mail"></iframe></div>`);
  fillInviteCalendars();
  const fr = $(".ml-frame");
  const csp = `default-src 'none'; img-src data: ${images ? "https: http:" : ""}; style-src 'unsafe-inline' ${images ? "https:" : ""}; font-src data: ${images ? "https:" : ""}`;
  fr.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
    <style>html,body{margin:0;background:#fff;color:#1f2937;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}body{padding:2px 4px}
    img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #cbd5e1;margin:8px 0 8px 2px;padding-left:12px;color:#475569}a{color:#2563eb}pre{white-space:pre-wrap}</style></head>
    <body>${d.html}</body></html>`;
  const fit = () => { try { fr.style.height = Math.min(20000, fr.contentDocument.documentElement.scrollHeight + 8) + "px"; } catch {} };
  fr.onload = () => {
    fit();
    try {
      fr.contentDocument.querySelectorAll("img").forEach(i => i.addEventListener("load", fit));
      new ResizeObserver(fit).observe(fr.contentDocument.body);
    } catch {}
  };
  $("#ml-read").onclick = async e => {
    const b = e.target.closest("[data-r],[data-save],[data-paper]");
    if (!b) return;
    if (b.dataset.save || b.dataset.paper) {
      const dest = b.dataset.paper ? "paperasse" : "nas";
      try { const r = await api(`/api/mail/${acc.id}/part/save`, { json: { folder, uid: d.uid, n: +(b.dataset.save || b.dataset.paper), dest } }); toast(dest === "nas" ? `Enregistré dans ${r.where}` : "Envoyé à Paperasse : il sera lu et rangé"); }
      catch (err) { toast(err.message, "err"); }
      return;
    }
    const r = b.dataset.r;
    if (r === "back") return showReader(null);
    if (r === "images") return openMessage(d.uid, true);
    if (r === "unsub") {
      b.disabled = true;
      try {
        const res = await api(`/api/mail/${acc.id}/unsubscribe`, { json: { folder, uid: d.uid } });
        if (res.ok) { toast(`Désabonné ${res.method === "mail" ? "(demande envoyée par mail)" : "en un clic"} : tu ne devrais plus recevoir ces mails`); d.unsubscribe.done = Date.now() / 1000; }
        else { window.open(res.open, "_blank", "noopener"); d.unsubscribe.pending = true; }
        $(".ml-unsub").outerHTML = unsubBanner(d.unsubscribe);
      } catch (err) { toast(err.message, "err"); b.disabled = false; }
      return;
    }
    if (r === "unsubok") {
      await api(`/api/mail/${acc.id}/unsubscribed`, { json: { sender: d.unsubscribe.sender } });
      d.unsubscribe.done = Date.now() / 1000; d.unsubscribe.pending = false;
      $(".ml-unsub").outerHTML = unsubBanner(d.unsubscribe);
      return;
    }
    if (r === "cleanup") {
      if (!confirm(`Mettre à la corbeille tous les mails de ${d.unsubscribe.sender} de ce dossier ?`)) return;
      try {
        const res = await api(`/api/mail/${acc.id}/cleanup`, { json: { folder, sender: d.unsubscribe.sender } });
        toast(`${res.moved} mail${res.moved > 1 ? "s" : ""} mis à la corbeille`);
        showReader(null); loadList(); loadFolders();
      } catch (err) { toast(err.message, "err"); }
      return;
    }
    if (r === "rule") return ruleFor(d);
    if (r === "event") return mailToEvent(d);
    if (r.startsWith("inv-")) return answerInvite(d, r.slice(4), b);
    if (r === "addcontact") {
      const f = d.from[0], parts = (f.name || "").replace(/["']/g, "").trim().split(/\s+/);
      const { edit } = await import("./contacts.js");
      return edit({ first: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "", last: parts.length > 1 ? parts.at(-1) : "", emails: [{ type: "HOME", value: f.email }] },
        () => { toast(`${f.name || f.email} ajouté aux contacts : ses mails ne seront plus signalés`); openMessage(d.uid); });
    }
    if (r === "fiable" || r === "faux") {
      try {
        const res = await api(`/api/mail/${acc.id}/verdict`, { json: { folder, uid: d.uid, verdict: r } });
        toast(r === "faux" ? `Rangé dans Indésirables. Les prochains mails de ${res.sender} iront aussi.` : `${res.sender} est marqué comme fiable${res.moved ? " : remis dans la boîte de réception" : ""}`);
        if (res.moved) { msgs = msgs.filter(m => m.uid !== String(d.uid)); showReader(null); }
        else { const m = msgs.find(x => x.uid === String(d.uid)); if (m) delete m.security; openMessage(d.uid); }
        paintList(); loadFolders();
      } catch (err) { toast(err.message, "err"); }
      return;
    }
    if (["reply", "replyall", "forward"].includes(r)) return compose({ mode: r, msg: d });
    if (r === "move") return moveDialog([d.uid]);
    act(r, [d.uid]);
  };
}

// --- Règles de tri ----------------------------------------------------------------------------

const FIELDS = [["from", "L'expéditeur"], ["subject", "L'objet"], ["body", "Le texte"], ["to", "Les destinataires"],
  ["newsletter", "C'est une newsletter"], ["attachment", "Il y a une pièce jointe"], ["book", "L'expéditeur est dans le carnet"]];
const OPS = [["contains", "contient"], ["not_contains", "ne contient pas"], ["is", "est exactement"], ["ends", "vient du domaine"]];
const ACTS = [["move", "Ranger dans le dossier"], ["read", "Marquer comme lu"], ["star", "Suivre (étoile)"], ["silent", "Ne pas me notifier"],
  ["paperasse", "Envoyer les pièces jointes à Paperasse"], ["trash", "Mettre à la corbeille"]];

async function rulesPanel() {
  const items = await api("/api/mail/rules");
  const text = r => `Si ${r.conditions.map(c => {
      const f = FIELDS.find(x => x[0] === c.field)?.[1] || c.field;
      if (c.field === "newsletter" || c.field === "attachment") return (c.value === "no" ? "ce n'est pas : " : "") + f.toLowerCase();
      if (c.field === "book") return `${f.toLowerCase()} « ${c.value === "any" ? "n'importe lequel" : c.value === "none" ? "aucun" : c.value.replace(/^contacts-/, "")} »`;
      return `${f.toLowerCase()} ${OPS.find(o => o[0] === c.op)?.[1]} « ${c.value} »`;
    }).join(r.match === "any" ? " ou " : " et ")} → ${r.actions.map(a => a.type === "move" ? `ranger dans « ${a.folder} »` : ACTS.find(x => x[0] === a.type)?.[1].toLowerCase()).join(", ")}`;
  const m = modal("Règles de tri", `<div class="ml-rules">
    <p class="hint" style="margin-top:0">Elles s'appliquent toutes seules aux nouveaux mails de la boîte de réception, dans l'ordre, juste après le filtre anti-faux mails.</p>
    ${items.length ? items.map((r, i) => `<div class="ml-rule ${r.on ? "" : "off"}">
      <label class="switch" title="Activer"><input type="checkbox" data-on="${r.id}" ${r.on ? "checked" : ""}><span></span></label>
      <div class="grow"><b>${esc(r.name)}</b><small class="meta">${esc(text(r))}${r.account && r.account !== "*" ? ` · ${esc(accs.find(a => a.id === r.account)?.label || "")}` : ""}</small></div>
      <button class="icon-btn plain" data-up="${r.id}" ${i ? "" : "disabled"} title="Monter">${icon("arrow")}</button>
      <button class="icon-btn plain" data-edit="${r.id}" title="Modifier">${icon("edit")}</button>
      <button class="icon-btn plain" data-del="${r.id}" title="Supprimer">${icon("trash")}</button></div>`).join("")
      : `<div class="empty">${icon("sliders")}<b>Aucune règle</b>Exemples : ranger les newsletters dans un dossier, envoyer les factures EDF à Paperasse, marquer comme lus les mails du club…</div>`}
    <div class="modal-foot"><button class="btn ghost" data-a="apply" ${items.length ? "" : "disabled"}>${icon("refresh")}Appliquer aux mails déjà reçus</button><span class="grow"></span>
      <button class="btn" data-a="new">${icon("plus")}Nouvelle règle</button></div></div>`, { ic: "sliders", large: true });
  m.onchange = async e => { const t = e.target.closest("[data-on]"); if (t) { await api(`/api/mail/rules/${t.dataset.on}`, { method: "PUT", json: { on: t.checked } }); t.closest(".ml-rule").classList.toggle("off", !t.checked); } };
  m.onclick = async e => {
    const b = e.target.closest("[data-a],[data-edit],[data-del],[data-up]");
    if (!b) return;
    if (b.dataset.a === "new") { closePanel(); return setTimeout(() => ruleEditor({}), 250); }
    if (b.dataset.edit) { closePanel(); return setTimeout(() => ruleEditor(items.find(r => r.id === b.dataset.edit)), 250); }
    if (b.dataset.del && confirm("Supprimer cette règle ?")) { await api(`/api/mail/rules/${b.dataset.del}`, { method: "DELETE" }); closePanel(); return setTimeout(rulesPanel, 250); }
    if (b.dataset.up) { await api(`/api/mail/rules/${b.dataset.up}`, { method: "PUT", json: { move: "up" } }); closePanel(); return setTimeout(rulesPanel, 250); }
    if (b.dataset.a === "apply") {
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>Tri en cours…`;
      try {
        const r = await api("/api/mail/rules/apply", { json: { account: acc.id } });
        toast(`${r.matched} mail${r.matched > 1 ? "s" : ""} concerné${r.matched > 1 ? "s" : ""}, ${r.moved} rangé${r.moved > 1 ? "s" : ""}`);
        closePanel(); loadList(); loadFolders();
      } catch (err) { toast(err.message, "err"); b.disabled = false; }
    }
  };
}

function ruleFor(d) {
  const f = d.from[0] || {};
  ruleEditor({ name: f.name || f.email, account: acc.id, conditions: [{ field: "from", op: "is", value: f.email || "" }],
    actions: [{ type: "move", folder: d.unsubscribe ? "Newsletters" : "" }] });
}

async function ruleEditor(r) {
  let books = [];
  try { books = (await api("/api/contacts?q=%00")).books; } catch {}
  const folderNames = folders.filter(f => f.role !== "inbox").map(f => f.name);
  const condRow = (c = { field: "from", op: "contains", value: "" }) => `<div class="ml-cond">
    <select data-k="field">${FIELDS.map(([v, l]) => `<option value="${v}" ${c.field === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select data-k="op">${OPS.map(([v, l]) => `<option value="${v}" ${c.op === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select data-k="yn"><option value="yes" ${c.value !== "no" ? "selected" : ""}>oui</option><option value="no" ${c.value === "no" ? "selected" : ""}>non</option></select>
    <select data-k="book"><option value="any">n'importe lequel</option><option value="none" ${c.value === "none" ? "selected" : ""}>aucun (inconnu)</option>
      ${books.map(b => `<option value="${b.id}" ${c.value === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
    <input type="text" data-k="value" value="${esc(["newsletter", "attachment", "book"].includes(c.field) ? "" : c.value)}" placeholder="ex. edf.fr, facture">
    <button type="button" class="icon-btn plain" data-rm>${icon("x")}</button></div>`;
  const has = t => (r.actions || []).find(a => a.type === t);
  const m = modal(r.id ? "Modifier la règle" : "Nouvelle règle", `<form class="ml-rform">
    <div class="grid2"><div><label class="field">Nom</label><input type="text" name="name" value="${esc(r.name || "")}" placeholder="Ex. Newsletters, Factures EDF"></div>
      <div><label class="field">Boîte mail</label><select name="account" style="width:100%"><option value="*">Toutes mes boîtes</option>
        ${accs.map(a => `<option value="${a.id}" ${(r.account || "*") === a.id ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div></div>
    <label class="field">Quand <select name="match" class="inline"><option value="all">toutes les conditions</option><option value="any" ${r.match === "any" ? "selected" : ""}>au moins une condition</option></select> sont vraies</label>
    <div id="ml-conds">${(r.conditions?.length ? r.conditions : [undefined]).map(condRow).join("")}</div>
    <button type="button" class="btn ghost small" data-addc>${icon("plus")}Condition</button>
    <p class="hint">Plusieurs mots séparés par des virgules : il suffit d'un seul (ex. « facture, échéance »).</p>
    <label class="field">Alors</label>
    <div class="ml-acts">${ACTS.map(([v, l]) => `<label class="check"><input type="checkbox" name="act" value="${v}" ${has(v) ? "checked" : ""}> ${l}
      ${v === "move" ? `<input type="text" name="folder" list="ml-fnames" value="${esc(has("move")?.folder || "")}" placeholder="Dossier (créé s'il n'existe pas)">` : ""}</label>`).join("")}</div>
    <datalist id="ml-fnames">${folderNames.map(n => `<option value="${esc(n)}">`).join("")}<option value="Newsletters"><option value="Factures"></datalist>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "sliders", large: true });
  const f = m.querySelector("form");
  const sync = () => m.querySelectorAll(".ml-cond").forEach(row => {
    const field = row.querySelector("[data-k=field]").value;
    row.querySelector("[data-k=op]").hidden = ["newsletter", "attachment", "book"].includes(field);
    row.querySelector("[data-k=value]").hidden = ["newsletter", "attachment", "book"].includes(field);
    row.querySelector("[data-k=yn]").hidden = !["newsletter", "attachment"].includes(field);
    row.querySelector("[data-k=book]").hidden = field !== "book";
  });
  sync();
  m.addEventListener("change", sync);
  m.addEventListener("click", e => {
    if (e.target.closest("[data-addc]")) { m.querySelector("#ml-conds").insertAdjacentHTML("beforeend", condRow()); sync(); }
    const rm = e.target.closest("[data-rm]");
    if (rm && m.querySelectorAll(".ml-cond").length > 1) rm.closest(".ml-cond").remove();
  });
  f.folder.addEventListener("input", () => { f.querySelector("[name=act][value=move]").checked = !!f.folder.value.trim(); });
  f.onsubmit = async e => {
    e.preventDefault();
    const conditions = [...m.querySelectorAll(".ml-cond")].map(row => {
      const field = row.querySelector("[data-k=field]").value;
      const value = ["newsletter", "attachment"].includes(field) ? row.querySelector("[data-k=yn]").value
        : field === "book" ? row.querySelector("[data-k=book]").value : row.querySelector("[data-k=value]").value;
      return { field, op: row.querySelector("[data-k=op]").value, value };
    });
    const actions = [...f.querySelectorAll("[name=act]:checked")].map(x => ({ type: x.value, folder: x.value === "move" ? f.folder.value : "" }));
    const body = { name: f.name.value, account: f.account.value, match: f.match.value, conditions, actions, on: r.on ?? true };
    try {
      await api(r.id ? `/api/mail/rules/${r.id}` : "/api/mail/rules", { method: r.id ? "PUT" : "POST", json: body });
      closePanel();
      toast(r.id ? "Règle enregistrée" : "Règle créée : elle s'applique aux prochains mails");
      setTimeout(rulesPanel, 250);
    } catch (err) { toast(err.message, "err"); }
  };
}

// --- Invitations et agenda ----------------------------------------------------------------

const ANSWER = { ACCEPTED: "Accepté", TENTATIVE: "Peut-être", DECLINED: "Refusé" };
let agendaInfo = null;

function inviteBanner(inv) {
  if (!inv) return "";
  const s = new Date(inv.start), e = new Date(inv.end);
  const when = inv.allday ? s.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : `${s.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}, ${s.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const head = `<div class="ml-inv-head">${icon("calendar")}<div class="grow"><b>${esc(inv.title)}</b><small>${esc(when.charAt(0).toUpperCase() + when.slice(1))}${inv.location ? ` · ${esc(inv.location)}` : ""}${inv.recur_text ? ` · ${esc(inv.recur_text)}` : ""}</small>
    <small class="meta">${inv.organizer ? `Organisé par ${esc(inv.organizer)}` : ""}${inv.attendees ? ` · ${inv.attendees} invité${inv.attendees > 1 ? "s" : ""}` : ""}</small></div></div>`;
  if (inv.method === "CANCEL") return `<div class="ml-inv cancel">${head}<p><b>Cet événement est annulé.</b></p>${inv.in_agenda ? `<div class="row"><button class="btn small" data-r="inv-remove">${icon("trash")}Retirer de l'agenda</button></div>` : ""}</div>`;
  if (inv.method === "REPLY") return `<div class="ml-inv">${head}<p>${esc(inv.reply_from)} a répondu : <b>${esc(ANSWER[inv.reply_status] || inv.reply_status)}</b></p></div>`;
  return `<div class="ml-inv">${head}
    ${inv.in_agenda ? `<p class="meta">${icon("check")} Dans ton agenda « ${esc(inv.in_agenda)} »${inv.my_status ? ` · ta réponse : ${esc(ANSWER[inv.my_status] || inv.my_status)}` : ""}</p>` : ""}
    <div class="row"><select data-invcal></select>
      <button class="btn small" data-r="inv-ACCEPTED">${icon("check")}Accepter</button>
      <button class="btn ghost small" data-r="inv-TENTATIVE">Peut-être</button>
      <button class="btn ghost small" data-r="inv-DECLINED">${icon("x")}Refuser</button></div></div>`;
}

async function fillInviteCalendars() {
  const sel = document.querySelector("[data-invcal]");
  if (!sel) return;
  try { agendaInfo = agendaInfo || await api("/api/agenda"); } catch { sel.hidden = true; return; }
  sel.innerHTML = agendaInfo.calendars.filter(c => !c.readonly).map(c => `<option value="${c.id}">${esc(c.name)}${c.external ? ` (${esc(c.account_label)})` : ""}</option>`).join("");
  if (sel.querySelector('option[value="personnel"]')) sel.value = "personnel";
}

async function answerInvite(d, answer, b) {
  const cal = document.querySelector("[data-invcal]")?.value;
  b.disabled = true;
  try {
    const r = await api(`/api/mail/${acc.id}/invite`, { json: { folder, uid: d.uid, answer, cal } });
    toast(r.warning || (answer === "remove" ? "Retiré de l'agenda" : answer === "DECLINED" ? `Invitation refusée${r.sent ? " : l'organisateur est prévenu" : ""}`
      : `Ajouté à ton agenda${r.sent ? " : l'organisateur est prévenu" : ""}`), r.warning ? "err" : "ok");
    openMessage(d.uid);
  } catch (err) { toast(err.message, "err"); b.disabled = false; }
}

async function mailToEvent(d) {
  let s;
  try { s = await api(`/api/mail/${acc.id}/event-suggest?folder=${encodeURIComponent(folder)}&uid=${d.uid}`); } catch (err) { return toast(err.message, "err"); }
  const { newEvent } = await import("./agenda.js");
  const open = c => newEvent({ title: s.title, notes: s.notes, ...(c ? { start: c.start, end: c.end, allday: c.allday } : {}) }, () => {});
  if (s.candidates.length <= 1) return open(s.candidates[0]);
  const m = modal("Ajouter à l'agenda", `<p class="hint" style="margin-top:0">Plusieurs dates dans ce mail : laquelle ?</p>
    <div class="ml-dates">${s.candidates.map((c, i) => `<button class="acc-prov" data-c="${i}">${icon("calendar")}<span class="grow"><b>${esc(new Date(c.start).toLocaleString("fr-FR", c.allday ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}</b>
      <small>« ${esc(c.text)} »</small></span></button>`).join("")}
      <button class="acc-prov" data-c="-1">${icon("edit")}<span class="grow"><b>Autre date</b><small>Je la choisis moi-même</small></span></button></div>`, { ic: "calendar" });
  m.onclick = e => { const b = e.target.closest("[data-c]"); if (b) { closePanel(); setTimeout(() => open(s.candidates[+b.dataset.c]), 250); } };
}

async function awayPanel() {
  const v = await api(`/api/mail/${acc.id}/vacation`);
  const m = modal(`Absence · ${acc.label}`, `<form>
    <label class="check"><input type="checkbox" name="on" ${v.on ? "checked" : ""}> Répondre automatiquement aux mails reçus</label>
    <div class="grid2"><div><label class="field">Du</label><input type="date" name="start" value="${esc(v.start)}"></div><div><label class="field">Au</label><input type="date" name="end" value="${esc(v.end)}"></div></div>
    <label class="field">Objet</label><input type="text" name="subject" value="${esc(v.subject)}">
    <label class="field">Message</label><textarea name="text" rows="5" placeholder="Bonjour, je suis en vacances jusqu'au 15 août et je lirai ton message à mon retour.">${esc(v.text)}</textarea>
    <label class="check"><input type="checkbox" name="contacts_only" ${v.contacts_only ? "checked" : ""}> Seulement à mes contacts</label>
    <p class="hint">Une seule réponse tous les 4 jours par personne ; jamais aux newsletters, aux adresses « no-reply » ni aux faux mails. Bêta Tool doit rester allumé pour répondre.</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "sun" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api(`/api/mail/${acc.id}/vacation`, { method: "PUT", json: { on: f.on.checked, start: f.start.value, end: f.end.value, subject: f.subject.value, text: f.text.value, contacts_only: f.contacts_only.checked } });
      closePanel(); toast(r.active ? "Réponse automatique activée" : r.on ? "Réponse automatique programmée" : "Réponse automatique désactivée");
    } catch (err) { toast(err.message, "err"); }
  };
}

// --- Newsletters ---------------------------------------------------------------------------

function unsubBanner(u) {
  if (!u) return "";
  const when = u.done ? new Date(u.done * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
  return `<div class="ml-unsub ${u.done ? "done" : ""}">${icon(u.done ? "check" : "mail")}
    <span class="grow">${u.done ? `Tu t'es désabonné de cette newsletter le ${when}.` : u.pending ? "Confirme le désabonnement sur la page qui vient de s'ouvrir, puis reviens ici."
      : `Newsletter : tu peux arrêter de la recevoir${u.auto ? " en un clic" : ""}.`}</span>
    ${u.done ? `<button class="btn ghost small" data-r="cleanup">${icon("trash")}Supprimer ses anciens mails</button>`
      : u.pending ? `<button class="btn small" data-r="unsubok">${icon("check")}C'est fait</button><a class="btn ghost small" href="${esc(u.link || "#")}" target="_blank" rel="noopener">${icon("external")}Rouvrir</a>`
      : `<button class="btn small" data-r="unsub">${icon("x")}Se désabonner</button>`}</div>`;
}

// --- Faux mails ----------------------------------------------------------------------------

function secBadge(sec) {
  if (!sec) return "";
  return sec.level === "phishing" ? `<span class="ml-sec bad" title="${esc(sec.reasons.join(" · "))}">${icon("alert")}Faux mail ?</span>`
    : `<span class="ml-sec warn" title="${esc(sec.reasons.join(" · "))}">${icon("alert")}Suspect</span>`;
}

function secBanner(sec) {
  if (!sec || sec.level === "ok") return "";
  const fake = sec.level === "phishing", inJunk = role() === "junk";
  return `<div class="ml-alert ${fake ? "bad" : "warn"}">
    <div class="ml-alert-head">${icon("shield")}<b>${fake ? (inJunk ? "Bêta Tool a rangé ce mail ici : c'est très probablement un faux" : "Faux mail probable : ne clique sur rien, ne réponds pas")
      : "Attention, ce mail pourrait être suspect"}</b></div>
    <ul>${sec.reasons.map(r => `<li>${esc(r.charAt(0).toUpperCase() + r.slice(1))}</li>`).join("")}</ul>
    ${fake ? `<p class="meta">Les liens et les images de ce mail sont désactivés. En cas de doute, va directement sur le site officiel ou appelle le service client.</p>` : ""}
    <div class="row">${inJunk && fake ? "" : `<button class="btn small danger" data-r="faux">${icon("alert")}C'est un faux mail</button>`}
      <button class="btn ghost small" data-r="fiable">${icon("check")}Ce mail est fiable</button></div></div>`;
}

// --- Rédaction --------------------------------------------------------------------------

async function compose({ mode = "", msg = null, to: preset = "" }) {
  const me = (acc.email || "").toLowerCase();
  let to = preset, cc = "", subject = "";
  if (msg) {
    subject = (mode === "forward" ? "Tr : " : "Re : ") + msg.subject.replace(/^((re|tr|fwd?)\s*:\s*)+/i, "");
    if (mode !== "forward") {
      to = addr(msg.reply_to.length ? msg.reply_to : msg.from);
      if (mode === "replyall") cc = addr([...msg.to, ...msg.cc].filter(a => a.email.toLowerCase() !== me && !msg.from.some(f => f.email === a.email)));
    }
  }
  const fromContacts = await api("/api/contacts/suggest").catch(() => []);  // carnets d'adresses d'abord, puis les adresses récentes
  const known = [...new Map([...fromContacts.map(c => ({ name: c.name, email: c.email })), ...msgs.flatMap(m => [...m.from, ...m.to])]
    .filter(a => a.email).map(a => [a.email.toLowerCase(), a])).values()].slice(0, 600);
  const m = modal(mode === "forward" ? "Transférer" : mode ? "Répondre" : "Nouveau mail", `<form class="ml-compose">
    <datalist id="ml-known">${known.map(a => `<option value="${esc(a.name ? `${a.name} <${a.email}>` : a.email)}">`).join("")}</datalist>
    ${accs.length > 1 ? `<div class="ml-crow"><label>De</label><select name="from">${accs.map(a => `<option value="${a.id}" ${a.id === acc.id ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>` : ""}
    <div class="ml-crow"><label>À</label><input type="text" name="to" list="ml-known" value="${esc(to)}" autocomplete="off" ${mode === "forward" || !mode ? "autofocus" : ""}>
      <button type="button" class="btn ghost small" data-cc ${cc ? "hidden" : ""}>Cc / Cci</button></div>
    <div class="ml-crow" data-ccrow ${cc ? "" : "hidden"}><label>Cc</label><input type="text" name="cc" list="ml-known" value="${esc(cc)}" autocomplete="off"></div>
    <div class="ml-crow" data-ccrow ${cc ? "" : "hidden"}><label>Cci</label><input type="text" name="bcc" list="ml-known" autocomplete="off"></div>
    <div class="ml-crow"><label>Objet</label><input type="text" name="subject" value="${esc(subject)}"></div>
    <textarea name="text" rows="12" placeholder="Ton message…"></textarea>
    ${msg ? `<p class="hint">${icon(mode === "forward" ? "send" : "back")} ${mode === "forward" ? `Le mail d'origine${msg.attachments.length ? ` et ses ${msg.attachments.length} pièce${msg.attachments.length > 1 ? "s" : ""} jointe${msg.attachments.length > 1 ? "s" : ""}` : ""} sera ajouté en dessous.` : "Le mail d'origine sera cité en dessous."}</p>` : ""}
    <div class="ml-files" id="ml-files"></div>
    <div class="ml-copts">
      <label class="check"><input type="checkbox" name="follow"> Me rappeler si pas de réponse dans</label>
      <select name="follow_days">${[1, 2, 3, 5, 7, 14].map(n => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n} jour${n > 1 ? "s" : ""}</option>`).join("")}</select>
      <span class="grow"></span>
      <label class="check"><input type="checkbox" name="later"> Envoyer plus tard :</label>
      <select name="when"><option value="tomorrow8">Demain à 8h</option><option value="monday8">Lundi à 8h</option><option value="tonight18">Ce soir à 18h</option><option value="custom">Choisir…</option></select>
      <input type="datetime-local" name="send_at" hidden></div>
    <div class="modal-foot"><label class="btn ghost"><input type="file" multiple hidden name="files">${icon("upload")}Joindre</label>
      ${acc.mail?.signature ? `<label class="check"><input type="checkbox" name="sig" checked> Signature</label>` : ""}
      <span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("send")}Envoyer</button></div></form>`, { ic: "edit", large: true });
  const f = m.querySelector("form");
  let files = [];
  const paintFiles = () => { m.querySelector("#ml-files").innerHTML = files.map((x, i) => `<span class="chip">${icon("file")}${esc(x.name)} · ${sizeStr(x.size)} <button type="button" class="icon-btn plain" data-rm="${i}">${icon("x")}</button></span>`).join(""); };
  f.files.onchange = () => { files = files.concat([...f.files.files]); f.files.value = ""; paintFiles(); };
  m.querySelector("#ml-files").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); paintFiles(); } };
  m.querySelector("[data-cc]").onclick = e => { e.target.hidden = true; m.querySelectorAll("[data-ccrow]").forEach(r => r.hidden = false); };
  const sendBtn = () => f.querySelector(".modal-foot .btn:last-child");
  const syncLater = () => {
    f.send_at.hidden = !f.later.checked || f.when.value !== "custom";
    sendBtn().innerHTML = `${icon(f.later.checked ? "clock" : "send")}${f.later.checked ? "Programmer" : "Envoyer"}`;
  };
  f.later.onchange = syncLater;
  f.when.onchange = () => { f.later.checked = true; syncLater(); };
  f.follow_days.onchange = () => { f.follow.checked = true; };
  (mode && mode !== "forward" ? f.text : f.to).focus();
  f.onsubmit = async e => {
    e.preventDefault();
    if (!f.to.value.trim() && !f.cc.value.trim() && !f.bcc.value.trim()) return toast("Indique au moins un destinataire", "err");
    if (!f.subject.value.trim() && !confirm("Envoyer sans objet ?")) return;
    const fd = new FormData();
    for (const k of ["to", "cc", "bcc", "subject", "text"]) fd.append(k, f[k].value);
    if (f.sig && !f.sig.checked) fd.append("signature", "0");
    if (msg) { fd.append("mode", mode); fd.append("ref_uid", msg.uid); fd.append("ref_folder", msg.folder); }
    if (f.follow.checked) fd.append("follow_days", f.follow_days.value);
    let at = null;
    if (f.later.checked) {
      const d = new Date(), pad = n => String(n).padStart(2, "0"), local = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
      if (f.when.value === "tomorrow8") { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
      else if (f.when.value === "monday8") { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(8, 0, 0, 0); }
      else if (f.when.value === "tonight18") { d.setHours(18, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
      at = f.when.value === "custom" ? f.send_at.value : local(d);
      if (!at) return toast("Choisis la date d'envoi", "err");
      fd.append("send_at", at);
    }
    files.forEach(x => fd.append("files", x));
    const from = f.from?.value || acc.id;
    const btn = f.querySelector(".modal-foot .btn:last-child");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Envoi…`;
    try {
      const r = await api(`/api/mail/${from}/send`, { method: "POST", body: fd });
      closePanel();
      if (r.scheduled) {
        toast(`Mail programmé pour ${new Date(r.scheduled).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
        loadScheduledCount();
        return;
      }
      toast(r.warning || (f.follow.checked ? `Mail envoyé : je te préviens s'il n'y a pas de réponse dans ${f.follow_days.value} jour${+f.follow_days.value > 1 ? "s" : ""}` : "Mail envoyé"), r.warning ? "err" : "ok");
      if (role() === "sent") loadList(true);
      if (msg && mode !== "forward") { const x = msgs.find(y => y.uid === msg.uid); if (x) { x.answered = true; paintList(); } }
    } catch (err) { toast(err.message, "err"); btn.disabled = false; syncLater(); }
  };
}

