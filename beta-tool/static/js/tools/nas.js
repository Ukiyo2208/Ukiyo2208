// Outil « Santé du NAS » (administrateurs) : disques et prévision, processeur, mémoire, températures, SMART, réseau.
import { $, esc, icon, toast, sizeStr } from "../ui.js";
import { api } from "../state.js";
import { pageHead } from "../main.js";

let timer = null;
const dfr = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const rate = b => b == null ? "—" : sizeStr(b) + "/s";
const level = (v, warn, bad) => v == null ? "" : v >= bad ? "bad" : v >= warn ? "warn" : "ok";

function since(s) {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

// Petite courbe des dernières 24 h (valeurs en %, ou en °C ramenées sur 0–100)
function line(values, max = 100) {
  const pts = values.map((v, i) => v == null ? null : [i / Math.max(1, values.length - 1) * 100, 40 - Math.min(1, v / max) * 38]).filter(Boolean);
  if (pts.length < 2) return `<div class="ns-line empty">Les courbes apparaissent après quelques relevés (toutes les 5 min).</div>`;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return `<svg class="ns-line" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${d}L100,40L0,40Z" class="area"/><path d="${d}" class="stroke"/></svg>`;
}

export async function render(root) {
  root.innerHTML = pageHead("nas", `<button class="btn ghost" id="ns-smart">${icon("refresh")}Tester les disques</button>`) + `<div id="ns-body"><div class="card empty">${icon("server")}Lecture des capteurs…</div></div>`;
  $("#ns-smart").onclick = async e => {
    e.currentTarget.disabled = true;
    try { await api("/api/nas/smart", { method: "POST" }); await load(); toast("État des disques relu"); }
    catch (err) { toast(err.message, "err"); }
    e.currentTarget.disabled = false;
  };
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (!$("#ns-body")) return clearInterval(timer); if (!document.hidden) load(true); }, 10000);
}

