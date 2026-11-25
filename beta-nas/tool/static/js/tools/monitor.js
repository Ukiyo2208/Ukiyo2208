// Outil « Surveillance » (administrateurs) : sites, services et espace disque sous contrôle.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const TYPES = {
  http: ["Site web", "globe", "Vérifie qu'une page répond (code HTTP inférieur à 400)."],
  keyword: ["Mot dans une page", "search", "Vérifie qu'un mot est présent (ou absent) dans une page."],
  tcp: ["Port d'un service", "server", "Vérifie qu'un service répond sur un port (box, NAS, serveur de jeu…)."],
  ping: ["Ping", "wifi", "Vérifie qu'un appareil du réseau répond."],
  disk: ["Espace disque", "nas", "Prévient quand il reste peu de place sur le NAS."],
};
const PRESETS = [
  { label: "Bêta Tool", icon: "grid", m: { type: "http", name: "Bêta Tool", target: location.origin + "/login", interval: 300 } },
  { label: "Espace disque du NAS", icon: "nas", m: { type: "disk", name: "Espace disque", target: "*", threshold: 10, interval: 900 } },
  { label: "Box internet", icon: "wifi", m: { type: "tcp", name: "Box internet", target: "192.168.1.1:80", interval: 300 } },
  { label: "Accès à Internet", icon: "globe", m: { type: "http", name: "Accès à Internet", target: "https://www.google.com", interval: 300 } },
  { label: "Bêta Work", icon: "briefcase", m: { type: "http", name: "Bêta Work (ONLYOFFICE)", target: `${location.protocol}//${location.hostname}:8081/healthcheck`, interval: 300 } },
  { label: "Coffre", icon: "key", m: { type: "http", name: "Coffre (Vaultwarden)", target: `${location.protocol}//${location.hostname}:8082/alive`, interval: 300 } },
];
const INTERVALS = [[60, "1 min"], [300, "5 min"], [900, "15 min"], [1800, "30 min"], [3600, "1 h"]];
let timer = null, ctx = {};

const state = m => m.paused ? ["pause", "En pause"] : m.state === "down" ? ["down", "En panne"] : m.state === "up" ? ["up", "En ligne"] : ["wait", "En attente"];
const pct = v => v == null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: v >= 99 && v < 100 ? 2 : 1 }) + " %";

function spark(points, h = 36) {
  if (!points.length) return `<div class="mo-spark empty">Pas encore de mesure</div>`;
  const max = Math.max(50, ...points.map(p => p[2] || 0));
  const w = 100 / Math.max(points.length, 30);
  return `<svg class="mo-spark" viewBox="0 0 100 ${h}" preserveAspectRatio="none">${points.map((p, i) => {
    const bh = p[1] ? Math.max(3, (p[2] || max * .3) / max * (h - 2)) : h;
    return `<rect x="${(i * w).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${(w * .7).toFixed(2)}" height="${bh.toFixed(2)}" rx=".6" class="${p[1] ? "ok" : "ko"}"><title>${new Date(p[0] * 1000).toLocaleString("fr-FR")} · ${p[1] ? (p[2] != null ? p[2] + " ms" : "OK") : "panne"}</title></rect>`;
  }).join("")}</svg>`;
}

