// Réglages → Extension : installer l'extension de navigateur, la relier avec un code, gérer les navigateurs reliés.
import { $, esc, icon, toast } from "./ui.js";
import { api, ago } from "./state.js";

let timer = null;

export async function settingsTab(el) {
  const d = await api("/api/ext/browsers");
  el.innerHTML = `
    <div class="intro" style="margin-top:0"><span class="tile bleu">${icon("globe")}</span><p>L'extension <b>Bêta Tool</b> pour <b>Opera</b>, Chrome, Edge, Brave et Vivaldi :
      envoie un fichier, un relevé ou une vidéo sur le NAS en un clic, garde l'historique des prix des produits que tu regardes et compare avec les autres boutiques,
      et envoie une page dans Notes, un colis dans Colis ou un rendez-vous dans l'Agenda.</p></div>
    <div class="card"><div class="card-title">${icon("download")}1. Installer</div>
      <ol class="ex-steps">
        <li><a class="btn small" href="/api/ext/download">${icon("download")}Télécharger l'extension (.zip)</a> puis <b>décompresse</b> le fichier (clic droit › Extraire tout).</li>
        <li>Opera : ouvre <code>opera://extensions</code> · Chrome / Brave / Vivaldi : <code>chrome://extensions</code> · Edge : <code>edge://extensions</code>.</li>
        <li>Active le <b>Mode développeur</b> (en haut à droite), puis <b>« Charger l'extension non empaquetée »</b> et choisis le dossier <code>beta-tool-extension</code>.</li>
        <li>Épingle l'icône Bêta Tool dans la barre (pièce de puzzle › épingle).</li>
      </ol>
      <p class="hint">Garde le dossier décompressé à sa place : le navigateur s'en sert. Après une mise à jour de Bêta Tool, retélécharge-le, remplace le dossier puis clique sur « Actualiser » dans la page des extensions.</p></div>
    <div class="card"><div class="card-title">${icon("link")}2. Relier ce navigateur</div>
      <p class="hint" style="margin-top:0">L'extension s'ouvre sur ses options au premier lancement. Indique l'adresse <code>${esc(d.url)}</code> et ce code :</p>
      <div class="row"><button class="btn" id="ex-code">${icon("key")}Relier un navigateur</button><span id="ex-show" class="ex-code"></span></div>
      <p class="hint">Le code ne sert qu'une fois et expire au bout de 5 minutes. L'extension reçoit un accès personnel à <b>ton</b> compte, que tu peux retirer ici à tout moment.</p></div>
    <div class="card"><div class="card-title">${icon("monitor")}Navigateurs reliés <span class="count">${d.browsers.length}</span></div>
      <div class="acc-list">${d.browsers.length ? d.browsers.map(t => `<div class="acc-row"><span class="tile bleu">${icon("globe")}</span>
        <div class="grow"><b>${esc(t.name)}</b><small class="meta">Relié ${ago(t.created)} · ${t.used ? `utilisé ${ago(t.used)}` : "jamais utilisé"}</small></div>
        <button class="btn ghost small" data-revoke="${t.id}">${icon("x")}Retirer</button></div>`).join("") : `<p class="meta">Aucun navigateur relié.</p>`}</div></div>
    <div class="card"><div class="card-title">${icon("key")}Mots de passe</div>
      <p class="hint" style="margin-top:0">Pour créer et remplir tes mots de passe, utilise l'extension <b>Bitwarden</b> (open source, auditée) reliée au <b>Coffre</b> du NAS :
        les mots de passe sont chiffrés dans ton navigateur avant d'arriver sur le NAS. ${d.vault_on && d.vault ? `Adresse de ton Coffre à indiquer dans Bitwarden (« Auto-hébergé ») : <code>${esc(d.vault)}</code>.` : "Active d'abord l'outil Coffre (Réglages › Outils, conteneur Vaultwarden)."}
        Le pas-à-pas est dans les options de l'extension Bêta Tool.</p>
      <div class="row"><a class="btn ghost small" href="https://addons.opera.com/fr/extensions/details/bitwarden-free-password-manager/" target="_blank" rel="noopener">${icon("external")}Bitwarden pour Opera</a>
        <a class="btn ghost small" href="https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb" target="_blank" rel="noopener">${icon("external")}pour Chrome / Brave</a></div></div>`;
  $("#ex-code").onclick = async () => {
    const r = await api("/api/ext/code", { method: "POST" });
    let left = r.expires;
    const show = () => { const s = $("#ex-show"); if (!s) return clearInterval(timer); s.innerHTML = left > 0 ? `<b>${r.code.slice(0, 3)} ${r.code.slice(3)}</b><small class="meta">valable ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")}</small>` : `<small class="meta">Code expiré</small>`; left--; };
    clearInterval(timer); show(); timer = setInterval(show, 1000);
  };
  el.querySelectorAll("[data-revoke]").forEach(b => b.onclick = async () => {
    if (!confirm("Retirer l'accès de ce navigateur ?")) return;
    await api(`/api/me/tokens/${b.dataset.revoke}`, { method: "DELETE" });
    toast("Accès retiré");
    settingsTab(el);
  });
}
