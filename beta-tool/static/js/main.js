// Coquille du site : configuration, menu, navigation, recherche, notifications, aide, suggestions.
import { $, $$, esc, icon, hydrateIcons, toast, openPanel, closePanel, sizeStr } from "./ui.js";
import { HELP } from "./help.js";
import { TOOLS, SYSTEM, CATS, byId } from "./registry.js";
import { state, isAdmin, enabled, api, ago } from "./state.js";
import * as downloader from "./downloader.js";
import * as converter from "./converter.js";
import * as pdf from "./pdf/hub.js";
import * as archive from "./archive.js";
import * as work from "./work.js";
import * as push from "./push.js";

hydrateIcons();

// --- Thème ------------------------------------------------------------------
const THEMES = ["auto", "light", "dark"];
function getTheme() { try { return localStorage.getItem("bt-theme") || "auto"; } catch { return "auto"; } }
export function setTheme(t) {
  try { localStorage.setItem("bt-theme", t); } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $$("[data-theme-set]").forEach(b => b.classList.toggle("on", b.dataset.themeSet === t));
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-theme-set]");
  if (b) setTheme(b.dataset.themeSet);
});

// --- Menu, accueil, onglets ---------------------------------------------------
const visible = t => enabled(t.id) && (!t.admin || isAdmin());

function buildNav() {
  const groups = CATS.map(([cat, label]) => {
    const items = TOOLS.filter(t => t.cat === cat && visible(t));
    return items.length ? `<div class="nav-label">${label}</div>` + items.map(navLink).join("") : "";
  }).join("");
  $("#nav").innerHTML = `<a href="#/" data-route="home">${icon("home")}Accueil</a>` + groups
    + `<div class="nav-label">Bêta Tool</div>` + SYSTEM.map(navLink).join("");
  const u = state.config.user;
  $("#side-user").innerHTML = `
    <div class="me"><span class="avatar">${esc((u.name[0] || "?").toUpperCase())}</span>
      <span><b>${esc(state.config.mode === "open" ? "Accès libre" : u.name)}</b><small>${u.role === "admin" ? "Administrateur" : "Membre"} · v${esc(state.config.version)}</small></span>
      ${state.config.mode !== "open" ? `<form method="post" action="/logout"><button class="icon-btn plain" title="Se déconnecter">${icon("logout")}</button></form>` : ""}
    </div>
    <div class="theme-switch" role="group" aria-label="Thème">
      <button data-theme-set="auto" title="Automatique">${icon("monitor")}</button>
      <button data-theme-set="light" title="Clair">${icon("sun")}</button>
      <button data-theme-set="dark" title="Sombre">${icon("moon")}</button>
    </div>`;
  setTheme(getTheme());
  $("#tab-files").hidden = !enabled("fichiers");
  $("#sheet-body").innerHTML = CATS.map(([cat, label]) => {
    const items = TOOLS.filter(t => t.cat === cat && visible(t));
    return items.length ? `<div class="nav-label">${label}</div><div class="sheet-grid">${items.map(sheetLink).join("")}</div>` : "";
  }).join("") + `<div class="nav-label">Bêta Tool</div><div class="sheet-grid">${SYSTEM.map(sheetLink).join("")}</div>`
    + $("#side-user").innerHTML;
  $("#suggest-tool").innerHTML = `<option value="general">Le site en général</option>`
    + [...TOOLS, ...SYSTEM.filter(t => t.id === "reglages")].map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  buildHome();
}
const navLink = t => `<a href="#/${t.id}" data-route="${t.id}">${icon(t.icon)}${esc(t.name)}</a>`;
const sheetLink = t => `<a href="#/${t.id}" data-route="${t.id}"><span class="tile ${t.tile}">${icon(t.icon)}</span>${esc(t.name)}</a>`;

