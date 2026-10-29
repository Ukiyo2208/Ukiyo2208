// Outil « Agenda » : vues mois / semaine / à venir, agendas partagés, synchronisation des téléphones.
import { $, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, enabled } from "../state.js";
import { pageHead } from "../main.js";
import { connect, editAccount, PROVIDER_ICON } from "../accounts.js";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const RECUR = [["", "Ne se répète pas"], ["daily", "Tous les jours"], ["weekly", "Toutes les semaines"], ["monthly", "Tous les mois"], ["yearly", "Tous les ans"]];
const REMIND = [["", "Aucun rappel"], ["0", "À l'heure de l'événement"], ["10", "10 minutes avant"], ["30", "30 minutes avant"], ["60", "1 heure avant"], ["120", "2 heures avant"], ["1440", "La veille"], ["10080", "Une semaine avant"]];
const REMIND_DAY = [["", "Aucun rappel"], ["-480", "Le jour même à 8h"], ["300", "La veille à 19h"], ["960", "La veille à 8h"], ["2400", "2 jours avant à 8h"], ["9600", "Une semaine avant à 8h"]];
const WEEK = [["MO", "L", "lundi"], ["TU", "M", "mardi"], ["WE", "M", "mercredi"], ["TH", "J", "jeudi"], ["FR", "V", "vendredi"], ["SA", "S", "samedi"], ["SU", "D", "dimanche"]];
const NTH = ["", "1er", "2e", "3e", "4e", "dernier"];
const simpleRule = r => !r || (r.interval === 1 && !r.byday?.length && r.monthly !== "nth" && !r.until && !r.count);

