// Outil « Téléphones » : dossier WebDAV de sauvegarde, appareils, lecture des SMS et appels sauvegardés.
import { $, esc, icon, toast, sizeStr } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

let d = null, tab = "appareils";

export async function render(root, parts) {
  tab = ["appareils", "sms", "appels"].includes(parts[0]) ? parts[0] : "appareils";
  root.innerHTML = pageHead("sauvegarde-tel") + `<div class="seg bg-tabs" id="tp-tabs">
      ${[["appareils", "Sauvegarde", "phone"], ["sms", "SMS", "mail"], ["appels", "Appels", "clock"]].map(([k, l, ic]) => `<label><input type="radio" name="tpt" value="${k}" ${k === tab ? "checked" : ""}>${icon(ic)}<span>${l}</span></label>`).join("")}</div>
    <div id="tp-body"></div>`;
  $("#tp-tabs").onchange = e => { tab = e.target.value; history.replaceState(null, "", `#/sauvegarde-tel/${tab}`); paint(); };
  d = await api("/api/phones");
  paint();
}

function paint() {
  const el = $("#tp-body");
  if (!el) return;
  ({ appareils, sms, appels })[tab](el);
}

function appareils(el) {
  el.innerHTML = `${!d.accounts ? `<div class="intro"><span class="tile ambre">${icon("alert")}</span><p>La sauvegarde des téléphones demande des <b>comptes</b> (Réglages › Comptes) : chacun se connecte avec son identifiant et son mot de passe Bêta Tool.</p></div>` : ""}
    <div class="card"><div class="card-title">${icon("link")}Ton dossier de sauvegarde</div>
      <div class="tp-url"><code>${esc(d.url)}</code><button class="btn ghost small" id="tp-copy">${icon("copy")}Copier</button></div>
      <p class="hint">Identifiant : <b>${esc(d.user)}</b> · mot de passe : celui de Bêta Tool. ${d.https ? "" : `${icon("alert")} Adresse en http : à utiliser seulement à la maison, ou passe en https (Réglages › Accès sécurisé).`}</p></div>
    <div class="tp-grid">
      <div class="card"><div class="card-title"><span class="tile">${icon("image")}</span>iPhone : photos et vidéos</div>
        <ol class="ac-steps"><li>Installe <b>PhotoSync</b> (App Store).</li><li>Réglages › Configurer › <b>WebDAV</b> : serveur = l'adresse ci-dessus, identifiant et mot de passe Bêta Tool, dossier « iPhone ».</li>
          <li>Active <b>Transfert automatique</b> (à l'arrivée à la maison ou à la recharge) : seules les nouvelles photos partent.</li></ol></div>
      <div class="card"><div class="card-title"><span class="tile vert">${icon("phone")}</span>Android : photos, documents, WhatsApp…</div>
        <ol class="ac-steps"><li>Installe <b>FolderSync</b> (Play Store).</li><li>Comptes › + › <b>WebDAV</b> : adresse ci-dessus, identifiant et mot de passe Bêta Tool.</li>
          <li>Paires de dossiers › + : « DCIM/Camera » → « Android/Photos », synchro <b>vers le serveur</b>, planifiée (ex. chaque nuit en Wi-Fi). Pareil pour Documents, Download, WhatsApp/Media…</li></ol></div>
      <div class="card"><div class="card-title"><span class="tile violet">${icon("mail")}</span>Android : SMS et journal d'appels</div>
        <ol class="ac-steps"><li>Installe <b>SMS Backup &amp; Restore</b> (SyncTech) et programme une sauvegarde quotidienne des SMS et appels dans un dossier du téléphone.</li>
          <li>Dans FolderSync, ajoute ce dossier (vers « Android/SMS »).</li><li>Tes messages se relisent ensuite dans l'onglet <b>SMS</b>, et se restaurent sur un nouveau téléphone avec la même appli.</li></ol>
        <p class="hint">Sur iPhone, les SMS ne sont pas accessibles aux applis : ils restent dans la sauvegarde iCloud ou celle de l'ordinateur.</p></div>
    </div>
    <div class="card"><div class="card-title">${icon("nas")}Appareils sauvegardés</div>
      ${d.devices.length ? d.devices.map(x => `<div class="bg-row"><span class="tile bleu-vert tp-ic">${icon("phone")}</span><span class="grow bg-lbl"><b>${esc(x.name)}</b>
        <small class="meta">${x.files} fichier${x.files > 1 ? "s" : ""} · ${sizeStr(x.size)}${x.last ? ` · dernier envoi ${ago(x.last)}` : ""}</small></span>
        <a class="btn ghost small" href="#/fichiers/telephones/${encodeURIComponent(d.user)}/${encodeURIComponent(x.name)}">${icon("folder")}Ouvrir</a></div>`).join("")
        : `<p class="meta">Rien pour l'instant : configure une appli ci-dessus. Chaque dossier créé (iPhone, Android…) apparaîtra ici.</p>`}</div>`;
  $("#tp-copy").onclick = async () => { await navigator.clipboard.writeText(d.url).catch(() => {}); toast("Adresse copiée"); };
}