function buildHome() {
  $("#home-tools").innerHTML = CATS.map(([cat, label]) => {
    const items = TOOLS.filter(t => t.cat === cat && visible(t));
    if (!items.length) return "";
    return `<div class="home-cat">${label}</div><div class="tools">${items.map(t => `
      <a class="card tool" href="#/${t.id}">
        <span class="tile ${t.tile}">${icon(t.icon)}</span>
        <h2>${esc(t.name)}</h2><p>${esc(t.desc)}</p>
        <div class="chips">${t.chips.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>
      </a>`).join("")}</div>`;
  }).join("");
  $("#version").textContent = "v" + state.config.version;
}

async function loadDashboard() {
  try {
    const d = await api("/api/dashboard");
    const disks = d.disks.map(k => {
      const pct = Math.round(k.used / k.total * 100);
      return `<div class="card widget"><div class="w-head">${icon("nas")}<b>Stockage</b><span class="meta">${pct} %</span></div>
        <div class="bar ${pct > 90 ? "warn" : ""}"><div style="width:${pct}%"></div></div>
        <p class="meta">${sizeStr(k.free)} libres sur ${sizeStr(k.total)}</p>
        <p class="hint" style="margin:0">${k.roots.map(esc).join(" · ")}</p></div>`;
    }).join("");
    const labels = { abonnements: ["Chaînes suivies", "rss", "#/abonnements"], documents: ["Documents", "briefcase", "#/work"], notes: ["Notes", "notebook", "#/notes"], partages: ["Partages actifs", "send", "#/drop"],
                     questionnaires: ["Questionnaires", "form", "#/questionnaires"], liens: ["Liens courts", "link", "#/liens"] };
    const counts = Object.entries(d.counts).filter(([k, v]) => v != null && labels[k]).map(([k, v]) =>
      `<a class="stat" href="${labels[k][2]}">${icon(labels[k][1])}<b>${v}</b><span>${labels[k][0]}</span></a>`).join("");
    const acts = d.activity.length ? d.activity.map(activityRow).join("") : `<p class="hint">Rien pour l'instant.</p>`;
    $("#dash").innerHTML = disks + (counts ? `<div class="card widget"><div class="w-head">${icon("chart")}<b>En bref</b></div><div class="stats">${counts}</div></div>` : "")
      + `<div class="card widget"><div class="w-head">${icon("clock")}<b>Activité récente</b></div><div class="acts">${acts}</div></div>`;
  } catch { $("#dash").innerHTML = ""; }
}
const activityRow = a => {
  const t = byId(a.tool);
  return `<a class="act ${a.kind}" href="${esc(a.link || "#/")}"><span class="tile ${t?.tile || ""}">${icon(t?.icon || "bell")}</span>
    <span><b>${esc(a.text)}</b><small>${ago(a.ts)}</small></span></a>`;
};

// --- Navigation -------------------------------------------------------------
let current = { view: "home", help: "home", parts: [], query: {} };
let dynModule = null;

function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const top = parts[0] || "home";
  const tool = byId(top);
  if (top === "pdf" && parts[1]) return { view: "pdf-tool", help: "pdf/" + parts[1], top, parts, query };
  if (top === "home" || !tool) return { view: "home", help: "home", top: "home", parts: [], query };
  return { view: tool.view || "dyn", help: HELP[top + "/" + (parts[1] || "")] ? top + "/" + parts[1] : top, top, parts, query, tool };
}

async function route() {
  const prev = current;
  current = parseRoute();
  if (dynModule && (prev.top !== current.top || current.view !== "dyn")) { dynModule.leave?.(); dynModule = null; }
  $$("main > section").forEach(s => { s.hidden = s.dataset.view !== current.view; });
  $$("#nav a, #tabbar a, #sheet a").forEach(a => a.classList.toggle("active", a.dataset.route === current.top));
  closePanel();
  if (prev.top !== current.top) window.scrollTo(0, 0);
  const t = current.tool;
  if (t && !visible(t)) return disabledPage(t);
  if (current.view === "home") loadDashboard();
  if (current.view === "telecharger") downloader.show(current.query);
  if (current.view === "convertir") converter.show();
  if (current.view === "pdf") pdf.showHub($("#pdf-hub"));
  if (current.view === "pdf-tool") pdf.showTool(current.parts[1], $("#pdf-tool"));
  if (current.view === "suggestions") loadSuggestions();
  if (current.view === "decompresser") {
    if (!$("#arc-root").children.length) archive.init();
    if (window.btArchive) { archive.show(window.btArchive); window.btArchive = null; }  // archive ouverte depuis Fichiers
  }
  if (current.view === "work") current.parts[1] ? work.showEditor(current.parts[1]) : work.showHome();
  else work.closeEditor();
  if (current.view === "dyn") {
    const root = $("#dyn-root");
    try {
      const mod = await t.load();
      if (parseRoute().top !== current.top) return;  // l'utilisateur est parti entre-temps
      if (dynModule !== mod) { root.innerHTML = ""; delete root.dataset.tool; }
      dynModule = mod;
      if (root.dataset.tool !== t.id) { root.innerHTML = ""; root.dataset.tool = t.id; }
      await mod.render(root, current.parts.slice(1), current.query);
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="empty">${icon("alert")}Impossible d'ouvrir cet outil : ${esc(e.message)}</div>`;
    }
  }
  $("#suggest-tool").value = byId(current.top) ? current.top : "general";
  showIntro();
}
addEventListener("hashchange", route);

