import { config, call, openNas, eur } from "./lib.js";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IMMO = /(seloger|leboncoin|pap|bienici|logic-immo|orpi|century21|laforet|guy-hoquet|stephaneplazaimmobilier|figaro|ouestfrance-immo|superimmo|meilleursagents|lesiteimmo|immonot|paruvendu)\./;
let tab, cfg, status;

function out(html, kind = "") { $("#out").innerHTML = html ? `<div class="msg ${kind}">${html}</div>` : ""; }
function bg(msg) { return new Promise(res => chrome.runtime.sendMessage(msg, r => res(r))); }

async function init() {
  cfg = await config();
  const forced = Number(new URLSearchParams(location.search).get("tab"));  // popup ouvert dans un onglet (tests, accessibilité)
  [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  $("#opts").onclick = () => chrome.runtime.openOptionsPage();
  $("#go-setup").onclick = () => chrome.runtime.openOptionsPage();
  $("#open").onclick = () => cfg.base ? openNas() : chrome.runtime.openOptionsPage();
  if (!cfg.token) { $("#setup").hidden = false; return; }
  $("#main").hidden = false;
  $("#site").textContent = cfg.site || "Bêta Tool";
  $("#who").textContent = `${cfg.user} · ${cfg.base.replace(/^https?:\/\//, "")}`;
  const web = /^https?:/.test(tab?.url || "");
  if (!web) $("#actions").querySelectorAll("[data-a]:not([data-a=drop])").forEach(b => b.disabled = true);
  if (web && IMMO.test(new URL(tab.url).hostname)) $('[data-a="immo"]').hidden = false;
  try { status = await call("/api/v1/ext/status"); } catch (e) { out(esc(e.message), "err"); return; }
  vault();
  if (web) product();
}

// --- Produit de l'onglet ---------------------------------------------------------------------------
async function product() {
  let r;
  try { r = await call("/api/v1/ext/prix/product", { json: { url: tab.url } }); } catch { return; }
  if (!r.product) return;
  paintProduct(r.product);
}

function paintProduct(p) {
  const cur = p.offers.find(o => o.current) || p.offers[0];
  const v = cur?.verdict;
  $("#product").innerHTML = `<div class="card">
    <div class="row">${p.image ? `<img class="pimg" src="${esc(p.image)}" alt="">` : ""}<div class="grow"><b>${esc(p.title.slice(0, 90))}</b>
      <div class="row"><span class="price">${eur(cur?.price)}</span>${v ? `<span class="st ${v.level === "info" ? "" : v.level}">${esc(v.text)}</span>` : ""}</div></div></div>
    ${p.offers.length > 1 ? `<div class="list" style="margin-top:6px">${p.offers.slice(0, 6).map(o => `<a class="item" href="${esc(o.url)}" target="_blank"><span class="grow">${esc(o.shop)}${o.current ? " <span class='meta'>(ici)</span>" : ""}</span><b>${eur(o.price)}</b></a>`).join("")}</div>` : ""}
    <label class="c"><input type="checkbox" id="follow" ${p.followed ? "checked" : ""}> Suivre ce produit (alerte si le prix baisse)</label>
    <div class="row"><input id="target" inputmode="decimal" placeholder="Prix cible (€)" value="${p.target ?? ""}" style="max-width:150px"><button class="btn p grow" id="cmp">Comparer les prix</button></div>
    <div class="row wrap small" style="margin-top:8px">${p.links.map(l => `<a href="${esc(l.url)}" target="_blank">${esc(l.name)}</a>`).join(" · ")}</div>
    <div class="row small" style="margin-top:6px"><a href="#" id="hist">Historique complet dans Bêta Tool</a></div></div>`;
  $("#product").querySelectorAll("img").forEach(i => i.addEventListener("error", () => i.remove()));
  const save = async () => {
    const r = await bg({ type: "follow", pid: p.id, followed: $("#follow").checked, target: $("#target").value, tabId: tab.id });
    if (r?.error) out(esc(r.error), "err"); else out("Enregistré", "ok");
  };
  $("#follow").onchange = save;
  $("#target").onchange = () => { $("#follow").checked = true; save(); };
  $("#hist").onclick = e => { e.preventDefault(); openNas("#/prix/" + p.id); };
  $("#cmp").onclick = async () => {
    const b = $("#cmp"); b.disabled = true; b.textContent = "Recherche dans les boutiques…";
    const r = await bg({ type: "compare", pid: p.id, tabId: tab.id });
    if (r?.error) { out(esc(r.error), "err"); b.disabled = false; b.textContent = "Comparer les prix"; return; }
    paintProduct(r.product);
    out(r.found ? `${r.found} autre${r.found > 1 ? "s" : ""} boutique${r.found > 1 ? "s" : ""} trouvée${r.found > 1 ? "s" : ""} sur ${r.searched}` : r.searched ? `Ce produit n'a pas été trouvé ailleurs (${r.searched} boutique${r.searched > 1 ? "s" : ""} cherchée${r.searched > 1 ? "s" : ""})` : "Toutes tes boutiques de comparaison ont déjà ce produit", r.found ? "ok" : "");
  };
}

// --- Recherche ---------------------------------------------------------------------------------------
let timer;
$("#q").oninput = e => {
  clearTimeout(timer);
  const q = e.target.value.trim();
  if (q.length < 2) { $("#results").innerHTML = ""; return; }
  timer = setTimeout(async () => {
    try {
      const res = await call("/api/v1/ext/search?q=" + encodeURIComponent(q));
      $("#results").innerHTML = res.slice(0, 8).map(r => `<a class="item" href="#" data-l="${esc(r.link)}"><span class="grow"><b>${esc(r.title)}</b><br><span class="meta">${esc(r.sub || "")}</span></span></a>`).join("") || `<p class="meta">Aucun résultat</p>`;
    } catch (err) { $("#results").innerHTML = `<p class="meta">${esc(err.message)}</p>`; }
  }, 220);
};
$("#results").onclick = e => { const a = e.target.closest("[data-l]"); if (a) { e.preventDefault(); openNas(a.dataset.l); } };
$("#q").onkeydown = e => { if (e.key === "Enter") openNas("#/recherche?q=" + encodeURIComponent(e.target.value)); };

// --- Actions sur la page -------------------------------------------------------------------------
async function page(full = false) {
  try { return await chrome.tabs.sendMessage(tab.id, { type: "page", full }); } catch { return null; }
}

$("#actions").onclick = async e => {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const a = b.dataset.a;
  try {
    if (a === "drop") return chrome.tabs.create({ url: chrome.runtime.getURL("drop.html") });
    b.disabled = true;
    if (a === "video") { await call("/api/v1/ext/video", { json: { url: tab.url } }); out("Téléchargement lancé : la vidéo arrive dans Téléchargements.", "ok"); }
    if (a === "note") {
      const p = await page();
      const r = await call("/api/v1/ext/note", { json: { title: tab.title, url: tab.url, text: p?.selection || "" } });
      out(`Enregistré dans Bêta Notes. <a href="#" data-open="${esc(r.link)}">Ouvrir</a>`, "ok");
    }
    if (a === "price") {
      const p = await page();
      const r = await call("/api/v1/ext/prix/seen", { json: { url: tab.url, html: p?.html || "", follow: true } });
      if (!r.product) throw new Error("Pas de prix reconnu sur cette page");
      paintProduct(r.product); out("Prix suivi : je te préviens s'il baisse.", "ok");
    }
    if (a === "immo") {
      const p = await page(true);
      const r = await call("/api/v1/ext/immo", { json: { url: tab.url, html: p?.html || "" } });
      out(esc(r.warning || `Annonce suivie${r.listing.price ? " · " + eur(r.listing.price) : ""}`), r.warning ? "" : "ok");
    }
    if (a === "parcels") {
      const found = await chrome.tabs.sendMessage(tab.id, { type: "scan-parcels", patterns: status.parcel_patterns, context: status.parcel_context }).catch(() => null);
      if (!found?.length) out("Aucun numéro de suivi repéré sur cette page. Sélectionne-le puis clic droit › « Suivre le colis ».");
      else out(found.map(f => `<div class="row"><code class="grow">${esc(f.number)}</code><button class="btn" data-track="${esc(f.number)}">Suivre</button></div>`).join(""));
    }
  } catch (err) { out(esc(err.message), "err"); }
  b.disabled = false;
};
$("#out").onclick = async e => {
  const o = e.target.closest("[data-open]");
  if (o) { e.preventDefault(); return openNas(o.dataset.open); }
  const t = e.target.closest("[data-track]");
  if (!t) return;
  t.disabled = true;
  try { await call("/api/v1/ext/parcel", { json: { number: t.dataset.track, label: tab.title.slice(0, 60) } }); t.textContent = "✓ Suivi"; }
  catch (err) { t.textContent = err.message.slice(0, 40); }
};

// --- Mots de passe ---------------------------------------------------------------------------------
function vault() {
  const v = status.vault || {};
  $("#vault").innerHTML = v.on && v.url
    ? `Tes mots de passe sont dans <b>ton Coffre</b> sur le NAS (<code>${esc(v.url.replace(/^https?:\/\//, ""))}</code>). Pour les remplir et en créer en un clic, utilise l'extension <b>Bitwarden</b> (open source) reliée à ce coffre. <a href="#" id="vh">Comment faire ?</a>`
    : `Pour créer et remplir tes mots de passe en sécurité : active le <b>Coffre</b> (Vaultwarden) dans Bêta Tool, puis installe l'extension open source <b>Bitwarden</b>. <a href="#" id="vh">Comment faire ?</a>`;
  $("#vh").onclick = e => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL("options.html#mots-de-passe") }); };
}

init();
