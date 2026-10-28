// Réglages : outils, comptes, mises à jour, apparence, à propos.
import { $, $$, esc, icon, toast, modal, closePanel } from "../ui.js";
import { TOOLS, CATS } from "../registry.js";
import { state, isAdmin, api, ago } from "../state.js";
import { pageHead, reloadConfig, setTheme } from "../main.js";
import * as push from "../push.js";
import { canvas as qrCanvas } from "../qrcode.js";
import * as i18n from "../i18n.js";
import { settingsTab as enligne } from "../accounts.js";
import { settingsTab as apiTab } from "../apitokens.js";

const TABS = [
  ["general", "Général", "settings", true],
  ["outils", "Outils", "grid", true],
  ["comptes", "Comptes", "users", false],
  ["enligne", "Comptes en ligne", "globe", false],
  ["api", "API", "code", false],
  ["notifications", "Notifications", "bell", false],
  ["maj", "Mises à jour", "refresh", true],
  ["apparence", "Apparence", "sun", false],
  ["apropos", "À propos", "help", false],
];

export async function render(root, parts) {
  const tabs = TABS.filter(t => !t[3] || isAdmin());
  const tab = tabs.find(t => t[0] === parts[0])?.[0] || (isAdmin() ? "general" : "comptes");
  root.innerHTML = pageHead({ name: "Réglages", icon: "settings", tile: "", desc: "Personnalise Bêta Tool : outils, comptes, mises à jour…" })
    + `<nav class="tabs">${tabs.map(([id, label, ic]) => `<a href="#/reglages/${id}" class="${id === tab ? "on" : ""}">${icon(ic)}${label}</a>`).join("")}</nav>
       <div id="set-body"></div>`;
  await ({ general, outils, comptes, enligne, api: apiTab, notifications, maj, apparence, apropos })[tab]($("#set-body"));
}

// --- Général ----------------------------------------------------------------
async function general(el) {
  const s = await api("/api/settings");
  el.innerHTML = `<form class="card" id="gen-form">
    <div class="card-title">${icon("settings")}Général</div>
    <div class="grid2">
      <div><label class="field">Nom du site</label><input type="text" name="site_name" value="${esc(s.site_name)}" placeholder="Bêta Tool"></div>
      <div><label class="field">Nom du stockage</label><input type="text" name="storage_name" value="${esc(s.storage_name)}" placeholder="NAS">
        <p class="hint">« NAS », « serveur », « PC »… Remplace le mot « NAS » partout dans l'interface.</p></div>
    </div>
    <button class="btn">${icon("check")}Enregistrer</button>
  </form>`;
  $("#gen-form").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("/api/settings", { method: "PUT", json: { site_name: f.get("site_name"), storage_name: f.get("storage_name") } });
    toast("Réglages enregistrés");
    setTimeout(() => location.reload(), 600);
  };
}

// --- Outils -----------------------------------------------------------------
async function outils(el) {
  const s = await api("/api/settings");
  el.innerHTML = `<div class="card">
    <div class="card-title">${icon("grid")}Outils affichés <span class="count">${Object.values(s.tools).filter(Boolean).length} sur ${TOOLS.length}</span></div>
    <p class="hint" style="margin-top:-8px">Un outil désactivé disparaît du menu, de l'accueil et de la recherche, pour tout le monde. Ses fichiers restent sur le NAS.</p>
    ${CATS.map(([cat, label]) => `<div class="home-cat">${label}</div>` + TOOLS.filter(t => t.cat === cat).map(t => `
      <div class="set-row">
        <span class="tile ${t.tile}">${icon(t.icon)}</span>
        <div class="txt"><b>${esc(t.name)}</b><small>${esc(t.desc)}${t.id === "coffre" ? " Demande le conteneur Vaultwarden (voir le README)." : ""}${t.id === "vpn" ? " Demande le conteneur wg-easy (voir le README)." : ""}${t.id === "work" ? " Demande le conteneur ONLYOFFICE." : ""}</small></div>
        <label class="switch"><input type="checkbox" data-tool="${t.id}" ${s.tools[t.id] ? "checked" : ""}><span></span></label>
      </div>`).join("")).join("")}
  </div>`;
  el.addEventListener("change", async e => {
    const id = e.target.dataset.tool;
    if (!id) return;
    try {
      await api("/api/settings", { method: "PUT", json: { tools: { [id]: e.target.checked } } });
      toast(`${TOOLS.find(t => t.id === id).name} ${e.target.checked ? "activé" : "désactivé"}`);
      state.config = await api("/api/config");
      const { reloadConfig: rc } = await import("../main.js");
      rc();
    } catch (err) { toast(err.message, "err"); e.target.checked = !e.target.checked; }
  });
}

