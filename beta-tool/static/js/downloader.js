// Outil « Téléchargeur ».
import { $, toast, icon } from "./ui.js";
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
        body: JSON.stringify({ url: $("#dl-url").value, mode: $("[name=dl-mode]:checked").value, subfolder: $("#dl-subfolder").value }),
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
      if (j.subfolder) parts.push("→ " + j.subfolder);
      if (j.error) parts.push(j.error);
      return jobBlock(j, { title: j.title, label: LABELS[j.status] || j.status, meta: parts.filter(Boolean).join(" · "),
                           pct: j.progress, glyph: icon(j.mode === "audio" ? "music" : "video") });
    }, "Aucun téléchargement pour l'instant. Colle un lien pour commencer.");
  } catch {}
}

export function show() {
  refresh();
  clearInterval(timer);
  timer = setInterval(() => { if (!$("[data-view=telecharger]").hidden) refresh(); else clearInterval(timer); }, 1500);
}