function disabledPage(t) {
  $$("main > section").forEach(s => { s.hidden = s.dataset.view !== "dyn"; });
  $("#dyn-root").dataset.tool = "";
  $("#dyn-root").innerHTML = `<div class="empty" style="padding:80px 20px">${icon(t.icon)}<b>${esc(t.name)} est désactivé</b>
    ${isAdmin() ? `<a class="btn small" href="#/reglages/outils">${icon("settings")}Gérer les outils</a>` : "Demande à un administrateur de l'activer."}</div>`;
}

/** En-tête standard d'un outil chargé à la demande. */
export function pageHead(tool, extra = "") {
  const t = typeof tool === "string" ? byId(tool) : tool;
  return `<div class="page-head"><span class="tile ${t.tile}">${icon(t.icon)}</span>
    <div class="grow"><h1>${esc(t.name)}</h1><p>${esc(t.desc || "")}</p></div>${extra}
    <button class="btn ghost" data-help>${icon("help")}Aide</button></div>`;
}

// --- Bandeau « première visite » -------------------------------------------
function seen(key) { try { return localStorage.getItem("bt-seen-" + key); } catch { return true; } }
function markSeen(key) { try { localStorage.setItem("bt-seen-" + key, "1"); } catch {} }
function showIntro() {
  $$(".intro").forEach(el => el.remove());
  const key = current.help;
  if (key === "home" || !HELP[key] || seen(key)) return;
  const section = $(`main > section[data-view="${current.view}"]`);
  const anchor = section?.querySelector(".page-head") || section?.querySelector(".back");
  if (!anchor) return;
  const el = document.createElement("div");
  el.className = "intro";
  el.innerHTML = `<span class="tile ambre">${icon("lightbulb")}</span>
    <p><b>Première fois ici ?</b> Le tuto t'explique tout en une minute.</p>
    <button class="btn small" data-a="open">${icon("help")}Voir le tuto</button>
    <button class="icon-btn plain" data-a="close" title="Masquer">${icon("x")}</button>`;
  el.querySelector("[data-a=open]").onclick = () => { markSeen(key); el.remove(); openHelp(); };
  el.querySelector("[data-a=close]").onclick = () => { markSeen(key); el.remove(); };
  anchor.after(el);
}
export const refreshIntro = showIntro;