export async function render(root, parts) {
  if (parts[0]) return detail(root, parts[0]);
  const d = await api("/api/monitor");
  ctx = d;
  const down = d.monitors.filter(m => m.state === "down" && !m.paused).length;
  const up = d.monitors.filter(m => m.state === "up" && !m.paused).length;
  root.innerHTML = pageHead("surveillance", `<button class="btn" id="mo-new">${icon("plus")}Ajouter</button>`) + `
    ${d.monitors.length ? `<div class="mo-summary card ${down ? "bad" : "good"}">
      <span class="mo-big">${icon(down ? "alert" : "check")}</span>
      <div class="grow"><b>${down ? `${down} problème${down > 1 ? "s" : ""} en cours` : "Tout fonctionne"}</b>
        <small class="meta">${up} en ligne · ${down} en panne · ${d.monitors.length} surveillance${d.monitors.length > 1 ? "s" : ""}</small></div>
      ${d.monitors.some(m => m.public) ? `<a class="btn ghost small" href="/statut" target="_blank">${icon("external")}Page de statut publique</a>` : ""}
    </div>` : ""}
    <div id="mo-list"></div>`;
  $("#mo-list").innerHTML = d.monitors.length ? `<div class="mo-grid">${d.monitors.map(card).join("")}</div>`
    : `<div class="card"><div class="empty">${icon("pulse")}<b>Rien n'est surveillé pour l'instant</b>Commence par un modèle :</div>
       <div class="mo-presets">${PRESETS.map((p, i) => `<button class="chip" data-preset="${i}">${icon(p.icon)}${esc(p.label)}</button>`).join("")}</div></div>`;
  $("#mo-new").onclick = () => edit(null, () => render(root, parts));
  root.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => edit({ ...PRESETS[b.dataset.preset].m }, () => render(root, parts)));
  $("#mo-list").onclick = async e => {
    const b = e.target.closest("[data-a]");
    const c = e.target.closest("[data-id]");
    if (!c) return;
    const m = d.monitors.find(x => x.id === c.dataset.id);
    if (!b) return void (location.hash = "#/surveillance/" + m.id);
    e.stopPropagation();
    if (b.dataset.a === "check") {
      b.disabled = true;
      const r = await api(`/api/monitor/${m.id}/check`, { json: {} }).catch(err => toast(err.message, "err"));
      if (r) toast(`${m.name} : ${r.last_ok ? "OK" : "en échec"} · ${r.last_msg}`, r.last_ok ? "ok" : "err");
      render(root, parts);
    }
    if (b.dataset.a === "edit") edit(m, () => render(root, parts));
  };
  clearInterval(timer);
  timer = setInterval(() => { if ($("#mo-list") && !document.querySelector(".modal.open")) render(root, parts); else if (!$("#mo-list")) clearInterval(timer); }, 20000);
}

function card(m) {
  const [cls, label] = state(m);
  return `<div class="card mo-card ${cls}" data-id="${m.id}">
    <div class="mo-head"><span class="mo-dot ${cls}"></span>
      <div class="grow"><b>${esc(m.name)}</b><small class="meta ellipsis">${icon(TYPES[m.type][1])}${esc(m.type === "disk" ? `Moins de ${m.threshold} % libres` : m.target)}</small></div>
      <span class="mo-state ${cls}">${label}</span></div>
    ${spark(m.spark)}
    <div class="mo-foot">
      <span><b>${pct(m.uptime["24h"])}</b><small>24 h</small></span><span><b>${pct(m.uptime["30j"])}</b><small>30 jours</small></span>
      <span><b>${m.last_ms != null ? m.last_ms + " ms" : "—"}</b><small>réponse</small></span>
      ${m.cert_days != null ? `<span class="${m.cert_days <= 14 ? "warn" : ""}"><b>${m.cert_days} j</b><small>certificat</small></span>` : ""}
      <span class="grow"></span>
      <button class="icon-btn plain" data-a="check" title="Vérifier maintenant">${icon("refresh")}</button>
      <button class="icon-btn plain" data-a="edit" title="Modifier">${icon("settings")}</button>
    </div>
    <small class="meta mo-msg">${m.last_check ? `${esc(m.last_msg || "")} · ${ago(m.last_check)}` : "Première vérification en cours…"}</small>
  </div>`;
}