async function sms(el) {
  if (!d.sms) return el.innerHTML = `<div class="card empty">${icon("mail")}<b>Aucune sauvegarde de SMS</b>Avec « SMS Backup &amp; Restore » sur Android, envoie tes fichiers sms-….xml dans ton dossier de sauvegarde (onglet Sauvegarde).</div>`;
  el.innerHTML = `<div class="tp-sms"><div class="card tp-threads"><div class="ml-search">${icon("search")}<input type="search" id="tp-q" placeholder="Chercher un nom, un numéro, un mot…"></div>
      <div id="tp-list"><p class="meta"><span class="spinner"></span></p></div></div>
    <div class="card tp-conv" id="tp-conv"><div class="empty">${icon("mail")}<b>Choisis une conversation</b><small class="meta">Sauvegarde du ${new Date(d.sms_date * 1000).toLocaleDateString("fr-FR")}</small></div></div></div>`;
  let timer;
  const load = async () => {
    const r = await api(`/api/phones/sms?q=${encodeURIComponent($("#tp-q").value)}`);
    $("#tp-list").innerHTML = r.threads.map(t => `<button class="tp-th" data-a="${esc(t.addr)}"><span class="ml-av" style="--h:${[...t.addr].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc((t.name || "#")[0].toUpperCase())}</span>
      <span class="grow"><b>${esc(t.name || t.addr)}</b><small class="meta">${esc(t.preview)}</small></span><small class="meta">${new Date(t.last * 1000).toLocaleDateString("fr-FR")}</small></button>`).join("")
      || `<p class="meta" style="padding:12px">Rien trouvé.</p>`;
  };
  $("#tp-q").oninput = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  $("#tp-list").onclick = async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    el.querySelectorAll(".tp-th.on").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const r = await api(`/api/phones/sms/${encodeURIComponent(b.dataset.a)}`);
    let day = "";
    $("#tp-conv").innerHTML = `<div class="tp-head"><b>${esc(b.querySelector("b").textContent)}</b><small class="meta">${esc(b.dataset.a)} · ${r.messages.length} messages</small></div>
      <div class="tp-msgs">${r.messages.map(m => {
        const dd = new Date(m.date * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const sep = dd !== day ? `<p class="tp-day">${dd}</p>` : "";
        day = dd;
        return `${sep}<div class="tp-msg ${m.out ? "out" : ""}"><span>${esc(m.text)}</span><small>${new Date(m.date * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></div>`;
      }).join("")}</div>`;
    const box = $("#tp-conv .tp-msgs");
    box.scrollTop = box.scrollHeight;
  };
  load();
}

async function appels(el) {
  if (!d.calls) return el.innerHTML = `<div class="card empty">${icon("clock")}<b>Aucune sauvegarde d'appels</b>Avec « SMS Backup &amp; Restore », coche aussi le journal d'appels.</div>`;
  const r = await api("/api/phones/calls");
  const dur = s => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}` : `${s} s`;
  el.innerHTML = `<div class="card bg-tx">${r.calls.map(c => `<div class="bg-row"><span class="tile ${c.type === "manqué" ? "rose" : c.type === "sortant" ? "bleu" : "vert"} tp-ic">${icon("phone")}</span>
    <span class="grow bg-lbl"><b>${esc(c.name && c.name !== "(Unknown)" ? c.name : c.addr)}</b><small class="meta">Appel ${esc(c.type)}${c.duration ? ` · ${dur(c.duration)}` : ""}</small></span>
    <small class="meta">${new Date(c.date * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>`).join("")}</div>`;
}
