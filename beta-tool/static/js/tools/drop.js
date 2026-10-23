// Outil « Bêta Drop » : partager des fichiers par lien, ou recevoir des fichiers.
import { $, esc, icon, toast, modal, sizeStr, dropzone, dropHTML } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";
import { svg as qrSvg } from "../qrcode.js";

const EXPIRY = [["1", "1 jour"], ["7", "7 jours"], ["30", "30 jours"], ["0", "Jamais"]];
let files = [], refs = [];

export async function render(root, parts, query) {
  const tab = ["partager", "recevoir"].includes(parts[0]) ? parts[0] : "liste";
  root.innerHTML = pageHead("drop") + `<nav class="tabs">
      <a href="#/drop" class="${tab === "liste" ? "on" : ""}">${icon("list")}Mes partages</a>
      <a href="#/drop/partager" class="${tab === "partager" ? "on" : ""}">${icon("send")}Partager des fichiers</a>
      <a href="#/drop/recevoir" class="${tab === "recevoir" ? "on" : ""}">${icon("inbox")}Recevoir des fichiers</a>
    </nav><div id="dr-body"></div>`;
  if (tab === "partager") return sendForm(query);
  if (tab === "recevoir") return receiveForm();
  return list();
}

const linkOf = token => `${location.origin}/d/${token}`;

