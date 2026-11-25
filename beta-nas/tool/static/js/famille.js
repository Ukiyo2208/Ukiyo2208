// Réglages › Famille : règles des comptes enfants (outils permis, heures, temps d'écran).
import { esc, icon, toast } from "./ui.js";
import { TOOLS } from "./registry.js";
import { api } from "./state.js";

export async function settingsTab(el) {
  const d = await api("/api/famille");
  const tools = TOOLS.filter(t => d.tools.includes(t.id) && !t.admin);
  el.innerHTML = `<div class="intro"><span class="tile violet">${icon("users")}</span><p>Un <b>compte enfant</b> ne voit que les outils que tu choisis, seulement aux heures permises,
      avec un temps d'écran par jour. Le temps n'est compté que quand Bêta Tool est ouvert et utilisé. Pour créer un compte enfant : onglet <a href="#/reglages/comptes">Comptes</a>, rôle « Enfant ».</p></div>
    ${d.children.length ? d.children.map(c => {
      const r = c.rules, s = c.state, max = Math.max(30, ...c.week.map(w => w.min));
      return `<form class="card fm-child" data-child="${esc(c.name)}">
        <div class="card-title"><span class="avatar">${esc(c.name[0].toUpperCase())}</span>${esc(c.name)}
          <span class="grow"></span><small class="meta">${s.blocked ? `${icon("lock")}Bloqué en ce moment` : s.remaining != null ? `${s.remaining} min restantes aujourd'hui` : "Pas de limite"}</small></div>
        <div><label class="field">Outils permis</label><div class="fm-tools">${tools.map(t => `<label class="check"><input type="checkbox" name="tools" value="${t.id}" ${r.tools.includes(t.id) ? "checked" : ""}> ${esc(t.name)}</label>`).join("")}</div></div>
        <div class="grid2"><div><label class="field">En semaine</label><div class="fm-hours"><input type="time" name="w0" value="${r.week[0]}"> à <input type="time" name="w1" value="${r.week[1]}"></div></div>
          <div><label class="field">Le week-end</label><div class="fm-hours"><input type="time" name="e0" value="${r.weekend[0]}"> à <input type="time" name="e1" value="${r.weekend[1]}"></div></div></div>
        <div class="grid2"><div><label class="field">Temps d'écran par jour</label><select name="limit" style="width:100%">${[...new Set([0, 30, 45, 60, 90, 120, 180, 240, r.limit])].sort((a, b) => a - b).map(m => `<option value="${m}" ${m === r.limit ? "selected" : ""}>${m ? `${m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`}` : "Pas de limite"}</option>`).join("")}</select></div>
          <div><label class="field">Aujourd'hui : ${s.used} min</label><div class="fm-hours"><button type="button" class="btn ghost small" data-bonus="15">+15 min</button><button type="button" class="btn ghost small" data-bonus="30">+30 min</button><button type="button" class="btn ghost small" data-bonus="60">+1 h</button></div></div></div>
        <div><label class="field">Les 7 derniers jours</label><div class="fm-week">${c.week.map(w => `<span title="${w.min} min"><i style="height:${(w.min / max * 100).toFixed(0)}%"></i>${new Date(w.day + "T12:00").toLocaleDateString("fr-FR", { weekday: "narrow" })}</span>`).join("")}</div></div>
        <div class="fm-hours"><span class="grow"></span><button class="btn">${icon("check")}Enregistrer</button></div></form>`;
    }).join("") : `<div class="card empty">${icon("users")}<b>Aucun compte enfant</b>Crée un compte dans l'onglet <a href="#/reglages/comptes">Comptes</a> et choisis le rôle « Enfant ».</div>`}`;
  el.querySelectorAll("[data-child]").forEach(f => {
    const name = f.dataset.child;
    f.onsubmit = async e => {
      e.preventDefault();
      try {
        await api(`/api/famille/${encodeURIComponent(name)}`, { method: "PUT", json: {
          tools: [...f.querySelectorAll("[name=tools]:checked")].map(i => i.value), week: [f.w0.value, f.w1.value], weekend: [f.e0.value, f.e1.value], limit: +f.limit.value } });
        toast(`Règles de ${name} enregistrées`); settingsTab(el);
      } catch (err) { toast(err.message, "err"); }
    };
    f.querySelectorAll("[data-bonus]").forEach(b => b.onclick = async () => {
      await api(`/api/famille/${encodeURIComponent(name)}`, { method: "PUT", json: { bonus: +b.dataset.bonus } });
      toast(`${b.textContent} pour ${name} aujourd'hui`); settingsTab(el);
    });
  });

}
