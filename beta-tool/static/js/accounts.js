// Comptes en ligne : assistant de connexion (iCloud, Gmail, Outlook, Google Agenda, CalDAV, .ics)
// partagé par les outils Mails et Agenda, et page « Réglages → Comptes en ligne ».
import { $, esc, icon, toast, modal, closePanel } from "./ui.js";
import { api, isAdmin } from "./state.js";

const MAIL = [
  ["icloud", "iCloud", "Adresses @icloud.com, @me.com", "cloud"],
  ["gmail", "Gmail", "Adresses @gmail.com", "mail"],
  ["microsoft", "Outlook", "Outlook, Hotmail, Live, Microsoft 365", "mail"],
  ["imap", "Autre adresse", "Orange, Free, SFR, La Poste, Yahoo, ton domaine…", "at"],
];
const CAL = [
  ["icloud", "iCloud", "Calendrier de l'iPhone et du Mac", "cloud"],
  ["google", "Google Agenda", "Agendas de ton compte Google", "calendar"],
  ["microsoft", "Outlook", "Outlook.com, Hotmail, Microsoft 365", "calendar"],
  ["caldav", "Serveur CalDAV", "Nextcloud, Synology Calendar, Fastmail…", "server"],
  ["ics", "Lien d'abonnement", "Jours fériés, vacances scolaires, club de sport (.ics)", "link"],
];
const TILE = { icloud: "", gmail: "rose", google: "vert", microsoft: "bleu-vert", imap: "violet", caldav: "ambre", ics: "violet" };
export const PROVIDER_ICON = { icloud: "cloud", gmail: "mail", google: "calendar", microsoft: "mail", caldav: "server", ics: "link" };

let oauth = null;
const ic = n => icon({ cloud: "server", at: "mail" }[n] || n);

/** Ouvre l'assistant. want : "mail" ou "cal" ; onDone(compte) une fois connecté. */
export async function connect({ want = "mail", onDone = () => {} } = {}) {
  oauth = (await api("/api/accounts")).oauth;
  const list = want === "mail" ? MAIL : CAL;
  const m = modal(want === "mail" ? "Ajouter une boîte mail" : "Raccorder un agenda", `<div class="acc-wiz">
    <p class="hint" style="margin-top:0">${want === "mail" ? "Tes mails restent chez ton fournisseur : Bêta Tool les affiche et t'avertit des nouveaux." : "Les événements restent chez ton fournisseur : tu les vois ici, à côté de l'agenda Famille, et tu peux les modifier."}</p>
    <div class="acc-providers">${list.map(([id, name, sub, i]) => `<button class="acc-prov" data-p="${id}"><span class="tile ${TILE[id]}">${ic(i)}</span>
      <span class="grow"><b>${esc(name)}</b><small>${esc(sub)}</small></span>${icon("right")}</button>`).join("")}</div>
    <div class="acc-step" hidden></div></div>`, { ic: want === "mail" ? "mail" : "calendar", large: true });
  const step = m.querySelector(".acc-step"), pick = m.querySelector(".acc-providers");
  const done = acc => { closePanel(); toast(`${acc.label} est connecté`); onDone(acc); };
  const back = () => { step.hidden = true; pick.hidden = false; step.innerHTML = ""; clearTimeout(pollTimer); };
  pick.onclick = e => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    pick.hidden = true;
    step.hidden = false;
    form(step, b.dataset.p, want, done);
    step.querySelector("[data-back]")?.addEventListener("click", back);
  };
  m.addEventListener("closed", () => clearTimeout(pollTimer));
}

let pollTimer = null;
const backBtn = `<button type="button" class="btn ghost small" data-back>${icon("left")}Autres services</button>`;
const foot = label => `<div class="modal-foot">${backBtn}<span class="grow"></span><button class="btn">${icon("check")}${label}</button></div>`;
const pw = (label = "Mot de passe d'application") => `<label class="field">${label}</label><input type="password" name="password" required autocomplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx">`;
const mailField = (ph = "prenom@exemple.fr") => `<label class="field">Adresse mail</label><input type="email" name="email" required placeholder="${ph}" autocomplete="off">`;