/** Panneau « Personnaliser la répétition » (fréquence, jours, fin). */
function repeatPanel(rep, startDay) {
  const r = rep || { freq: "WEEKLY", interval: 1, byday: [WEEK[(startDay.getDay() + 6) % 7][0]], monthly: "date" };
  const nth = Math.floor((startDay.getDate() - 1) / 7) + 1, last = addDays(startDay, 7).getMonth() !== startDay.getMonth();
  const wd = WEEK[(startDay.getDay() + 6) % 7][2];
  return `<div class="ag-rep">
    <div class="row"><span>Tous les</span><input type="number" name="r_int" min="1" max="99" value="${r.interval || 1}">
      <select name="r_freq">${[["DAILY", "jour(s)"], ["WEEKLY", "semaine(s)"], ["MONTHLY", "mois"], ["YEARLY", "an(s)"]].map(([v, l]) => `<option value="${v}" ${r.freq === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="ag-days" data-for="WEEKLY">${WEEK.map(([v, l, n]) => `<label title="${n}"><input type="checkbox" name="r_day" value="${v}" ${(r.byday || []).includes(v) ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
    <div class="ag-month" data-for="MONTHLY"><label class="check"><input type="radio" name="r_month" value="date" ${r.monthly !== "nth" ? "checked" : ""}> Le ${startDay.getDate()} du mois</label>
      <label class="check"><input type="radio" name="r_month" value="nth" ${r.monthly === "nth" ? "checked" : ""}> Le ${nth >= 5 ? "dernier" : NTH[nth]} ${wd} du mois</label>
      ${last && nth < 5 ? `<label class="check"><input type="radio" name="r_month" value="last" ${r.monthly === "nth" && r.nth === -1 ? "checked" : ""}> Le dernier ${wd} du mois</label>` : ""}</div>
    <div class="row"><span>Fin</span><select name="r_end"><option value="">Jamais</option><option value="until" ${r.until ? "selected" : ""}>Le…</option><option value="count" ${r.count ? "selected" : ""}>Après…</option></select>
      <input type="date" name="r_until" value="${r.until || ""}" ${r.until ? "" : "hidden"}><input type="number" name="r_count" min="1" max="999" value="${r.count || 10}" ${r.count ? "" : "hidden"}><span data-cnt ${r.count ? "" : "hidden"}>fois</span></div></div>`;
}

function readRepeat(f) {
  const freq = f.r_freq.value, m = f.querySelector("[name=r_month]:checked")?.value;
  return { freq, interval: +f.r_int.value || 1, byday: freq === "WEEKLY" ? [...f.querySelectorAll("[name=r_day]:checked")].map(x => x.value) : [],
    monthly: freq === "MONTHLY" && m !== "date" ? "nth" : "date", nth: m === "last" ? -1 : undefined,
    until: f.r_end.value === "until" ? f.r_until.value : null, count: f.r_end.value === "count" ? +f.r_count.value : null };
}
let view = "mois", cursor = new Date(), info = null, hidden = new Set();
try { hidden = new Set(JSON.parse(localStorage.getItem("bt-agenda-hidden") || "[]")); view = localStorage.getItem("bt-agenda-view") || "mois"; } catch {}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const hm = s => s.slice(11, 16).replace(":", "h").replace(/^0/, "");
const sameDay = (a, b) => iso(a) === iso(b);

export async function render(root, parts, query) {
  if (query?.date) { cursor = new Date(query.date + "T12:00"); history.replaceState(null, "", "#/agenda"); }
  info = await api("/api/agenda");
  root.innerHTML = pageHead("agenda", `<button class="btn ghost" id="ag-sync">${icon("phone")}Synchroniser</button>
    <button class="btn" id="ag-new">${icon("plus")}Événement</button>`) + `
    <div class="ag-layout">
      <aside class="ag-side card">
        <div class="card-title">${icon("calendar")}Mes agendas</div>
        <div id="ag-cals"></div>
        <button class="btn ghost small wide" id="ag-addcal">${icon("plus")}Nouvel agenda</button>
        <button class="btn ghost small wide" style="margin-top:6px" id="ag-bins">${icon("trash")}Poubelles et collectes</button>
        <label class="btn ghost small wide" style="margin-top:6px"><input type="file" accept=".ics,text/calendar" hidden id="ag-import">${icon("upload")}Importer un .ics</label>
        <div class="card-title ag-ext-title">${icon("globe")}Agendas raccordés</div>
        <div id="ag-ext"></div>
        <button class="btn ghost small wide" id="ag-connect">${icon("plus")}Raccorder un agenda</button>
        <p class="hint ag-ext-hint">iCloud, Google, Outlook, Nextcloud, jours fériés…</p>
      </aside>
      <div class="ag-main">
        <div class="ag-bar">
          <button class="icon-btn" data-nav="-1" title="Précédent">${icon("left")}</button>
          <button class="btn ghost small" data-nav="0">Aujourd'hui</button>
          <button class="icon-btn" data-nav="1" title="Suivant">${icon("right")}</button>
          <h2 id="ag-title"></h2>
          <div class="seg" id="ag-view">${[["mois", "Mois"], ["semaine", "Semaine"], ["liste", "À venir"]].map(([v, l]) =>
            `<label><input type="radio" name="agv" value="${v}" ${view === v ? "checked" : ""}>${l}</label>`).join("")}</div>
        </div>
        <div id="ag-view-body" class="card ag-body"></div>
      </div>
    </div>`;
  paintCals();
  $("#ag-new").onclick = () => edit({ start: iso(cursor) + "T" + nextHour() });
  $("#ag-sync").onclick = syncPanel;
  if (query?.sync) { history.replaceState(null, "", "#/agenda"); syncPanel(); }
  $("#ag-addcal").onclick = addCalendar;
  $("#ag-bins").onclick = binsPanel;
  $("#ag-import").onchange = importIcs;
  $("#ag-connect").onclick = () => connect({ want: "cal", onDone: reloadCals });
  $("#ag-view").onchange = e => { view = e.target.value; try { localStorage.setItem("bt-agenda-view", view); } catch {} paint(); };
  root.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
    const n = +b.dataset.nav;
    if (!n) cursor = new Date();
    else if (view === "mois") cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
    else cursor = addDays(cursor, n * (view === "semaine" ? 7 : 30));
    paint();
  });
  paint();
}

const nextHour = () => `${String(Math.min(23, new Date().getHours() + 1)).padStart(2, "0")}:00`;

function paintCals() {
  const local = info.calendars.filter(c => !c.external);
  const ext = info.calendars.filter(c => c.external);
  const line = c => `<label class="ag-cal"><input type="checkbox" data-cal="${c.id}" ${hidden.has(c.id) ? "" : "checked"}>
      <span class="ag-dot" style="background:${c.color}"></span><span class="grow">${esc(c.name)}${c.shared ? ` <small class="meta">· partagé</small>` : ""}
      ${c.external ? `<small class="meta ag-acc">${icon(PROVIDER_ICON[c.provider] || "globe")}${esc(c.account_label || "")}${c.readonly ? " · lecture seule" : ""}</small>` : ""}</span>
      ${c.error ? `<span class="ag-warn" title="${esc(c.error)}">${icon("alert")}</span>` : ""}
      ${c.external ? `<button class="icon-btn plain" data-editacc="${c.account}" title="Réglages du compte">${icon("settings")}</button>`
        : c.readonly ? "" : `<button class="icon-btn plain" data-editcal="${c.id}" title="Modifier">${icon("settings")}</button>`}</label>`;
  $("#ag-cals").innerHTML = [...local, ...(enabled("contacts") ? [{ id: "_anniversaires", name: "Anniversaires (Contacts)", color: "#ec4899", readonly: true },
      { id: "_fetes", name: "Fêtes des prénoms (Contacts)", color: "#a855f7", readonly: true }] : []),
    { id: "_paperasse", name: "Échéances (Paperasse)", color: "#f59e0b", readonly: true }].map(line).join("");
  $("#ag-ext").innerHTML = ext.map(line).join("");
  $(".ag-ext-hint").hidden = ext.length > 0;
  for (const box of [$("#ag-cals"), $("#ag-ext")]) {
    box.onchange = e => {
      const id = e.target.dataset.cal;
      e.target.checked ? hidden.delete(id) : hidden.add(id);
      try { localStorage.setItem("bt-agenda-hidden", JSON.stringify([...hidden])); } catch {}
      paint();
    };
    box.onclick = async e => {
      const b = e.target.closest("[data-editcal]");
      if (b) { e.preventDefault(); return editCalendar(info.calendars.find(c => c.id === b.dataset.editcal)); }
      const a = e.target.closest("[data-editacc]");
      if (a) {
        e.preventDefault();
        const acc = (await api("/api/accounts")).accounts.find(x => x.id === a.dataset.editacc);
        if (acc) editAccount(acc, reloadCals);
      }
    };
  }
}

async function reloadCals() {
  info = await api("/api/agenda");
  paintCals();
  paint();
}

async function paint() {
  const body = $("#ag-view-body");
  if (!body) return;
  let start, end, title;
  if (view === "mois") {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    start = monday(first); end = addDays(start, 42);
    title = first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  } else if (view === "semaine") {
    start = monday(cursor); end = addDays(start, 7);
    title = `${start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${addDays(end, -1).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
  } else {
    start = new Date(new Date().toDateString()); end = addDays(start, 90);
    title = "Les 3 prochains mois";
  }
  $("#ag-title").textContent = title.charAt(0).toUpperCase() + title.slice(1);
  const evs = (await api(`/api/agenda/events?start=${iso(start)}&end=${iso(end)}`)).filter(e => !hidden.has(e.cal));
  if (info.calendars.some(c => c.external)) {  // erreurs des agendas raccordés (mot de passe changé…)
    const fresh = await api("/api/agenda").catch(() => null);
    if (fresh && JSON.stringify(fresh.calendars.map(c => c.error)) !== JSON.stringify(info.calendars.map(c => c.error))) { info = fresh; paintCals(); }
  }
  ({ mois: month, semaine: week, liste: upcoming })[view](body, evs, start);
  body.onclick = e => {
    const ev = e.target.closest("[data-ev]");
    if (ev) { e.stopPropagation(); return open(evs[+ev.dataset.ev]); }
    const day = e.target.closest("[data-day]");
    if (day) edit({ start: day.dataset.day + "T" + (day.dataset.hour || nextHour()) });
  };
}

function chip(e, i, withTime = true) {
  return `<button class="ag-chip ${e.allday ? "allday" : ""} ${e.paid ? "paid" : ""}" data-ev="${i}" style="--c:${e.color}" title="${esc(e.title)}">
    ${withTime && !e.allday ? `<b>${hm(e.start)}</b>` : ""}${e.recur ? icon("refresh") : ""}${esc(e.title)}</button>`;
}

function month(body, evs, start) {
  const today = new Date();
  const m = cursor.getMonth();
  let html = `<div class="ag-month"><div class="ag-head">${DAYS.map(d => `<span>${d}</span>`).join("")}</div><div class="ag-grid">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), key = iso(d);
    const list = evs.map((e, n) => [e, n]).filter(([e]) => e.start.slice(0, 10) <= key && (e.end.slice(0, 10) > key || e.start.slice(0, 10) === key
      || (!e.allday && e.end.slice(0, 10) === key && e.end.slice(11) !== "00:00:00")));
    html += `<div class="ag-day ${d.getMonth() !== m ? "out" : ""} ${sameDay(d, today) ? "today" : ""}" data-day="${key}">
      <span class="ag-num">${d.getDate()}</span>
      ${list.slice(0, 3).map(([e, n]) => chip(e, n)).join("")}${list.length > 3 ? `<button class="ag-more" data-more="${key}">+${list.length - 3}</button>` : ""}</div>`;
  }
  body.innerHTML = html + "</div></div>";
  body.querySelectorAll("[data-more]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const key = b.dataset.more;
    const list = evs.map((x, n) => [x, n]).filter(([x]) => x.start.slice(0, 10) <= key && (x.end.slice(0, 10) > key || x.start.slice(0, 10) === key
      || (!x.allday && x.end.slice(0, 10) === key && x.end.slice(11) !== "00:00:00")));
    const mm = modal(new Date(key + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
      `<div class="ag-daylist">${list.map(([x, n]) => chip(x, n)).join("")}</div>`, { ic: "calendar" });
    mm.onclick = ev2 => { const c = ev2.target.closest("[data-ev]"); if (c) { closePanel(); setTimeout(() => open(evs[+c.dataset.ev]), 250); } };
  });
}

