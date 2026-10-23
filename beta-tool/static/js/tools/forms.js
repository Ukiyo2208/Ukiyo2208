// Outil « Questionnaires » : liste, éditeur, résultats.
import { $, $$, esc, icon, toast, modal, closePanel } from "../ui.js";
import { api, ago } from "../state.js";
import { pageHead } from "../main.js";
import { svg as qrSvg, BRAND_LOGO } from "../qrcode.js";

const TYPES = {
  text: ["Réponse courte", "type"], paragraph: ["Paragraphe", "list"], email: ["E-mail", "mail"], number: ["Nombre", "hash2"],
  date: ["Date", "calendar"], choice: ["Choix unique", "check"], checkbox: ["Cases à cocher", "list"], dropdown: ["Liste déroulante", "menu"],
  scale: ["Échelle", "sliders"], rating: ["Note (étoiles)", "star"], yesno: ["Oui / Non", "check"],
};
const CHOICES = ["choice", "checkbox", "dropdown"];
const TEMPLATES = [["vide", "Vide", "plus"], ["sondage", "Sondage", "chart"], ["inscription", "Inscription", "users"], ["avis", "Avis / satisfaction", "star"], ["contact", "Contact", "mail"]];
let F = null, saveTimer = null;

export async function render(root, parts) {
  if (parts[0] && parts[1] === "reponses") return results(root, parts[0]);
  if (parts[0]) return editor(root, parts[0]);
  return list(root);
}

const publicUrl = id => `${location.origin}/f/${id}`;

// --- Liste ------------------------------------------------------------------
async function list(root) {
  const all = await api("/api/forms");
  root.innerHTML = pageHead("questionnaires") + `
    <div class="card"><div class="card-title">${icon("plus")}Nouveau questionnaire</div>
      <div class="tpls">${TEMPLATES.map(([k, l, ic]) => `<button class="tpl" data-tpl="${k}"><span class="tile vert">${icon(ic)}</span>${l}</button>`).join("")}</div></div>
    <div class="card"><div class="card-title">${icon("form")}Mes questionnaires <span class="count">${all.length}</span></div>
      ${all.length ? all.map(f => `<div class="share" data-id="${f.id}">
        <span class="tile vert">${icon("form")}</span>
        <div class="txt"><b>${esc(f.title)}</b><small>${f.questions} question${f.questions > 1 ? "s" : ""} · modifié ${ago(f.updated || f.created)}</small></div>
        <span class="${f.open ? "pill-ok" : "pill-warn"}">${f.open ? "Ouvert" : "Fermé"}</span>
        <a class="btn small ghost" href="#/questionnaires/${f.id}/reponses">${icon("chart")}${f.responses} réponse${f.responses > 1 ? "s" : ""}</a>
        <a class="icon-btn plain" href="#/questionnaires/${f.id}/modifier" title="Modifier">${icon("edit")}</a>
        <button class="icon-btn plain" data-a="share" title="Partager">${icon("send")}</button>
        <button class="icon-btn plain" data-a="dup" title="Dupliquer">${icon("copy")}</button>
        <button class="icon-btn plain" data-a="del" title="Supprimer">${icon("trash")}</button></div>`).join("")
        : `<div class="empty">${icon("form")}Aucun questionnaire. Choisis un modèle ci-dessus pour commencer.</div>`}</div>`;
  root.querySelectorAll("[data-tpl]").forEach(b => b.onclick = async () => {
    const f = await api("/api/forms", { json: { template: b.dataset.tpl } });
    location.hash = `#/questionnaires/${f.id}/modifier`;
  });
  root.querySelectorAll("[data-id] [data-a]").forEach(b => b.onclick = async () => {
    const id = b.closest("[data-id]").dataset.id, f = all.find(x => x.id === id);
    if (b.dataset.a === "share") shareBox(id, f.title);
    if (b.dataset.a === "dup") { await api(`/api/forms/${id}/duplicate`, { json: {} }); list(root); }
    if (b.dataset.a === "del") {
      const m = modal("Supprimer ce questionnaire ?", `<p>« ${esc(f.title)} » et ses ${f.responses} réponse(s) seront supprimés définitivement.</p>
        <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" data-ok>${icon("trash")}Supprimer</button></div>`, { ic: "trash" });
      m.querySelector("[data-ok]").onclick = async () => { await api(`/api/forms/${id}`, { method: "DELETE" }); closePanel(); list(root); };
    }
  });
}