function form(el, p, want, done) {
  const submit = (fn, label = "Connexion…") => async e => {
    e.preventDefault();
    const btn = e.target.querySelector(".modal-foot .btn:last-child");
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${label}`;
    try { done(await fn(new FormData(e.target))); }
    catch (err) { toast(err.message, "err"); btn.disabled = false; btn.innerHTML = old; }
  };
  const post = body => api("/api/accounts", { json: body });

  if (p === "icloud") {
    el.innerHTML = `<form><ol class="tuto">
      <li><b>Crée un mot de passe pour Bêta Tool</b><span>Sur <a href="https://account.apple.com" target="_blank" rel="noopener">account.apple.com</a> → Connexion et sécurité → Mots de passe pour app → « + ». Nomme-le « Bêta Tool ».</span></li>
      <li><b>Colle-le ci-dessous avec ton adresse Apple</b><span>Ton vrai mot de passe Apple ne marche pas ici : Apple l'interdit, pour ta sécurité.</span></li></ol>
      ${mailField("prenom@icloud.com")}${pw()}
      <div class="acc-use"><span class="meta">Utiliser pour :</span><label class="check"><input type="checkbox" name="mail" checked> Mails</label><label class="check"><input type="checkbox" name="cal" checked> Agenda</label></div>
      ${foot("Connecter iCloud")}</form>`;
    el.querySelector("form").onsubmit = submit(f => post({ provider: "icloud", email: f.get("email"), password: f.get("password"), mail: !!f.get("mail"), cal: !!f.get("cal") }));
  } else if (p === "gmail") {
    el.innerHTML = `<form><ol class="tuto">
      <li><b>Active la validation en deux étapes</b><span>Sur <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">myaccount.google.com/security</a>, si ce n'est pas déjà fait.</span></li>
      <li><b>Crée un mot de passe d'application</b><span>Sur <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, nomme-le « Bêta Tool » : Google affiche 16 lettres.</span></li>
      <li><b>Colle-les ci-dessous</b><span>Ton agenda Google se raccorde à part, depuis l'outil Agenda.</span></li></ol>
      ${mailField("prenom@gmail.com")}${pw()}${foot("Connecter Gmail")}</form>`;
    el.querySelector("form").onsubmit = submit(f => post({ provider: "gmail", email: f.get("email"), password: f.get("password"), mail: true }));
  } else if (p === "microsoft") {
    if (oauth.microsoft) return microsoft(el, want, done);
    if (want === "mail") {
      el.innerHTML = `<div class="acc-off"><span class="tile ambre">${icon("alert")}</span><div><b>La connexion Microsoft n'est pas encore activée</b>
        <p class="hint">Microsoft n'accepte plus les mots de passe pour lire les mails d'Outlook depuis une autre appli : il faut une connexion « Se connecter avec Microsoft ». ${isAdmin() ? `Active-la en 5 minutes dans <a href="#/reglages/enligne" data-close>Réglages → Comptes en ligne</a>.` : "Demande à l'administrateur de Bêta Tool de l'activer (Réglages → Comptes en ligne)."}</p></div></div>
        <div class="modal-foot">${backBtn}</div>`;
      return;
    }
    return icsForm(el, done, "outlook");
  } else if (p === "google") {
    if (oauth.google) return google(el, done);
    return icsForm(el, done, "google");
  } else if (p === "ics") {
    return icsForm(el, done, "ics");
  } else if (p === "caldav") {
    el.innerHTML = `<form><p class="hint" style="margin-top:0">L'adresse se trouve dans les réglages de ton serveur (Nextcloud : Agenda → Paramètres → « Copier l'adresse CalDAV principale »).</p>
      <label class="field">Adresse du serveur</label><input type="url" name="url" required placeholder="https://cloud.exemple.fr/remote.php/dav">
      <div class="grid2"><div><label class="field">Identifiant</label><input type="text" name="username" required autocomplete="off"></div>
      <div>${pw("Mot de passe")}</div></div>
      <label class="field">Nom affiché</label><input type="text" name="name" placeholder="Ex. Nextcloud">
      ${foot("Raccorder")}</form>`;
    el.querySelector("form").onsubmit = submit(f => post({ provider: "caldav", url: f.get("url"), username: f.get("username"), password: f.get("password"), name: f.get("name") }));
  } else {
    el.innerHTML = `<form>${mailField()}${pw("Mot de passe")}
      <p class="hint">Certains fournisseurs (Yahoo, Orange avec double authentification…) demandent un mot de passe d'application, à créer dans les réglages de sécurité de ton compte.</p>
      <details class="formats acc-adv"><summary>${icon("settings")}Réglages du serveur <small class="meta" data-auto></small></summary>
        <div class="grid2">
          <div><label class="field">Serveur IMAP (réception)</label><input type="text" name="imap_host"></div>
          <div class="grid2"><div><label class="field">Port</label><input type="number" name="imap_port"></div><div><label class="field">Sécurité</label><select name="imap_sec"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Aucune</option></select></div></div>
          <div><label class="field">Serveur SMTP (envoi)</label><input type="text" name="smtp_host"></div>
          <div class="grid2"><div><label class="field">Port</label><input type="number" name="smtp_port"></div><div><label class="field">Sécurité</label><select name="smtp_sec"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Aucune</option></select></div></div>
          <div><label class="field">Identifiant</label><input type="text" name="username" autocomplete="off"></div>
          <label class="check" style="align-self:end"><input type="checkbox" name="auto_sent"> Le serveur range seul les mails envoyés</label>
        </div></details>${foot("Connecter")}</form>`;
    const f = el.querySelector("form");
    let detected = "";
    f.email.addEventListener("change", async () => {
      if (!f.email.value.includes("@") || detected === f.email.value) return;
      detected = f.email.value;
      try {
        const d = await api("/api/accounts/detect", { json: { email: f.email.value } });
        for (const k of ["imap_host", "imap_port", "imap_sec", "smtp_host", "smtp_port", "smtp_sec", "username"]) f[k].value = d[k];
        f.auto_sent.checked = d.auto_sent;
        el.querySelector("[data-auto]").textContent = `· ${d.imap_host}`;
      } catch {}
    });
    f.onsubmit = submit(fd => {
      const body = Object.fromEntries(fd);
      body.auto_sent = !!fd.get("auto_sent");
      return post({ ...body, provider: "imap", mail: true });
    });
  }
}

function icsForm(el, done, kind) {
  const how = {
    google: `<ol class="tuto"><li><b>Ouvre Google Agenda sur un ordinateur</b><span><a href="https://calendar.google.com" target="_blank" rel="noopener">calendar.google.com</a> → roue dentée → Paramètres.</span></li>
      <li><b>Choisis ton agenda à gauche</b><span>Puis « Intégrer l'agenda » → copie l'« Adresse secrète au format iCal ».</span></li>
      <li><b>Colle-la ci-dessous</b><span>Lecture seule : les événements ajoutés dans Google apparaissent ici (mise à jour toutes les 15 minutes).</span></li></ol>
      ${oauth.google ? "" : `<p class="hint">${icon("lightbulb")} Pour aussi <b>ajouter et modifier</b> des événements Google depuis Bêta Tool, ${isAdmin() ? `active la connexion Google dans <a href="#/reglages/enligne" data-close>Réglages → Comptes en ligne</a>` : "demande à l'administrateur d'activer la connexion Google (Réglages → Comptes en ligne)"}.</p>`}`,
    outlook: `<ol class="tuto"><li><b>Ouvre Outlook sur le web</b><span><a href="https://outlook.live.com/calendar" target="_blank" rel="noopener">outlook.live.com</a> → Paramètres → Calendrier → Calendriers partagés.</span></li>
      <li><b>« Publier un calendrier »</b><span>Choisis l'agenda et « Peut afficher tous les détails », puis Publier. Copie le lien ICS.</span></li>
      <li><b>Colle-le ci-dessous</b><span>Lecture seule. Pour aussi modifier tes événements, ${isAdmin() ? `active la connexion Microsoft dans <a href="#/reglages/enligne" data-close>Réglages → Comptes en ligne</a>` : "demande à l'administrateur d'activer la connexion Microsoft"}.</span></li></ol>`,
    ics: `<p class="hint" style="margin-top:0">Beaucoup de sites proposent un lien « S'abonner » ou « webcal:// » : jours fériés, vacances scolaires, matchs, cours… Lecture seule, mis à jour toutes les 15 minutes.</p>`,
  }[kind];
  el.innerHTML = `<form>${how}<label class="field">Adresse du calendrier</label><input type="url" name="url" required placeholder="https://… ou webcal://…">
    <label class="field">Nom affiché</label><input type="text" name="name" placeholder="${kind === "ics" ? "Ex. Vacances scolaires" : kind === "google" ? "Ex. Google perso" : "Ex. Outlook travail"}">${foot("Raccorder")}</form>`;
  el.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector(".modal-foot .btn:last-child");
    btn.disabled = true;
    try { done(await api("/api/accounts", { json: { provider: "ics", url: f.get("url").trim(), name: f.get("name") } })); }
    catch (err) { toast(err.message, "err"); btn.disabled = false; }
  };
}