function week(body, evs, start) {
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const H0 = 6, H1 = 23, PX = 44;
  const today = new Date();
  body.innerHTML = `<div class="ag-week">
    <div class="ag-wrow ag-whead"><span></span>${days.map(d => `<span class="${sameDay(d, today) ? "today" : ""}">${DAYS[(d.getDay() + 6) % 7]} <b>${d.getDate()}</b></span>`).join("")}</div>
    <div class="ag-wrow ag-allday"><span class="meta">Journée</span>${days.map(d => `<div data-day="${iso(d)}">${evs.map((e, n) => [e, n])
      .filter(([e]) => e.allday && e.start.slice(0, 10) <= iso(d) && (e.end.slice(0, 10) > iso(d) || e.start.slice(0, 10) === iso(d))).map(([e, n]) => chip(e, n, false)).join("")}</div>`).join("")}</div>
    <div class="ag-wscroll"><div class="ag-wgrid" style="height:${(H1 - H0) * PX}px">
      <div class="ag-hours">${[...Array(H1 - H0)].map((_, h) => `<span style="top:${h * PX}px">${H0 + h}h</span>`).join("")}</div>
      ${days.map(d => `<div class="ag-col ${sameDay(d, today) ? "today" : ""}">
        ${[...Array(H1 - H0)].map((_, h) => `<div class="ag-slot" style="top:${h * PX}px;height:${PX}px" data-day="${iso(d)}" data-hour="${String(H0 + h).padStart(2, "0")}:00"></div>`).join("")}
        ${lanes(evs.map((e, n) => [e, n]).filter(([e]) => !e.allday && e.start.slice(0, 10) === iso(d))).map(({ e, n, lane, of }) => {
          const s = new Date(e.start), en = new Date(e.end);
          const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - H0) * PX), h = Math.max(22, (en - s) / 3600000 * PX);
          return `<button class="ag-wev" data-ev="${n}" style="top:${top}px;height:${h}px;left:calc(${lane / of * 100}% + 2px);width:calc(${100 / of}% - 4px);--c:${e.color}"><b>${esc(e.title)}</b><small>${hm(e.start)} – ${hm(e.end)}${e.location ? " · " + esc(e.location) : ""}</small></button>`;
        }).join("")}
        ${sameDay(d, today) ? `<div class="ag-now" style="top:${(today.getHours() + today.getMinutes() / 60 - H0) * PX}px"></div>` : ""}</div>`).join("")}
    </div></div></div>`;
  const sc = body.querySelector(".ag-wscroll");
  sc.scrollTop = (Math.max(H0, Math.min(today.getHours() - 1, 17)) - H0) * PX;
}