// --- Comptes ----------------------------------------------------------------
async function comptes(el) {
  const mode = state.config.mode;
  let html = "";
  if (mode === "accounts") html += `<form class="card" id="pw-form">
      <div class="card-title">${icon("key")}Mon mot de passe <span class="count">${esc(state.config.user.name)}</span></div>
      <div class="grid2"><input type="password" name="old" placeholder="Mot de passe actuel" required autocomplete="current-password">
        <input type="password" name="new" placeholder="Nouveau mot de passe (6 caractères min.)" required autocomplete="new-password"></div>
      <button class="btn">${icon("check")}Changer</button></form>
    <div class="card" id="twofa"></div>`;
  if (isAdmin()) {
    if (mode === "accounts") {
      const users = await api("/api/users");
      html += `<div class="card"><div class="card-title">${icon("users")}Comptes <span class="count">${users.length}</span></div>
        ${users.map(u => `<div class="set-row" data-user="${esc(u.name)}">
          <span class="avatar">${esc(u.name[0].toUpperCase())}</span>
          <div class="txt"><b>${esc(u.name)}${u.name === state.config.user.name ? " (toi)" : ""}</b><small>Créé le ${esc(u.created || "?")}${u.twofa ? ` · <span class="pill-ok">${icon("shield")}Double authentification</span>` : ""}</small></div>
          ${u.twofa && u.name !== state.config.user.name ? `<button class="icon-btn plain" data-a="twofa" title="Désactiver sa double authentification (téléphone perdu)">${icon("shield")}</button>` : ""}
          <select data-a="role"><option value="member" ${u.role === "member" ? "selected" : ""}>Membre</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrateur</option></select>
          <button class="icon-btn plain" data-a="pw" title="Changer le mot de passe">${icon("key")}</button>
          <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button>
        </div>`).join("")}</div>`;
    } else {
      html += `<div class="intro"><span class="tile">${icon("users")}</span><p>${mode === "open"
        ? "<b>Accès libre :</b> tout le monde sur le réseau a accès à tout. Crée un premier compte administrateur pour protéger le site par identifiant et mot de passe."
        : "<b>Mot de passe unique</b> (APP_PASSWORD) : tout le monde partage le même accès. Crée des comptes pour donner à chacun le sien ; ils remplaceront ce mot de passe."}</p></div>`;
    }
    html += `<form class="card" id="add-form">
      <div class="card-title">${icon("user")}${mode === "accounts" ? "Ajouter un compte" : "Créer le premier compte (administrateur)"}</div>
      <div class="grid2">
        <input type="text" name="name" placeholder="Identifiant (ex. Bastien)" required autocomplete="off">
        <input type="password" name="password" placeholder="Mot de passe (6 caractères min.)" required autocomplete="new-password">
        ${mode === "accounts" ? `<select name="role" style="width:100%"><option value="member">Membre : utilise les outils</option><option value="admin">Administrateur : gère aussi les réglages</option></select>` : ""}
      </div>
      <button class="btn">${icon("plus")}Créer le compte</button></form>
      <div class="card"><div class="card-title">${icon("help")}Rôles</div>
        <dl class="kv"><dt>Administrateur</dt><dd>Tous les outils + Réglages (outils, comptes, mises à jour) et Sauvegardes.</dd>
        <dt>Membre</dt><dd>Tous les outils activés. Ses notes, partages, questionnaires et liens lui sont propres.</dd></dl></div>`;
  }
  el.innerHTML = html || `<div class="card"><p>Rien à régler ici.</p></div>`;
  $("#pw-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/api/me/password", { json: { old: f.get("old"), new: f.get("new") } }); toast("Mot de passe changé"); e.target.reset(); }
    catch (err) { toast(err.message, "err"); }
  });
  $("#add-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api("/api/users", { json: { name: f.get("name"), password: f.get("password"), role: f.get("role") || "member" } });
      toast(r.first ? "Compte administrateur créé : le site demande maintenant une connexion" : "Compte créé");
      if (r.first) return setTimeout(() => location.reload(), 900);
      comptes(el);
    } catch (err) { toast(err.message, "err"); }
  });
  if ($("#twofa")) twofa($("#twofa"));
  el.querySelectorAll("[data-user]").forEach(row => {
    const name = row.dataset.user;
    row.querySelector("[data-a=twofa]")?.addEventListener("click", () => {
      const m = modal(`Désactiver la double authentification de ${name} ?`, `<p>À utiliser si ${esc(name)} a perdu son téléphone et ses codes de secours : il pourra se connecter avec son seul mot de passe, puis la réactiver.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("shield")}Désactiver</button></div>`, { ic: "shield" });
      m.querySelector("[data-ok]").onclick = async () => { await api(`/api/users/${encodeURIComponent(name)}/2fa`, { method: "DELETE" }); closePanel(); toast("Double authentification désactivée"); comptes(el); };
    });
    row.querySelector("[data-a=role]").onchange = async e => {
      try { await api(`/api/users/${encodeURIComponent(name)}`, { method: "PUT", json: { role: e.target.value } }); toast("Rôle modifié"); }
      catch (err) { toast(err.message, "err"); comptes(el); }
    };
    row.querySelector("[data-a=pw]").onclick = () => {
      const m = modal(`Mot de passe de ${name}`, `<form><input type="password" required placeholder="Nouveau mot de passe" autocomplete="new-password">
        <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Changer</button></div></form>`, { ic: "key" });
      m.querySelector("form").onsubmit = async ev => {
        ev.preventDefault();
        try { await api(`/api/users/${encodeURIComponent(name)}`, { method: "PUT", json: { password: m.querySelector("input").value } }); closePanel(); toast("Mot de passe changé"); }
        catch (err) { toast(err.message, "err"); }
      };
    };
    row.querySelector("[data-a=del]").onclick = () => {
      const m = modal(`Supprimer ${name} ?`, `<p>Le compte ne pourra plus se connecter. Ses fichiers sur le NAS ne sont pas supprimés.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
      m.querySelector("[data-ok]").onclick = async () => {
        try { await api(`/api/users/${encodeURIComponent(name)}`, { method: "DELETE" }); closePanel(); toast("Compte supprimé"); comptes(el); }
        catch (err) { toast(err.message, "err"); }
      };
    };
  });
}

// --- Double authentification ---------------------------------------------------
async function twofa(el) {
  const st = await api("/api/me/2fa");
  el.innerHTML = `<div class="card-title">${icon("shield")}Double authentification ${st.enabled ? `<span class="pill-ok">activée</span>` : `<span class="pill-warn">désactivée</span>`}</div>
    <p class="hint" style="margin-top:-6px">En plus du mot de passe, la connexion demande un code à 6 chiffres affiché par une appli sur ton téléphone
      (Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Bitwarden…). Indispensable si le site est ouvert sur Internet.</p>
    ${st.enabled ? `<p>Codes de secours restants : <b>${st.recovery_left}</b> sur 10.</p>
      <button class="btn ghost" data-a="off">${icon("x")}Désactiver</button>`
      : `<button class="btn" data-a="on">${icon("shield")}Activer</button>`}`;
  el.querySelector("[data-a=off]")?.addEventListener("click", () => {
    const m = modal("Désactiver la double authentification", `<form><label class="field">Ton mot de passe</label><input type="password" required autocomplete="current-password">
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn danger">Désactiver</button></div></form>`, { ic: "shield" });
    m.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      try { await api("/api/me/2fa/disable", { json: { password: m.querySelector("input").value } }); closePanel(); toast("Double authentification désactivée"); twofa(el); }
      catch (err) { toast(err.message, "err"); }
    };
  });
  el.querySelector("[data-a=on]")?.addEventListener("click", () => {
    const m = modal("Activer la double authentification", `<div class="tf-body"><form id="tf-pw"><label class="field">Confirme ton mot de passe</label>
      <input type="password" required autocomplete="current-password">
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">Continuer</button></div></form></div>`, { ic: "shield" });
    m.querySelector("#tf-pw").onsubmit = async e => {
      e.preventDefault();
      try {
        const setup = await api("/api/me/2fa/setup", { json: { password: m.querySelector("input").value } });
        const body = m.querySelector(".tf-body");
        const c = await qrCanvas(setup.uri, { size: 520, ecc: "M" });
        c.className = "qr-canvas";
        body.innerHTML = `<ol class="tuto">
            <li><b>Scanne ce QR code</b><span>Avec ton appli d'authentification (bouton « + » ou « Ajouter un compte »).</span></li></ol>
          <div class="tf-qr"></div>
          <p class="hint center">Impossible de scanner ? Saisis cette clé : <code class="tf-key">${esc(setup.secret.match(/.{1,4}/g).join(" "))}</code></p>
          <form id="tf-code"><ol class="tuto" style="counter-reset: s 1"><li><b>Tape le code affiché</b><span>6 chiffres, qui changent toutes les 30 secondes.</span></li></ol>
            <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="code-input" placeholder="123 456" required>
            <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Activer</button></div></form>`;
        body.querySelector(".tf-qr").append(c);
        body.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closePanel));
        body.querySelector("input").focus();
        body.querySelector("#tf-code").onsubmit = async ev => {
          ev.preventDefault();
          try {
            const { codes } = await api("/api/me/2fa/enable", { json: { code: body.querySelector(".code-input").value } });
            body.innerHTML = `<div class="intro" style="margin-top:0"><span class="tile vert">${icon("check")}</span><p><b>C'est activé !</b> Garde ces <b>codes de secours</b> en lieu sûr :
              chacun permet de te connecter une fois si tu perds ton téléphone.</p></div>
              <div class="recovery">${codes.map(c => `<code>${c}</code>`).join("")}</div>
              <div class="modal-foot"><button class="btn ghost" data-a="copy">${icon("copy")}Copier</button><button class="btn ghost" data-a="dl">${icon("download")}Télécharger</button><button class="btn" data-close>J'ai noté mes codes</button></div>`;
            const text = `Codes de secours ${state.config.site || "Bêta Tool"} (${state.config.user.name})\n\n${codes.join("\n")}\n`;
            body.querySelector("[data-a=copy]").onclick = async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast("Codes copiés"); };
            body.querySelector("[data-a=dl]").onclick = () => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
              a.download = "codes-de-secours-beta-tool.txt";
              a.click();
            };
            body.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closePanel));
            twofa(el);
          } catch (err) { toast(err.message, "err"); }
        };
      } catch (err) { toast(err.message, "err"); }
    };
  });
}