async function load(quiet) {
  let d;
  try { d = await api("/api/nas"); } catch (err) { if (!quiet) toast(err.message, "err"); return; }
  const el = $("#ns-body");
  if (!el) return;
  const probs = Object.values(d.problems || {});
  const maxT = d.temps.length ? Math.max(...d.temps.map(t => t.c)) : null;
  el.innerHTML = `
    <div class="card ns-state ${probs.length ? "bad" : "ok"}">${icon(probs.length ? "alert" : "check")}<div class="grow"><b>${probs.length ? "À surveiller" : "Tout va bien"}</b>
      <small class="meta">${probs.length ? probs.map(esc).join(" · ") : `${esc(d.host)} fonctionne depuis ${since(d.uptime)}`}</small></div></div>
    <div class="bg-kpis">
      <div class="card bg-kpi ns-kpi ${level(d.cpu, 70, 90)}"><small class="meta">Processeur · ${d.cores} cœur${d.cores > 1 ? "s" : ""}</small><b>${d.cpu ?? "—"} %</b><small class="meta">charge ${(d.load || []).map(x => x.toFixed(2)).join(" / ")}</small></div>
      <div class="card bg-kpi ns-kpi ${level(d.mem.pct, 85, d.settings.mem_pct)}"><small class="meta">Mémoire</small><b>${d.mem.pct ?? "—"} %</b><small class="meta">${sizeStr(d.mem.used)} sur ${sizeStr(d.mem.total)}${d.mem.swap_used ? ` · échange ${sizeStr(d.mem.swap_used)}` : ""}</small></div>
      <div class="card bg-kpi ns-kpi ${level(maxT, d.settings.temp - 10, d.settings.temp)}"><small class="meta">Température max.</small><b>${maxT != null ? Math.round(maxT) + " °C" : "—"}</b><small class="meta">${d.temps.length ? `${d.temps.length} capteur${d.temps.length > 1 ? "s" : ""}` : "aucun capteur lisible"}</small></div>
      <div class="card bg-kpi ns-kpi"><small class="meta">Réseau</small><b class="ns-net">↓ ${rate(d.net.rx)}</b><small class="meta">↑ ${rate(d.net.tx)}</small></div>
    </div>
    <div class="card"><div class="card-title">${icon("pie")}Disques</div><div class="ns-disks">${d.disks.map(k => {
      const f = k.forecast;
      return `<div class="ns-disk"><div class="row"><b class="grow">${esc(k.roots.join(", "))}</b><span class="cx-st ${level(k.pct, d.settings.disk_pct - 10, d.settings.disk_pct)}">${k.pct} %</span></div>
        <div class="bar"><div style="width:${k.pct}%"></div></div>
        <small class="meta"><span>${sizeStr(k.used)} utilisés sur ${sizeStr(k.total)}</span> · <span>${sizeStr(k.free)} libres</span></small>
        <small class="meta">${!f ? "Prévision disponible après 3 jours de relevés." : f.per_day <= 0 ? "L'espace utilisé ne grossit pas en ce moment." : `<span>+${sizeStr(f.per_month)} par mois</span>${f.full_on ? ` · <span>plein vers le</span> <b>${dfr(f.full_on)}</b> <span>(dans ${f.full_in} j)</span>` : " · <span>pas plein avant 10 ans</span>"}`}</small></div>`;
    }).join("") || `<p class="meta">Aucun dossier racine lisible.</p>`}</div></div>
    <div class="grid2 ns-grid">
      <div class="card"><div class="card-title">${icon("chart")}Dernières 24 heures</div>
        <small class="meta">Processeur (%)</small>${line(d.recent.map(r => r.cpu))}
        <small class="meta">Mémoire (%)</small>${line(d.recent.map(r => r.mem))}
        <small class="meta">Température max. (°C)</small>${line(d.recent.map(r => r.temp), 100)}</div>
      <div class="card"><div class="card-title">${icon("flame")}Températures</div>${d.temps.map(t => `<div class="bg-row"><span class="grow">${esc(t.name)}</span><span class="cx-st ${level(t.c, d.settings.temp - 10, d.settings.temp)}">${t.c} °C</span></div>`).join("") || `<p class="meta">Aucun capteur de température n'est visible depuis le conteneur.</p>`}
        <div class="card-title" style="margin-top:14px">${icon("list")}Programmes les plus gourmands</div>${d.processes.map(p => `<div class="bg-row"><span class="grow">${esc(p.name)}${p.count > 1 ? ` <small class="meta">×${p.count}</small>` : ""}</span><b>${sizeStr(p.rss)}</b></div>`).join("")}</div>
    </div>
    <div class="card"><div class="card-title">${icon("server")}État des disques (SMART)</div>${smartHTML(d.smart)}</div>
    <div class="card"><div class="card-title">${icon("bell")}Alertes</div>
      <form id="ns-set" class="ns-set">
        <label class="check"><input type="checkbox" name="on" ${d.settings.on ? "checked" : ""}> Me prévenir quand quelque chose ne va pas (et quand ça revient)</label>
        <div class="grid3"><div><label class="field">Disque plein à (%)</label><input type="number" name="disk_pct" min="50" max="99" value="${d.settings.disk_pct}"></div>
          <div><label class="field">Température max. (°C)</label><input type="number" name="temp" min="40" max="110" value="${d.settings.temp}"></div>
          <div><label class="field">Mémoire pleine à (%)</label><input type="number" name="mem_pct" min="50" max="100" value="${d.settings.mem_pct}"></div></div>
        <label class="check"><input type="checkbox" name="smart" ${d.settings.smart ? "checked" : ""}> Prévenir si un disque montre des signes d'usure (SMART)</label>
      </form><small class="meta">Système : ${esc(d.kernel)}</small></div>`;
  $("#ns-set").onchange = async e => {
    const f = e.currentTarget;
    try { await api("/api/nas/settings", { method: "PUT", json: { on: f.on.checked, smart: f.smart.checked, disk_pct: f.disk_pct.value, temp: f.temp.value, mem_pct: f.mem_pct.value } }); toast("Seuils enregistrés"); }
    catch (err) { toast(err.message, "err"); }
  };
}

function smartHTML(s) {
  if (!s) return `<p class="meta">Pas encore lu : clique sur « Tester les disques ».</p>`;
  if (!s.available) return `<p class="meta">smartctl n'est pas installé dans le conteneur. Pour voir l'usure des disques, ajoute le paquet <code>smartmontools</code> et donne au conteneur l'accès aux disques (<code>privileged: true</code> ou <code>devices: /dev/sda</code>). Le NAS UGREEN affiche aussi cet état dans son propre panneau Stockage.</p>`;
  if (!s.disks.length) return `<p class="meta">Aucun disque accessible : le conteneur n'a pas l'accès aux périphériques (<code>/dev/sd…</code>, <code>/dev/nvme…</code>).</p>`;
  return s.disks.map(x => {
    const bad = x.passed === false || x.reallocated > 0 || x.pending > 0;
    return `<div class="bg-row"><span class="cx-st ${x.passed == null ? "off" : bad ? "bad" : "ok"}">${x.passed == null ? "Inconnu" : bad ? "À surveiller" : "Bon"}</span>
      <span class="grow bg-lbl"><b>${esc(x.model || x.dev)}</b><small class="meta">${[esc(x.dev), x.capacity && sizeStr(x.capacity), x.hours != null && `${Math.round(x.hours / 24).toLocaleString("fr-FR")} jours d'allumage`,
        x.temp != null && `${x.temp} °C`, x.wear != null && `usure ${x.wear} %`, x.reallocated && `${x.reallocated} secteurs réalloués`, x.pending && `${x.pending} secteurs en attente`].filter(Boolean).join(" · ")}</small></span></div>`;
  }).join("");
}
