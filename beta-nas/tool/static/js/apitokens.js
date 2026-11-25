// Réglages → API : jetons personnels pour l'API externe (/api/v1) et exemples d'utilisation.
import { esc, icon, toast, modal, closePanel } from "./ui.js";
import { api, ago } from "./state.js";

export async function settingsTab(el) {
  const d = await api("/api/me/tokens");
  const curl = (path, extra = "") => `curl ${extra}-H "Authorization: Bearer bt_…" ${d.base}${path}`;
  el.innerHTML = `
    ${d.open ? `<div class="intro" style="margin-top:0"><span class="tile ambre">${icon("alert")}</span><p><b>Le site est en accès libre</b> : l'API répond aussi sans jeton. Crée des comptes (Réglages → Comptes) pour que seuls les jetons y donnent accès.</p></div>` : ""}
    <div class="card">
      <div class="card-title">${icon("key")}Mes jetons <span class="count">${d.tokens.length}</span></div>
      <p class="hint" style="margin-top:0">Un jeton permet à une autre appli (Home Assistant, Raccourcis iPhone, n8n, un script…) d'accéder à <b>tes</b> mails, ton agenda ou tes contacts, avec seulement les droits que tu choisis. Tu peux le révoquer à tout moment.</p>
      <div class="acc-list">${d.tokens.length ? d.tokens.map(t => `<div class="acc-row"><span class="tile violet">${icon("key")}</span>
        <div class="grow"><b>${esc(t.name)}</b> <code class="meta">${esc(t.prefix)}</code>
          <small class="meta">${t.scopes.map(s => esc(d.scopes[s] || s)).join(" · ")}</small>
          <small class="meta">Créé ${ago(t.created)} · ${t.used ? `utilisé ${ago(t.used)}` : "jamais utilisé"}${t.expires ? ` · expire le ${new Date(t.expires * 1000).toLocaleDateString("fr-FR")}` : ""}</small></div>
        <button class="btn ghost small" data-revoke="${t.id}">${icon("x")}Révoquer</button></div>`).join("") : `<p class="meta">Aucun jeton.</p>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="tk-new">${icon("plus")}Créer un jeton</button>
        <a class="btn ghost" href="/api/v1/openapi.json" target="_blank" rel="noopener">${icon("code")}Description OpenAPI</a></div></div>
    <div class="card">
      <div class="card-title">${icon("code")}Utiliser l'API</div>
      <p class="hint" style="margin-top:0">Adresse : <code>${esc(d.base)}</code> — chaque appel envoie l'en-tête <code>Authorization: Bearer</code> suivi du jeton.</p>
      <details class="formats" open><summary>${icon("mail")}Mails</summary>
        <pre class="tk-code">${esc(curl("/mail/unread"))}
${esc(curl("/mail/messages?unread=1&limit=5"))}
${esc(curl("/mail/send", `-X POST -H "Content-Type: application/json" -d '{"to":"paul@exemple.fr","subject":"Coucou","text":"Envoyé par mon raccourci"}' `))}</pre></details>
      <details class="formats"><summary>${icon("calendar")}Agenda</summary>
        <pre class="tk-code">${esc(curl("/events?start=2026-11-01&end=2026-11-08"))}
${esc(curl("/events", `-X POST -H "Content-Type: application/json" -d '{"title":"Dentiste","start":"2026-11-03T09:30","end":"2026-11-03T10:00","cal":"famille","reminder":"60"}' `))}</pre></details>
      <details class="formats"><summary>${icon("users")}Contacts</summary>
        <pre class="tk-code">${esc(curl("/contacts?q=martin"))}
${esc(curl("/contacts", `-X POST -H "Content-Type: application/json" -d '{"first":"Léa","last":"Martin","book":"contacts-pro","phones":[{"type":"CELL","value":"06 12 34 56 78"}]}' `))}</pre></details>
      <details class="formats"><summary>${icon("home")}Home Assistant : nombre de mails non lus</summary>
        <pre class="tk-code">${esc(`# configuration.yaml
rest:
  - resource: ${d.base}/mail/unread
    headers:
      Authorization: "Bearer bt_…"
    scan_interval: 120
    sensor:
      - name: "Mails non lus"
        value_template: "{{ value_json.total }}"`)}</pre></details>
      <details class="formats"><summary>${icon("phone")}Raccourcis iPhone</summary>
        <p class="hint">Action « Obtenir le contenu de l'URL » : adresse <code>${esc(d.base)}/events</code>, méthode GET (ou POST avec un corps JSON), en-tête <code>Authorization</code> = <code>Bearer bt_…</code>. Puis « Obtenir la valeur du dictionnaire » pour lire le résultat.</p></details>
    </div>
    <div class="card">
      <div class="card-title">${icon("mic")}« Dis Siri, Bêta Tool » et widgets</div>
      <p class="hint" style="margin-top:0">Crée d'abord un jeton avec le droit <b>Commandes vocales et widget</b>. Les phrases comprises sont les mêmes que le micro de l'appli :
        « ajoute du lait à la liste de courses », « rendez-vous chez le dentiste mardi à 14h », « qu'est-ce que j'ai demain ? »…</p>
      <details class="formats" open><summary>${icon("mic")}Siri (iPhone, iPad, Apple Watch, HomePod)</summary>
        <ol class="ac-steps"><li>Appli <b>Raccourcis</b> › <b>+</b> › nomme le raccourci « Bêta Tool » (c'est la phrase à dire à Siri).</li>
          <li>Ajoute l'action <b>Dicter le texte</b> (langue : français).</li>
          <li>Ajoute <b>Obtenir le contenu de l'URL</b> : URL <code>${esc(d.base)}/command</code>, méthode <b>POST</b>, en-tête <code>Authorization</code> = <code>Bearer bt_…</code>,
            corps <b>JSON</b> avec un champ texte <code>text</code> = <i>Texte dicté</i>.</li>
          <li>Ajoute <b>Obtenir la valeur du dictionnaire</b> pour la clé <code>speech</code>, puis <b>Énoncer le texte</b>.</li>
          <li>« Dis Siri, Bêta Tool »… « ajoute des piles à la liste de courses ».</li></ol></details>
      <details class="formats"><summary>${icon("phone")}Google Assistant / Android</summary>
        <p class="hint">Avec l'appli gratuite <b>HTTP Shortcuts</b> : crée un raccourci « POST » vers <code>${esc(d.base)}/command</code> avec l'en-tête <code>Authorization: Bearer bt_…</code>
          et le corps <code>{"text": "{dictée}"}</code> (variable de type « texte saisi »), puis affiche ou lis le champ <code>speech</code>. Le raccourci se pose sur l'écran d'accueil.</p>
        <pre class="tk-code">${esc(curl("/command", `-X POST -H "Content-Type: application/json" -d '{"text":"ajoute du lait à la liste de courses"}' `))}</pre></details>
      <details class="formats"><summary>${icon("grid")}Widget d'écran d'accueil iPhone (Scriptable)</summary>
        <p class="hint">Installe l'appli gratuite <b>Scriptable</b>, crée un script, colle le code ci-dessous en remplaçant <code>bt_…</code> par ton jeton,
          puis ajoute un widget Scriptable (taille moyenne) sur l'écran d'accueil et choisis ce script.</p>
        <pre class="tk-code" id="tk-widget">${esc(widgetScript(d.base))}</pre>
        <button class="btn ghost small" id="tk-copyw">${icon("copy")}Copier le script</button></details>
      <details class="formats"><summary>${icon("code")}Résumé du jour en JSON (Home Assistant, KWGT…)</summary>
        <pre class="tk-code">${esc(curl("/widget"))}</pre></details>
    </div>`;
  el.querySelector("#tk-copyw").onclick = async () => { await navigator.clipboard.writeText(widgetScript(d.base)); toast("Script copié"); };
  el.querySelector("#tk-new").onclick = () => create(el, d);
  el.onclick = async e => {
    const b = e.target.closest("[data-revoke]");
    if (!b || !confirm("Révoquer ce jeton ? Les applis qui l'utilisent n'auront plus accès.")) return;
    await api(`/api/me/tokens/${b.dataset.revoke}`, { method: "DELETE" });
    toast("Jeton révoqué");
    settingsTab(el);
  };
}

function create(el, d) {
  const m = modal("Nouveau jeton", `<form>
    <label class="field">Nom</label><input type="text" name="name" required placeholder="Ex. Home Assistant, Raccourci « Mes mails »">
    <label class="field" style="margin-top:12px">Droits</label>
    <div class="tk-scopes">${Object.entries(d.scopes).map(([k, v]) => `<label class="check"><input type="checkbox" name="scope" value="${k}" ${k.endsWith(":read") ? "checked" : ""}> ${esc(v)} <code class="meta">${k}</code></label>`).join("")}</div>
    <label class="field" style="margin-top:12px">Durée</label><select name="days"><option value="0">Sans limite</option><option value="30">30 jours</option><option value="90">3 mois</option><option value="365">1 an</option></select>
    <p class="hint">Donne seulement les droits utiles : un affichage sur Home Assistant n'a besoin que de « Lire ».</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Créer</button></div></form>`, { ic: "key" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api("/api/me/tokens", { json: { name: f.name.value, days: +f.days.value, scopes: [...f.querySelectorAll("[name=scope]:checked")].map(x => x.value) } });
      closePanel();
      const s = modal("Ton jeton", `<p class="hint" style="margin-top:0">Copie-le maintenant : pour ta sécurité, il ne sera plus jamais affiché.</p>
        <div class="tk-token"><code>${esc(r.token)}</code><button class="btn small" data-copy>${icon("copy")}Copier</button></div>
        <div class="modal-foot"><button class="btn" data-close>${icon("check")}C'est noté</button></div>`, { ic: "key" });
      s.querySelector("[data-copy]").onclick = () => navigator.clipboard?.writeText(r.token).then(() => toast("Jeton copié"));
      s.addEventListener("closed", () => settingsTab(el));
    } catch (err) { toast(err.message, "err"); }
  };
}

function widgetScript(base) {
  return `// Bêta Tool : widget « Ma journée »
const URL = "${base}/widget";
const TOKEN = "bt_…"; // ton jeton (droit « Commandes vocales et widget »)
const req = new Request(URL);
req.headers = { Authorization: "Bearer " + TOKEN };
let d;
try { d = await req.loadJSON(); } catch (e) { d = null; }
const w = new ListWidget();
w.backgroundGradient = Object.assign(new LinearGradient(), { colors: [new Color("#0b1530"), new Color("#122a5c")], locations: [0, 1] });
w.url = "${base.replace(/\/api\/v1$/, "")}/#/journee";
const title = w.addText("Bêta Tool" + (d && d.weather ? "  " + d.weather.emoji + " " + d.weather.min + "°/" + d.weather.max + "°" : ""));
title.font = Font.boldSystemFont(14); title.textColor = Color.white();
w.addSpacer(6);
if (!d) { const t = w.addText("Pas de connexion au NAS"); t.textColor = Color.gray(); }
else {
  for (const e of d.events.slice(0, 3)) { const t = w.addText((e.time ? e.time + "  " : "• ") + e.title); t.font = Font.systemFont(12); t.textColor = Color.white(); t.lineLimit = 1; }
  if (!d.events.length) { const t = w.addText("Rien de prévu aujourd'hui"); t.font = Font.systemFont(12); t.textColor = Color.lightGray(); }
  if (d.bins.length) { const t = w.addText("♻️ Ce soir : " + d.bins.join(", ")); t.font = Font.systemFont(11); t.textColor = new Color("#fbbf24"); }
  w.addSpacer();
  const line = [d.tasks_count ? d.tasks_count + " tâche(s)" : null, d.unread ? d.unread + " mail(s)" : null, d.parcels ? d.parcels + " colis" : null].filter(Boolean).join(" · ");
  const f = w.addText(line || "Tout est à jour"); f.font = Font.mediumSystemFont(11); f.textColor = new Color("#93c5fd");
}
Script.setWidget(w);
Script.complete();`;
}