/** Événements qui se chevauchent : côte à côte, chacun dans sa colonne. */
function lanes(list) {
  const items = list.map(([e, n]) => ({ e, n, s: new Date(e.start).getTime(), t: new Date(e.end).getTime() })).sort((a, b) => a.s - b.s || b.t - a.t);
  let group = [], groupEnd = 0;
  const flush = () => { const of = Math.max(...group.map(g => g.lane)) + 1; group.forEach(g => { g.of = of; }); group = []; };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) flush();
    const used = group.filter(g => g.t > it.s).map(g => g.lane);
    it.lane = [...Array(group.length + 1).keys()].find(l => !used.includes(l));
    group.push(it);
    groupEnd = Math.max(groupEnd, it.t);
  }
  if (group.length) flush();
  return items;
}

function upcoming(body, evs) {
  if (!evs.length) { body.innerHTML = `<div class="empty">${icon("calendar")}<b>Rien de prévu</b>Ajoute un événement, ou synchronise ton téléphone pour retrouver ton agenda ici.</div>`; return; }
  const groups = {};
  evs.forEach((e, n) => (groups[e.start.slice(0, 10)] ||= []).push([e, n]));
  body.innerHTML = Object.entries(groups).map(([day, list]) => {
    const d = new Date(day + "T12:00");
    const rel = sameDay(d, new Date()) ? "Aujourd'hui" : sameDay(d, addDays(new Date(), 1)) ? "Demain" : "";
    return `<div class="ag-lday"><div class="ag-ldate"><b>${d.getDate()}</b><span>${d.toLocaleDateString("fr-FR", { weekday: "short", month: "short" })}</span></div>
      <div class="grow">${rel ? `<div class="home-cat" style="margin:0 0 6px">${rel}</div>` : ""}${list.map(([e, n]) => `<button class="ag-lev" data-ev="${n}" style="--c:${e.color}">
        <span class="ag-time">${e.allday ? "Journée" : `${hm(e.start)}<small>${hm(e.end)}</small>`}</span>
        <span class="grow"><b>${esc(e.title)}</b><small class="meta">${[e.location, e.shared ? "Famille" : "", e.recur ? (e.recur_text || "répété") : "", e.reminder != null ? "rappel" : ""].filter(Boolean).map(esc).join(" · ")}</small></span></button>`).join("")}</div></div>`;
  }).join("");
}

function open(e) {
  if (e.readonly) { if (e.link) location.hash = e.link; else details(e); return; }
  edit(e);
}

