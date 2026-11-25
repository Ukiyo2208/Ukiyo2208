// Réglages › Accès sécurisé : HTTPS sans rien ouvrir sur Internet (Caddy à la maison ou Tailscale).
import { esc, icon } from "./ui.js";
import { api } from "./state.js";

export async function settingsTab(el) {
  const s = await api("/api/security");
  const ok = (good, text) => `<li class="${good ? "ok" : "no"}">${icon(good ? "check" : "alert")}<span>${text}</span></li>`;
  el.innerHTML = `
    <div class="card ac-hero"><span class="tile ${s.https ? "vert" : "ambre"}">${icon(s.https ? "lock" : "unlock")}</span><div class="grow">
      <h2>${s.https ? "Connexion chiffrée" : "Connexion non chiffrée"}</h2>
      <p class="meta">Tu utilises <b>${esc(s.origin)}</b>${s.tailscale ? " (Tailscale)" : ""}.</p></div></div>

    <div class="card"><div class="card-title">${icon("shield")}HTTPS ne veut pas dire « ouvert sur Internet »</div>
      <p>HTTPS sert seulement à <b>chiffrer</b> ce qui circule entre ton téléphone et le NAS (mots de passe, mails, papiers), comme un cadenas sur une enveloppe.
        Ça ne rend <b>pas</b> Bêta Tool visible depuis Internet : c'est l'ouverture d'un port sur ta box qui ferait ça, et aucune des deux solutions ci-dessous n'en ouvre.</p>
      <p>Tes mails, ton budget et tes papiers restent sur le NAS. HTTPS permet en plus : les <b>clés d'accès</b> (connexion par empreinte ou visage), le <b>mode hors ligne</b>,
        l'installation comme une <b>vraie appli</b> sur le téléphone et les notifications sur iPhone.</p>
      <ul class="ac-check">
        ${ok(s.https, s.https ? "Connexion chiffrée (https://)" : "Connexion en clair (http://) : n'importe quel appareil du Wi-Fi pourrait lire ce qui passe")}
        ${ok(s.accounts, s.accounts ? `Comptes avec mot de passe (${s.users})` : "Pas de comptes : tout le monde sur le réseau a accès à tout")}
        ${ok(s.passkeys > 0 || s.twofa > 0, s.passkeys || s.twofa ? `${s.passkeys} clé(s) d'accès, ${s.twofa} compte(s) avec double authentification` : "Ni clé d'accès ni double authentification")}
        ${ok(!s.ip || s.https, s.ip && !s.https ? "Adresse IP en http : les clés d'accès et le mode hors ligne ne marchent pas" : "Adresse avec un nom")}
      </ul></div>

    <div class="ac-grid">
      <div class="card"><div class="card-title"><span class="tile vert">${icon("home")}</span>Solution 1 : à la maison seulement</div>
        <p class="meta">Pour qui veut que rien ne sorte de la maison. Bêta Tool crée son propre certificat ; chaque appareil lui fait confiance une fois.</p>
        <ol class="ac-steps">
          <li>Dans le fichier <code>.env</code> : ajoute <code>https</code> à <code>COMPOSE_PROFILES</code> et mets dans <code>BETA_HOST</code> le nom du NAS suivi de <code>.local</code>
            (ex. <code>dxp4800.local</code>, visible dans les réglages réseau du NAS UGREEN).</li>
          <li>Dans <code>docker-compose.yml</code>, enlève le <code>#</code> devant la ligne <code>/caddy:ro</code> du service beta-tool, puis <code>docker compose up -d</code>.</li>
          <li>Sur chaque appareil, ${s.ca ? `<a href="/ca.crt" download>télécharge le certificat de la maison</a>` : "télécharge le certificat de la maison (lien disponible ici une fois l'étape 2 faite)"} et installe-le :
            <ul><li><b>iPhone / iPad</b> : ouvre le fichier › Réglages › Profil téléchargé › Installer, puis Réglages › Général › Informations › Réglages des certificats › active-le.</li>
              <li><b>Android</b> : Paramètres › Sécurité › Chiffrement et identifiants › Installer un certificat › Certificat CA.</li>
              <li><b>Windows</b> : double-clic › Installer › Ordinateur local › « Autorités de certification racines de confiance ».</li>
              <li><b>Mac</b> : double-clic › Trousseau « Système » › ouvre le certificat › Se fier › Toujours.</li></ul></li>
          <li>Ouvre <code>https://${esc(location.hostname.endsWith(".local") ? location.hostname : "nom-du-nas.local")}:8443</code> et ajoute-le à l'écran d'accueil.</li></ol>
        <p class="hint">${icon("lock")} Rien n'est ouvert sur ta box. Le certificat ne vaut que pour Bêta Tool chez toi.</p></div>

      <div class="card"><div class="card-title"><span class="tile bleu">${icon("globe")}</span>Solution 2 : Tailscale (maison et dehors)</div>
        <p class="meta">Le plus simple si tu veux aussi y accéder hors de la maison. Tes appareils forment un réseau privé chiffré ; Bêta Tool reste invisible pour le reste d'Internet.</p>
        <ol class="ac-steps">
          <li>Crée un compte gratuit sur <a href="https://tailscale.com" target="_blank" rel="noopener">tailscale.com</a> et installe l'appli Tailscale sur ton téléphone et ton ordinateur.</li>
          <li>Sur <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener">la console Tailscale › DNS</a> : active <b>MagicDNS</b> et <b>HTTPS Certificates</b>.</li>
          <li>Crée une clé (Settings › Keys › Generate auth key), colle-la dans <code>TS_AUTHKEY</code> du fichier <code>.env</code>, ajoute <code>tailscale</code> à <code>COMPOSE_PROFILES</code>, puis <code>docker compose up -d</code>.</li>
          <li>Ouvre <code>https://beta.&lt;ton-réseau&gt;.ts.net</code> depuis un appareil connecté à Tailscale : le certificat est déjà reconnu, rien à installer.</li></ol>
        <p class="hint">${icon("lock")} Seuls les appareils connectés à ton compte Tailscale peuvent joindre Bêta Tool. Le partage public (« Funnel ») reste désactivé.</p></div>
    </div>
    <p class="hint">Déjà un nom de domaine avec un reverse proxy (Synology, Nginx Proxy Manager…) ? Ça marche aussi : Bêta Tool lit les en-têtes <code>X-Forwarded-Proto</code> et <code>X-Forwarded-Host</code>.
      Dans ce cas, garde la double authentification ou les clés d'accès activées.</p>`;
}
