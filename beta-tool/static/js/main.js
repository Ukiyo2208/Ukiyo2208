// Coquille du site : navigation, thème, aide, suggestions.
import { $, $$, esc, icon, hydrateIcons, toast, openPanel, closePanel } from "./ui.js";
import { HELP } from "./help.js";
import * as downloader from "./downloader.js";
import * as converter from "./converter.js";
import * as pdf from "./pdf/hub.js";
import * as archive from "./archive.js";
import * as work from "./work.js";

hydrateIcons();

// --- Thème ------------------------------------------------------------------
const THEMES = ["auto", "light", "dark"];
function getTheme() { try { return localStorage.getItem("bt-theme") || "auto"; } catch { return "auto"; } }
function setTheme(t) {
  try { localStorage.setItem("bt-theme", t); } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $$("[data-theme-set]").forEach(b => b.classList.toggle("on", b.dataset.themeSet === t));
  const cycle = $("[data-theme-cycle]");
  if (cycle) cycle.innerHTML = icon(t === "light" ? "sun" : t === "dark" ? "moon" : "monitor");
}
$$("[data-theme-set]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
$("[data-theme-cycle]").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(getTheme()) + 1) % 3]));
setTheme(getTheme());

// --- Navigation -------------------------------------------------------------
let current = { view: "home", help: "home", parts: [] };

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const top = parts[0] || "home";
  if (top === "pdf" && parts[1]) return { view: "pdf-tool", help: "pdf/" + parts[1], top, parts };
  if (["home", "telecharger", "convertir", "pdf", "decompresser", "work", "suggestions"].includes(top)) return { view: top, help: top, top, parts };
  return { view: "home", help: "home", top: "home", parts: [] };
}

function route() {
  current = parseRoute();
  $$("main > section").forEach(s => { s.hidden = s.dataset.view !== current.view; });
  $$("#nav a, #tabbar a").forEach(a => a.classList.toggle("active", a.dataset.route === current.top));
  closePanel();
  window.scrollTo(0, 0);
  if (current.view === "telecharger") downloader.show();
  if (current.view === "convertir") converter.show();
  if (current.view === "pdf") pdf.showHub($("#pdf-hub"));
  if (current.view === "pdf-tool") pdf.showTool(current.parts[1], $("#pdf-tool"));
  if (current.view === "suggestions") loadSuggestions();
  if (current.view === "decompresser" && !$("#arc-root").children.length) archive.init();
  if (current.view === "work") current.parts[1] ? work.showEditor(current.parts[1]) : work.showHome();
  else work.closeEditor();
  $("#suggest-tool").value = ["telecharger", "convertir", "pdf", "decompresser", "work"].includes(current.top) ? current.top : "general";
  showIntro();
}
addEventListener("hashchange", route);

// --- Bandeau « première visite » -------------------------------------------
function seen(key) { try { return localStorage.getItem("bt-seen-" + key); } catch { return true; } }
function markSeen(key) { try { localStorage.setItem("bt-seen-" + key, "1"); } catch {} }
function showIntro() {
  $$(".intro").forEach(el => el.remove());
  const key = current.help;
  if (key === "home" || !HELP[key] || seen(key)) return;
  const section = $(`main > section[data-view="${current.view}"]`);
  const el = document.createElement("div");
  el.className = "intro";
  el.innerHTML = `<span class="tile ambre">${icon("lightbulb")}</span>
    <p><b>Première fois ici ?</b> Le tuto t'explique tout en une minute.</p>
    <button class="btn small" data-a="open">${icon("help")}Voir le tuto</button>
    <button class="icon-btn plain" data-a="close" title="Masquer">${icon("x")}</button>`;
  el.querySelector("[data-a=open]").onclick = () => { markSeen(key); el.remove(); openHelp(); };
  el.querySelector("[data-a=close]").onclick = () => { markSeen(key); el.remove(); };
  const anchor = section.querySelector(".page-head") || section.querySelector(".back");
  anchor.after(el);
}