// --- Notifications --------------------------------------------------------------
const NOTIF_TOOLS = ["journee", "mails", "colis", "telecharger", "abonnements", "convertir", "video", "transcription", "image", "drop", "presse-papier", "questionnaires",
  "agenda", "paperasse", "recettes", "surveillance", "sauvegardes", "traduction", "reglages"];

async function notifications(el) {
  const sub = await push.current().catch(() => null);
  const st = await api("/api/push" + (sub ? "?endpoint=" + encodeURIComponent(sub.endpoint) : ""));
  const why = push.unsupported();
  const on = !!sub && st.subscribed;
  const tools = NOTIF_TOOLS.map(id => id === "reglages" ? { id, name: "Sécurité du compte", icon: "shield", tile: "", desc: "Connexion avec un code de secours, double authentification…" }
    : TOOLS.find(t => t.id === id)).filter(t => t && (t.id === "reglages" || state.config.tools[t.id] !== false) && (!t.admin || isAdmin()));
  el.innerHTML = `<div class="card">
      <div class="card-title">${icon("bell")}Sur cet appareil <span class="count">${esc(push.deviceName())}</span></div>
      <p class="hint" style="margin-top:-6px">Reçois une notification sur ton téléphone ou ton ordinateur quand un téléchargement est fini, qu'un youtubeur publie une vidéo,
        qu'un site ne répond plus… même quand Bêta Tool est fermé.</p>
      ${why ? `<div class="intro" style="margin:0"><span class="tile ambre">${icon("alert")}</span><p>${why === "https"
        ? "<b>Adresse en https:// nécessaire.</b> Les navigateurs n'autorisent les notifications push que sur un site sécurisé : passe par le proxy inversé du NAS ou Tailscale (voir le README)."
        : why === "ios-install" ? "<b>Sur iPhone et iPad</b>, installe d'abord l'appli : bouton Partager de Safari → « Sur l'écran d'accueil ». Ouvre ensuite Bêta Tool depuis l'icône et reviens ici."
        : "Ce navigateur ne gère pas les notifications push. Essaie avec Chrome, Edge, Firefox ou Safari récent."}</p></div>`
        : `<div class="set-row" style="border:0;padding:0"><span class="tile ${on ? "vert" : ""}">${icon("bell")}</span>
          <div class="txt"><b>${on ? "Notifications activées" : "Notifications désactivées"}</b><small>${on ? "Cet appareil reçoit les notifications choisies plus bas." : "Active-les pour être prévenu même quand Bêta Tool est fermé."}</small></div>
          ${on ? `<button class="btn ghost small" data-a="test">${icon("send")}Tester</button><button class="btn ghost small" data-a="off">Désactiver</button>`
            : `<button class="btn" data-a="on">${icon("bell")}Activer</button>`}</div>`}
    </div>
    <div class="card"><div class="card-title">${icon("list")}Me prévenir pour</div>
      ${tools.map(t => `<div class="set-row"><span class="tile ${t.tile}">${icon(t.icon)}</span>
        <div class="txt"><b>${esc(t.name)}</b><small>${esc(NOTIF_HINT[t.id] || t.desc)}</small></div>
        <label class="switch"><input type="checkbox" data-tool="${t.id}" ${st.prefs.off.includes(t.id) ? "" : "checked"}><span></span></label></div>`).join("")}
    </div>
    ${st.devices.length ? `<div class="card"><div class="card-title">${icon("monitor")}Mes appareils abonnés <span class="count">${st.devices.length}</span></div>
      ${st.devices.map(d => `<div class="set-row"><span class="tile">${icon(/iPhone|Android|iPad/.test(d.name) ? "phone" : "monitor")}</span>
        <div class="txt"><b>${esc(d.name)}${d.this ? " (cet appareil)" : ""}</b><small>Depuis ${ago(d.created)}</small></div></div>`).join("")}</div>` : ""}`;
  el.querySelector("[data-a=on]")?.addEventListener("click", async () => {
    try { await push.enable(); toast("Notifications activées sur cet appareil"); notifications(el); } catch (err) { toast(err.message, "err"); }
  });
  el.querySelector("[data-a=off]")?.addEventListener("click", async () => { await push.disable(); toast("Notifications désactivées"); notifications(el); });
  el.querySelector("[data-a=test]")?.addEventListener("click", async () => {
    try { const r = await api("/api/push/test", { json: {} }); toast(`Notification envoyée à ${r.sent} appareil${r.sent > 1 ? "s" : ""}`); } catch (err) { toast(err.message, "err"); }
  });
  el.querySelectorAll("[data-tool]").forEach(cb => cb.onchange = async () => {
    const off = [...el.querySelectorAll("[data-tool]")].filter(x => !x.checked).map(x => x.dataset.tool);
    await api("/api/push/prefs", { method: "PUT", json: { off } });
    toast("Préférences enregistrées");
  });
}
const NOTIF_HINT = {
  telecharger: "Téléchargement terminé ou en échec.", abonnements: "Nouvelle vidéo d'une chaîne suivie.", convertir: "Conversion terminée.",
  video: "Compression terminée.", transcription: "Transcription prête.", image: "Traitement d'images terminé.", drop: "Quelqu'un t'a envoyé des fichiers.",
  "presse-papier": "Nouveau contenu copié depuis un autre appareil.", questionnaires: "Nouvelle réponse à un questionnaire.",
  agenda: "Rappels de tes événements.", paperasse: "Échéances à venir (factures, contrats…).", recettes: "Liste de courses modifiée par quelqu'un d'autre.",
  surveillance: "Un site ou un service ne répond plus, ou revient.", sauvegardes: "Sauvegarde réussie ou en échec.", traduction: "Traduction de document terminée.",
};

