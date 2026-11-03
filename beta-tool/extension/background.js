// Tâches de fond de l'extension : menus du clic droit, téléchargements, notifications, prix (comparaison,
// relecture des produits suivis), recherche depuis la barre d'adresse (mot-clé « bt »).
import { config, call, upload, nameFromUrl, openNas, eur } from "./lib.js";

// --- Menus du clic droit ---------------------------------------------------------------------------
const MENUS = [
  ["link", "Envoyer sur le NAS", ["link"]],
  ["link-auto", "Ranger automatiquement (relevé, facture, photo…)", ["link"], "link"],
  ["link-paperasse", "Dans Paperasse", ["link"], "link"],
  ["link-fichiers", "Dans Fichiers (Téléchargements/Navigateur)", ["link"], "link"],
  ["link-photos", "Dans l'Album photo", ["link"], "link"],
  ["link-video", "Télécharger la vidéo de ce lien", ["link"], "link"],
  ["image-photos", "Envoyer l'image dans l'Album photo", ["image"]],
  ["page-video", "Télécharger la vidéo de cette page sur le NAS", ["page", "video"]],
  ["page-price", "Suivre le prix de ce produit", ["page"]],
  ["page-note", "Enregistrer la page dans Bêta Notes", ["page"]],
  ["page-immo", "Suivre cette annonce immobilière", ["page"]],
  ["page-drop", "Déposer un fichier sur le NAS…", ["page", "action"]],
  ["sel-note", "Ajouter la sélection à Bêta Notes", ["selection"]],
  ["sel-event", "Créer un rendez-vous avec « %s »", ["selection"]],
  ["sel-parcel", "Suivre le colis « %s »", ["selection"]],
  ["sel-search", "Rechercher « %s » dans Bêta Tool", ["selection"]],
];

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts, parentId] of MENUS) chrome.contextMenus.create({ id, title, contexts, ...(parentId ? { parentId } : {}) });
  });
}
chrome.runtime.onInstalled.addListener(details => {
  setupMenus();
  chrome.alarms.create("refresh", { periodInMinutes: 180, delayInMinutes: 5 });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => { setupMenus(); chrome.alarms.create("refresh", { periodInMinutes: 180, delayInMinutes: 5 }); });

// --- Notifications ----------------------------------------------------------------------------------
async function notify(title, message, { link, actions, requireInteraction } = {}) {
  const id = "bt-" + Date.now() + Math.random().toString(36).slice(2, 6);
  const opts = { type: "basic", iconUrl: "icons/icon128.png", title, message: String(message || "").slice(0, 250), priority: 1 };
  if (actions?.length) opts.buttons = actions.map(a => ({ title: a.title }));
  if (requireInteraction) opts.requireInteraction = true;
  await chrome.storage.session.set({ [id]: { link, actions } });
  try { chrome.notifications.create(id, opts); }
  catch { delete opts.buttons; chrome.notifications.create(id, opts); }  // navigateurs sans boutons de notification
  return id;
}
async function onNotif(id, button) {
  const d = (await chrome.storage.session.get(id))[id];
  chrome.notifications.clear(id);
  if (!d) return;
  const act = button != null ? d.actions?.[button] : d.actions?.[0];
  if (act) return runAction(act);
  if (d.link) openNas(d.link);
}
chrome.notifications.onClicked.addListener(id => onNotif(id, null));
chrome.notifications.onButtonClicked.addListener((id, b) => onNotif(id, b));

async function runAction(a) {
  if (a.kind === "upload") return sendLink(a.url, a.dest || "auto", a.tabId, a.name);
  if (a.kind === "choose") return chrome.tabs.create({ url: chrome.runtime.getURL(`drop.html?url=${encodeURIComponent(a.url)}&name=${encodeURIComponent(a.name || "")}`) });
  if (a.kind === "open") return openNas(a.link);
}

// --- Récupérer un fichier (avec la session du site) puis l'envoyer -----------------------------------
function fileName(disposition, url, type) {
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition || "");
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition || "");
  try { if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch {}
  if (plain) return plain[1].trim();
  return nameFromUrl(url, type);
}

async function grab(url, tabId) {
  // 1. depuis la page (même site : la session et les cookies du site sont utilisés tels quels)
  if (tabId != null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && new URL(tab.url).origin === new URL(url).origin) {
        const r = await chrome.tabs.sendMessage(tabId, { type: "fetch", url });
        if (r?.data) {
          const blob = await (await fetch(r.data)).blob();
          return { blob, name: fileName(r.disposition, url, r.type), type: r.type };
        }
      }
    } catch {}
  }
  // 2. depuis l'extension
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`Le site a répondu ${r.status}`);
  const blob = await r.blob();
  return { blob, name: fileName(r.headers.get("content-disposition"), r.url || url, blob.type), type: blob.type };
}

