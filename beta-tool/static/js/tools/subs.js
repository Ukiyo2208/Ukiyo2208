// Outil « Abonnements » : chaînes suivies, nouveautés, téléchargement automatique.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";
import * as push from "../push.js";

const STATUS = { new: ["Nouveau", "pill-new"], seen: ["", ""], queued: ["En file", "pill-warn"], downloading: ["Téléchargement", "pill-warn"],
  downloaded: ["Téléchargée", "pill-ok"], error: ["Échec", "pill-err"], ignored: ["Ignorée", "pill-mute"], old: ["", ""], filtered: ["Filtrée", "pill-mute"] };
const INTERVALS = [[1, "Toutes les heures"], [3, "Toutes les 3 h"], [6, "Toutes les 6 h"], [12, "Deux fois par jour"], [24, "Une fois par jour"]];
let timer = null, filter = null;

const dur = s => !s ? "" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`
  : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const avatar = (src, name) => src ? `<img class="sb-av" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="sb-av letter">${esc((name || "?")[0].toUpperCase())}</span>`;

export async function render(root, parts) {
  const tab = parts[0] === "chaines" ? "chaines" : "nouveautes";
  const subs = await api("/api/subs");
  root.innerHTML = pageHead("abonnements", subs.length ? `<button class="btn ghost" id="sb-check">${icon("refresh")}Tout vérifier</button>` : "") + `
    <form class="card sb-add" id="sb-form">
      <div class="card-title">${icon("plus")}Suivre une chaîne</div>
      <div class="row"><input type="text" name="url" class="grow" placeholder="Lien d'une chaîne YouTube, d'une playlist, d'un podcast (flux RSS)…" required>
        <button class="btn">${icon("rss")}S'abonner</button></div>
      <div class="sb-opts">
        <label>Quand une vidéo sort
          <select name="mode"><option value="notify">Me prévenir</option><option value="download">La télécharger sur le NAS</option></select></label>
        <label>Format <select name="format"><option value="video">Vidéo</option><option value="audio">Audio seulement</option></select></label>
        <label>Télécharger aussi les dernières <select name="backlog"><option value="0">Non</option><option value="1">La dernière</option><option value="3">Les 3 dernières</option><option value="5">Les 5 dernières</option></select></label>
      </div>
      <p class="msg" id="sb-msg" style="margin:10px 0 0"></p>
    </form>
    ${!push.active() && !push.unsupported() ? `<div class="intro"><span class="tile">${icon("bell")}</span><p>Active les <b>notifications sur ton téléphone</b> pour savoir dès qu'un youtubeur publie une vidéo.</p>
      <button class="btn small" id="sb-push">${icon("bell")}Activer</button></div>` : ""}
    <nav class="tabs"><a href="#/abonnements" class="${tab === "nouveautes" ? "on" : ""}">${icon("play")}Nouveautés</a>
      <a href="#/abonnements/chaines" class="${tab === "chaines" ? "on" : ""}">${icon("rss")}Chaînes <span class="count">${subs.length}</span></a></nav>
    <div id="sb-body"></div>`;
  $("#sb-form").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn");
    btn.disabled = true;
    $("#sb-msg").innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Lecture de la chaîne…`;
    try {
      const f = Object.fromEntries(new FormData(e.target));
      const s = await api("/api/subs", { json: f });
      toast(`Abonné à ${s.title}`);
      render(root, parts);
    } catch (err) { $("#sb-msg").textContent = err.message; btn.disabled = false; }
  };
  $("#sb-check")?.addEventListener("click", async () => {
    const r = await api("/api/subs/check-all", { json: {} });
    toast(`Vérification de ${r.count} chaîne${r.count > 1 ? "s" : ""}…`);
    setTimeout(() => render(root, parts), 6000);
  });
  $("#sb-push")?.addEventListener("click", async () => {
    try { await push.enable(); toast("Notifications activées sur cet appareil"); render(root, parts); } catch (err) { toast(err.message, "err"); }
  });
  if (!subs.length) {
    $("#sb-body").innerHTML = `<div class="card"><div class="empty">${icon("rss")}<b>Aucune chaîne suivie</b>
      Colle le lien d'une chaîne YouTube (ex. youtube.com/@NomDeLaChaine), d'une playlist ou d'un podcast.
      Tu seras prévenu de chaque nouvelle vidéo, et elle peut même arriver toute seule sur le NAS.</div></div>`;
    return;
  }
  tab === "chaines" ? channels($("#sb-body"), subs, root, parts) : feedView($("#sb-body"), subs);
}

