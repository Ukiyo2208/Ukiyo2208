// Réglages › Comptes : clés d'accès (se connecter avec l'empreinte, le visage ou le code de l'appareil).
import { esc, icon, toast } from "./ui.js";
import { api, ago } from "./state.js";

const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));

function guessName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Téléphone Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "PC Windows" : "Cet appareil";
}

export async function card(el) {
  const d = await api("/api/me/passkeys");
  if (!d.accounts) { el.hidden = true; return; }
  const supported = !!window.PublicKeyCredential && isSecureContext && d.secure;
  el.innerHTML = `<div class="card-title">${icon("key")}Clés d'accès ${d.keys.length ? `<span class="pill-ok">${d.keys.length}</span>` : ""}</div>
    <p class="hint" style="margin-top:-6px">Connecte-toi sans mot de passe, avec l'empreinte, le visage ou le code de ton téléphone ou de ton ordinateur.
      La clé secrète reste dans ton appareil : rien à retenir, rien à se faire voler.</p>
    ${d.keys.map(k => `<div class="set-row" data-k="${esc(k.id)}"><span class="avatar">${icon("key")}</span>
      <div class="txt"><b>${esc(k.name)}</b><small>Ajoutée ${ago(k.created)}${k.used ? ` · utilisée ${ago(k.used)}` : ""}</small></div>
      <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button></div>`).join("")}
    ${supported ? `<button class="btn" data-a="add">${icon("plus")}Ajouter cet appareil</button>`
      : `<p class="pill-warn" style="display:inline-flex;gap:6px;align-items:center">${icon("lock")}Indisponible sur cette adresse (${esc(d.origin)})</p>
         <p class="hint">Les navigateurs n'autorisent les clés d'accès que sur une adresse sécurisée : <b>https://</b> avec un nom (pas une adresse IP).
           Voir <a href="#/reglages/acces">Réglages › Accès sécurisé</a> : ça se met en place sans rien ouvrir sur Internet.</p>`}`;
  el.onclick = async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    if (b.dataset.a === "del") {
      if (!confirm("Supprimer cette clé d'accès ? Pense aussi à la supprimer dans le trousseau de l'appareil.")) return;
      await api(`/api/me/passkeys/${encodeURIComponent(b.closest("[data-k]").dataset.k)}`, { method: "DELETE" });
      return card(el);
    }
    try {
      const o = await api("/api/me/passkeys/options", { json: {} });
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) },
        excludeCredentials: o.excludeCredentials.map(c => ({ ...c, id: unb64(c.id) })) } });
      await api("/api/me/passkeys", { json: { name: guessName(), clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) } });
      toast("Clé d'accès ajoutée : tu peux te connecter sans mot de passe");
      card(el);
    } catch (err) {
      if (err.name === "InvalidStateError") toast("Cet appareil a déjà une clé d'accès", "err");
      else if (err.name !== "NotAllowedError") toast(err.message, "err");
    }
  };
}