// --- Aide -------------------------------------------------------------------
function openHelp() {
  const h = HELP[current.help] || HELP[current.top] || HELP.home;
  markSeen(current.help);
  $$(".intro").forEach(el => el.remove());
  $("#help-title").textContent = h.title;
  $("#help-tile").className = "tile " + (h.tile || "");
  $("#help-tile").innerHTML = icon(h.icon || "help");
  $("#help-body").innerHTML = `
    <p class="lead">${esc(h.lead)}</p>
    <ol class="tuto">${h.steps.map(([t, d]) => `<li><b>${esc(t)}</b>${d ? `<span>${esc(d)}</span>` : ""}</li>`).join("")}</ol>
    ${h.tips?.length ? `<div class="tips"><h3>${icon("lightbulb")}Astuces</h3><ul>${h.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    ${h.faq?.length ? `<div class="faq"><h3>${icon("help")}Questions fréquentes</h3>${h.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>` : ""}
    <button class="btn ghost wide" data-suggest-help style="margin-top:12px">${icon("lightbulb")}Une question sans réponse ? Fais une suggestion</button>`;
  $("#help-body [data-suggest-help]").onclick = openSuggest;
  openPanel($("#help"));
}

document.addEventListener("click", e => {
  if (e.target.closest("[data-help]")) openHelp();
  if (e.target.closest("[data-suggest]")) openSuggest();
  if (e.target.closest("[data-search]")) { e.preventDefault(); openPalette(); }
  if (e.target.closest("[data-bell]")) openNotifs();
  if (e.target.closest("[data-menu]")) { e.preventDefault(); openPanel($("#sheet")); }
  if (e.target.closest("#sheet a")) closePanel();
  if (e.target.closest("[data-close]")) closePanel();
});
$("#scrim").addEventListener("click", closePanel);

// --- Recherche globale (Ctrl K) ---------------------------------------------
let palIndex = 0, palItems = [], palTimer = null;
function openPalette() {
  openPanel($("#palette"));
  $("#palette-q").value = "";
  palette("");
  setTimeout(() => $("#palette-q").focus(), 60);
}
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  if (!$("#palette").classList.contains("open")) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    palIndex = (palIndex + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
    paintPalette();
  }
  if (e.key === "Enter" && palItems[palIndex]) { location.hash = palItems[palIndex].link; closePanel(); }
});
$("#palette-q").addEventListener("input", e => {
  clearTimeout(palTimer);
  const q = e.target.value.trim();
  palette(q);
  if (q.length >= 2) palTimer = setTimeout(async () => {
    try {
      const remote = await api("/api/search?q=" + encodeURIComponent(q));
      if ($("#palette-q").value.trim() === q) palette(q, remote);
    } catch {}
  }, 220);
});
const TYPE_ICON = { sub: "rss", clip: "clipboard", document: "doc", note: "notebook", file: "file", folder: "folder", form: "form", share: "send", link: "link", photo: "image", media: "play" };
const TYPE_LABEL = { sub: "Abonnements", clip: "Presse-papier", tool: "Outils", document: "Documents", note: "Notes", file: "Fichiers", folder: "Fichiers", form: "Questionnaires", share: "Partages", link: "Liens", photo: "Photos", media: "Médias" };
function palette(q, remote = []) {
  const n = q.toLowerCase();
  const tools = [...TOOLS.filter(visible), ...SYSTEM].filter(t => !n || t.name.toLowerCase().includes(n) || (t.desc || "").toLowerCase().includes(n))
    .map(t => ({ type: "tool", title: t.name, sub: t.desc || "", link: "#/" + t.id, icon: t.icon, tile: t.tile }));
  palItems = [...tools.slice(0, n ? 6 : 20), ...remote];
  palIndex = 0;
  paintPalette();
}
function paintPalette() {
  let last = "";
  $("#palette-results").innerHTML = palItems.length ? palItems.map((r, i) => {
    const group = TYPE_LABEL[r.type] || "Résultats";
    const head = group !== last ? `<div class="pal-group">${group}</div>` : "";
    last = group;
    return `${head}<a class="pal-item ${i === palIndex ? "on" : ""}" href="${esc(r.link)}" data-i="${i}">
      <span class="tile ${r.tile || ""}">${icon(r.icon || TYPE_ICON[r.type] || "file")}</span>
      <span><b>${esc(r.title)}</b><small>${esc(r.sub || "")}</small></span></a>`;
  }).join("") : `<div class="empty">${icon("search")}Aucun résultat</div>`;
  $("#palette-results .pal-item.on")?.scrollIntoView({ block: "nearest" });
}
$("#palette-results").addEventListener("click", e => { if (e.target.closest(".pal-item")) closePanel(); });

// --- Notifications ----------------------------------------------------------
let notifs = [], lastId = 0, polling = false;
const seenId = () => { try { return +localStorage.getItem("bt-notif-seen") || 0; } catch { return 0; } };
async function pollActivity(first = false) {
  if (polling) return;  // évite deux requêtes simultanées (minuterie + retour sur l'onglet)
  polling = true;
  try {
    const fresh = (await api("/api/activity?since=" + lastId)).filter(a => a.id > lastId);
    if (!fresh.length) return;
    lastId = Math.max(lastId, ...fresh.map(a => a.id));
    notifs = [...fresh, ...notifs].slice(0, 60);
    if (!first) fresh.forEach(a => {
      toast(a.text, a.kind === "err" ? "err" : "ok");
      if ("Notification" in window && Notification.permission === "granted" && document.hidden && !push.active()) {
        new Notification("Bêta Tool", { body: a.text, icon: "/brand/apple-touch-icon.png", tag: String(a.id) });
      }
    });
    paintBell();
    if (current.view === "home" && !first) loadDashboard();
  } catch {} finally { polling = false; }
}
function paintBell() {
  const unread = notifs.filter(a => a.id > seenId()).length;
  $$(".bell .dotcount").forEach(d => { d.hidden = !unread; d.textContent = unread > 9 ? "9+" : unread; });
}
function openNotifs() {
  const canPush = !push.unsupported();
  $("#notifs-perm").innerHTML = (canPush ? !push.active() : "Notification" in window && Notification.permission === "default")
    ? `<div class="intro"><span class="tile">${icon("bell")}</span><p>${canPush ? "Recevoir les notifications sur cet appareil, même quand Bêta Tool est fermé ?"
        : "Être prévenu même quand l'onglet est en arrière-plan ?"}</p>
       <button class="btn small" id="notif-allow">Activer</button></div>` : "";
  $("#notif-allow")?.addEventListener("click", async () => {
    if (canPush) { try { await push.enable(); toast("Notifications activées sur cet appareil"); } catch (err) { toast(err.message, "err"); } }
    else await Notification.requestPermission();
    openNotifs();
  });
  $("#notifs-list").innerHTML = notifs.length ? `<div class="acts">${notifs.map(activityRow).join("")}</div>`
    : `<div class="empty">${icon("bell")}Aucune notification pour l'instant.</div>`;
  try { localStorage.setItem("bt-notif-seen", String(lastId)); } catch {}
  paintBell();
  openPanel($("#notifs"));
}
$("#notifs-list").addEventListener("click", e => { if (e.target.closest("a")) closePanel(); });

// --- Suggestions ------------------------------------------------------------
function openSuggest() {
  openPanel($("#suggest"));
  setTimeout(() => $("#suggest-msg").focus(), 200);
}
$("#suggest-form").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/suggestions", { json: {
      kind: $("#suggest-form [name=kind]:checked").value, tool: $("#suggest-tool").value,
      message: $("#suggest-msg").value, name: $("#suggest-name").value || (state.config.mode === "accounts" ? state.config.user.name : ""),
    } });
    $("#suggest-msg").value = "";
    closePanel();
    toast("Merci ! Ta suggestion est enregistrée.");
    if (current.view === "suggestions") loadSuggestions();
  } catch (err) { toast(err.message, "err"); }
});