function details(e) {
  const c = info.calendars.find(x => x.id === e.cal);
  const d1 = new Date(e.start), d2 = new Date(e.end);
  const day = d => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const when = e.allday ? (iso(d1) === iso(addDays(d2, -1)) || iso(d1) === iso(d2) ? day(d1) : `${day(d1)} → ${day(addDays(d2, -1))}`)
    : `${day(d1)}, ${hm(e.start)} – ${hm(e.end)}`;
  modal(e.title, `<div class="ag-details">
    <p>${icon("clock")}<span>${when.charAt(0).toUpperCase() + when.slice(1)}</span></p>
    ${e.location ? `<p>${icon("pin")}<span>${esc(e.location)}</span></p>` : ""}
    ${c ? `<p><span class="ag-dot" style="background:${c.color}"></span><span>${esc(c.name)} <small class="meta">· ${esc(c.account_label || "")}</small></span></p>` : ""}
    ${e.notes ? `<p class="ag-notes">${esc(e.notes)}</p>` : ""}
    <p class="hint">${icon("lock")} Agenda en lecture seule : modifie cet événement chez ${esc(c?.account_label || "ton fournisseur")}.</p></div>`, { ic: "calendar" });
}

/** Formulaire d'un événement ; exporté pour Mails (« Ajouter à l'agenda ») et Ma journée. */
export async function newEvent(prefill = {}, after) {
  if (!info) info = await api("/api/agenda");
  edit(prefill, after);
}

function edit(e, after) {
  const isNew = !e.uid;
  const cals = info.calendars.filter(c => !c.readonly);
  const allday = !!e.allday;
  const sd = (e.start || iso(new Date()) + "T09:00").slice(0, 16), ed = (e.end || "").slice(0, 16);
  const endDefault = ed || (() => { const d = new Date(sd); d.setHours(d.getHours() + 1); return iso(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); })();
  const endDay = allday && ed ? iso(addDays(new Date(ed.slice(0, 10) + "T12:00"), ed.slice(11) === "00:00" ? -1 : 0)) : sd.slice(0, 10);
  const recurSel = e.repeat && !simpleRule(e.repeat) ? "more" : e.recur === "custom" && !e.repeat ? "custom" : (e.recur && e.recur !== "custom" ? e.recur : e.repeat ? e.repeat.freq.toLowerCase() : "");
  const remOpts = day => (day ? REMIND_DAY : REMIND);
  const remVal = String(e.reminder ?? (isNew ? (allday ? "" : "30") : ""));
  const m = modal(isNew ? "Nouvel événement" : "Modifier l'événement", `<form class="ag-form">
    <input type="text" name="title" class="ag-title-in" value="${esc(e.title || "")}" placeholder="Titre (ex. Dentiste, Anniversaire de Léa…)" required>
    <label class="check"><input type="checkbox" name="allday" ${allday ? "checked" : ""}> Toute la journée</label>
    <div class="grid2 ag-dates">
      <div><label class="field">Début</label><input type="datetime-local" name="start" value="${sd}" data-t><input type="date" name="startd" value="${sd.slice(0, 10)}" data-d></div>
      <div><label class="field">Fin</label><input type="datetime-local" name="end" value="${endDefault}" data-t><input type="date" name="endd" value="${endDay}" data-d></div>
    </div>
    <div class="grid2">
      <div><label class="field">Agenda</label><select name="cal" style="width:100%">${cals.map(c => `<option value="${c.id}" ${c.id === (e.cal || "personnel") ? "selected" : ""}>${esc(c.name)}${c.shared ? " (partagé)" : c.external ? ` (${esc(c.account_label)})` : ""}</option>`).join("")}</select></div>
      <div><label class="field">Rappel</label><select name="reminder" style="width:100%"></select></div>
      <div><label class="field">Répétition</label><select name="recur" style="width:100%">${RECUR.map(([v, l]) => `<option value="${v}" ${recurSel === v ? "selected" : ""}>${l}</option>`).join("")}
        <option value="more" ${recurSel === "more" ? "selected" : ""}>${recurSel === "more" && e.recur_text ? esc(e.recur_text) : "Personnaliser…"}</option>
        ${recurSel === "custom" ? `<option value="custom" selected>${esc(e.recur_text || "Personnalisée")} (gardée)</option>` : ""}</select></div>
      <div><label class="field">Lieu</label><input type="text" name="location" value="${esc(e.location || "")}"></div>
    </div>
    <div class="ag-rep-wrap" hidden></div>
    <label class="field">Notes</label><textarea name="notes" rows="2">${esc(e.notes || "")}</textarea>
    ${e.recur ? `<p class="hint">${icon("refresh")} Événement répété : la modification s'applique à toutes les occurrences.</p>` : ""}
    <div class="modal-foot">${isNew ? "" : `<button type="button" class="btn danger ghost" data-a="del">${icon("trash")}</button>`}
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "calendar", large: true });
  const f = m.querySelector("form");
  const wrap = m.querySelector(".ag-rep-wrap");
  const startDay = () => new Date((f.allday.checked ? f.startd.value : f.start.value.slice(0, 10)) + "T12:00");
  const fillRem = keep => {
    const opts = remOpts(f.allday.checked), cur = keep ?? f.reminder.value;
    f.reminder.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")
      + (cur && !opts.some(o => o[0] === cur) ? `<option value="${cur}" selected>${Math.abs(+cur) >= 60 ? Math.round(+cur / 60) + " h" : cur + " min"} ${+cur < 0 ? "après le début" : "avant"}</option>` : "");
  };
  const showRep = () => {
    wrap.hidden = f.recur.value !== "more";
    if (!wrap.hidden && !wrap.innerHTML) wrap.innerHTML = repeatPanel(e.repeat && !simpleRule(e.repeat) ? e.repeat : null, startDay());
    if (wrap.hidden) return;
    const fr = f.r_freq.value;
    wrap.querySelectorAll("[data-for]").forEach(x => { x.hidden = x.dataset.for !== fr; });
    f.r_until.hidden = f.r_end.value !== "until";
    f.r_count.hidden = wrap.querySelector("[data-cnt]").hidden = f.r_end.value !== "count";
  };
  const sync = () => {
    m.querySelectorAll("[data-t]").forEach(x => { x.hidden = f.allday.checked; });
    m.querySelectorAll("[data-d]").forEach(x => { x.hidden = !f.allday.checked; });
  };
  f.allday.onchange = () => { sync(); fillRem(f.allday.checked ? "" : "30"); };
  sync();
  fillRem(remVal);
  showRep();
  f.recur.addEventListener("change", showRep);
  wrap.addEventListener("change", showRep);
  f.start.addEventListener("change", () => {  // garde la même durée quand on déplace le début
    const s = new Date(f.start.value), en = new Date(f.end.value);
    if (en <= s) { const d = new Date(s.getTime() + 3600000); f.end.value = iso(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  });
  f.title.focus();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const day = f.allday.checked;
    const data = { title: f.title.value, allday: day, start: day ? f.startd.value : f.start.value, end: day ? f.endd.value : f.end.value,
      cal: f.cal.value, reminder: f.reminder.value, recur: f.recur.value, location: f.location.value, notes: f.notes.value,
      orig_start: e.start, category: e.category || "" };
    if (f.recur.value === "more") {
      data.repeat = readRepeat(f);
      data.recur = data.repeat.freq.toLowerCase();
      if (data.repeat.freq === "WEEKLY" && !data.repeat.byday.length) return toast("Choisis au moins un jour de la semaine", "err");
    }
    try {
      const r = await api(isNew ? "/api/agenda/events" : `/api/agenda/events/${encodeURIComponent(e.uid)}`, { method: isNew ? "POST" : "PUT", json: data });
      closePanel();
      toast(isNew ? "Événement ajouté" : "Événement modifié");
      if (after) return after(r);
      cursor = new Date((day ? f.startd.value : f.start.value.slice(0, 10)) + "T12:00");
      paint();
    } catch (err) { toast(err.message, "err"); }
  };
  m.querySelector("[data-a=del]")?.addEventListener("click", async () => {
    if (e.recur && !confirm("Supprimer toutes les occurrences de cet événement répété ?")) return;
    await api(`/api/agenda/events/${encodeURIComponent(e.uid)}`, { method: "DELETE" });
    closePanel();
    toast("Événement supprimé");
    paint();
  });
}