// --- Mises à jour -------------------------------------------------------------
async function maj(el) {
  const u = await api("/api/update");
  el.innerHTML = `
    <div class="card">
      <div class="card-title">${icon("refresh")}Version installée</div>
      <dl class="kv">
        <dt>Bêta Tool</dt><dd>${esc(u.current)} ${u.current === u.builtin ? `<span class="pill-ok">version de l'image</span>` : `<span class="pill-ok">mise à jour installée</span>`}</dd>
        <dt>Image Docker</dt><dd>${esc(u.builtin)}</dd>
        <dt>yt-dlp</dt><dd>${esc(u.ytdlp || "?")}</dd>
      </dl>
      ${u.launcher ? "" : `<p class="hint">${icon("alert")} Le site ne tourne pas via le lanceur (launch.py) : après une mise à jour, redémarre-le à la main.</p>`}
    </div>

    <div class="card">
      <div class="card-title">${icon("download")}Installer une mise à jour</div>
      <p class="hint" style="margin-top:-6px">Colle le lien de la mise à jour (fichier .zip, ou lien « latest.json »), ou choisis le fichier téléchargé.</p>
      <form class="row" id="upd-url"><input type="text" class="grow" name="url" placeholder="https://…/beta-tool-update-2.1.0.zip" required>
        <button class="btn">${icon("download")}Installer</button></form>
      <label class="drop" id="upd-drop" style="padding:20px"><input type="file" accept=".zip" hidden>
        <strong>ou glisse le fichier .zip ici</strong><small>beta-tool-update-x.y.z.zip</small></label>
      <div id="upd-msg"></div>
    </div>

    <div class="card">
      <div class="card-title">${icon("bell")}Vérification automatique</div>
      <form class="row" id="upd-check"><input type="text" class="grow" name="url" value="${esc(u.update_url)}" placeholder="Adresse du fichier latest.json (optionnel)">
        <button class="btn ghost">${icon("refresh")}Vérifier</button></form>
      <div id="check-result"></div>
    </div>

    <div class="card">
      <div class="card-title">${icon("clock")}Historique et retour arrière</div>
      ${u.history.length ? u.history.map(h => `<div class="set-row"><span class="tile">${icon("refresh")}</span>
        <div class="txt"><b>Version ${esc(h.version)}</b><small>Installée le ${esc(h.date)}</small>
        ${h.notes.length ? `<ul class="changelog">${h.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div>
        ${u.installed.includes(h.version) && h.version !== u.current ? `<button class="btn small ghost" data-use="${esc(h.version)}">Utiliser</button>` : h.version === u.current ? `<span class="pill-ok">active</span>` : ""}
        ${u.bad.includes(h.version) ? `<span class="pill-warn">n'a pas démarré</span>` : ""}</div>`).join("")
        : `<p class="hint">Aucune mise à jour installée depuis les réglages.</p>`}
      ${u.current !== u.builtin ? `<div class="set-row"><span class="tile">${icon("nas")}</span><div class="txt"><b>Version de l'image Docker (${esc(u.builtin)})</b><small>Revenir à la version d'origine</small></div>
        <button class="btn small ghost" data-use="builtin">Utiliser</button></div>` : ""}
    </div>

    <div class="card">
      <div class="card-title">${icon("video")}Téléchargeur (yt-dlp)</div>
      <p class="hint" style="margin-top:-6px">YouTube change souvent : si les téléchargements échouent, mets yt-dlp à jour (sans reconstruire l'image).</p>
      <button class="btn ghost" id="ytdlp">${icon("refresh")}Mettre à jour yt-dlp</button>
      <button class="btn ghost" id="restart">${icon("power")}Redémarrer le site</button>
    </div>`;

  const install = async body => {
    $("#upd-msg").innerHTML = `<div class="loading"><span class="spinner"></span>Installation…</div>`;
    try {
      const r = await api("/api/update/install", body);
      waitRestart(`Version ${r.version} installée`, r.notes);
    } catch (err) { $("#upd-msg").innerHTML = `<div class="msg">${esc(err.message)}</div>`; }
  };
  $("#upd-url").onsubmit = e => { e.preventDefault(); install({ json: { url: new FormData(e.target).get("url") } }); };
  const drop = $("#upd-drop");
  const onFile = f => { const fd = new FormData(); fd.append("file", f); install({ method: "POST", body: fd }); };
  drop.querySelector("input").onchange = e => e.target.files[0] && onFile(e.target.files[0]);
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); });

  $("#upd-check").onsubmit = async e => {
    e.preventDefault();
    const url = new FormData(e.target).get("url").trim();
    await api("/api/settings", { method: "PUT", json: { update_url: url } });
    const box = $("#check-result");
    box.innerHTML = `<div class="loading"><span class="spinner"></span>Vérification…</div>`;
    try {
      const c = await api("/api/update/check", { json: { url } });
      box.innerHTML = c.available ? `<div class="result"><span class="tile">${icon("download")}</span>
          <div class="body"><b>Version ${esc(c.version)} disponible</b><span class="meta">Tu as la ${esc(c.current)}${c.rebuild ? " · demande de reconstruire l'image" : ""}</span>
          ${c.notes?.length ? `<ul class="changelog">${c.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div>
          ${c.rebuild ? "" : `<div class="actions"><button class="btn small" id="do-upd">Installer</button></div>`}</div>`
        : `<p class="pill-ok" style="margin-top:12px">${icon("check")}Tu es à jour (${esc(c.current)})</p>`;
      $("#do-upd")?.addEventListener("click", () => install({ json: { url: c.url, sha256: c.sha256 } }));
    } catch (err) { box.innerHTML = `<div class="msg">${esc(err.message)}</div>`; }
  };
  el.querySelectorAll("[data-use]").forEach(b => b.onclick = async () => {
    await api("/api/update/use", { json: { version: b.dataset.use } });
    waitRestart("Changement de version");
  });
  $("#ytdlp").onclick = async e => {
    e.target.disabled = true;
    try { await api("/api/update/ytdlp", { json: {} }); waitRestart("yt-dlp mis à jour"); }
    catch (err) { toast(err.message, "err"); e.target.disabled = false; }
  };
  $("#restart").onclick = async () => { await api("/api/restart", { json: {} }); waitRestart("Redémarrage"); };
}

/** Affiche « redémarrage… » puis recharge la page quand le site répond de nouveau. */
function waitRestart(title, notes = []) {
  const m = modal(title, `<div class="loading" style="justify-content:center"><span class="spinner"></span>Redémarrage du site…</div>
    ${notes.length ? `<ul class="changelog">${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`, { ic: "refresh" });
  const started = Date.now();
  const tick = async () => {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok && Date.now() - started > 2500) return location.reload();
    } catch {}
    if (Date.now() - started < 120000) tick();
    else m.querySelector(".loading").textContent = "Le site ne répond pas encore : recharge la page dans un instant.";
  };
  tick();
}

// --- Apparence et notifications ---------------------------------------------
function apparence(el) {
  const theme = (() => { try { return localStorage.getItem("bt-theme") || "auto"; } catch { return "auto"; } })();
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  el.innerHTML = `
    <div class="card"><div class="card-title">${icon("sun")}Thème</div>
      <div class="seg">${[["auto", "Automatique", "monitor"], ["light", "Clair", "sun"], ["dark", "Sombre", "moon"]].map(([v, l, i]) =>
        `<label><input type="radio" name="th" value="${v}" ${theme === v ? "checked" : ""}>${icon(i)}${l}</label>`).join("")}</div></div>
    <div class="card"><div class="card-title">${icon("translate")}Langue · Language</div>
      <div class="seg">${[["fr", "Français"], ["en", "English"]].map(([v, l]) =>
        `<label class="notranslate"><input type="radio" name="lg" value="${v}" ${(state.config.prefs?.lang || i18n.current()) === v ? "checked" : ""}>${l}</label>`).join("")}</div>
      <p class="hint">Choix enregistré pour ton compte, sur tous tes appareils.</p></div>
    <div class="card"><div class="card-title">${icon("bell")}Notifications</div>
      <p class="hint" style="margin-top:-6px">Notifications sur ton téléphone ou ordinateur, même quand Bêta Tool est fermé : réglages dans l'onglet Notifications.</p>
      <a class="btn ghost" href="#/reglages/notifications">${icon("bell")}Régler les notifications</a></div>
    <div class="card"><div class="card-title">${icon("phone")}Installer l'application</div>
      <p class="hint" style="margin-top:-6px">Une vraie icône sur ton téléphone ou ton ordinateur, en plein écran. Bonus : « Partager → Bêta Tool » depuis YouTube lance le téléchargement.</p>
      ${window.btInstall ? `<button class="btn" id="pwa">${icon("download")}Installer Bêta Tool</button>`
        : ios ? `<p>Sur iPhone / iPad : bouton <b>Partager</b> de Safari → <b>Sur l'écran d'accueil</b>.</p>`
        : `<p>Menu du navigateur → <b>Installer l'application</b> (ou « Ajouter à l'écran d'accueil »).</p>`}
      ${isSecureContext ? "" : `<p class="hint">${icon("alert")} L'installation complète (et le partage depuis d'autres applis) demande une adresse en HTTPS. Le README explique comment.</p>`}</div>`;
  el.querySelectorAll("[name=th]").forEach(r => r.onchange = () => setTheme(r.value));
  el.querySelectorAll("[name=lg]").forEach(r => r.onchange = async () => {
    await api("/api/me/prefs", { method: "PUT", json: { lang: r.value } });
    try { localStorage.setItem("bt-lang", r.value); } catch {}
    location.reload();
  });
  $("#pwa")?.addEventListener("click", async () => { window.btInstall.prompt(); window.btInstall = null; });
}

// --- À propos ---------------------------------------------------------------
function apropos(el) {
  const libs = [
    ["yt-dlp", "Unlicense", "Téléchargeur"], ["FFmpeg", "LGPL/GPL", "Vidéo, audio"], ["LibreOffice", "MPL 2.0", "Conversion de documents"],
    ["Pandoc", "GPL 2", "Texte balisé"], ["Calibre", "GPL 3", "Livres numériques"], ["Pillow / pillow-heif", "MIT-CMU / BSD", "Images"],
    ["Poppler", "GPL 2", "PDF"], ["Ghostscript", "AGPL 3", "Compression PDF"], ["OCRmyPDF + Tesseract", "MPL 2.0 / Apache 2.0", "OCR"],
    ["pikepdf", "MPL 2.0", "Chiffrement PDF"], ["pdf.js", "Apache 2.0", "Affichage PDF"], ["pdf-lib", "MIT", "Édition PDF"],
    ["JSZip", "MIT / GPL 3", "Archives ZIP"], ["7-Zip, bsdtar", "LGPL / BSD", "Décompresseur"], ["ONLYOFFICE Docs", "AGPL 3", "Bêta Work"],
    ["faster-whisper", "MIT", "Transcription"], ["rembg", "MIT", "Détourage d'images"], ["Vaultwarden", "AGPL 3", "Coffre"],
    ["marked, DOMPurify", "MIT / Apache 2.0", "Bêta Notes"], ["qrcode-generator, qr-scanner", "MIT", "QR codes"],
    ["Radicale", "GPL 3", "Agenda (CalDAV)"], ["Argos Translate, CTranslate2, SentencePiece", "MIT / Apache 2.0", "Traduction"],
    ["WireGuard, wg-easy", "GPL 2 / AGPL 3", "VPN"],
    ["Inter, Dancing Script", "OFL 1.1", "Polices"], ["Flask, Waitress", "BSD / ZPL", "Serveur web"],
  ];
  el.innerHTML = `<div class="card"><div class="card-title">${icon("help")}Bêta Tool ${esc(state.config.version)}</div>
      <p>Boîte à outils auto-hébergée : tes fichiers restent chez toi. Version bêta : tes idées et retours sont les bienvenus via le bouton <b>Suggestion</b>.</p></div>
    <div class="card"><div class="card-title">${icon("star")}Logiciels libres utilisés</div>
      <dl class="kv">${libs.map(([n, l, u]) => `<dt>${esc(n)}</dt><dd>${esc(u)} <span class="meta">· ${esc(l)}</span></dd>`).join("")}</dl></div>`;
}