async function feedView(el, subs) {
  const items = await api("/api/subs/feed" + (filter ? "?sub=" + filter : ""));
  const f = subs.find(s => s.id === filter);
  el.innerHTML = `<div class="sb-bar">
      <div class="chips">${[`<button class="chip ${!filter ? "on" : ""}" data-f="">Toutes</button>`,
        ...subs.map(s => `<button class="chip ${filter === s.id ? "on" : ""}" data-f="${s.id}">${avatar(s.avatar, s.title)}${esc(s.title)}${s.new ? ` <b>${s.new}</b>` : ""}</button>`)].join("")}</div>
      ${items.some(i => i.status === "new") ? `<button class="btn ghost small" id="sb-seen">${icon("check")}Tout marquer comme vu</button>` : ""}
    </div>
    ${items.length ? `<div class="sb-grid">${items.map(card).join("")}</div>`
      : `<div class="card"><div class="empty">${icon("play")}<b>Rien de nouveau</b>${f ? `Aucune vidéo récente pour ${esc(f.title)}.` : "Les prochaines vidéos de tes chaînes apparaîtront ici."}</div></div>`}`;
  el.querySelector(".sb-bar").onclick = e => {
    const c = e.target.closest("[data-f]");
    if (c) { filter = c.dataset.f || null; feedView(el, subs); }
  };
  $("#sb-seen")?.addEventListener("click", async () => { await api("/api/subs/seen", { json: {} }); feedView(el, subs); });
  el.querySelector(".sb-grid")?.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const c = b.closest("[data-item]");
    try {
      await api(`/api/subs/${c.dataset.sub}/items/${encodeURIComponent(c.dataset.item)}`, { json: { action: b.dataset.a } });
      if (b.dataset.a === "download") toast("Téléchargement lancé");
      feedView(el, subs);
    } catch (err) { toast(err.message, "err"); }
  });
  clearInterval(timer);
  if (items.some(i => ["queued", "downloading"].includes(i.status))) timer = setInterval(() => { if ($(".sb-grid")) feedView(el, subs); else clearInterval(timer); }, 4000);
}

function card(i) {
  const [label, cls] = STATUS[i.status] || ["", ""];
  const sub = i.channel;
  return `<div class="card sb-item ${i.status}" data-item="${esc(i.id)}" data-sub="${i.sub}">
    <a class="sb-thumb" href="${esc(i.link || i.url)}" target="_blank" rel="noopener">${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon("play")}
      ${i.duration ? `<span class="sb-dur">${dur(i.duration)}</span>` : ""}
      ${label ? `<span class="sb-badge ${cls}">${label}${i.status === "downloading" && i.progress != null ? ` ${Math.round(i.progress)} %` : ""}</span>` : ""}</a>
    <div class="sb-info">${avatar(i.avatar, sub)}
      <div class="grow"><b class="sb-title">${esc(i.title)}</b><small class="meta">${esc(sub)} · ${ago(i.published || i.found)}</small></div></div>
    <div class="sb-actions">
      ${["new", "seen", "ignored", "error", "old", "filtered"].includes(i.status) ? `<button class="btn small" data-a="download">${icon("download")}Télécharger</button>` : ""}
      ${i.status === "downloaded" ? `<a class="btn small ghost" href="#/fichiers/telechargements/Abonnements">${icon("folder")}Voir le fichier</a>` : ""}
      <a class="icon-btn plain" href="${esc(i.link || i.url)}" target="_blank" rel="noopener" title="Regarder sur le site">${icon("external")}</a>
      ${i.status === "new" ? `<button class="icon-btn plain" data-a="ignore" title="Ignorer">${icon("x")}</button>` : ""}
    </div></div>`;
}