// --- Rendez-vous réguliers : poubelles… -----------------------------------------------------------

const BINS = [["🗑️", "Ordures ménagères"], ["♻️", "Emballages (bac jaune)"], ["🍾", "Verre"], ["📰", "Papiers"], ["🌿", "Déchets verts"], ["🛋️", "Encombrants"], ["🥕", "Biodéchets"]];

function binsPanel() {
  const shared = info.calendars.find(c => c.shared && !c.external) || info.calendars.find(c => !c.readonly);
  const row = (i = 0) => `<div class="ag-bin">
    <select data-k="type">${BINS.map(([e, n], j) => `<option value="${j}" ${j === i ? "selected" : ""}>${e} ${n}</option>`).join("")}</select>
    <select data-k="day">${WEEK.map(([v, , n]) => `<option value="${v}">le ${n}</option>`).join("")}</select>
    <select data-k="freq"><option value="1">chaque semaine</option><option value="even">les semaines paires</option><option value="odd">les semaines impaires</option>
      <option value="1st">le 1er du mois</option><option value="2nd">le 2e du mois</option><option value="3rd">le 3e du mois</option><option value="4th">le 4e du mois</option><option value="last">le dernier du mois</option></select>
    <button type="button" class="icon-btn plain" data-rm title="Retirer">${icon("x")}</button></div>`;
  const m = modal("Rendez-vous réguliers : poubelles", `<form class="ag-bins">
    <p class="hint" style="margin-top:0">Indique les jours de collecte de ta commune : Bêta Tool crée les rendez-vous et te prévient la veille au soir. Si ta commune publie un calendrier en ligne (.ics), tu peux aussi le raccorder (« Raccorder un agenda »).</p>
    <div id="ag-bin-rows">${row(0)}${row(1)}</div>
    <button type="button" class="btn ghost small" data-addbin>${icon("plus")}Ajouter une collecte</button>
    <div class="grid2" style="margin-top:12px">
      <div><label class="field">Agenda</label><select name="cal" style="width:100%">${info.calendars.filter(c => !c.readonly).map(c => `<option value="${c.id}" ${c.id === shared?.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label class="field">Rappel</label><select name="reminder" style="width:100%">${REMIND_DAY.map(([v, l]) => `<option value="${v}" ${v === "300" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Créer les rendez-vous</button></div></form>`, { ic: "refresh", large: true });
  m.addEventListener("click", ev => {
    if (ev.target.closest("[data-addbin]")) m.querySelector("#ag-bin-rows").insertAdjacentHTML("beforeend", row(2));
    const rm = ev.target.closest("[data-rm]");
    if (rm) rm.closest(".ag-bin").remove();
  });
  m.querySelector("form").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, rows = [...m.querySelectorAll(".ag-bin")];
    if (!rows.length) return toast("Ajoute au moins une collecte", "err");
    try {
      for (const r of rows) {
        const [emoji, name] = BINS[+r.querySelector("[data-k=type]").value];
        const dayCode = r.querySelector("[data-k=day]").value, freq = r.querySelector("[data-k=freq]").value;
        let d = new Date(); d.setHours(12, 0, 0, 0);
        const target = WEEK.findIndex(w => w[0] === dayCode);
        while ((d.getDay() + 6) % 7 !== target) d = addDays(d, 1);  // prochain jour de collecte
        let repeat;
        if (freq === "1") repeat = { freq: "WEEKLY", interval: 1, byday: [dayCode] };
        else if (freq === "even" || freq === "odd") {
          const week = dd => { const t = new Date(Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7); };
          if ((week(d) % 2 === 0) !== (freq === "even")) d = addDays(d, 7);
          repeat = { freq: "WEEKLY", interval: 2, byday: [dayCode] };
        } else {
          const n = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, last: -1 }[freq];
          d = new Date(d.getFullYear(), d.getMonth(), 1, 12);
          const firstOf = dd => { let x = new Date(dd); while ((x.getDay() + 6) % 7 !== target) x = addDays(x, 1); return x; };
          const pick = month => { const f1 = firstOf(month); if (n > 0) return addDays(f1, 7 * (n - 1)); let x = f1; while (addDays(x, 7).getMonth() === f1.getMonth()) x = addDays(x, 7); return x; };
          d = pick(d);
          if (d < new Date(new Date().toDateString())) d = pick(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12));
          repeat = { freq: "MONTHLY", interval: 1, monthly: "nth", nth: n };
        }
        await api("/api/agenda/events", { json: { title: `${emoji} ${name}`, allday: true, start: iso(d), end: iso(d), cal: f.cal.value,
          reminder: f.reminder.value, recur: "custom", repeat, category: "Poubelles", notes: "Sortir le bac la veille au soir." } });
      }
      closePanel();
      toast(`${rows.length} collecte${rows.length > 1 ? "s" : ""} ajoutée${rows.length > 1 ? "s" : ""} à l'agenda`);
      paint();
    } catch (err) { toast(err.message, "err"); }
  };
}