async function detail(root, id) {
  const m = await api("/api/monitor/" + id);
  const [cls, label] = state(m);
  const days = Object.entries(m.days).sort().slice(-30);
  root.innerHTML = `<a class="back" href="#/surveillance">${icon("back")}Surveillance</a>
    <div class="page-head"><span class="mo-dot big ${cls}"></span><div class="grow"><h1>${esc(m.name)}</h1><p>${esc(TYPES[m.type][0])} · ${esc(m.type === "disk" ? `alerte sous ${m.threshold} % libres` : m.target)}</p></div>
      <button class="btn ghost" id="mo-edit">${icon("settings")}Modifier</button></div>
    <div class="mo-stats">
      <div class="card"><small>État</small><b class="mo-state ${cls}">${label}</b><span class="meta">${esc(m.last_msg || "")}</span></div>
      <div class="card"><small>Disponibilité 24 h</small><b>${pct(m.uptime["24h"])}</b></div>
      <div class="card"><small>7 jours</small><b>${pct(m.uptime["7j"])}</b></div>
      <div class="card"><small>30 jours</small><b>${pct(m.uptime["30j"])}</b></div>
      ${m.cert_days != null ? `<div class="card"><small>Certificat HTTPS</small><b>${m.cert_days} jours</b></div>` : ""}
    </div>
    <div class="card"><div class="card-title">${icon("chart")}Dernières 24 heures <span class="count">${m.checks.length} vérifications</span></div>${spark(m.checks, 60)}</div>
    <div class="card"><div class="card-title">${icon("calendar")}Disponibilité par jour</div>
      <div class="mo-days">${days.length ? days.map(([day, v]) => {
        const p = v[1] ? v[0] / v[1] * 100 : null;
        return `<span class="${p == null ? "" : p >= 99.5 ? "ok" : p >= 95 ? "mid" : "ko"}" title="${new Date(day).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · ${pct(p)}${v[3] ? ` · ${Math.round(v[2] / v[3])} ms en moyenne` : ""}"></span>`;
      }).join("") : `<p class="hint">Pas encore de données.</p>`}</div></div>
    <div class="card"><div class="card-title">${icon("list")}Incidents</div>
      ${m.events.length ? m.events.map(e => `<div class="set-row"><span class="mo-dot ${e.kind === "down" ? "down" : "up"}"></span>
        <div class="txt"><b>${e.kind === "down" ? "Panne" : "Rétabli"}</b><small>${new Date(e.ts * 1000).toLocaleString("fr-FR")} · ${esc(e.msg)}</small></div></div>`).join("")
        : `<p class="hint">Aucun incident enregistré. 🎉</p>`}</div>`;
  $("#mo-edit").onclick = () => edit(m, () => detail(root, id), () => { location.hash = "#/surveillance"; });
  clearInterval(timer);
}