async function microsoft(el, want, done) {
  el.innerHTML = `<div class="acc-oauth"><p class="hint" style="margin-top:0">Tu vas te connecter sur le site de Microsoft : Bêta Tool ne voit jamais ton mot de passe.</p>
    <div class="acc-code"><span class="spinner"></span> Préparation…</div><div class="modal-foot">${backBtn}</div></div>`;
  try {
    const r = await api("/api/accounts/oauth/microsoft/start", { json: { purpose: want } });
    el.querySelector(".acc-code").innerHTML = `<ol class="tuto">
      <li><b>Ouvre la page de connexion Microsoft</b><span><a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">${icon("external")}${esc(r.url.replace(/^https?:\/\//, ""))}</a></span></li>
      <li><b>Tape ce code</b><span><code class="acc-big" data-copy="${esc(r.code)}">${esc(r.code)}</code> <button class="icon-btn plain" data-copy="${esc(r.code)}" title="Copier">${icon("copy")}</button></span></li>
      <li><b>Connecte-toi et accepte</b><span>Cette fenêtre se met à jour toute seule.</span></li></ol>
      <p class="meta" data-wait><span class="spinner"></span> En attente de la connexion…</p>`;
    el.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast("Code copié")));
    const tick = async () => {
      if (!el.isConnected) return;
      try {
        const res = await api("/api/accounts/oauth/microsoft/poll", { json: { flow: r.flow } });
        if (res.pending) { pollTimer = setTimeout(tick, r.interval * 1000); return; }
        done(res);
      } catch (err) { el.querySelector("[data-wait]").innerHTML = `${icon("alert")} ${esc(err.message)}`; }
    };
    pollTimer = setTimeout(tick, r.interval * 1000);
  } catch (err) { el.querySelector(".acc-code").innerHTML = `<p class="hint">${icon("alert")} ${esc(err.message)}</p>`; }
}

