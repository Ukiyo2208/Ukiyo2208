// Outil « Recettes » : carnet, fiche avec portions ajustables, mode cuisine, liste de courses partagée.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago, state } from "../state.js";
import { pageHead } from "../main.js";

let timer = null, cats = [], filter = { cat: "", q: "" }, wake = null;
const mins = m => !m ? "" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
const imgOf = r => r.image ? `/api/recipes/${r.id}/image${r.image_v ? "?v=" + r.image_v : ""}` : "";

// --- Quantités : « 200 g de farine » × 1,5 → « 300 g de farine » ---------------
const FRAC = { "½": .5, "¼": .25, "¾": .75, "⅓": 1 / 3, "⅔": 2 / 3 };
function fmt(n) {
  if (n >= 10) return String(Math.round(n));
  const near = [[.25, "¼"], [.5, "½"], [.75, "¾"], [1 / 3, "⅓"], [2 / 3, "⅔"]];
  const whole = Math.floor(n), rest = n - whole;
  const f = near.find(([v]) => Math.abs(rest - v) < .04);
  if (f && whole < 4) return (whole ? whole + " " : "") + f[1];
  return String(Math.round(n * 10) / 10).replace(".", ",");
}
export function scale(line, k) {
  if (k === 1) return line;
  return line.replace(/^(\s*)(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])(?:\s*(?:-|à)\s*(\d+(?:[.,]\d+)?))?/, (all, sp, a, b) => {
    const val = s => FRAC[s] ?? (s.includes("/") ? s.split("/").map(x => parseFloat(x)).reduce((x, y) => x / y) : parseFloat(s.replace(",", ".")));
    const v = val(a.replace(/\s/g, ""));
    if (!isFinite(v)) return all;
    return sp + fmt(v * k) + (b ? "-" + fmt(parseFloat(b.replace(",", ".")) * k) : "");
  });
}

export async function render(root, parts) {
  if (parts[0] && parts[0] !== "courses") return detail(root, parts[0]);
  const tab = parts[0] === "courses" ? "courses" : "recettes";
  const [d, s] = await Promise.all([api("/api/recipes"), api("/api/shopping")]);
  cats = d.categories;
  const left = s.items.filter(i => !i.checked).length;
  root.innerHTML = pageHead("recettes", `<button class="btn ghost" id="rc-new">${icon("plus")}Nouvelle recette</button>`) + `
    <nav class="tabs"><a href="#/recettes" class="${tab === "recettes" ? "on" : ""}">${icon("utensils")}Recettes <span class="count">${d.recipes.length}</span></a>
      <a href="#/recettes/courses" class="${tab === "courses" ? "on" : ""}">${icon("cart")}Liste de courses ${left ? `<span class="count">${left}</span>` : ""}</a></nav>
    <div id="rc-body"></div>`;
  $("#rc-new").onclick = () => edit(null);
  tab === "courses" ? shoppingView($("#rc-body"), s) : list($("#rc-body"), d.recipes);
}

