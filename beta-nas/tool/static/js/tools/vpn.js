// Outil « VPN » (administrateurs) : appareils WireGuard, QR codes, état des connexions.
import { $, esc, icon, toast, modal, closePanel, sizeStr } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const POWERED = `<a class="powered" href="https://github.com/wg-easy/wg-easy" target="_blank" rel="noopener">${icon("globe")}Propulsé par <b>WireGuard</b> et <b>wg-easy</b> · open source</a>`;
let timer = null;

export async function render(root) {
  const d = await api("/api/vpn");
  const live = c => c.handshake && Date.now() - new Date(c.handshake) < 3 * 60 * 1000;
  root.innerHTML = pageHead("vpn", d.ready && d.configured ? `<button class="btn" id="vpn-add">${icon("plus")}Ajouter un appareil</button>` : "") + `
    <div class="card vault-hero">
      <span class="tile bleu-vert" style="width:64px;height:64px">${icon("globe")}</span>
      <div class="grow"><h2 style="margin:0">${!d.ready ? "Le VPN n'est pas démarré" : !d.configured ? "Mot de passe du VPN manquant" : "Ton VPN est prêt"}</h2>
        <p class="meta" style="margin:4px 0 0">${!d.ready ? "Active le service wg-easy (« vpn » dans COMPOSE_PROFILES du fichier .env), puis recharge cette page."
          : !d.configured ? "Renseigne VPN_PASSWORD dans .env (le même que celui de wg-easy) et redémarre Bêta Tool."
          : `Connecte tes appareils à la maison où que tu sois : accès aux outils, au NAS, et connexion protégée sur les Wi-Fi publics.`}</p>
        <div style="margin-top:10px">${POWERED}</div></div>
    </div>
    ${d.error ? `<p class="msg">${esc(d.error)}</p>` : ""}
    ${d.ready && d.configured ? `<div class="card"><div class="card-title">${icon("monitor")}Appareils <span class="count">${d.clients.length}</span></div>
      ${d.clients.length ? d.clients.map(c => `<div class="set-row vpn-dev" data-id="${esc(c.id)}">
        <span class="tile ${live(c) ? "vert" : ""}">${icon(/t[ée]l[ée]phone|iphone|android|pixel|galaxy/i.test(c.name) ? "phone" : "monitor")}</span>
        <div class="txt"><b>${esc(c.name)} ${live(c) ? `<span class="pill-ok">connecté</span>` : ""}${c.enabled ? "" : ` <span class="pill-mute">désactivé</span>`}</b>
          <small>${esc(c.address || "")} · ${c.handshake ? "dernière connexion " + ago(new Date(c.handshake) / 1000) : "jamais connecté"} · ↓ ${sizeStr(c.tx)} ↑ ${sizeStr(c.rx)}</small></div>
        <button class="btn small ghost" data-a="qr">${icon("qr")}QR code</button>
        <a class="icon-btn plain" href="/api/vpn/clients/${encodeURIComponent(c.id)}/configuration?name=${encodeURIComponent(c.name)}" title="Télécharger le fichier .conf">${icon("download")}</a>
        <label class="switch" title="${c.enabled ? "Désactiver" : "Activer"}"><input type="checkbox" data-a="toggle" ${c.enabled ? "checked" : ""}><span></span></label>
        <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button></div>`).join("")
        : `<div class="empty">${icon("phone")}<b>Aucun appareil</b>Ajoute ton téléphone : un QR code s'affiche, scanne-le avec l'appli WireGuard, c'est tout.</div>`}</div>` : ""}
    <div class="card"><div class="card-title">${icon("list")}Mise en route</div>
      <ol class="tuto">
        <li><b>Démarre le service</b><span>Dans .env : ajoute « vpn » à COMPOSE_PROFILES, choisis VPN_PASSWORD et renseigne VPN_HOST (adresse publique de ta box ou nom DynDNS, ex. maison.synology.me). Puis docker compose up -d.</span></li>
        <li><b>Ouvre le port sur la box</b><span>Redirige le port <b>UDP 51820</b> de ta box vers l'adresse du NAS (menu « NAT / redirection de ports » de la box).</span></li>
        <li><b>Ajoute un appareil</b><span>Bouton « Ajouter un appareil », puis scanne le QR code avec l'appli WireGuard (iPhone, Android, Windows, Mac).</span></li>
        <li><b>Active le VPN quand tu sors</b><span>Un interrupteur dans l'appli WireGuard. Bêta Tool reste alors accessible à son adresse habituelle (ex. http://192.168.1.10:8080).</span></li>
      </ol>
      <p class="hint">Synology : le module WireGuard n'est pas inclus dans DSM, il faut d'abord l'installer (voir le README). Plus simple sinon : Tailscale.</p></div>
    <div class="card"><div class="card-title">${icon("download")}Applis WireGuard</div>
      <div class="chips">
        <a class="chip" href="https://apps.apple.com/app/wireguard/id1441195209" target="_blank" rel="noopener">iPhone / iPad / Mac</a>
        <a class="chip" href="https://play.google.com/store/apps/details?id=com.wireguard.android" target="_blank" rel="noopener">Android</a>
        <a class="chip" href="https://www.wireguard.com/install/" target="_blank" rel="noopener">Windows, Linux</a>
      </div></div>`;
  $("#vpn-add")?.addEventListener("click", () => {
    const m = modal("Nouvel appareil", `<form><label class="field">Nom de l'appareil</label><input type="text" name="name" required maxlength="40" placeholder="Ex. Téléphone de Léa, PC portable">
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("plus")}Créer</button></div></form>`, { ic: "globe" });
    m.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      try {
        const r = await api("/api/vpn/clients", { json: { name: e.target.name.value } });
        closePanel();
        await render(root);
        if (r.client) setTimeout(() => showQr(r.client), 260);
      } catch (err) { toast(err.message, "err"); }
    };
  });
  root.querySelectorAll(".vpn-dev").forEach(row => {
    const c = d.clients.find(x => x.id === row.dataset.id);
    row.querySelector("[data-a=qr]").onclick = () => showQr(c);
    row.querySelector("[data-a=toggle]").onchange = async e => {
      try { await api(`/api/vpn/clients/${encodeURIComponent(c.id)}/${e.target.checked ? "enable" : "disable"}`, { json: {} }); toast(e.target.checked ? "Appareil activé" : "Appareil désactivé"); }
      catch (err) { toast(err.message, "err"); e.target.checked = !e.target.checked; }
    };
    row.querySelector("[data-a=del]").onclick = () => {
      const m = modal(`Supprimer « ${c.name} » ?`, `<p>Cet appareil ne pourra plus se connecter au VPN.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
      m.querySelector("[data-ok]").onclick = async () => { await api(`/api/vpn/clients/${encodeURIComponent(c.id)}`, { method: "DELETE" }); closePanel(); render(root); };
    };
  });
  clearInterval(timer);
  if (d.ready && d.configured) timer = setInterval(() => { if ($(".vpn-dev, .vault-hero") && !document.querySelector(".modal.open")) render(root); else if (!$(".vault-hero")) clearInterval(timer); }, 15000);
}

function showQr(c) {
  modal(c.name, `<div class="vpn-qr"><img src="/api/vpn/clients/${encodeURIComponent(c.id)}/qrcode.svg?t=${Date.now()}" alt="QR code WireGuard"></div>
    <ol class="tuto"><li><b>Ouvre l'appli WireGuard</b><span>Bouton « + » puis « Scanner un QR code ».</span></li>
      <li><b>Scanne ce code</b><span>Donne un nom au tunnel, puis active-le.</span></li></ol>
    <p class="hint">Ce QR code contient la clé de l'appareil : ne le partage pas. Sur ordinateur, utilise plutôt le fichier .conf.</p>
    <div class="modal-foot"><a class="btn ghost" href="/api/vpn/clients/${encodeURIComponent(c.id)}/configuration?name=${encodeURIComponent(c.name)}">${icon("download")}Fichier .conf</a>
      <button class="btn" data-close>Terminé</button></div>`, { ic: "qr" });
}

export function leave() { clearInterval(timer); }