async function google(el, done) {
  el.innerHTML = `<form><ol class="tuto">
      <li><b>Connecte-toi à Google</b><span><button type="button" class="btn small" data-go>${icon("external")}Ouvrir la connexion Google</button></span></li>
      <li><b>Accepte l'accès à l'agenda</b><span>Si Google affiche « Application non validée », clique sur « Paramètres avancés » puis « Accéder à… » : c'est l'application que ton administrateur a créée pour la maison.</span></li>
      <li><b>À la fin, la page affiche une erreur : c'est normal</b><span>Copie l'adresse de cette page (elle commence par http://127.0.0.1) et colle-la ci-dessous.</span></li></ol>
    <label class="field">Adresse de la page d'erreur</label><input type="text" name="url" required placeholder="http://127.0.0.1:53682/?state=…&code=…" autocomplete="off">
    ${foot("Raccorder Google Agenda")}</form>`;
  let flow = null;
  el.querySelector("[data-go]").onclick = async () => {
    try { const r = await api("/api/accounts/oauth/google/start", { json: {} }); flow = r.flow; window.open(r.url, "_blank", "noopener"); }
    catch (err) { toast(err.message, "err"); }
  };
  el.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    if (!flow) return toast("Commence par « Ouvrir la connexion Google »", "err");
    const btn = e.target.querySelector(".modal-foot .btn:last-child");
    btn.disabled = true;
    try { done(await api("/api/accounts/oauth/google/finish", { json: { flow, url: e.target.url.value } })); }
    catch (err) { toast(err.message, "err"); btn.disabled = false; }
  };
}

// --- Réglages → Comptes en ligne --------------------------------------------------------