const LABEL = { paperasse: "Paperasse", budget: "Budget", patrimoine: "Patrimoine", photos: "Album photo", fichiers: "Fichiers" };
async function sendLink(url, dest = "auto", tabId = null, name = null) {
  try {
    const f = await grab(url, tabId);
    const fname = name || f.name;
    if (/text\/html/.test(f.type) && !/\.html?$/i.test(fname)) throw new Error("le site a renvoyé une page au lieu du fichier (connexion expirée ?)");
    const r = await upload(f.blob, fname, dest, url);
    notify(`Envoyé dans ${r.label || LABEL[r.dest] || "le NAS"}`, `${fname}${r.detail ? " · " + r.detail : ""}`, { link: r.link });
    return r;
  } catch (e) {
    notify("Envoi impossible", `${e.message}. Tu peux glisser le fichier dans la page « Déposer ».`, { actions: [{ title: "Ouvrir « Déposer »", kind: "choose", url, name }] });
    throw e;
  }
}

async function pageInfo(tabId, full = false, text = false) {
  try { return await chrome.tabs.sendMessage(tabId, { type: "page", full, text }); }
  catch { return null; }
}

async function safe(fn, label) {
  try { return await fn(); }
  catch (e) { notify(label || "Bêta Tool", e.message); return null; }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId, tabId = tab?.id;
  if (id.startsWith("link-") && id !== "link-video") return sendLink(info.linkUrl, id.slice(5), tabId).catch(() => {});
  if (id === "image-photos") return sendLink(info.srcUrl, "photos", tabId).catch(() => {});
  if (id === "link-video" || id === "page-video") {
    const url = id === "link-video" ? info.linkUrl : info.pageUrl;
    return safe(async () => { await call("/api/v1/ext/video", { json: { url } }); notify("Téléchargement lancé", "La vidéo arrive dans Téléchargements (meilleure qualité).", { link: "#/telecharger" }); }, "Vidéo");
  }
  if (id === "page-price") return safe(async () => {
    const p = await pageInfo(tabId);
    const r = await call("/api/v1/ext/prix/seen", { json: { url: tab.url, html: p?.html || "", follow: true } });
    if (!r.product) throw new Error("Pas de prix reconnu sur cette page");
    notify("Prix suivi", `${r.product.title} · ${eur(r.product.offers.find(o => o.current)?.price)} : je te préviens s'il baisse.`, { link: "#/prix/" + r.product.id });
    chrome.tabs.sendMessage(tabId, { type: "show-pill", product: r.product }).catch(() => {});
  }, "Suivi des prix");
  if (id === "page-note" || id === "sel-note") return safe(async () => {
    const p = await pageInfo(tabId);
    const text = id === "sel-note" ? info.selectionText : (p?.selection || "");
    const r = await call("/api/v1/ext/note", { json: { title: tab.title, url: tab.url, text } });
    notify("Enregistré dans Bêta Notes", tab.title, { link: r.link });
  }, "Bêta Notes");
  if (id === "page-immo") return safe(async () => {
    const p = await pageInfo(tabId, true);
    const r = await call("/api/v1/ext/immo", { json: { url: tab.url, html: p?.html || "" } });
    notify("Annonce suivie", r.warning || `${r.listing.title || "Annonce"}${r.listing.price ? " · " + eur(r.listing.price) : ""}`, { link: r.link });
  }, "Immobilier");
  if (id === "page-drop") return chrome.tabs.create({ url: chrome.runtime.getURL("drop.html") });
  if (id === "sel-event") return chrome.windows.create({ url: chrome.runtime.getURL(`event.html?text=${encodeURIComponent(info.selectionText)}&url=${encodeURIComponent(tab?.url || "")}`), type: "popup", width: 440, height: 600 });
  if (id === "sel-parcel") return safe(async () => {
    await call("/api/v1/ext/parcel", { json: { number: info.selectionText, label: (tab?.title || "Colis").slice(0, 60) } });
    notify("Colis suivi", info.selectionText.trim(), { link: "#/colis" });
  }, "Colis");
  if (id === "sel-search") return openNas("#/recherche?q=" + encodeURIComponent(info.selectionText));
});