function list(el, all) {
  const shown = all.filter(r => (!filter.cat || r.category === filter.cat) && (!filter.q || (r.title + " " + r.ingredients.join(" ")).toLowerCase().includes(filter.q)));
  el.innerHTML = `<form class="card rc-import" id="rc-import"><span class="tile rose">${icon("link")}</span>
      <input type="text" name="url" class="grow" placeholder="Colle le lien d'une recette (Marmiton, 750g, Cuisine AZ, Ptitchef, CuisineActuelle…)" required>
      <button class="btn">${icon("download")}Importer</button></form>
    <div class="rc-bar"><div class="search-box grow">${icon("search")}<input type="search" id="rc-q" placeholder="Chercher une recette ou un ingrédient (ex. « poulet », « chocolat »)" value="${esc(filter.q)}"></div>
      <div class="chips">${["", ...cats].filter(c => !c || all.some(r => r.category === c)).map(c => `<button class="chip ${filter.cat === c ? "on" : ""}" data-cat="${esc(c)}">${c || "Toutes"}</button>`).join("")}</div></div>
    ${shown.length ? `<div class="rc-grid">${shown.map(r => `<a class="card rc-card" href="#/recettes/${r.id}">
        <div class="rc-img">${r.image ? `<img src="${imgOf(r)}" alt="" loading="lazy">` : icon("utensils")}
          ${r.favorite ? `<span class="rc-fav">${icon("heart")}</span>` : ""}</div>
        <div class="rc-info"><b>${esc(r.title)}</b><small class="meta">${esc(r.category || "")}${r.total || r.prep || r.cook ? ` · ${icon("timer")} ${mins(r.total || (r.prep || 0) + (r.cook || 0))}` : ""} · ${r.servings || "?"} pers.</small></div></a>`).join("")}</div>`
      : `<div class="card"><div class="empty">${icon("utensils")}<b>${all.length ? "Aucune recette ne correspond" : "Ton carnet de recettes est vide"}</b>
          ${all.length ? "" : "Colle le lien d'une recette trouvée sur Internet : ingrédients, étapes et photo sont récupérés automatiquement."}</div></div>`}`;
  $("#rc-import").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn");
    btn.disabled = true;
    try { const r = await api("/api/recipes/import", { json: { url: e.target.url.value } }); toast(`« ${r.title} » ajoutée`); location.hash = "#/recettes/" + r.id; }
    catch (err) { toast(err.message, "err"); }
    btn.disabled = false;
  };
  el.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { filter.cat = b.dataset.cat; list(el, all); });
  let t;
  $("#rc-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value.trim().toLowerCase(); list(el, all); const i = $("#rc-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
}