function shareBox(id, title) {
  const url = publicUrl(id);
  const m = modal(`Partager « ${title} »`, `<div class="qr-big">${qrSvg(url, { px: 8, logo: BRAND_LOGO })}</div>
    <div class="copy-row"><input type="text" readonly value="${esc(url)}"><button class="btn small" data-copy>${icon("copy")}Copier</button></div>
    <div class="modal-foot"><a class="btn ghost" href="${url}" target="_blank" rel="noopener">${icon("external")}Ouvrir</a>
      <a class="btn ghost" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}">${icon("mail")}E-mail</a></div>`, { ic: "send" });
  m.querySelector("[data-copy]").onclick = async () => { await navigator.clipboard.writeText(url).catch(() => {}); toast("Lien copié"); };
}

// --- Éditeur ----------------------------------------------------------------
async function editor(root, id) {
  F = await api(`/api/forms/${id}`);
  root.innerHTML = `<a class="back" href="#/questionnaires">${icon("back")}Questionnaires</a>
    <div class="fe">
      <div>
        <div class="card fe-head" style="border-top:6px solid ${F.settings.color}">
          <input type="text" class="fe-title" id="fe-title" value="${esc(F.title)}" placeholder="Titre du questionnaire">
          <textarea class="fe-desc" id="fe-desc" placeholder="Description (optionnelle)">${esc(F.description)}</textarea>
        </div>
        <div id="fe-qs"></div>
        <div class="card fe-add"><span class="meta">Ajouter une question :</span>
          ${Object.entries(TYPES).map(([k, [l, ic]]) => `<button class="chip" data-add="${k}">${icon(ic)}${l}</button>`).join("")}</div>
      </div>
      <div class="fe-side">
        <div class="card"><div class="card-title">${icon("send")}Partage <span class="count" id="fe-saved">Enregistré</span></div>
          <div class="qr-mini center">${qrSvg(publicUrl(id), { px: 4, logo: BRAND_LOGO })}</div>
          <div class="copy-row"><input type="text" readonly value="${esc(publicUrl(id))}"><button class="btn small" data-copy>${icon("copy")}</button></div>
          <div class="row" style="margin:8px 0 0"><a class="btn small ghost" href="${publicUrl(id)}" target="_blank" rel="noopener">${icon("eye")}Aperçu</a>
            <a class="btn small" href="#/questionnaires/${id}/reponses">${icon("chart")}${F.responses} réponse${F.responses > 1 ? "s" : ""}</a></div></div>
        <div class="card"><div class="card-title">${icon("settings")}Réglages</div>
          <div class="set-row"><div class="txt"><b>Accepter les réponses</b></div><label class="switch"><input type="checkbox" data-s="open" ${F.settings.open ? "checked" : ""}><span></span></label></div>
          <div class="set-row"><div class="txt"><b>Me prévenir à chaque réponse</b></div><label class="switch"><input type="checkbox" data-s="notify" ${F.settings.notify ? "checked" : ""}><span></span></label></div>
          <label class="field" style="margin-top:12px">Fermer automatiquement le</label>
          <input type="date" data-s="closes_at" value="${F.settings.closes_at ? new Date(F.settings.closes_at * 1000).toISOString().slice(0, 10) : ""}" style="width:100%;margin-bottom:12px">
          <label class="field">Message après envoi</label><textarea data-s="confirmation" rows="2" style="min-height:60px">${esc(F.settings.confirmation || "")}</textarea>
          <label class="field" style="margin-top:12px">Couleur</label><input type="color" data-s="color" value="${F.settings.color}">
        </div>
      </div>
    </div>`;
  drawQuestions();
  $("#fe-title").oninput = e => { F.title = e.target.value; dirty(); };
  $("#fe-desc").oninput = e => { F.description = e.target.value; dirty(); };
  root.querySelector("[data-copy]").onclick = async () => { await navigator.clipboard.writeText(publicUrl(id)).catch(() => {}); toast("Lien copié"); };
  root.querySelectorAll("[data-s]").forEach(inp => inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
    const k = inp.dataset.s;
    F.settings[k] = inp.type === "checkbox" ? inp.checked : k === "closes_at" ? (inp.value ? new Date(inp.value + "T23:59").getTime() / 1000 : null) : inp.value;
    if (k === "color") $(".fe-head").style.borderTopColor = inp.value;
    dirty();
  }));
  root.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const type = b.dataset.add;
    F.questions.push({ id: Math.random().toString(16).slice(2, 10), type, label: "", required: false,
                       ...(CHOICES.includes(type) ? { options: ["Option 1", "Option 2"] } : {}), ...(type === "scale" ? { min: 1, max: 5 } : {}) });
    drawQuestions();
    dirty();
    $$(".fe-q").at(-1)?.querySelector(".fe-label")?.focus();
  });
}