// --- Téléchargements ---------------------------------------------------------------------------------
const DOC = /\.(pdf|csv|ofx|qif|qfx|xlsx?|docx?|odt|ods|jpe?g|png|heic|zip)$/i;
const AUTO = /\.(pdf|csv|ofx|qif|qfx)$/i;
chrome.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== "complete") return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  const c = await config();
  if (!item || !c.token || c.opts.downloads === "off" || item.byExtensionId || chosen.delete(delta.id)) return;
  const url = item.finalUrl || item.url;
  if (!/^https?:/.test(url) || (c.base && url.startsWith(c.base))) return;
  let name = (item.filename || "").split(/[\\/]/).pop();
  if (!DOC.test(name)) name = nameFromUrl(url, item.mime);  // nom du fichier disque inconnu ou sans extension : celui du lien
  if (!DOC.test(name)) return;
  if (c.opts.downloads === "auto" && AUTO.test(name)) return sendLink(url, "auto", null, name).catch(() => {});
  notify("Envoyer sur le NAS ?", `${name} : relevé → Budget, facture → Paperasse, photo → Album…`, {
    requireInteraction: true,
    actions: [{ title: "Ranger automatiquement", kind: "upload", url, name, dest: "auto" }, { title: "Choisir où…", kind: "choose", url, name }],
  });
});

// --- Prix ----------------------------------------------------------------------------------------------
async function getText(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { credentials: "include", signal: ctl.signal, headers: { "Accept-Language": "fr-FR,fr;q=0.9" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return { html: (await r.text()).slice(0, 4_000_000), url: r.url || url };
  } finally { clearTimeout(t); }
}

const running = new Map();
async function compare(pid, url = null) {
  if (running.has(pid)) return running.get(pid);
  const job = (async () => {
    const { steps } = await call("/api/v1/ext/prix/plan", { json: { pid } });
    let found = 0;
    const one = async step => {
      try {
        const s = await getText(step.url);
        const r = await call("/api/v1/ext/prix/page", { json: { pid, shop: step.shop, url: s.url, html: s.html, kind: "search" } });
        if (r.matched) return found++;
        for (const c of (r.candidates || []).slice(0, 2)) {
          const p = await getText(c);
          const r2 = await call("/api/v1/ext/prix/page", { json: { pid, shop: step.shop, url: p.url, html: p.html, kind: "product" } });
          if (r2.matched) return found++;
        }
      } catch {}
    };
    const queue = [...steps];
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await one(queue.shift()); }));
    const { product } = await call("/api/v1/ext/prix/done", { json: { pid, url } });
    return { product, found, searched: steps.length };
  })();
  running.set(pid, job);
  try { return await job; } finally { running.delete(pid); }
}

async function refreshDue() {
  const c = await config();
  if (!c.token) return;
  const { items } = await call("/api/v1/ext/prix/due");
  for (const it of items) {
    try {
      const s = await getText(it.url);
      await call("/api/v1/ext/prix/page", { json: { pid: it.pid, url: it.url, html: s.html, kind: "refresh" } });
    } catch {}
  }
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === "refresh") refreshDue().catch(() => {}); });

async function badge(tabId, p) {
  if (tabId == null) return;
  const cur = p?.offers.find(o => o.current);
  const cheaper = p && cur && p.offers.some(o => !o.current && o.price && o.price < cur.price - 0.01 && o.available !== false);
  await chrome.action.setBadgeText({ tabId, text: !p ? "" : cheaper ? "↓" : p.followed ? "✓" : "€" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: cheaper ? "#0e9f6e" : "#2563eb" });
  await chrome.storage.session.set({ ["tab-" + tabId]: p ? p.id : null });
}
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove("tab-" + id));

// --- Messages (pages et fenêtre de l'extension) ----------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  (async () => {
    const c = await config();
    const tabUrl = msg.tabId != null ? (await chrome.tabs.get(msg.tabId).catch(() => null))?.url : sender.tab?.url;
    if (msg.type === "opts") return c.opts;
    if (!c.token) return null;
    if (msg.type === "product") {
      if (!c.opts.prices) return null;
      const r = await call("/api/v1/ext/prix/seen", { json: { url: msg.url, html: msg.html } });
      await badge(tabId, r.product);
      return { product: r.product, pill: c.opts.pill };
    }
    if (msg.type === "follow") {
      const r = await call("/api/v1/ext/prix/follow", { json: { pid: msg.pid, url: tabUrl, followed: msg.followed, ...(msg.target !== undefined ? { target: msg.target } : {}) } });
      await badge(tabId ?? msg.tabId, r.product);
      return r;
    }
    if (msg.type === "compare") {
      const r = await compare(msg.pid, tabUrl);
      await badge(tabId ?? msg.tabId, r.product);
      if (msg.tabId != null) chrome.tabs.sendMessage(msg.tabId, { type: "show-pill", product: r.product }).catch(() => {});
      return r;
    }
    if (msg.type === "video") { await call("/api/v1/ext/video", { json: { url: msg.url } }); return { ok: true }; }
    if (msg.type === "send-link") return sendLink(msg.url, msg.dest, msg.tabId ?? null, msg.name || null);
    return null;
  })().then(reply, e => reply({ error: e.message }));
  return true;
});

