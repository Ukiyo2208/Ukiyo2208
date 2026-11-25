// Rendu commun des listes de tâches (téléchargements, conversions).
import { esc, icon } from "./ui.js";

export function renderJobs(el, jobs, row, emptyText) {
  el.innerHTML = jobs.length ? jobs.map(row).join("") : `<div class="empty">${icon("inbox")}${esc(emptyText)}</div>`;
}

export function jobBlock(j, { title, label, meta, pct, extra = "", glyph = "" }) {
  const indet = pct == null && !["done", "error", "queued"].includes(j.status);
  return `<div class="job ${j.status}">
    <span class="ficon">${glyph}</span>
    <div class="body">
      <div class="head"><div class="title">${esc(title)}</div><span class="status">${esc(label)}</span>${extra}</div>
      <div class="meta">${esc(meta)}</div>
      <div class="bar ${indet ? "indeterminate" : ""}"><div style="width:${j.status === "done" ? 100 : pct || 0}%"></div></div>
    </div></div>`;
}