function options() {
  return `<div class="grid2">
      <div><label class="field">Expire après</label><select name="expires_days" style="width:100%">${EXPIRY.map(([v, l]) => `<option value="${v}" ${v === "7" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field">Mot de passe (optionnel)</label><input type="password" name="password" autocomplete="new-password" placeholder="Aucun"></div>
    </div>
    <label class="field">Message (optionnel)</label><textarea name="message" rows="2" style="min-height:60px" placeholder="Ex. : les photos de samedi 📸"></textarea>`;
}

// --- Partager ---------------------------------------------------------------
function sendForm(query) {
  files = [];
  refs = query.root ? new URLSearchParams(location.hash.split("?")[1]).getAll("p").map(p => ({ root: query.root, path: p })) : [];
  $("#dr-body").innerHTML = `<form class="card" id="send-form">
    ${dropHTML("send-drop", { accept: "*/*", multiple: true, title: "Glisse les fichiers à partager", sub: "ou clique pour les choisir", tile: "" })}
    <div class="files" id="send-files" style="margin:12px 0"></div>
    <div class="grid2"><div><label class="field">Titre (optionnel)</label><input type="text" name="title" placeholder="Ex. : Vacances 2026"></div>
      <div><label class="field">Téléchargements max. (optionnel)</label><input type="number" name="max_downloads" min="1" placeholder="Illimité"></div></div>
    ${options()}
    <button class="btn wide" style="margin-top:14px" id="send-go">${icon("link")}Créer le lien de partage</button>
    <div id="send-result"></div></form>`;
  const z = $("#send-drop");
  dropzone(z, z.querySelector("input"), list => { files = files.concat(list); paintFiles(); });
  paintFiles();
  $("#send-form").onsubmit = async e => {
    e.preventDefault();
    if (!files.length && !refs.length) return toast("Ajoute au moins un fichier", "err");
    const f = new FormData(e.target);
    const btn = $("#send-go");
    btn.disabled = true;
    try {
      let share;
      if (files.length) {
        const form = new FormData();
        ["title", "message", "expires_days", "password", "max_downloads"].forEach(k => form.append(k, f.get(k) || ""));
        files.forEach(x => form.append("file", x));
        form.append("kind", "send");
        share = await upload(form, btn);
        if (refs.length) toast("Les fichiers du NAS feront l'objet d'un second lien", "err");
      } else {
        share = await api("/api/drop", { json: { kind: "send", items: refs, ...Object.fromEntries(f) } });
      }
      showLink($("#send-result"), share);
      files = []; refs = []; paintFiles();
    } catch (err) { toast(err.message, "err"); }
    btn.disabled = false;
    btn.innerHTML = `${icon("link")}Créer le lien de partage`;
  };
}

function upload(form, btn) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/drop");
    xhr.upload.onprogress = e => { if (e.lengthComputable) btn.textContent = `Envoi… ${Math.round(e.loaded / e.total * 100)} %`; };
    xhr.onload = () => { const d = JSON.parse(xhr.responseText || "{}"); xhr.status === 200 ? resolve(d) : reject(new Error(d.error || "Erreur")); };
    xhr.onerror = () => reject(new Error("Connexion perdue"));
    xhr.send(form);
  });
}

function paintFiles() {
  const all = [...files.map((f, i) => ({ name: f.name, size: f.size, i, kind: "f" })), ...refs.map((r, i) => ({ name: r.path.split("/").pop(), i, kind: "r" }))];
  $("#send-files").innerHTML = all.map(x => `<div class="file"><span class="ficon">${x.kind === "r" ? icon("nas") : esc((x.name.split(".").pop() || "").slice(0, 4))}</span>
    <div class="name">${esc(x.name)}<small>${x.kind === "r" ? "déjà sur le NAS (pas de copie)" : sizeStr(x.size)}</small></div>
    <span class="pick"><button type="button" class="icon-btn plain" data-rm="${x.kind}${x.i}">✕</button></span></div>`).join("");
  $("#send-files").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const k = b.dataset.rm[0], i = +b.dataset.rm.slice(1);
    (k === "f" ? files : refs).splice(i, 1);
    paintFiles();
  });
}

// --- Recevoir ---------------------------------------------------------------
function receiveForm() {
  $("#dr-body").innerHTML = `<form class="card" id="recv-form">
    <div class="intro" style="margin-bottom:16px"><span class="tile">${icon("inbox")}</span>
      <p>Crée un lien de dépôt : n'importe qui peut l'ouvrir pour t'envoyer des fichiers, sans compte. Ils arrivent dans <b>Fichiers reçus</b>.</p></div>
    <label class="field">Nom du dépôt</label><input type="text" name="title" placeholder="Ex. : Photos du mariage" required style="margin-bottom:14px">
    ${options()}
    <button class="btn wide" style="margin-top:14px">${icon("link")}Créer le lien de dépôt</button>
    <div id="recv-result"></div></form>`;
  $("#recv-form").onsubmit = async e => {
    e.preventDefault();
    try {
      const share = await api("/api/drop", { json: { kind: "receive", ...Object.fromEntries(new FormData(e.target)) } });
      showLink($("#recv-result"), share);
    } catch (err) { toast(err.message, "err"); }
  };
}

function showLink(el, s) {
  const url = linkOf(s.token);
  el.innerHTML = `<div class="result share-result">
    <div class="qr-mini">${qrSvg(url, { px: 4 })}</div>
    <div class="body"><b>${esc(s.title)}</b>
      <div class="copy-row"><input type="text" readonly value="${esc(url)}"><button type="button" class="btn small" data-copy="${esc(url)}">${icon("copy")}Copier</button></div>
      <span class="meta">${s.expires ? "Expire " + new Date(s.expires * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "Sans expiration"}${s.password ? " · protégé par mot de passe" : ""}</span>
      <div class="actions" style="margin-top:8px">
        <a class="btn small ghost" href="mailto:?subject=${encodeURIComponent(s.title)}&body=${encodeURIComponent(url)}">${icon("mail")}E-mail</a>
        ${navigator.share ? `<button type="button" class="btn small ghost" data-native="${esc(url)}">${icon("send")}Partager</button>` : ""}
      </div></div></div>`;
  bindCopy(el);
}

function bindCopy(el) {
  el.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Lien copié"); }
    catch { b.previousElementSibling?.select(); document.execCommand("copy"); toast("Lien copié"); }
  });
  el.querySelectorAll("[data-native]").forEach(b => b.onclick = () => navigator.share({ url: b.dataset.native }).catch(() => {}));
}

// --- Liste ------------------------------------------------------------------
const STATE = { actif: ["Actif", "pill-ok"], expire: ["Expiré", "pill-warn"], epuise: ["Limite atteinte", "pill-warn"] };
async function list() {
  const shares = await api("/api/drop");
  $("#dr-body").innerHTML = shares.length ? `<div class="card">${shares.map(s => `
    <div class="share" data-token="${esc(s.token)}">
      <span class="tile ${s.kind === "receive" ? "vert" : ""}">${icon(s.kind === "receive" ? "inbox" : "send")}</span>
      <div class="txt"><b>${esc(s.title)}</b>
        <small>${s.kind === "receive" ? `Dépôt · ${s.received} fichier${s.received > 1 ? "s" : ""} reçu${s.received > 1 ? "s" : ""}` : `${s.files.length} fichier${s.files.length > 1 ? "s" : ""} · ${s.downloads} téléchargement${s.downloads > 1 ? "s" : ""}${s.max_downloads ? " / " + s.max_downloads : ""}`}
        · créé ${ago(s.created)}${s.expires ? " · expire " + new Date(s.expires * 1000).toLocaleDateString("fr-FR") : ""}${s.password ? " · 🔒" : ""}</small></div>
      <span class="${STATE[s.state][1]}">${STATE[s.state][0]}</span>
      <button class="icon-btn plain" data-a="copy" title="Copier le lien">${icon("copy")}</button>
      <button class="icon-btn plain" data-a="qr" title="QR code">${icon("qr")}</button>
      ${s.kind === "receive" ? `<a class="icon-btn plain" href="#/fichiers/depots/${encodeURIComponent(s.folder || "")}" title="Voir les fichiers reçus">${icon("folder")}</a>` : ""}
      <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button>
    </div>`).join("")}</div>`
    : `<div class="card"><div class="empty">${icon("send")}Aucun partage pour l'instant.
        <span><a class="btn small" href="#/drop/partager">Partager des fichiers</a> <a class="btn small ghost" href="#/drop/recevoir">Recevoir des fichiers</a></span></div></div>`;
  $("#dr-body").onclick = async e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const s = shares.find(x => x.token === e.target.closest("[data-token]").dataset.token);
    const url = linkOf(s.token);
    if (a === "copy") { try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch { toast(url); } }
    if (a === "qr") { const m = modal(s.title, `<div class="qr-big">${qrSvg(url, { px: 8 })}</div><div class="copy-row"><input type="text" readonly value="${esc(url)}"><button class="btn small" data-copy="${esc(url)}">${icon("copy")}Copier</button></div>`, { ic: "qr" }); bindCopy(m); }
    if (a === "del") {
      const m = modal("Supprimer ce partage ?", `<p>Le lien ne fonctionnera plus.${s.kind === "send" ? " Les fichiers envoyés pour ce partage seront effacés (ceux déjà sur le NAS ne sont pas touchés)." : " Les fichiers reçus restent dans Fichiers reçus."}</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
      m.querySelector("[data-ok]").onclick = async () => {
        await api(`/api/drop/${s.token}`, { method: "DELETE" });
        document.querySelector("#scrim").click();
        toast("Partage supprimé");
        list();
      };
    }
  };
}
