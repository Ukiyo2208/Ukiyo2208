// Outil « Sauvegardes » (administrateurs) : copies planifiées vers un disque de sauvegarde.
import { $, esc, icon, toast, modal, closePanel, sizeStr } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
let timer = null;

export async function render(root) {
  const d = await api("/api/backup");
  root.innerHTML = pageHead("sauvegardes", `<button class="btn" id="bk-new">${icon("plus")}Nouvelle sauvegarde</button>`) + `
    <div class="card"><div class="card-title">${icon("nas")}Destination</div>
      ${d.dest.ok ? `<p><b>${esc(d.dest.path)}</b> · ${sizeStr(d.dest.free)} libres sur ${sizeStr(d.dest.total)}</p>
        <p class="hint" style="margin:0">Les copies sont aussi visibles dans <a href="#/fichiers/sauvegardes">Fichiers → Sauvegardes</a> pour restaurer un fichier.</p>`
        : `<div class="intro" style="margin:0"><span class="tile ambre">${icon("alert")}</span><p><b>Aucun disque de sauvegarde.</b> Branche un disque USB (ou choisis un autre volume)
          et monte-le sur <code>${esc(d.dest.path)}</code> dans docker-compose.yml, par exemple <code>/volumeUSB1/usbshare:/backup</code>.</p></div>`}
      ${d.rsync ? "" : `<p class="msg">rsync n'est pas installé dans l'image : reconstruis-la.</p>`}</div>
    <div id="bk-list"></div>`;
  $("#bk-new").onclick = () => edit(null, d.sources, () => render(root));
  draw(d, root);
  clearInterval(timer);
  timer = setInterval(async () => {
    if (!$("#bk-list")) return clearInterval(timer);
    const fresh = await api("/api/backup").catch(() => null);
    if (fresh && fresh.jobs.some(j => j.running) !== d.jobs.some(j => j.running)) render(root);
  }, 4000);
}

function draw(d, root) {
  $("#bk-list").innerHTML = d.jobs.length ? d.jobs.map(j => {
    const last = j.last;
    const labels = j.sources.map(s => d.sources.find(x => x.id === s)?.label || s).join(", ");
    return `<div class="card bk" data-id="${j.id}">
      <div class="row" style="margin:0">
        <span class="tile bleu-vert">${icon("shield")}</span>
        <div class="grow"><b>${esc(j.name)}</b><br><small class="meta">${esc(labels)}</small></div>
        ${j.running ? `<span class="pill-ok"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span>En cours</span>`
          : `<span class="${j.enabled ? "pill-ok" : "pill-warn"}">${j.enabled ? "Programmée" : "En pause"}</span>`}
        <button class="btn small" data-a="run" ${j.running ? "disabled" : ""}>${icon("play")}Lancer maintenant</button>
        <button class="icon-btn plain" data-a="edit" title="Modifier">${icon("edit")}</button>
        <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button>
      </div>
      <dl class="kv" style="margin-top:14px">
        <dt>Quand</dt><dd>${j.days.length === 7 ? "Tous les jours" : j.days.map(x => DAYS[x]).join(", ") || "Jamais (manuel)"} à ${esc(j.time)}</dd>
        <dt>Type</dt><dd>${j.mode === "mirror" ? "Miroir (une copie à jour)" : `Incrémental · ${j.keep} versions gardées`}</dd>
        <dt>Dernière</dt><dd>${last ? `<span class="${last.status === "ok" ? "pill-ok" : "pill-warn"}">${last.status === "ok" ? "Réussie" : "Échec"}</span>
          ${ago(last.at)} · ${esc(last.message)} · ${last.duration} s` : "Jamais lancée"}</dd>
        ${j.mode !== "mirror" ? `<dt>Versions</dt><dd>${j.snapshots.length ? j.snapshots.slice(0, 8).map(s => `<a class="chip" href="#/fichiers/sauvegardes/${encodeURIComponent(j.name)}/${s}">${s.replace("_", " ").replace(/(\d{2})(\d{2})$/, "$1h$2")}</a>`).join(" ") : "aucune"}</dd>` : ""}
      </dl></div>`;
  }).join("") : `<div class="card"><div class="empty">${icon("shield")}<b>Aucune sauvegarde programmée</b>Crée-en une : par exemple tes photos et documents, chaque nuit à 3 h.</div></div>`;
  $("#bk-list").onclick = async e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const j = d.jobs.find(x => x.id === e.target.closest("[data-id]").dataset.id);
    if (a === "run") { try { await api(`/api/backup/${j.id}/run`, { json: {} }); toast("Sauvegarde lancée"); render(root); } catch (err) { toast(err.message, "err"); } }
    if (a === "edit") edit(j, d.sources, () => render(root));
    if (a === "del") {
      const m = modal(`Supprimer « ${j.name} » ?`, `<p>La planification est supprimée. Les copies déjà faites restent sur le disque de sauvegarde.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
      m.querySelector("[data-ok]").onclick = async () => { await api(`/api/backup/${j.id}`, { method: "DELETE" }); closePanel(); render(root); };
    }
  };
}

function edit(job, sources, done) {
  const j = job || { name: "", sources: [], mode: "incremental", time: "03:00", days: [0, 1, 2, 3, 4, 5, 6], keep: 7, enabled: true };
  const m = modal(job ? "Modifier la sauvegarde" : "Nouvelle sauvegarde", `<form>
    <label class="field">Nom</label><input type="text" name="name" value="${esc(j.name)}" placeholder="Ex. Photos et documents" required>
    <label class="field" style="margin-top:14px">Dossiers à sauvegarder</label>
    <div class="bk-src">${sources.map(s => `<label class="check"><input type="checkbox" name="src" value="${esc(s.id)}" ${j.sources.includes(s.id) ? "checked" : ""}> ${esc(s.label)}</label>`).join("")}</div>
    <label class="field" style="margin-top:14px">Type</label>
    <div class="seg"><label><input type="radio" name="mode" value="incremental" ${j.mode !== "mirror" ? "checked" : ""}>Incrémental (historique)</label>
      <label><input type="radio" name="mode" value="mirror" ${j.mode === "mirror" ? "checked" : ""}>Miroir</label></div>
    <p class="hint">Incrémental : une version par sauvegarde, seuls les fichiers modifiés prennent de la place (disque ext4, Btrfs ou NTFS conseillé). Miroir : une seule copie à jour.</p>
    <div class="grid2">
      <div><label class="field">Heure</label><input type="time" name="time" value="${esc(j.time)}" required></div>
      <div><label class="field">Versions gardées</label><input type="number" name="keep" min="1" max="365" value="${j.keep}"></div>
    </div>
    <label class="field">Jours</label>
    <div class="seg">${DAYS.map((dn, i) => `<label><input type="checkbox" name="day" value="${i}" ${j.days.includes(i) ? "checked" : ""}>${dn}</label>`).join("")}</div>
    <label class="check" style="margin-top:14px"><input type="checkbox" name="enabled" ${j.enabled ? "checked" : ""}> Activée</label>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "shield", large: true });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/backup", { json: { id: job?.id, name: f.name.value, sources: [...f.querySelectorAll("[name=src]:checked")].map(x => x.value),
        mode: f.mode.value, time: f.time.value, keep: f.keep.value, days: [...f.querySelectorAll("[name=day]:checked")].map(x => +x.value), enabled: f.enabled.checked } });
      closePanel();
      toast("Sauvegarde enregistrée");
      done();
    } catch (err) { toast(err.message, "err"); }
  };
}

export function leave() { clearInterval(timer); }