export async function settingsTab(el) {
  const { accounts, oauth: o } = await api("/api/accounts");
  el.innerHTML = `<div class="card">
      <div class="card-title">${icon("globe")}Mes comptes en ligne <span class="count">${accounts.length}</span></div>
      <p class="hint" style="margin-top:0">Boîtes mail et agendas que tu as raccordés. Les mots de passe sont chiffrés sur le NAS et ne sont visibles par personne, même un administrateur.</p>
      <div class="acc-list">${accounts.length ? accounts.map(row).join("") : `<p class="meta">Aucun compte raccordé.</p>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn" data-add="mail">${icon("mail")}Ajouter une boîte mail</button>
        <button class="btn ghost" data-add="cal">${icon("calendar")}Raccorder un agenda</button></div></div>
    ${isAdmin() ? `<div class="card" id="acc-admin"></div>` : ""}`;
  el.onclick = async e => {
    const add = e.target.closest("[data-add]");
    if (add) return connect({ want: add.dataset.add, onDone: () => settingsTab(el) });
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const acc = accounts.find(a => a.id === b.dataset.acc);
    if (b.dataset.a === "del") {
      const only = b.dataset.only;
      if (!confirm(only ? `Ne plus utiliser « ${acc.label} » pour ${only === "mail" ? "les mails" : "l'agenda"} ?` : `Déconnecter « ${acc.label} » de Bêta Tool ? Rien n'est supprimé chez ${acc.provider_label}.`)) return;
      await api(`/api/accounts/${acc.id}${only ? "?only=" + only : ""}`, { method: "DELETE" });
      toast("Compte déconnecté");
      settingsTab(el);
    } else if (b.dataset.a === "edit") editAccount(acc, () => settingsTab(el));
  };
  if (isAdmin()) adminOAuth($("#acc-admin"), o);
}

function row(a) {
  const uses = [a.mail ? "Mails" : "", a.cal ? (a.cal.kind === "ics" ? "Agenda (lecture seule)" : `Agenda · ${a.cal.calendars?.length || 0}`) : ""].filter(Boolean);
  return `<div class="acc-row"><span class="tile ${TILE[a.provider] || ""}">${icon(PROVIDER_ICON[a.provider] || "mail")}</span>
    <div class="grow"><b>${esc(a.label)}</b><small class="meta">${esc(a.provider_label)} · ${uses.map(esc).join(" · ")}</small></div>
    <button class="icon-btn plain" data-acc="${a.id}" data-a="edit" title="Modifier">${icon("settings")}</button>
    <button class="icon-btn plain" data-acc="${a.id}" data-a="del" title="Déconnecter">${icon("trash")}</button></div>`;
}

