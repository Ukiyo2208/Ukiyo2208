// Outil « Coffre » : accès et guide de Vaultwarden (gestionnaire de mots de passe compatible Bitwarden).
import { $, esc, icon } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

const POWERED = `<a class="powered" href="https://github.com/dani-garcia/vaultwarden" target="_blank" rel="noopener">${icon("key")}Propulsé par <b>Vaultwarden</b> · open source (AGPL v3)</a>`;

export async function render(root) {
  const st = await api("/api/vault/status").catch(() => ({ ready: false }));
  const url = st.url || `${location.protocol}//${location.hostname}:8082`;
  const secure = url.startsWith("https://");
  root.innerHTML = pageHead("coffre") + `
    <div class="card vault-hero">
      <span class="tile rose" style="width:64px;height:64px">${icon("key")}</span>
      <div class="grow"><h2 style="margin:0">${st.ready ? "Ton coffre est prêt" : "Le coffre n'est pas démarré"}</h2>
        <p class="meta" style="margin:4px 0 0">${st.ready ? esc(url) : "Active le service Vaultwarden (profil « vault » dans le fichier .env), puis recharge cette page."}</p>
        <div style="margin-top:10px">${POWERED}</div></div>
      ${st.ready ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon("external")}Ouvrir le coffre</a>` : ""}
    </div>
    ${secure ? "" : `<div class="intro"><span class="tile ambre">${icon("alert")}</span><p><b>HTTPS obligatoire.</b> Pour des raisons de sécurité, les navigateurs n'autorisent
      le chiffrement du coffre que sur une adresse en <b>https://</b>. Passe par le proxy inversé de ton NAS (Synology : Panneau de configuration → Portail de connexion → Proxy inversé)
      ou par Tailscale, puis renseigne VAULT_URL dans .env. Le README détaille la marche à suivre.</p></div>`}
    <div class="card"><div class="card-title">${icon("list")}Mise en route</div>
      <ol class="tuto">
        <li><b>Crée ton compte</b><span>Ouvre le coffre et clique « Créer un compte ». Ton mot de passe principal chiffre tout : il est impossible de le récupérer, note-le en lieu sûr.</span></li>
        <li><b>Ferme les inscriptions</b><span>Une fois les comptes de la famille créés, mets SIGNUPS_ALLOWED=false dans .env et redémarre, pour que personne d'autre ne puisse s'inscrire.</span></li>
        <li><b>Installe les applis Bitwarden</b><span>Téléphone (App Store, Play Store), extension de navigateur, ordinateur. À la connexion, choisis « Auto-hébergé » et indique l'adresse du coffre.</span></li>
        <li><b>Importe tes mots de passe</b><span>Depuis Chrome, Firefox, 1Password, LastPass… : Outils → Importer des données dans le coffre web.</span></li>
      </ol></div>
    <div class="card"><div class="card-title">${icon("download")}Applis Bitwarden</div>
      <div class="chips">
        <a class="chip" href="https://apps.apple.com/app/bitwarden-password-manager/id1137397744" target="_blank" rel="noopener">iPhone / iPad</a>
        <a class="chip" href="https://play.google.com/store/apps/details?id=com.x8bit.bitwarden" target="_blank" rel="noopener">Android</a>
        <a class="chip" href="https://bitwarden.com/download/#downloads-web-browser" target="_blank" rel="noopener">Extensions navigateur</a>
        <a class="chip" href="https://bitwarden.com/download/#downloads-desktop" target="_blank" rel="noopener">Windows, Mac, Linux</a>
      </div>
      <p class="hint">Le coffre est compatible avec les applis officielles Bitwarden (Bitwarden est une marque de Bitwarden Inc., sans lien avec Bêta Tool).</p></div>
    <div class="powered-wrap">${POWERED}</div>`;
}