// --- Barre d'adresse : « bt » puis Espace ----------------------------------------------------------
const xml = s => String(s || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
let omniTimer;
chrome.omnibox.setDefaultSuggestion({ description: "Rechercher dans Bêta Tool : fichiers, notes, mails, tâches, opérations…" });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  clearTimeout(omniTimer);
  if (text.trim().length < 2) return;
  omniTimer = setTimeout(async () => {
    try {
      const res = await call("/api/v1/ext/search?q=" + encodeURIComponent(text.trim()));
      suggest(res.slice(0, 8).map(r => ({ content: r.link, description: `${xml(r.title)} <dim>— ${xml(r.sub || "")}</dim>` })));
    } catch {}
  }, 200);
});
chrome.omnibox.onInputEntered.addListener(async text => {
  if (text.startsWith("#/")) return openNas(text);
  openNas("#/recherche?q=" + encodeURIComponent(text));
});

// --- Avant d'enregistrer : renommer, convertir, extraire, envoyer sur le NAS ------------------------
// Le téléchargement attend la réponse de la fenêtre « save.html » (fermer la fenêtre = enregistrer tel quel).
const pending = new Map();  // id → { item, suggest, done, win }
const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|cab|cbz|cbr)$/i;
const CONVERTIBLE = /\.(pdf|docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?|odp|epub|mobi|azw3?|md|html?|jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|mp4|mkv|mov|avi|webm|flv|wmv|m4v|mp3|wav|flac|aac|m4a|ogg|opus|wma)$/i;

const chosen = new Set();  // téléchargements déjà passés par la fenêtre : pas de 2e question à la fin
function finish(id, opts) {
  const p = pending.get(id);
  if (!p || p.done) return;
  p.done = true;
  chosen.add(id);
  pending.delete(id);
  try { opts ? p.suggest(opts) : p.suggest(); } catch {}
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    const c = await config();
    const url = item.finalUrl || item.url;
    const name = item.filename || "";
    const mode = c.opts.beforeSave || "smart";
    if (item.byExtensionId === chrome.runtime.id) {  // fichier enregistré par l'extension : Chrome oublie le nom demandé, on le redonne
      const key = "name:" + item.url, want = (await chrome.storage.session.get(key))[key];
      chrome.storage.session.remove(key);
      return want ? suggest({ filename: want, conflictAction: "uniquify" }) : suggest();
    }
    if (!c.token || mode === "off" || item.byExtensionId || !/^https?:/.test(url) || (c.base && url.startsWith(c.base))
        || (mode === "smart" && !ARCHIVE.test(name) && !CONVERTIBLE.test(name))) return suggest();
    pending.set(item.id, { item, suggest, done: false });
    const win = await chrome.windows.create({ url: chrome.runtime.getURL(`save.html?id=${item.id}`), type: "popup", width: 480, height: 680, focused: true });
    if (pending.has(item.id)) pending.get(item.id).win = win.id;
    setTimeout(() => finish(item.id), 10 * 60 * 1000);  // sans réponse : enregistré tel quel
  })().catch(() => suggest());
  return true;  // réponse asynchrone
});

chrome.windows.onRemoved.addListener(winId => {
  for (const [id, p] of pending) if (p.win === winId) finish(id);
});

// La fenêtre garde une connexion ouverte (le service de fond reste éveillé pendant le choix)
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "save") return;
  port.onMessage.addListener(async msg => {
    const p = pending.get(msg.id);
    if (msg.type === "info") return port.postMessage({ type: "info", item: p ? { id: p.item.id, url: p.item.finalUrl || p.item.url, filename: p.item.filename, mime: p.item.mime, size: p.item.totalBytes || p.item.fileSize, referrer: p.item.referrer } : null });
    if (msg.type === "keep") finish(msg.id);
    if (msg.type === "rename") finish(msg.id, { filename: msg.filename.replace(/[\\/:*?"<>|]+/g, "_"), conflictAction: "uniquify" });
    if (msg.type === "handled") {  // la fenêtre a récupéré le fichier : le téléchargement d'origine est annulé
      try { await chrome.downloads.cancel(msg.id); } catch {}
      finish(msg.id);
      try { await chrome.downloads.erase({ id: msg.id }); } catch {}
    }
  });
});