function edit(m, done, gone) {
  const isNew = !m?.id;
  m = { type: "http", interval: 300, timeout: 10, retries: 2, threshold: 10, notify: true, ...(m || {}) };
  const roots = ctx.roots || [];
  const mm = modal(isNew ? "Nouvelle surveillance" : m.name, `<form>
    <label class="field">Type</label>
    <div class="mo-types">${Object.entries(TYPES).filter(([t]) => t !== "ping" || ctx.ping !== false).map(([t, [l, ic]]) =>
      `<label><input type="radio" name="type" value="${t}" ${m.type === t ? "checked" : ""}><span>${icon(ic)}${l}</span></label>`).join("")}</div>
    <p class="hint" id="mo-type-hint"></p>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(m.name || "")}" placeholder="Ex. Mon site" required>
    <div data-show="http keyword tcp ping"><label class="field" style="margin-top:12px" id="mo-target-label">Adresse</label>
      <input type="text" name="target" value="${esc(m.type === "disk" ? "" : m.target || "")}"></div>
    <div data-show="keyword"><label class="field" style="margin-top:12px">Mot à chercher</label><input type="text" name="keyword" value="${esc(m.keyword || "")}">
      <label class="check" style="margin-top:8px"><input type="checkbox" name="invert" ${m.invert ? "checked" : ""}> Alerter si le mot <b>est</b> présent (ex. « Erreur »)</label></div>
    <div data-show="disk" class="grid2" style="margin-top:12px">
      <div><label class="field">Dossier</label><select name="disk" style="width:100%"><option value="*">Tous les disques</option>
        ${roots.map(r => `<option value="${r.id}" ${m.target === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select></div>
      <div><label class="field">Alerter sous (% libres)</label><input type="number" name="threshold" min="1" max="90" value="${m.threshold}"></div></div>
    <div class="grid2" style="margin-top:12px">
      <div><label class="field">Vérifier toutes les</label><select name="interval" style="width:100%">${INTERVALS.map(([v, l]) => `<option value="${v}" ${m.interval === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field">Alerter après</label><select name="retries" style="width:100%">${[1, 2, 3, 5].map(v => `<option value="${v}" ${m.retries === v ? "selected" : ""}>${v} échec${v > 1 ? "s" : ""} de suite</option>`).join("")}</select></div>
    </div>
    <div style="display:grid;gap:10px;margin-top:6px">
      <label class="check"><input type="checkbox" name="notify" ${m.notify ? "checked" : ""}> Me prévenir (cloche et notification sur l'appli)</label>
      <label class="check"><input type="checkbox" name="public" ${m.public ? "checked" : ""}> Afficher sur la page de statut publique (/statut)</label>
      <label class="check" data-show="http keyword"><input type="checkbox" name="insecure" ${m.insecure ? "checked" : ""}> Accepter un certificat non valide (réseau local)</label>
      ${isNew ? "" : `<label class="check"><input type="checkbox" name="paused" ${m.paused ? "checked" : ""}> Mettre en pause</label>`}
    </div>
    <p id="mo-test-result" class="hint"></p>
    <div class="modal-foot">${isNew ? "" : `<button type="button" class="btn danger ghost" data-a="del">${icon("trash")}</button>`}
      <button type="button" class="btn ghost" data-a="test">${icon("play")}Tester</button><button type="button" class="btn ghost" data-close>Annuler</button>
      <button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "pulse", large: true });
  const f = mm.querySelector("form");
  const sync = () => {
    const t = f.type.value;
    mm.querySelectorAll("[data-show]").forEach(el => { el.hidden = !el.dataset.show.split(" ").includes(t); });
    $("#mo-type-hint").textContent = TYPES[t][2];
    $("#mo-target-label").textContent = t === "tcp" ? "Hôte et port (ex. 192.168.1.1:80)" : t === "ping" ? "Hôte ou adresse IP" : "Adresse de la page";
    f.target.placeholder = t === "tcp" ? "192.168.1.1:80" : t === "ping" ? "192.168.1.1" : "https://www.exemple.fr";
  };
  f.addEventListener("change", e => e.target.name === "type" && sync());
  sync();
  const payload = () => ({ id: m.id, type: f.type.value, name: f.name.value, target: f.type.value === "disk" ? f.disk.value : f.target.value,
    keyword: f.keyword.value, invert: f.invert.checked, threshold: +f.threshold.value, interval: +f.interval.value, retries: +f.retries.value,
    notify: f.notify.checked, public: f.public.checked, insecure: f.insecure.checked, paused: f.paused?.checked || false });
  mm.querySelector("[data-a=test]").onclick = async () => {
    $("#mo-test-result").textContent = "Test en cours…";
    try {
      const r = await api("/api/monitor/test", { json: payload() });
      $("#mo-test-result").innerHTML = `<span class="${r.ok ? "pill-ok" : "pill-err"}">${r.ok ? "Réussi" : "Échec"}</span> ${esc(r.msg)}${r.ms != null ? ` · ${r.ms} ms` : ""}`;
    } catch (err) { $("#mo-test-result").innerHTML = `<span class="msg">${esc(err.message)}</span>`; }
  };
  mm.querySelector("[data-a=del]")?.addEventListener("click", async () => {
    await api(`/api/monitor/${m.id}`, { method: "DELETE" });
    closePanel();
    toast("Surveillance supprimée");
    (gone || done)();
  });
  f.onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/monitor", { json: payload() }); closePanel(); toast("Surveillance enregistrée"); setTimeout(done, 1500); }
    catch (err) { toast(err.message, "err"); }
  };
}

export function leave() { clearInterval(timer); }