export function editAccount(a, after = () => {}) {
  const m = modal(a.label, `<form>
    <label class="field">Nom affiché</label><input type="text" name="label" value="${esc(a.label)}">
    ${a.mail ? `<label class="field">Ton nom (expéditeur)</label><input type="text" name="name" value="${esc(a.mail.name || "")}" placeholder="Ex. Léa Martin">
      <label class="field">Signature</label><textarea name="signature" rows="3" placeholder="Ex. Léa · 06 12 34 56 78">${esc(a.mail.signature || "")}</textarea>
      <label class="check"><input type="checkbox" name="notify" ${a.mail.notify !== false ? "checked" : ""}> Me prévenir des nouveaux mails</label>` : ""}
    ${a.cal && a.cal.kind !== "ics" ? `<label class="field" style="margin-top:12px">Agendas affichés</label><div class="acc-cals">${(a.cal.calendars || []).map(c => `<label class="check">
      <input type="checkbox" name="cal-${c.id}" ${c.on !== false ? "checked" : ""}><span class="ag-dot" style="background:${c.color}"></span>${esc(c.name)}${c.ro ? ` <small class="meta">lecture seule</small>` : ""}</label>`).join("")}</div>
      <button type="button" class="btn ghost small" data-a="refresh">${icon("refresh")}Actualiser la liste</button>` : ""}
    <div class="modal-foot">${a.mail && a.cal ? `<button type="button" class="btn ghost small" data-only="${a.cal.kind === "ics" ? "cal" : "mail"}">${icon("x")}${a.cal.kind === "ics" ? "Retirer l'agenda" : "Retirer les mails"}</button>` : ""}
      <span class="grow"></span><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "settings" });
  const f = m.querySelector("form");
  f.onsubmit = async e => {
    e.preventDefault();
    const body = { label: f.label.value };
    if (a.mail) Object.assign(body, { name: f.name.value, signature: f.signature.value, notify: f.notify.checked });
    if (a.cal) body.calendars = Object.fromEntries((a.cal.calendars || []).filter(c => f["cal-" + c.id]).map(c => [c.id, { on: f["cal-" + c.id].checked }]));
    try { await api(`/api/accounts/${a.id}`, { method: "PUT", json: body }); closePanel(); toast("Enregistré"); after(); }
    catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-a=refresh]")?.addEventListener("click", async () => {
    try { await api(`/api/accounts/${a.id}/refresh`, { json: {} }); closePanel(); toast("Liste des agendas actualisée"); after(); }
    catch (err) { toast(err.message, "err"); }
  });
  m.querySelector("[data-only]")?.addEventListener("click", async ev => {
    await api(`/api/accounts/${a.id}?only=${ev.currentTarget.dataset.only}`, { method: "DELETE" });
    closePanel(); after();
  });
}

async function adminOAuth(el, o) {
  const cfg = await api("/api/accounts/oauth-config");
  el.innerHTML = `<div class="card-title">${icon("key")}Connexions Microsoft et Google <span class="count">administrateur</span></div>
    <p class="hint" style="margin-top:0">Outlook (mails et agenda) et Google Agenda en lecture-écriture demandent une « application » enregistrée gratuitement chez Microsoft et Google. À faire une seule fois pour toute la maison.</p>
    <form class="acc-oauth-form">
      <details class="formats" ${o.microsoft ? "" : "open"}><summary>${icon("mail")}Microsoft (Outlook, Hotmail, Microsoft 365) ${o.microsoft ? `<span class="chip ok">activé</span>` : ""}</summary>
        <ol class="tuto">
          <li><b>Ouvre le portail Azure</b><span><a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">portal.azure.com</a> → « Inscriptions d'applications » → « Nouvelle inscription » (un compte Microsoft gratuit suffit).</span></li>
          <li><b>Nom : « Bêta Tool »</b><span>Types de comptes : « Comptes dans un annuaire organisationnel et comptes Microsoft personnels ». Pas d'URI de redirection. Inscrire.</span></li>
          <li><b>Authentification → « Autoriser les flux clients publics » : Oui</b><span>Enregistrer. Rien d'autre à régler : chacun accepte les autorisations (mails, agenda) en se connectant.</span></li>
          <li><b>Copie l'« ID d'application (client) »</b><span>Colle-le ci-dessous.</span></li></ol>
        <label class="field">ID d'application Microsoft</label><input type="text" name="ms_client_id" value="${esc(cfg.ms_client_id)}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"></details>
      <details class="formats" ${o.google ? "" : ""}><summary>${icon("calendar")}Google Agenda ${o.google ? `<span class="chip ok">activé</span>` : ""}</summary>
        <ol class="tuto">
          <li><b>Crée un projet</b><span><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> → Nouveau projet « Bêta Tool ».</span></li>
          <li><b>Active l'API Google Calendar</b><span>« API et services » → Bibliothèque → Google Calendar API → Activer.</span></li>
          <li><b>Écran de consentement OAuth</b><span>Externe, nom « Bêta Tool », ton adresse. Ajoute la portée <code>…/auth/calendar</code>. Puis « Publier l'application » (sinon la connexion expire au bout de 7 jours).</span></li>
          <li><b>Identifiants → Créer → ID client OAuth</b><span>Type : « Application de bureau ». Copie l'ID client et le code secret ci-dessous.</span></li></ol>
        <div class="grid2"><div><label class="field">ID client Google</label><input type="text" name="google_client_id" value="${esc(cfg.google_client_id)}" placeholder="…apps.googleusercontent.com" autocomplete="off"></div>
          <div><label class="field">Code secret du client</label><input type="password" name="google_client_secret" placeholder="${cfg.google_secret_set ? "déjà enregistré (laisser vide pour le garder)" : "GOCSPX-…"}" autocomplete="new-password"></div></div></details>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn">${icon("check")}Enregistrer</button></div></form>`;
  el.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/accounts/oauth-config", { method: "PUT", json: { ms_client_id: f.ms_client_id.value, google_client_id: f.google_client_id.value, google_client_secret: f.google_client_secret.value } });
      toast("Connexions enregistrées");
      settingsTab(el.parentElement);
    } catch (err) { toast(err.message, "err"); }
  };
}