function addCalendar() {
  const m = modal("Nouvel agenda", `<form><label class="field">Nom</label><input type="text" name="name" required placeholder="Ex. Travail, Sport, Enfants">
    <label class="field" style="margin-top:12px">Couleur</label><div class="ag-colors">${info.colors.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i === 2 ? "checked" : ""}><span style="background:${c}"></span></label>`).join("")}</div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Créer</button></div></form>`, { ic: "calendar" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/agenda/calendars", { json: { name: e.target.name.value, color: e.target.color.value } }); closePanel(); info = await api("/api/agenda"); paintCals(); paint(); }
    catch (err) { toast(err.message, "err"); }
  };
}

function editCalendar(c) {
  const m = modal(c.name, `<form><label class="field">Nom</label><input type="text" name="name" value="${esc(c.name)}" required>
    <label class="field" style="margin-top:12px">Couleur</label><div class="ag-colors">${info.colors.map(col => `<label><input type="radio" name="color" value="${col}" ${col === c.color ? "checked" : ""}><span style="background:${col}"></span></label>`).join("")}</div>
    ${c.shared ? `<p class="hint">Agenda partagé par toute la maison : le nom et la couleur changent pour tout le monde.</p>` : ""}
    <div class="modal-foot">${c.shared ? "" : `<button type="button" class="btn danger ghost" data-a="del">${icon("trash")}Supprimer</button>`}
      <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">${icon("check")}Enregistrer</button></div></form>`, { ic: "calendar" });
  m.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    await api(`/api/agenda/calendars/${c.id}`, { method: "PUT", json: { name: e.target.name.value, color: e.target.color.value } });
    closePanel(); info = await api("/api/agenda"); paintCals(); paint();
  };
  m.querySelector("[data-a=del]")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer l'agenda « ${c.name} » et tous ses événements ?`)) return;
    try { await api(`/api/agenda/calendars/${c.id}`, { method: "DELETE" }); closePanel(); info = await api("/api/agenda"); paintCals(); paint(); }
    catch (err) { toast(err.message, "err"); }
  });
}