function drawQuestions() {
  $("#fe-qs").innerHTML = F.questions.map((q, i) => `<div class="card fe-q" data-i="${i}">
    <div class="row" style="margin:0 0 10px">
      <input type="text" class="fe-label grow" data-f="label" value="${esc(q.label)}" placeholder="Intitulé de la question">
      <select data-f="type">${Object.entries(TYPES).map(([k, [l]]) => `<option value="${k}" ${k === q.type ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    ${CHOICES.includes(q.type) ? `<div class="fe-opts">${q.options.map((o, j) => `<div class="fe-opt"><span class="dot ${q.type}"></span>
        <input type="text" data-opt="${j}" value="${esc(o)}"><button class="icon-btn plain" data-rmopt="${j}" title="Retirer">${icon("x")}</button></div>`).join("")}
        <button class="btn small ghost" data-addopt>${icon("plus")}Ajouter une option</button>
        ${q.type !== "dropdown" ? `<label class="check" style="margin-left:10px"><input type="checkbox" data-f="other" ${q.other ? "checked" : ""}> Option « Autre »</label>` : ""}</div>` : ""}
    ${q.type === "scale" ? `<div class="row"><span class="meta">De</span><select data-f="min">${[0, 1].map(v => `<option ${q.min == v ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class="meta">à</span><select data-f="max">${[3, 4, 5, 6, 7, 8, 9, 10].map(v => `<option ${q.max == v ? "selected" : ""}>${v}</option>`).join("")}</select>
        <input type="text" data-f="min_label" value="${esc(q.min_label || "")}" placeholder="Libellé min." style="width:140px"><input type="text" data-f="max_label" value="${esc(q.max_label || "")}" placeholder="Libellé max." style="width:140px"></div>` : ""}
    <div class="fe-q-foot">
      <label class="check"><input type="checkbox" data-f="required" ${q.required ? "checked" : ""}> Obligatoire</label>
      <span class="grow"></span>
      <button class="icon-btn plain" data-mv="-1" title="Monter">▲</button><button class="icon-btn plain" data-mv="1" title="Descendre">▼</button>
      <button class="icon-btn plain" data-dupq title="Dupliquer">${icon("copy")}</button><button class="icon-btn plain" data-delq title="Supprimer">${icon("trash")}</button>
    </div></div>`).join("") || `<div class="card"><div class="empty">${icon("form")}Ajoute ta première question ci-dessous.</div></div>`;
  $("#fe-qs").oninput = $("#fe-qs").onchange = e => {
    const card = e.target.closest(".fe-q");
    if (!card) return;
    const q = F.questions[+card.dataset.i];
    const f = e.target.dataset.f;
    if (f) {
      q[f] = e.target.type === "checkbox" ? e.target.checked : ["min", "max"].includes(f) ? +e.target.value : e.target.value;
      if (f === "type" && e.type === "change") {
        if (CHOICES.includes(q.type) && !q.options) q.options = ["Option 1", "Option 2"];
        if (q.type === "scale") { q.min ??= 1; q.max ??= 5; }
        drawQuestions();
      }
    }
    if (e.target.dataset.opt != null) q.options[+e.target.dataset.opt] = e.target.value;
    dirty();
  };
  $("#fe-qs").onclick = e => {
    const card = e.target.closest(".fe-q");
    if (!card) return;
    const i = +card.dataset.i, q = F.questions[i];
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.addopt != null) q.options.push(`Option ${q.options.length + 1}`);
    else if (b.dataset.rmopt != null) { if (q.options.length > 1) q.options.splice(+b.dataset.rmopt, 1); }
    else if (b.dataset.mv) { const j = i + +b.dataset.mv; if (j < 0 || j >= F.questions.length) return; [F.questions[i], F.questions[j]] = [F.questions[j], F.questions[i]]; }
    else if (b.dataset.dupq != null) F.questions.splice(i + 1, 0, { ...structuredClone(q), id: Math.random().toString(16).slice(2, 10) });
    else if (b.dataset.delq != null) F.questions.splice(i, 1);
    else return;
    drawQuestions();
    dirty();
  };
}

function dirty() {
  $("#fe-saved").textContent = "Enregistrement…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      F = { ...F, ...(await api(`/api/forms/${F.id}`, { method: "PUT", json: { title: F.title, description: F.description, questions: F.questions, settings: F.settings } })), responses: F.responses };
      if ($("#fe-saved")) $("#fe-saved").textContent = "Enregistré";
    } catch (e) { toast(e.message, "err"); }
  }, 600);
}

