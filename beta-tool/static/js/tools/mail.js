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
  root.innerHTML = pageHead("mails", accs.length ? `<button class="btn ghost" id="ml-acc">${icon("settings")}Comptes</button><button class="btn" id="ml-write">${icon("edit")}Écrire</button>` : "")
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
  $("#ml-add").onclick = () => connect({ want: "mail", onDone: a => { acc = a; render(root, [a.id]); } });
  $("#ml-menu").onclick = () => $(".ml-layout").dataset.pane = "side";
  $("#ml-refresh").onclick = () => { loadFolders(); loadList(); };
  let t = null;
  $("#ml-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); page = 0; loadList(); }, 400); };
  $("#ml-filter").onchange = e => { unread = e.target.value === "1"; page = 0; loadList(); };
  paintAccounts();
  await Promise.all([loadFolders(), loadList()]);
  if (q?.uid) openMessage(q.uid);
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

function paintFolders() {
  const el = $("#ml-folders");
  if (!el) return;
  el.innerHTML = folders.map(f => `<button class="ml-folder ${f.name === folder ? "on" : ""}" data-folder="${esc(f.name)}" style="--d:${Math.min(f.depth, 3)}">
      ${icon(FOLDER_ICON[f.role] || "folder")}<span class="grow">${esc(f.label)}</span>${f.unread ? `<span class="count">${f.unread}</span>` : ""}</button>`).join("")
    + `<button class="ml-folder" data-newfolder>${icon("plus")}<span class="grow meta">Nouveau dossier</span></button>`;
  const cur = folders.find(f => f.name === folder);
  $("#ml-fname").textContent = cur?.label || folder;
  const head = $(`.ml-acc.on .count`);
  if (head) head.textContent = acc.unread || "";
}

const role = () => folders.find(f => f.name === folder)?.role;

async function loadList(quiet = false) {
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
        <div class="ml-l2"><span class="grow">${m.answered ? icon("back") : ""}${esc(m.subject)}</span>${m.attach ? icon("link", "ml-pj") : ""}
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
      <button class="icon-btn plain" data-r="move" title="Déplacer">${icon("move")}</button></div>
    <div class="ml-rhead"><h2>${esc(d.subject)}</h2>
      <div class="ml-from"><span class="ml-av big" style="--h:${hue(who(d.from))}">${initial(who(d.from))}</span>
        <div class="grow"><b>${esc(who(d.from))}</b> <small class="meta">${esc(d.from[0]?.email || "")}</small>
          <small class="meta ml-to">À : ${esc(addr(d.to)) || "—"}${d.cc.length ? ` · Cc : ${esc(addr(d.cc))}` : ""}</small></div>
        <small class="meta">${d.date ? new Date(d.date * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</small></div></div>
    ${d.remote_images && !images ? `<div class="ml-imgs">${icon("eye")}<span class="grow">Images distantes bloquées pour protéger ta vie privée (elles servent souvent à savoir si tu as ouvert le mail).</span><button class="btn ghost small" data-r="images">Afficher les images</button></div>` : ""}
    ${d.attachments.length ? `<div class="ml-atts">${d.attachments.map(a => `<div class="ml-att">${icon(a.type === "application/pdf" ? "pdf" : a.type.startsWith("image/") ? "image" : "file")}
      <a class="grow" href="/api/mail/${acc.id}/part?folder=${encodeURIComponent(folder)}&uid=${d.uid}&n=${a.n}&inline=1" target="_blank" rel="noopener" title="Ouvrir"><b>${esc(a.name)}</b><small class="meta">${sizeStr(a.size)}</small></a>
      <a class="icon-btn plain" href="/api/mail/${acc.id}/part?folder=${encodeURIComponent(folder)}&uid=${d.uid}&n=${a.n}" title="Télécharger">${icon("download")}</a>
      <button class="icon-btn plain" data-save="${a.n}" title="Enregistrer sur le NAS">${icon("nas")}</button>
      ${/pdf|image\/(jpe?g|png|heic)/.test(a.type) ? `<button class="icon-btn plain" data-paper="${a.n}" title="Envoyer à Paperasse">${icon("receipt")}</button>` : ""}</div>`).join("")}</div>` : ""}
    <div class="ml-frame-wrap"><iframe class="ml-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Contenu du mail"></iframe></div>`);
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
    if (["reply", "replyall", "forward"].includes(r)) return compose({ mode: r, msg: d });
    if (r === "move") return moveDialog([d.uid]);
    act(r, [d.uid]);
  };
}

// --- Rédaction --------------------------------------------------------------------------

function compose({ mode = "", msg = null }) {
  const me = (acc.email || "").toLowerCase();
  let to = "", cc = "", subject = "";
  if (msg) {
    subject = (mode === "forward" ? "Tr : " : "Re : ") + msg.subject.replace(/^((re|tr|fwd?)\s*:\s*)+/i, "");
    if (mode !== "forward") {
      to = addr(msg.reply_to.length ? msg.reply_to : msg.from);
      if (mode === "replyall") cc = addr([...msg.to, ...msg.cc].filter(a => a.email.toLowerCase() !== me && !msg.from.some(f => f.email === a.email)));
    }
  }
  const known = [...new Map(msgs.flatMap(m => [...m.from, ...m.to]).filter(a => a.email).map(a => [a.email.toLowerCase(), a])).values()].slice(0, 200);
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
    <div class="modal-foot"><label class="btn ghost"><input type="file" multiple hidden name="files">${icon("upload")}Joindre</label>
      ${acc.mail?.signature ? `<label class="check"><input type="checkbox" name="sig" checked> Signature</label>` : ""}
      <span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("send")}Envoyer</button></div></form>`, { ic: "edit", large: true });
  const f = m.querySelector("form");
  let files = [];
  const paintFiles = () => { m.querySelector("#ml-files").innerHTML = files.map((x, i) => `<span class="chip">${icon("file")}${esc(x.name)} · ${sizeStr(x.size)} <button type="button" class="icon-btn plain" data-rm="${i}">${icon("x")}</button></span>`).join(""); };
  f.files.onchange = () => { files = files.concat([...f.files.files]); f.files.value = ""; paintFiles(); };
  m.querySelector("#ml-files").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); paintFiles(); } };
  m.querySelector("[data-cc]").onclick = e => { e.target.hidden = true; m.querySelectorAll("[data-ccrow]").forEach(r => r.hidden = false); };
  (mode && mode !== "forward" ? f.text : f.to).focus();
  f.onsubmit = async e => {
    e.preventDefault();
    if (!f.to.value.trim() && !f.cc.value.trim() && !f.bcc.value.trim()) return toast("Indique au moins un destinataire", "err");
    if (!f.subject.value.trim() && !confirm("Envoyer sans objet ?")) return;
    const fd = new FormData();
    for (const k of ["to", "cc", "bcc", "subject", "text"]) fd.append(k, f[k].value);
    if (f.sig && !f.sig.checked) fd.append("signature", "0");
    if (msg) { fd.append("mode", mode); fd.append("ref_uid", msg.uid); fd.append("ref_folder", msg.folder); }
    files.forEach(x => fd.append("files", x));
    const from = f.from?.value || acc.id;
    const btn = f.querySelector(".modal-foot .btn:last-child");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Envoi…`;
    try {
      const r = await api(`/api/mail/${from}/send`, { method: "POST", body: fd });
      closePanel();
      toast(r.warning || "Mail envoyé", r.warning ? "err" : "ok");
      if (role() === "sent") loadList(true);
      if (msg && mode !== "forward") { const x = msgs.find(y => y.uid === msg.uid); if (x) { x.answered = true; paintList(); } }
    } catch (err) { toast(err.message, "err"); btn.disabled = false; btn.innerHTML = `${icon("send")}Envoyer`; }
  };
}