async function importIcs(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("cal", "personnel");
  try { const r = await api("/api/agenda/import", { method: "POST", body: fd }); toast(`${r.imported} événement${r.imported > 1 ? "s" : ""} importé${r.imported > 1 ? "s" : ""} dans Personnel`); paint(); }
  catch (err) { toast(err.message, "err"); }
}

function syncPanel() {
  const server = `${location.origin}/dav/`;
  const m = modal("Synchroniser avec ton téléphone", `<div class="ag-sync">
    ${info.radicale ? "" : `<div class="intro" style="margin-top:0"><span class="tile ambre">${icon("alert")}</span><p>Le serveur de synchronisation (Radicale) n'est pas installé : reconstruis l'image Docker ou installe la mise à jour.</p></div>`}
    <p class="hint" style="margin-top:0">Tes agendas Bêta Tool apparaissent dans l'appli Calendrier du téléphone, et ce que tu y ajoutes revient ici. Dans les deux sens, automatiquement.</p>
    <dl class="kv ag-creds">
      <dt>Serveur</dt><dd><code>${esc(server)}</code> <button class="icon-btn plain" data-copy="${esc(server)}">${icon("copy")}</button></dd>
      <dt>Identifiant</dt><dd><code>${esc(info.sync.login)}</code> <button class="icon-btn plain" data-copy="${esc(info.sync.login)}">${icon("copy")}</button></dd>
      <dt>Mot de passe</dt><dd id="ag-pw">${info.sync.configured ? `<span class="meta">déjà créé (masqué)</span>` : ""} <button class="btn small" id="ag-genpw">${icon("key")}${info.sync.configured ? "En créer un nouveau" : "Créer le mot de passe"}</button></dd>
    </dl>
    <p class="hint">C'est un mot de passe propre à l'agenda, différent de celui du site. En recréer un déconnecte les appareils déjà configurés.</p>
    <details class="formats" open><summary>${icon("phone")}iPhone et iPad</summary><ol class="tuto">
      <li><b>Réglages → Calendrier → Comptes → Ajouter un compte</b><span>Choisis « Autre », puis « Ajouter un compte CalDAV ».</span></li>
      <li><b>Remplis les champs</b><span>Serveur : <code>${esc(location.host)}</code>, puis l'identifiant et le mot de passe ci-dessus.</span></li>
      <li><b>Ouvre l'appli Calendrier</b><span>Les agendas « Personnel » et « Famille » apparaissent.</span></li></ol></details>
    <details class="formats"><summary>${icon("phone")}Android</summary><ol class="tuto">
      <li><b>Installe DAVx⁵</b><span>Gratuit et open source (Play Store ou F-Droid).</span></li>
      <li><b>Ajouter un compte → Connexion avec URL et nom d'utilisateur</b><span>URL : <code>${esc(server)}</code>, puis l'identifiant et le mot de passe.</span></li>
      <li><b>Coche les agendas à synchroniser</b><span>Ils apparaissent dans Google Agenda et dans l'appli Agenda du téléphone.</span></li></ol></details>
    <details class="formats"><summary>${icon("monitor")}Ordinateur (Thunderbird, Calendrier macOS, Outlook…)</summary>
      <p class="hint">Ajoute un agenda « réseau » ou « CalDAV » avec l'adresse du serveur, l'identifiant et le mot de passe.</p></details>
    ${location.protocol === "http:" ? `<p class="hint">${icon("alert")} Hors de chez toi, utilise une adresse en https:// (proxy inversé du NAS ou Tailscale) pour que le mot de passe circule chiffré.</p>` : ""}
    <p class="hint">Synchronisation propulsée par <a href="https://radicale.org" target="_blank" rel="noopener">Radicale</a> (open source, GPL v3).</p></div>`, { ic: "phone", large: true });
  m.addEventListener("click", async ev => {
    const c = ev.target.closest("[data-copy]");
    if (c) { await navigator.clipboard.writeText(c.dataset.copy).catch(() => {}); toast("Copié"); }
  });
  m.querySelector("#ag-genpw").onclick = async () => {
    const r = await api("/api/agenda/sync-password", { json: {} });
    info.sync.configured = true;
    m.querySelector("#ag-pw").innerHTML = `<code class="ag-pwd">${esc(r.password)}</code> <button class="icon-btn plain" data-copy="${esc(r.password)}">${icon("copy")}</button>
      <small class="meta" style="display:block">Note-le maintenant : il ne sera plus affiché.</small>`;
  };
}