// --- Aide -------------------------------------------------------------------
function openHelp() {
  const h = HELP[current.help] || HELP.home;
  markSeen(current.help);
  $$(".intro").forEach(el => el.remove());
  $("#help-title").textContent = h.title;
  $("#help-tile").className = "tile " + (h.tile || "");
  $("#help-tile").innerHTML = icon(h.icon || "help");
  $("#help-body").innerHTML = `
    <p class="lead">${esc(h.lead)}</p>
    <ol class="tuto">${h.steps.map(([t, d]) => `<li><b>${esc(t)}</b>${d ? `<span>${esc(d)}</span>` : ""}</li>`).join("")}</ol>
    ${h.tips.length ? `<div class="tips"><h3>${icon("lightbulb")}Astuces</h3><ul>${h.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    ${h.faq.length ? `<div class="faq"><h3>${icon("help")}Questions fréquentes</h3>${h.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>` : ""}
    <button class="btn ghost wide" data-suggest style="margin-top:12px">${icon("lightbulb")}Une question sans réponse ? Fais une suggestion</button>`;
  $("#help-body [data-suggest]").onclick = openSuggest;
  openPanel($("#help"));
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-help]")) openHelp();
  if (e.target.closest("[data-suggest]") && !e.target.closest("#help-body")) openSuggest();
  if (e.target.closest("[data-close]")) closePanel();
});
$("#scrim").addEventListener("click", closePanel);

// --- Suggestions ------------------------------------------------------------
function openSuggest() {
  openPanel($("#suggest"));
  setTimeout(() => $("#suggest-msg").focus(), 200);
}
$("#suggest-form").addEventListener("submit", async e => {
  e.preventDefault();
  const body = {
    kind: $("#suggest-form [name=kind]:checked").value, tool: $("#suggest-tool").value,
    message: $("#suggest-msg").value, name: $("#suggest-name").value,
  };
  try {
    const r = await fetch("/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Erreur");
    $("#suggest-msg").value = "";
    closePanel();
    toast("Merci ! Ta suggestion est enregistrée.");
    if (current.view === "suggestions") loadSuggestions();
  } catch (err) { toast(err.message, "err"); }
});

const KIND = { idee: ["💡", "Idée d'outil"], amelioration: ["✨", "Amélioration"], bug: ["🐞", "Problème"] };
const TOOL = { general: "Général", telecharger: "Téléchargeur", convertir: "Convertisseur", pdf: "Studio PDF", decompresser: "Décompresseur", work: "Bêta Work" };
async function loadSuggestions() {
  const list = await (await fetch("/api/suggestions")).json().catch(() => []);
  $("#sugg-list").innerHTML = list.length ? list.map(s => `
    <div class="sugg">
      <div class="head" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="status">${KIND[s.kind]?.[0] || ""} ${esc(KIND[s.kind]?.[1] || s.kind)}</span>
        <span class="chip">${esc(TOOL[s.tool] || s.tool)}</span>
        <span class="meta">${esc(s.name || "Anonyme")} · ${esc(s.date)}</span>
      </div>
      <p>${esc(s.message)}</p>
    </div>`).join("")
    : `<div class="empty">${icon("inbox")}Aucune suggestion pour l'instant. Sois le premier !</div>`;
}

// --- Accueil ----------------------------------------------------------------
const h = new Date().getHours();
$("#greeting").textContent = (h < 5 || h >= 18 ? "Bonsoir" : "Bonjour") + " 👋";

// --- Configuration du serveur ------------------------------------------------
// Sans NAS (PC, mini-PC, serveur…), STORAGE_NAME remplace le mot « NAS » partout dans l'interface.
let storage = "NAS";
const swapStorage = node => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) if (n.nodeValue.includes("NAS")) n.nodeValue = n.nodeValue.replace(/\bNAS\b/g, storage);
  if (node.querySelectorAll) node.querySelectorAll("[placeholder*=NAS],[title*=NAS]").forEach(el => {
    ["placeholder", "title"].forEach(a => el.getAttribute(a) && el.setAttribute(a, el.getAttribute(a).replace(/\bNAS\b/g, storage)));
  });
};
fetch("/api/config").then(r => r.json()).then(cfg => {
  $("#logout").hidden = !cfg.auth;
  if (!cfg.storage || cfg.storage === "NAS") return;
  storage = cfg.storage;
  swapStorage(document.body);
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1) swapStorage(n);
    else if (n.nodeType === 3 && n.nodeValue.includes("NAS")) n.nodeValue = n.nodeValue.replace(/\bNAS\b/g, storage);
  }))).observe(document.body, { childList: true, subtree: true });
}).catch(() => {});

downloader.init();
converter.init();
route();
