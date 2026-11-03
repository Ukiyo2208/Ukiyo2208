import { call } from "./lib.js";
const $ = s => document.querySelector(s);
const f = $("#f");
const q = new URLSearchParams(location.search);
const text = q.get("text") || "";
f.notes.value = text + (q.get("url") ? `\n\n${q.get("url")}` : "");
f.allday.onchange = () => { $("#t").hidden = f.allday.checked; };
(async () => {
  try {
    const g = await call("/api/v1/ext/event-guess", { json: { text } });
    f.title.value = g.title || text.slice(0, 100);
    if (g.start) {
      f.date.value = g.start.slice(0, 10);
      f.allday.checked = !!g.allday;
      if (!g.allday) f.time.value = g.start.slice(11, 16);
    }
  } catch (e) { f.title.value = text.slice(0, 100); $("#msg").innerHTML = `<div class="msg err">${e.message}</div>`; }
  $("#t").hidden = f.allday.checked;
})();
f.onsubmit = async e => {
  e.preventDefault();
  try {
    await call("/api/v1/ext/event", { json: { title: f.title.value, allday: f.allday.checked, start: f.allday.checked ? f.date.value : `${f.date.value}T${f.time.value}`,
      minutes: f.minutes.value, location: f.location.value, notes: f.notes.value } });
    $("#msg").innerHTML = `<div class="msg ok">Ajouté à l'Agenda.</div>`;
    setTimeout(() => window.close(), 900);
  } catch (err) { $("#msg").innerHTML = `<div class="msg err">${err.message}</div>`; }
};