async function detail(root, id) {
  const { recipes } = await api("/api/recipes");
  const r = recipes.find(x => x.id === id);
  if (!r) { root.innerHTML = `<div class="empty">${icon("utensils")}Recette introuvable.</div>`; return; }
  let servings = r.servings || 4;
  root.innerHTML = `<a class="back" href="#/recettes">${icon("back")}Recettes</a>
    <div class="rc-hero card">${r.image ? `<img src="${imgOf(r)}" alt="">` : `<div class="rc-noimg">${icon("utensils")}</div>`}
      <div class="rc-hero-txt"><span class="chip">${esc(r.category || "Recette")}</span><h1>${esc(r.title)}</h1>
        ${r.description ? `<p>${esc(r.description)}</p>` : ""}
        <div class="rc-times">${r.prep ? `<span>${icon("clock")}Préparation <b>${mins(r.prep)}</b></span>` : ""}${r.cook ? `<span>${icon("flame")}Cuisson <b>${mins(r.cook)}</b></span>` : ""}
          ${r.total && r.total !== (r.prep || 0) + (r.cook || 0) ? `<span>${icon("timer")}Total <b>${mins(r.total)}</b></span>` : ""}</div>
        <div class="row" style="margin:14px 0 0;flex-wrap:wrap">
          <button class="btn" id="rc-cook">${icon("play")}Mode cuisine</button>
          <button class="btn ghost" id="rc-fav">${icon("heart")}${r.favorite ? "Favori" : "Ajouter aux favoris"}</button>
          <button class="icon-btn" id="rc-edit" title="Modifier">${icon("edit")}</button>
          ${r.source ? `<a class="icon-btn" href="${esc(r.source)}" target="_blank" rel="noopener" title="Recette d'origine">${icon("external")}</a>` : ""}
          <button class="icon-btn" id="rc-del" title="Supprimer">${icon("trash")}</button></div></div></div>
    <div class="rc-cols">
      <div class="card rc-ingr"><div class="card-title">${icon("cart")}Ingrédients
          <span class="rc-serv"><button class="icon-btn plain" data-s="-1">−</button><b id="rc-n">${servings}</b> pers.<button class="icon-btn plain" data-s="1">+</button></span></div>
        <ul id="rc-ingr"></ul>
        <button class="btn ghost wide" id="rc-shop">${icon("cart")}Ajouter à la liste de courses</button></div>
      <div class="card rc-steps"><div class="card-title">${icon("list")}Préparation</div>
        <ol class="tuto">${r.steps.map(s => `<li><span class="rc-step">${timers(esc(s))}</span></li>`).join("") || "<p class='hint'>Aucune étape.</p>"}</ol>
        ${r.notes ? `<div class="intro"><span class="tile ambre">${icon("notebook")}</span><p>${esc(r.notes)}</p></div>` : ""}</div>
    </div>`;
  const paint = () => {
    const k = servings / (r.servings || servings);
    $("#rc-n").textContent = servings;
    $("#rc-ingr").innerHTML = r.ingredients.map((i, n) => `<li><label class="check"><input type="checkbox" data-i="${n}" checked> ${esc(scale(i, k))}</label></li>`).join("");
  };
  paint();
  root.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { servings = Math.max(1, servings + +b.dataset.s); paint(); });
  $("#rc-shop").onclick = async () => {
    const k = servings / (r.servings || servings);
    const items = [...root.querySelectorAll("#rc-ingr input:checked")].map(cb => scale(r.ingredients[cb.dataset.i], k));
    if (!items.length) return toast("Coche au moins un ingrédient", "err");
    await api("/api/shopping", { json: { items, recipe: r.title } });
    toast(`${items.length} ingrédient${items.length > 1 ? "s" : ""} ajouté${items.length > 1 ? "s" : ""} à la liste de courses`);
  };
  $("#rc-fav").onclick = async () => { await api(`/api/recipes/${id}`, { method: "PUT", json: { favorite: !r.favorite } }); detail(root, id); };
  $("#rc-edit").onclick = () => edit(r);
  $("#rc-del").onclick = () => {
    const m = modal(`Supprimer « ${r.title} » ?`, `<div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
    m.querySelector("[data-ok]").onclick = async () => { await api(`/api/recipes/${id}`, { method: "DELETE" }); closePanel(); location.hash = "#/recettes"; };
  };
  $("#rc-cook").onclick = () => cook(r, servings);
  root.addEventListener("click", e => { const t = e.target.closest("[data-timer]"); if (t) startTimer(+t.dataset.timer, t.dataset.label); });
}

/** Repère les durées dans une étape (« cuire 25 minutes ») et en fait des minuteurs. */
function timers(html) {
  return html.replace(/(\d+)\s*(?:à\s*\d+\s*)?(min(?:utes?)?|h(?:eures?)?)\b/gi, (all, n, u) => {
    const secs = /^h/i.test(u) ? n * 3600 : n * 60;
    return `<button class="rc-timer" data-timer="${secs}" data-label="${esc(all)}">${icon("timer")}${all}</button>`;
  });
}

let timersRunning = [];
function startTimer(secs, label) {
  const end = Date.now() + secs * 1000;
  const id = Math.random().toString(36).slice(2);
  timersRunning.push({ id, end, label });
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  paintTimers();
  toast(`Minuteur lancé : ${label}`);
}
function paintTimers() {
  let box = $("#rc-timers");
  if (!box) { box = document.createElement("div"); box.id = "rc-timers"; document.body.append(box); }
  const now = Date.now();
  timersRunning.forEach(t => {
    if (t.end <= now && !t.rang) {
      t.rang = true;
      try { const a = new AudioContext(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => o.stop(), 900); } catch {}
      if ("Notification" in window && Notification.permission === "granted") new Notification("Minuteur terminé ⏰", { body: t.label, icon: "/brand/icon-192.png" });
      toast(`⏰ Minuteur terminé : ${t.label}`);
    }
  });
  box.innerHTML = timersRunning.map(t => {
    const left = Math.max(0, Math.round((t.end - now) / 1000));
    return `<div class="rc-tm ${left ? "" : "done"}">${icon("timer")}<b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</b><span>${esc(t.label)}</span>
      <button class="icon-btn plain" data-stop="${t.id}">${icon("x")}</button></div>`;
  }).join("");
  box.onclick = e => { const b = e.target.closest("[data-stop]"); if (b) { timersRunning = timersRunning.filter(t => t.id !== b.dataset.stop); paintTimers(); } };
  clearTimeout(paintTimers.t);
  if (timersRunning.length) paintTimers.t = setTimeout(paintTimers, 1000);
}

async function cook(r, servings) {
  const k = servings / (r.servings || servings);
  let i = 0;
  const el = document.createElement("div");
  el.className = "rc-cookmode";
  document.body.append(el);
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  const paint = () => {
    el.innerHTML = `<div class="rc-cm-head"><b>${esc(r.title)}</b><span class="meta">Étape ${i + 1} sur ${r.steps.length}</span>
        <button class="icon-btn" data-a="close" title="Quitter">${icon("x")}</button></div>
      <div class="rc-cm-body"><aside><h3>Ingrédients · ${servings} pers.</h3><ul>${r.ingredients.map(x => `<li>${esc(scale(x, k))}</li>`).join("")}</ul></aside>
        <div class="rc-cm-step"><span class="rc-cm-num">${i + 1}</span><p>${timers(esc(r.steps[i] || "Bon appétit !"))}</p></div></div>
      <div class="rc-cm-foot"><button class="btn ghost" data-a="prev" ${i ? "" : "disabled"}>${icon("left")}Précédente</button>
        <div class="rc-cm-dots">${r.steps.map((_, n) => `<span class="${n === i ? "on" : n < i ? "done" : ""}"></span>`).join("")}</div>
        ${i < r.steps.length - 1 ? `<button class="btn" data-a="next">Suivante${icon("right")}</button>` : `<button class="btn" data-a="close">${icon("check")}Terminé</button>`}</div>`;
  };
  const close = () => { el.remove(); wake?.release?.(); wake = null; removeEventListener("keydown", key); };
  const key = e => { if (e.key === "ArrowRight" && i < r.steps.length - 1) { i++; paint(); } if (e.key === "ArrowLeft" && i) { i--; paint(); } if (e.key === "Escape") close(); };
  addEventListener("keydown", key);
  el.onclick = e => {
    const t = e.target.closest("[data-timer]");
    if (t) return startTimer(+t.dataset.timer, t.dataset.label);
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "next") i++;
    if (a === "prev") i--;
    if (a === "close") return close();
    paint();
  };
  // balayage gauche / droite sur téléphone
  let x0 = null;
  el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (dx < -60 && i < r.steps.length - 1) { i++; paint(); }
    if (dx > 60 && i) { i--; paint(); }
    x0 = null;
  });
  paint();
}

function edit(r) {
  const isNew = !r;
  r = r || { title: "", category: "Plat", servings: 4, ingredients: [], steps: [], notes: "" };
  const m = modal(isNew ? "Nouvelle recette" : "Modifier la recette", `<form class="rc-form">
    <label class="field">Titre</label><input type="text" name="title" value="${esc(r.title)}" required placeholder="Ex. Gratin dauphinois de mamie">
    <div class="grid2">
      <div><label class="field">Catégorie</label><select name="category" style="width:100%">${cats.map(c => `<option ${c === r.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div><label class="field">Personnes</label><input type="number" name="servings" min="1" max="99" value="${r.servings || 4}"></div>
      <div><label class="field">Préparation (min)</label><input type="number" name="prep" min="0" value="${r.prep ?? ""}"></div>
      <div><label class="field">Cuisson (min)</label><input type="number" name="cook" min="0" value="${r.cook ?? ""}"></div>
    </div>
    <label class="field">Ingrédients <span class="meta">(un par ligne, avec la quantité au début : « 200 g de farine »)</span></label>
    <textarea name="ingredients" rows="7">${esc(r.ingredients.join("\n"))}</textarea>
    <label class="field" style="margin-top:12px">Étapes <span class="meta">(une par ligne)</span></label>
    <textarea name="steps" rows="7">${esc(r.steps.join("\n"))}</textarea>
    <label class="field" style="margin-top:12px">Notes</label><textarea name="notes" rows="2" placeholder="Astuces, variantes…">${esc(r.notes || "")}</textarea>
    <label class="btn ghost small" style="margin-top:12px"><input type="file" name="photo" accept="image/*" hidden>${icon("camera")}${r.image ? "Changer la photo" : "Ajouter une photo"}</label>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "utensils", large: true });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const data = { title: f.title.value, category: f.category.value, servings: f.servings.value, prep: f.prep.value, cook: f.cook.value,
                   ingredients: f.ingredients.value, steps: f.steps.value, notes: f.notes.value };
    try {
      const saved = await api(isNew ? "/api/recipes" : `/api/recipes/${r.id}`, { method: isNew ? "POST" : "PUT", json: data });
      if (f.photo.files[0]) {
        const fd = new FormData();
        fd.append("file", f.photo.files[0]);
        await api(`/api/recipes/${saved.id}/image`, { method: "POST", body: fd });
      }
      closePanel();
      toast("Recette enregistrée");
      if (location.hash === "#/recettes/" + saved.id) window.dispatchEvent(new HashChangeEvent("hashchange"));
      else location.hash = "#/recettes/" + saved.id;
    } catch (err) { toast(err.message, "err"); }
  };
}

// --- Liste de courses ---------------------------------------------------------
function shoppingView(el, s) {
  let last = s.updated;
  const paint = s => {
    const byAisle = {};
    s.items.filter(i => !i.checked).forEach(i => (byAisle[i.aisle] ||= []).push(i));
    const done = s.items.filter(i => i.checked);
    el.innerHTML = `<form class="card rc-add" id="rc-add"><input type="text" name="text" class="grow" placeholder="Ajouter un article (ex. « 6 œufs », « lessive »)" autocomplete="off">
        <button class="btn">${icon("plus")}Ajouter</button></form>
      ${s.items.length ? "" : `<div class="card"><div class="empty">${icon("cart")}<b>Liste vide</b>Ajoute des articles ici, ou les ingrédients d'une recette en un clic. La liste est partagée : tout le monde à la maison la voit à jour, même au magasin.</div></div>`}
      ${s.aisles.filter(a => byAisle[a]).map(a => `<div class="home-cat">${esc(a)}</div><div class="card rc-shop">${byAisle[a].map(item).join("")}</div>`).join("")}
      ${done.length ? `<div class="home-cat rc-done-head">Dans le panier (${done.length})<button class="btn ghost small" id="rc-clear">${icon("trash")}Retirer</button></div>
        <div class="card rc-shop done">${done.map(item).join("")}</div>` : ""}`;
    $("#rc-add").onsubmit = async e => {
      e.preventDefault();
      const v = e.target.text.value.trim();
      if (!v) return;
      const ns = await api("/api/shopping", { json: { items: v.split(/\s*[,;]\s*/) } });
      last = ns.updated;
      paint(ns);
      $("#rc-add input").focus();
    };
    $("#rc-clear")?.addEventListener("click", async () => { const ns = await api("/api/shopping?which=checked", { method: "DELETE" }); last = ns.updated; paint(ns); });
    el.querySelectorAll("[data-item]").forEach(row => {
      row.querySelector("input").onchange = async e => { const ns = await api(`/api/shopping/${row.dataset.item}`, { method: "PUT", json: { checked: e.target.checked } }); last = ns.updated; paint(ns); };
      row.querySelector("[data-del]").onclick = async () => { const ns = await api(`/api/shopping/${row.dataset.item}`, { method: "DELETE" }); last = ns.updated; paint(ns); };
    });
  };
  const item = i => {
    const meta = [i.recipe, i.by !== state.config.user.name ? "ajouté par " + i.by : ""].filter(Boolean).join(" · ");
    return `<div class="rc-item" data-item="${i.id}"><label class="check grow"><input type="checkbox" ${i.checked ? "checked" : ""}>
      <span class="rc-it"><span class="rc-tx">${esc(i.text)}</span>${meta ? `<small class="meta">${esc(meta)}</small>` : ""}</span></label>
    <button class="icon-btn plain" data-del title="Supprimer">${icon("x")}</button></div>`;
  };
  paint(s);
  clearInterval(timer);
  timer = setInterval(async () => {  // synchronisation avec les autres appareils
    if (!document.body.contains(el) || !$("#rc-add")) return clearInterval(timer);
    if (document.activeElement?.closest("#rc-add") && $("#rc-add input").value) return;
    const ns = await api("/api/shopping").catch(() => null);
    if (ns && ns.updated !== last) { last = ns.updated; paint(ns); }
  }, 3000);
}

export function leave() { clearInterval(timer); }
