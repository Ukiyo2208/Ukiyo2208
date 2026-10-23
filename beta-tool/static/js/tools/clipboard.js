// Outil « Presse-papier » : copier sur un appareil, coller sur un autre.
import { $, esc, icon, toast, sizeStr } from "../ui.js";
import { api, ago, state } from "../state.js";
import { pageHead } from "../main.js";
import * as push from "../push.js";

let timer = null, latest = 0, clips = [], onPaste = null;

const headers = async () => {
  const h = { "X-Device": push.deviceName() };
  const sub = push.active() ? await push.current().catch(() => null) : null;
  if (sub) h["X-Push-Endpoint"] = sub.endpoint;  // pas de notification sur l'appareil qui envoie
  return h;
};

export async function render(root) {
  root.innerHTML = pageHead("presse-papier", `<button class="btn ghost" id="cb-clear">${icon("trash")}Vider</button>`) + `
    <div class="card cb-compose" id="cb-drop">
      <textarea id="cb-text" rows="3" placeholder="Tape ou colle ici un texte, un lien… (ou colle une image avec Ctrl+V, glisse un fichier)"></textarea>
      <div class="row">
        <button class="btn" id="cb-send">${icon("send")}Envoyer</button>
        <button class="btn ghost" id="cb-paste">${icon("clipboard")}Coller mon presse-papier</button>
        <label class="btn ghost"><input type="file" id="cb-file" multiple hidden>${icon("upload")}Fichier ou photo</label>
        <label class="check grow" style="justify-content:flex-end"><input type="checkbox" id="cb-shared"> Pour tout le monde</label>
      </div>
      <p class="hint" style="margin:0">Ce que tu envoies apparaît aussitôt sur tes autres appareils ouverts sur cette page${push.active() ? ", avec une notification" : ""}.</p>
    </div>
    <div id="cb-list"></div>`;
  latest = 0;
  await refresh(true);
  const send = async () => {
    const text = $("#cb-text").value;
    if (!text.trim()) return toast("Rien à envoyer", "err");
    try {
      await api("/api/clips", { json: { text, shared: $("#cb-shared").checked }, headers: await headers() });
      $("#cb-text").value = "";
      refresh();
    } catch (err) { toast(err.message, "err"); }
  };
  $("#cb-send").onclick = send;
  $("#cb-text").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); });
  $("#cb-file").onchange = e => { upload([...e.target.files]); e.target.value = ""; };
  $("#cb-paste").onclick = pasteFromSystem;
  $("#cb-clear").onclick = async () => { await api("/api/clips", { method: "DELETE" }); toast("Presse-papier vidé (sauf les éléments épinglés)"); refresh(true); };
  const zone = $("#cb-drop");
  ["dragenter", "dragover"].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", e => e.dataTransfer.files.length && upload([...e.dataTransfer.files]));
  // Ctrl+V d'une image (capture d'écran…) n'importe où sur la page
  document.removeEventListener("paste", onPaste);
  onPaste = e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); upload(files); }
  };
  document.addEventListener("paste", onPaste);
  clearInterval(timer);
  timer = setInterval(() => { if ($("#cb-list")) refresh(); else clearInterval(timer); }, 3000);
}

async function upload(files) {
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f, f.name || `image-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`);
    if ($("#cb-shared").checked) fd.append("shared", "1");
    try { await api("/api/clips/file", { method: "POST", body: fd, headers: await headers() }); }
    catch (err) { toast(err.message, "err"); }
  }
  refresh();
}

async function pasteFromSystem() {
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find(t => t.startsWith("image/"));
        if (img) return upload([new File([await it.getType(img)], "capture.png", { type: img })]);
      }
    }
    const text = await navigator.clipboard.readText();
    if (!text) return toast("Ton presse-papier est vide", "err");
    $("#cb-text").value = text;
    $("#cb-send").click();
  } catch {
    toast("Le navigateur bloque l'accès au presse-papier : colle avec Ctrl+V (ou appui long → Coller) dans la zone de texte", "err");
    $("#cb-text").focus();
  }
}

async function refresh(force = false) {
  const d = await api("/api/clips").catch(() => null);
  if (!d || (!force && d.latest === latest && d.clips.length === clips.length && d.clips.every((c, i) => c.pinned === clips[i]?.pinned && c.shared === clips[i]?.shared))) return;
  const fresh = !force && d.latest > latest && latest ? d.clips.filter(c => c.created > latest && c.device !== push.deviceName()) : [];
  latest = d.latest;
  clips = d.clips;
  paint();
  fresh.forEach(c => toast(`Reçu depuis ${c.device}`));
}