// --- Résultats --------------------------------------------------------------
async function results(root, id) {
  const [f, rs] = await Promise.all([api(`/api/forms/${id}`), api(`/api/forms/${id}/responses`)]);
  root.innerHTML = `<a class="back" href="#/questionnaires">${icon("back")}Questionnaires</a>
    <div class="page-head"><span class="tile vert">${icon("chart")}</span><div class="grow"><h1>${esc(f.title)}</h1><p>${rs.length} réponse${rs.length > 1 ? "s" : ""}</p></div>
      <a class="btn ghost" href="#/questionnaires/${id}/modifier">${icon("edit")}Modifier</a>
      <a class="btn ghost" href="/api/forms/${id}/export.csv">${icon("download")}CSV</a>
      <a class="btn" href="/api/forms/${id}/export.xlsx">${icon("sheet")}Excel</a></div>
    <nav class="tabs"><a href="#" data-tab="resume" class="on">${icon("chart")}Résumé</a><a href="#" data-tab="toutes">${icon("list")}Toutes les réponses</a></nav>
    <div id="rs-body"></div>`;
  const resume = () => {
    if (!rs.length) return `<div class="card"><div class="empty">${icon("inbox")}Pas encore de réponse. Partage le lien pour en recevoir.</div></div>`;
    return f.questions.map(q => {
      const vals = rs.map(r => r.answers[q.id]).filter(v => v != null && v !== "" && !(Array.isArray(v) && !v.length));
      let body;
      if ([...CHOICES, "yesno", "scale", "rating"].includes(q.type)) {
        const counts = {};
        const keys = q.type === "yesno" ? ["Oui", "Non"] : q.type === "scale" ? range(q.min, q.max) : q.type === "rating" ? range(1, 5) : [...q.options];
        keys.forEach(k => { counts[k] = 0; });
        vals.flat().forEach(v => { counts[v] = (counts[v] || 0) + 1; });
        const max = Math.max(1, ...Object.values(counts));
        const avg = ["scale", "rating"].includes(q.type) && vals.length ? (vals.reduce((s, v) => s + +v, 0) / vals.length).toFixed(1) : null;
        body = (avg ? `<p class="avg">Moyenne : <b>${avg}</b>${q.type === "rating" ? " / 5 ★" : ` / ${q.max}`}</p>` : "")
          + Object.entries(counts).map(([k, n]) => `<div class="barrow"><span class="lbl ${q.type === "rating" ? "stars" : ""}">${esc(q.type === "rating" ? "★".repeat(+k) : k)}</span>
            <span class="track"><span style="width:${n / max * 100}%"></span></span><b>${n}</b><span class="meta">${vals.length ? Math.round(n / vals.length * 100) : 0} %</span></div>`).join("");
      } else if (q.type === "number" && vals.length) {
        const nums = vals.map(Number);
        body = `<dl class="kv"><dt>Moyenne</dt><dd>${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)}</dd><dt>Total</dt><dd>${nums.reduce((a, b) => a + b, 0)}</dd>
          <dt>Min / max</dt><dd>${Math.min(...nums)} / ${Math.max(...nums)}</dd></dl>`;
      } else {
        body = `<div class="answers">${vals.slice(0, 60).map(v => `<p>${esc(v)}</p>`).join("") || `<p class="hint">Aucune réponse.</p>`}${vals.length > 60 ? `<p class="hint">… et ${vals.length - 60} autres (voir l'export)</p>` : ""}</div>`;
      }
      return `<div class="card"><div class="card-title">${esc(q.label || "Sans intitulé")} <span class="count">${vals.length} réponse${vals.length > 1 ? "s" : ""}</span></div>${body}</div>`;
    }).join("");
  };
  const toutes = () => rs.length ? `<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th>${f.questions.map(q => `<th>${esc(q.label)}</th>`).join("")}<th></th></tr></thead>
    <tbody>${rs.map(r => `<tr><td>${new Date(r.at * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
      ${f.questions.map(q => `<td>${esc(Array.isArray(r.answers[q.id]) ? r.answers[q.id].join(", ") : r.answers[q.id] ?? "")}</td>`).join("")}
      <td><button class="icon-btn plain" data-delr="${r.id}" title="Supprimer cette réponse">${icon("trash")}</button></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="card"><div class="empty">${icon("inbox")}Pas encore de réponse.</div></div>`;
  const show = tab => {
    $$("[data-tab]").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
    $("#rs-body").innerHTML = tab === "toutes" ? toutes() : resume();
  };
  root.querySelectorAll("[data-tab]").forEach(a => a.onclick = e => { e.preventDefault(); show(a.dataset.tab); });
  $("#rs-body").onclick = async e => {
    const rid = e.target.closest("[data-delr]")?.dataset.delr;
    if (rid) { await api(`/api/forms/${id}/responses/${rid}`, { method: "DELETE" }); results(root, id); }
  };
  show("resume");
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
