// Outil « Téléchargeur ».
import { $, esc, toast, icon } from "./ui.js";
import { renderJobs, jobBlock } from "./jobs.js";

const LABELS = { queued: "En attente", starting: "Démarrage", downloading: "Téléchargement", processing: "Finalisation", done: "Terminé", error: "Erreur" };
let timer = null;

export function init() {
  $("#dl-url").addEventListener("focus", async () => {
    if ($("#dl-url").value) return;
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (/^https?:\/\//.test(t)) $("#dl-url").value = t;
    } catch {}
  });

  $("#dl-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("#dl-go").disabled = true; $("#dl-msg").textContent = "";
    try {
      const r = await fetch("/api/download", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: $("#dl-url").value, mode: $("[name=dl-mode]:checked").value, subfolder: $("#dl-subfolder").value,
                              keep: $("#dl-keep").checked }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erreur");
      $("#dl-url").value = "";
      toast(data.ids.length > 1 ? `${data.ids.length} téléchargements lancés` : "Téléchargement lancé");
      refresh();
    } catch (err) { $("#dl-msg").textContent = err.message; }
    $("#dl-go").disabled = false;
  });
}

async function refresh() {
  try {
    const jobs = await (await fetch("/api/download/jobs")).json();
    renderJobs($("#dl-jobs"), jobs, j => {
      const parts = [];
      if (j.status === "downloading") parts.push(`${j.progress ?? "?"} %`, j.speed, j.eta && "reste " + j.eta);
      parts.push(j.mode === "audio" ? "Audio" : "Vidéo");
      parts.push(j.keep ? "NAS" + (j.subfolder ? " → " + j.subfolder : "") : "appareil seulement");
      if (j.error) parts.push(j.error);
      // Récupérer sur l'appareil : un bouton par fichier (un seul pour une vidéo, plusieurs pour une playlist)
      const files = j.status === "done" && j.files.length
        ? (j.files.length === 1 ? `<a class="btn small" href="/api/download/${j.id}/file/0" title="${esc(j.files[0])}">${icon("download")}Récupérer</a>`
          : `<details class="dl-files"><summary class="btn small">${icon("download")}${j.files.length} fichiers</summary>${j.files.map((f, i) =>
              `<a href="/api/download/${j.id}/file/${i}">${esc(f)}</a>`).join("")}</details>`) : "";
      return jobBlock(j, { title: j.title, label: LABELS[j.status] || j.status, meta: parts.filter(Boolean).join(" · "),
                           pct: j.progress, glyph: icon(j.mode === "audio" ? "music" : "video"), extra: files });
    }, "Aucun téléchargement pour l'instant. Colle un lien pour commencer.");
  } catch {}
}

export function show(query = {}) {
  // « Partager → Bêta Tool » depuis une autre appli : le lien arrive dans l'adresse
  if (query.url) {
    const m = /https?:\/\/\S+/.exec(query.url);
    if (m) $("#dl-url").value = m[0];
    history.replaceState(null, "", "#/telecharger");
  }
  refresh();
  clearInterval(timer);
  timer = setInterval(() => { if (!$("[data-view=telecharger]").hidden) refresh(); else clearInterval(timer); }, 1500);
}