function channels(el, subs, root, parts) {
  el.innerHTML = `<div class="card">${subs.map(s => `<div class="set-row sb-ch" data-id="${s.id}">
      ${avatar(s.avatar, s.title)}
      <div class="txt"><b>${esc(s.title)}${s.paused ? ` <span class="pill-mute">en pause</span>` : ""}</b>
        <small>${s.mode === "download" ? "Téléchargement automatique" : "Notification seulement"} · ${s.format === "audio" ? "audio" : "vidéo"}
          · ${s.last_check ? "vérifiée " + ago(s.last_check) : "jamais vérifiée"}${s.error ? ` · <span class="msg">${esc(s.error)}</span>` : ""}</small></div>
      <button class="btn small ghost" data-a="check">${icon("refresh")}Vérifier</button>
      <button class="icon-btn plain" data-a="edit" title="Réglages">${icon("settings")}</button>
      <a class="icon-btn plain" href="${esc(s.link)}" target="_blank" rel="noopener" title="Ouvrir la chaîne">${icon("external")}</a>
      <button class="icon-btn plain" data-a="del" title="Se désabonner">${icon("trash")}</button></div>`).join("")}</div>`;
  el.onclick = async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const s = subs.find(x => x.id === b.closest("[data-id]").dataset.id);
    if (b.dataset.a === "check") {
      b.disabled = true;
      try { const r = await api(`/api/subs/${s.id}/check`, { json: {} }); toast(r.new ? `${r.new} nouvelle${r.new > 1 ? "s" : ""} vidéo${r.new > 1 ? "s" : ""}` : "Rien de nouveau"); render(root, parts); }
      catch (err) { toast(err.message, "err"); b.disabled = false; }
    }
    if (b.dataset.a === "edit") edit(s, () => render(root, parts));
    if (b.dataset.a === "del") {
      const m = modal(`Se désabonner de ${s.title} ?`, `<p>Les vidéos déjà téléchargées restent sur le NAS.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Se désabonner</button></div>`, { ic: "rss" });
      m.querySelector("[data-ok]").onclick = async () => { await api(`/api/subs/${s.id}`, { method: "DELETE" }); closePanel(); toast("Désabonné"); render(root, parts); };
    }
  };
}

function edit(s, done) {
  const m = modal(s.title, `<form>
    <label class="field">Nom affiché</label><input type="text" name="title" value="${esc(s.title)}">
    <div class="grid2">
      <div><label class="field">Quand une vidéo sort</label><select name="mode" style="width:100%"><option value="notify" ${s.mode === "notify" ? "selected" : ""}>Me prévenir</option>
        <option value="download" ${s.mode === "download" ? "selected" : ""}>La télécharger sur le NAS</option></select></div>
      <div><label class="field">Format</label><select name="format" style="width:100%"><option value="video" ${s.format === "video" ? "selected" : ""}>Vidéo (meilleure qualité)</option>
        <option value="audio" ${s.format === "audio" ? "selected" : ""}>Audio seulement</option></select></div>
      <div><label class="field">Vérifier</label><select name="interval" style="width:100%">${INTERVALS.map(([v, l]) => `<option value="${v}" ${s.interval === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    <label class="field">Seulement si le titre contient</label><input type="text" name="include" value="${esc(s.include)}" placeholder="mots séparés par des virgules (vide = toutes)">
    <label class="field" style="margin-top:12px">Ignorer si le titre contient</label><input type="text" name="exclude" value="${esc(s.exclude)}" placeholder="ex. live, rediffusion">
    <div style="display:grid;gap:10px;margin-top:14px">
      <label class="check"><input type="checkbox" name="notify" ${s.notify ? "checked" : ""}> Notification à chaque nouvelle vidéo</label>
      <label class="check"><input type="checkbox" name="skip_shorts" ${s.skip_shorts ? "checked" : ""}> Ignorer les Shorts (vidéos de moins d'une minute)</label>
      <label class="check"><input type="checkbox" name="paused" ${s.paused ? "checked" : ""}> Mettre en pause</label>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "rss", large: true });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/subs/${s.id}`, { method: "PUT", json: { title: f.title.value, mode: f.mode.value, format: f.format.value, interval: +f.interval.value,
        include: f.include.value, exclude: f.exclude.value, notify: f.notify.checked, skip_shorts: f.skip_shorts.checked, paused: f.paused.checked } });
      closePanel();
      toast("Réglages enregistrés");
      done();
    } catch (err) { toast(err.message, "err"); }
  };
}

export function leave() { clearInterval(timer); }
