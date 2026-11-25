// Outil « Liens courts » : /s/<code> → longue adresse, avec compteur de clics.
import { $, esc, icon, toast, modal } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";
import { svg as qrSvg, BRAND_LOGO } from "../qrcode.js";

const short = code => `${location.origin}/s/${code}`;

export async function render(root) {
  root.innerHTML = pageHead("liens") + `
    <form class="card" id="ln-form">
      <label class="field">Adresse à raccourcir</label>
      <input type="text" name="url" placeholder="https://www.exemple.fr/une/tres/longue/adresse?avec=des&parametres" required>
      <div class="row">
        <span class="meta">${esc(location.host)}/s/</span><input type="text" name="code" placeholder="code-perso (optionnel)" style="width:220px">
        <input type="text" name="title" class="grow" placeholder="Note pour toi (optionnel)">
        <button class="btn">${icon("link")}Raccourcir</button>
      </div>
      <div id="ln-result"></div>
    </form>
    <div class="card"><div class="card-title">${icon("list")}Mes liens</div><div id="ln-list"></div></div>`;
  $("#ln-form").onsubmit = async e => {
    e.preventDefault();
    try {
      const l = await api("/api/links", { json: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      $("#ln-result").innerHTML = `<div class="result share-result"><div class="qr-mini">${qrSvg(short(l.code), { px: 4, logo: BRAND_LOGO })}</div>
        <div class="body"><b>Lien créé</b><div class="copy-row"><input type="text" readonly value="${short(l.code)}"><button type="button" class="btn small" data-copy="${short(l.code)}">${icon("copy")}Copier</button></div>
        <span class="meta">→ ${esc(l.url)}</span></div></div>`;
      bindCopy($("#ln-result"));
      list();
    } catch (err) { toast(err.message, "err"); }
  };
  list();
}

function bindCopy(el) {
  el.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy).catch(() => {}); toast("Lien copié"); });
}

async function list() {
  const links = await api("/api/links");
  $("#ln-list").innerHTML = links.length ? links.map(l => `<div class="share" data-code="${esc(l.code)}">
      <span class="tile">${icon("link")}</span>
      <div class="txt"><b>/s/${esc(l.code)}${l.title ? ` <span class="meta">· ${esc(l.title)}</span>` : ""}</b><small class="ellipsis">→ ${esc(l.url)}</small></div>
      <span class="stat-mini"><b>${l.clicks}</b> clic${l.clicks > 1 ? "s" : ""}<small>${l.last ? "dernier " + ago(l.last) : "jamais cliqué"}</small></span>
      <button class="icon-btn plain" data-a="copy" title="Copier">${icon("copy")}</button>
      <button class="icon-btn plain" data-a="qr" title="QR code">${icon("qr")}</button>
      <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button></div>`).join("")
    : `<div class="empty">${icon("link")}Aucun lien pour l'instant.</div>`;
  $("#ln-list").onclick = async e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const code = e.target.closest("[data-code]").dataset.code;
    if (a === "copy") { await navigator.clipboard.writeText(short(code)).catch(() => {}); toast("Lien copié"); }
    if (a === "qr") modal("/s/" + code, `<div class="qr-big">${qrSvg(short(code), { px: 8, logo: BRAND_LOGO })}</div><p class="meta center">${esc(short(code))}</p>`, { ic: "qr" });
    if (a === "del") { await api(`/api/links/${code}`, { method: "DELETE" }); toast("Lien supprimé"); list(); }
  };
}