function paint() {
  const list = $("#cb-list");
  if (!list) return;
  const pinned = clips.filter(c => c.pinned), rest = clips.filter(c => !c.pinned);
  list.innerHTML = clips.length ? [pinned.length ? `<div class="home-cat">${icon("pin")}Épinglés</div><div class="cb-grid">${pinned.map(clip).join("")}</div>` : "",
    rest.length ? `<div class="home-cat">Récents</div><div class="cb-grid">${rest.map(clip).join("")}</div>` : ""].join("")
    : `<div class="card"><div class="empty">${icon("clipboard")}<b>Presse-papier vide</b>Envoie un texte ici, puis ouvre cette page sur ton téléphone : il t'attend.</div></div>`;
  list.onclick = async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const c = clips.find(x => x.id === b.closest("[data-id]").dataset.id);
    if (b.dataset.a === "copy") return copy(c, b);
    if (b.dataset.a === "pin") await api(`/api/clips/${c.id}`, { method: "PUT", json: { pinned: !c.pinned } });
    if (b.dataset.a === "share") { await api(`/api/clips/${c.id}`, { method: "PUT", json: { shared: !c.shared } }); toast(c.shared ? "Visible par toi seul" : "Visible par tout le monde"); }
    if (b.dataset.a === "del") await api(`/api/clips/${c.id}`, { method: "DELETE" });
    refresh(true);
  };
}

function clip(c) {
  let body = "";
  if (c.kind === "text") body = `<pre class="cb-text">${esc(c.text.length > 1200 ? c.text.slice(0, 1200) + "…" : c.text)}</pre>`;
  if (c.kind === "link") body = `<a class="cb-link" href="${esc(c.text)}" target="_blank" rel="noopener">${icon("link")}<span>${esc(c.text)}</span></a>`;
  if (c.kind === "image") body = `<a href="/api/clips/${c.id}/raw" target="_blank"><img class="cb-img" src="/api/clips/${c.id}/raw" alt="" loading="lazy"></a>`;
  if (c.kind === "file") body = `<a class="cb-file" href="/api/clips/${c.id}/raw?dl=1">${icon("file")}<span><b>${esc(c.name)}</b><small>${sizeStr(c.size)}</small></span></a>`;
  return `<div class="card cb-clip" data-id="${c.id}">
    <div class="cb-head"><span class="meta">${icon(/iPhone|Android|iPad/.test(c.device) ? "phone" : "monitor")}${esc(c.device)} · ${ago(c.created)}</span>
      ${c.shared ? `<span class="pill-mute">${icon("users")}Pour tous${c.owner !== state.config.user.name ? " · " + esc(c.owner) : ""}</span>` : ""}</div>
    ${body}
    <div class="cb-actions">
      ${c.kind === "file" ? `<a class="btn small" href="/api/clips/${c.id}/raw?dl=1">${icon("download")}Télécharger</a>` : `<button class="btn small" data-a="copy">${icon("copy")}Copier</button>`}
      ${c.kind === "image" ? `<a class="btn small ghost" href="/api/clips/${c.id}/raw?dl=1">${icon("download")}</a>` : ""}
      <span class="grow"></span>
      <button class="icon-btn plain ${c.pinned ? "on" : ""}" data-a="pin" title="${c.pinned ? "Désépingler" : "Épingler (n'expire pas)"}">${icon("pin")}</button>
      <button class="icon-btn plain ${c.shared ? "on" : ""}" data-a="share" title="${c.shared ? "Rendre privé" : "Partager avec tout le monde"}">${icon("users")}</button>
      <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button>
    </div></div>`;
}

async function copy(c, btn) {
  try {
    if (c.kind === "image") {
      const blob = await (await fetch(`/api/clips/${c.id}/raw`)).blob();
      const png = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } else await navigator.clipboard.writeText(c.text);
    btn.innerHTML = `${icon("check")}Copié`;
    setTimeout(() => { btn.innerHTML = `${icon("copy")}Copier`; }, 1500);
  } catch {
    if (c.kind !== "image") {  // sans https : sélection manuelle
      const ta = document.createElement("textarea");
      ta.value = c.text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return toast("Copié");
    }
    toast("Copie impossible ici : le navigateur demande une adresse en https://", "err");
  }
}

async function toPng(blob) {
  const img = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return new Promise(res => c.toBlob(res, "image/png"));
}

export function leave() { clearInterval(timer); document.removeEventListener("paste", onPaste); }
