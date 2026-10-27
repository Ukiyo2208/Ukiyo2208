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
    </div>`;
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