const KIND = { idee: ["💡", "Idée d'outil"], amelioration: ["✨", "Amélioration"], bug: ["🐞", "Problème"] };
async function loadSuggestions() {
  const list = await api("/api/suggestions").catch(() => []);
  $("#sugg-list").innerHTML = list.length ? list.map(s => `
    <div class="sugg">
      <div class="head" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="status">${KIND[s.kind]?.[0] || ""} ${esc(KIND[s.kind]?.[1] || s.kind)}</span>
        <span class="chip">${esc(byId(s.tool)?.name || "Général")}</span>
        <span class="meta">${esc(s.name || "Anonyme")} · ${esc(s.date)}</span>
      </div>
      <p>${esc(s.message)}</p>
    </div>`).join("")
    : `<div class="empty">${icon("inbox")}Aucune suggestion pour l'instant. Sois le premier !</div>`;
}

// --- Nom du stockage --------------------------------------------------------
// Sans NAS (PC, mini-PC, serveur…), le nom choisi remplace le mot « NAS » partout dans l'interface.
function swapStorage(storage) {
  const swap = node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) if (n.nodeValue.includes("NAS")) n.nodeValue = n.nodeValue.replace(/\bNAS\b/g, storage);
    if (node.querySelectorAll) node.querySelectorAll("[placeholder*=NAS],[title*=NAS]").forEach(el => {
      ["placeholder", "title"].forEach(a => el.getAttribute(a) && el.setAttribute(a, el.getAttribute(a).replace(/\bNAS\b/g, storage)));
    });
  };
  swap(document.body);
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1 && !n.closest?.("[contenteditable], textarea")) swap(n);
    else if (n.nodeType === 3 && n.nodeValue.includes("NAS") && !n.parentElement?.closest("[contenteditable], textarea")) n.nodeValue = n.nodeValue.replace(/\bNAS\b/g, storage);
  }))).observe(document.body, { childList: true, subtree: true });
}

// --- Application installable (PWA) ------------------------------------------
addEventListener("beforeinstallprompt", e => { e.preventDefault(); window.btInstall = e; });

// --- Démarrage --------------------------------------------------------------
export async function reloadConfig() {
  state.config = await api("/api/config");
  buildNav();
  route();
}

(async () => {
  const hr = new Date().getHours();
  $("#greeting").textContent = (hr < 5 || hr >= 18 ? "Bonsoir" : "Bonjour") + (state.config?.user ? "" : "") + " 👋";
  state.config = await api("/api/config");
  if (state.config.mode === "accounts") $("#greeting").textContent = $("#greeting").textContent.replace(" 👋", `, ${state.config.user.name} 👋`);
  if (state.config.site && state.config.site !== "Bêta Tool") document.title = state.config.site;
  if (state.config.storage && state.config.storage !== "NAS") swapStorage(state.config.storage);
  buildNav();
  downloader.init();
  converter.init();
  route();
  pollActivity(true);
  setInterval(pollActivity, 15000);
  addEventListener("focus", () => pollActivity());
  if ("serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
