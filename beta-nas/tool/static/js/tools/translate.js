// Outil « Traduction » : texte et documents, traduits en local sur le NAS.
import { $, esc, icon, toast, sizeStr } from "../ui.js";
import { api, isAdmin } from "../state.js";
import { pageHead } from "../main.js";

let langs = null, timer = null, typing = null;
let pref = { from: "auto", to: "fr" };
try { pref = { ...pref, ...JSON.parse(localStorage.getItem("bt-traduction") || "{}") }; } catch {}
const save = () => { try { localStorage.setItem("bt-traduction", JSON.stringify(pref)); } catch {} };

export async function render(root, parts) {
  const tab = parts[0] === "modeles" ? "modeles" : parts[0] === "documents" ? "documents" : "texte";
  langs = await api("/api/translate/languages");
  root.innerHTML = pageHead("traduction") + `
    <nav class="tabs"><a href="#/traduction" class="${tab === "texte" ? "on" : ""}">${icon("type")}Texte</a>
      <a href="#/traduction/documents" class="${tab === "documents" ? "on" : ""}">${icon("file")}Documents et sous-titres</a>
      ${isAdmin() ? `<a href="#/traduction/modeles" class="${tab === "modeles" ? "on" : ""}">${icon("download")}Langues <span class="count">${langs.installed.length}</span></a>` : ""}</nav>
    <div id="tr-body"></div>`;
  clearInterval(timer);
  if (!langs.installed.length && tab !== "modeles") return empty($("#tr-body"));
  ({ texte: text, documents: documents, modeles: models })[tab]($("#tr-body"));
}

function empty(el) {
  el.innerHTML = `<div class="card"><div class="empty">${icon("translate")}<b>Aucune langue installée</b>
    La traduction se fait entièrement sur le NAS, sans envoyer tes textes sur Internet. Il faut d'abord télécharger les langues (environ 100 Mo chacune, une seule fois).
    ${isAdmin() ? `<button class="btn" id="tr-quick">${icon("download")}Installer Français ⇄ Anglais</button><a class="btn ghost" href="#/traduction/modeles">Autres langues</a>`
      : "<span>Demande à un administrateur d'installer les langues.</span>"}</div></div>`;
  $("#tr-quick")?.addEventListener("click", async () => {
    try {
      await api("/api/translate/install", { json: { from: "en", to: "fr" } });
      await api("/api/translate/install", { json: { from: "fr", to: "en" } });
      location.hash = "#/traduction/modeles";
    } catch (err) { toast(err.message, "err"); }
  });
}

const options = (list, sel, auto) => (auto ? `<option value="auto" ${sel === "auto" ? "selected" : ""}>Détecter la langue</option>` : "")
  + list.map(l => `<option value="${l.code}" ${l.code === sel ? "selected" : ""}>${esc(l.name)}</option>`).join("");

function text(el) {
  el.innerHTML = `<div class="tr-grid">
    <div class="card tr-pane"><div class="tr-head"><select id="tr-from">${options(langs.languages, pref.from, true)}</select><span class="meta" id="tr-detected"></span></div>
      <textarea id="tr-src" placeholder="Tape ou colle le texte à traduire…" rows="12"></textarea>
      <div class="tr-foot"><span class="meta" id="tr-count">0 caractère</span><button class="icon-btn plain" id="tr-clear" title="Effacer">${icon("x")}</button></div></div>
    <button class="icon-btn tr-swap" id="tr-swap" title="Inverser">${icon("convert")}</button>
    <div class="card tr-pane"><div class="tr-head"><select id="tr-to">${options(langs.languages, pref.to, false)}</select><span class="meta" id="tr-time"></span></div>
      <div id="tr-out" class="tr-out"><span class="meta">La traduction apparaît ici.</span></div>
      <div class="tr-foot"><span class="grow"></span><button class="btn ghost small" id="tr-copy">${icon("copy")}Copier</button></div></div>
  </div>
  <p class="hint center">🔒 Traduit sur ton NAS : ton texte ne quitte jamais la maison. Propulsé par les modèles open source <a href="https://www.argosopentech.com" target="_blank" rel="noopener">Argos Translate</a>.</p>`;
  const go = async () => {
    const t = $("#tr-src").value;
    $("#tr-count").textContent = `${t.length.toLocaleString("fr-FR")} caractère${t.length > 1 ? "s" : ""}`;
    if (!t.trim()) { $("#tr-out").innerHTML = `<span class="meta">La traduction apparaît ici.</span>`; return; }
    $("#tr-out").classList.add("busy");
    try {
      const r = await api("/api/translate", { json: { text: t, from: pref.from, to: pref.to } });
      if ($("#tr-src").value !== t) return;
      $("#tr-out").textContent = r.text;
      $("#tr-detected").textContent = r.detected ? `détectée : ${langs.languages.find(l => l.code === r.detected)?.name || r.detected}` : "";
      $("#tr-time").textContent = r.seconds != null ? `${String(r.seconds).replace(".", ",")} s` : "";
    } catch (err) { $("#tr-out").innerHTML = `<span class="msg">${esc(err.message)}</span>`; }
    $("#tr-out").classList.remove("busy");
  };
  $("#tr-src").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(go, 700); });
  $("#tr-from").onchange = e => { pref.from = e.target.value; save(); go(); };
  $("#tr-to").onchange = e => { pref.to = e.target.value; save(); go(); };
  $("#tr-swap").onclick = () => {
    const out = $("#tr-out").textContent;
    const from = pref.from === "auto" ? (langs.languages.find(l => $("#tr-detected").textContent.includes(l.name))?.code || "fr") : pref.from;
    pref = { from: pref.to, to: from };
    save();
    $("#tr-from").innerHTML = options(langs.languages, pref.from, true);
    $("#tr-to").innerHTML = options(langs.languages, pref.to, false);
    if (out && !$("#tr-out .meta")) $("#tr-src").value = out;
    go();
  };
  $("#tr-clear").onclick = () => { $("#tr-src").value = ""; go(); $("#tr-src").focus(); };
  $("#tr-copy").onclick = async () => { await navigator.clipboard.writeText($("#tr-out").textContent).catch(() => {}); toast("Traduction copiée"); };
}

function documents(el) {
  el.innerHTML = `<div class="card">
      <div class="row" style="margin-top:0"><label class="meta">De <select id="tr-dfrom">${options(langs.languages, pref.from, true)}</select></label>
        <label class="meta">vers <select id="tr-dto">${options(langs.languages, pref.to, false)}</select></label></div>
      <label class="drop" id="tr-drop"><input type="file" accept=".txt,.md,.srt,.vtt,.docx,.odt,.pdf" multiple hidden>
        <span class="tile vert">${icon("upload")}</span><strong>Glisse un document ici</strong>
        <small>Word, OpenDocument, PDF, TXT, Markdown, sous-titres SRT / VTT · la mise en page est conservée (sauf PDF → texte)</small></label>
    </div>
    <div class="card"><div class="card-title">${icon("list")}Traductions</div><div id="tr-jobs"></div></div>`;
  const zone = $("#tr-drop"), input = zone.querySelector("input");
  const send = async files => {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("from", $("#tr-dfrom").value);
      fd.append("to", $("#tr-dto").value);
      try { await api("/api/translate/doc", { method: "POST", body: fd }); } catch (err) { toast(err.message, "err"); }
    }
    refresh();
  };
  input.onchange = () => { send([...input.files]); input.value = ""; };
  ["dragenter", "dragover"].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", e => send([...e.dataTransfer.files]));
  const refresh = async () => {
    const jobs = await api("/api/translate/jobs").catch(() => []);
    const box = $("#tr-jobs");
    if (!box) return clearInterval(timer);
    box.innerHTML = jobs.length ? jobs.map(j => `<div class="set-row"><span class="tile ${j.status === "error" ? "rose" : j.status === "done" ? "vert" : ""}">${icon(j.status === "done" ? "check" : j.status === "error" ? "alert" : "translate")}</span>
      <div class="txt"><b>${esc(j.name)}</b><small>${j.status === "done" ? esc(j.output) + " · " + sizeStr(j.size) : j.status === "error" ? esc(j.error) : j.status === "running" ? `Traduction… ${j.progress ?? 0} %` : "En attente"}</small>
        ${j.status === "running" ? `<div class="bar"><div style="width:${j.progress || 0}%"></div></div>` : ""}</div>
      ${j.status === "done" ? `<a class="btn small" href="/api/translate/jobs/${j.id}/file">${icon("download")}Télécharger</a>` : ""}
      <button class="icon-btn plain" data-del="${j.id}" title="Retirer">${icon("x")}</button></div>`).join("")
      : `<p class="hint">Aucune traduction de document pour l'instant.</p>`;
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await api(`/api/translate/jobs/${b.dataset.del}`, { method: "DELETE" }).catch(e => toast(e.message, "err")); refresh(); });
  };
  refresh();
  timer = setInterval(refresh, 2500);
}

async function models(el) {
  el.innerHTML = `<div class="card"><div class="loading"><span class="spinner"></span>Chargement de la liste des langues…</div></div>`;
  let cat = [];
  try { cat = await api("/api/translate/catalog"); } catch (err) { el.innerHTML = `<div class="card"><p class="msg">${esc(err.message)}</p></div>`; return; }
  const paint = async () => {
    const st = await api("/api/translate/languages");
    const q = ($("#tr-q")?.value || "").toLowerCase();
    const list = cat.filter(p => !q || (p.from_name + p.to_name).toLowerCase().includes(q))
      .sort((a, b) => (b.from === "fr" || b.to === "fr") - (a.from === "fr" || a.to === "fr") || a.from_name.localeCompare(b.from_name));
    const html = `<div class="card"><div class="card-title">${icon("check")}Installées <span class="count">${st.installed.length}</span></div>
        ${st.installed.length ? st.installed.map(m => `<div class="set-row"><span class="tile vert">${icon("translate")}</span>
          <div class="txt"><b>${esc(name(m.from))} → ${esc(name(m.to))}</b><small>${sizeStr(m.size)}</small></div>
          <button class="icon-btn plain" data-rm="${m.dir}" title="Supprimer">${icon("trash")}</button></div>`).join("") : `<p class="hint">Aucune langue installée.</p>`}
        <p class="hint">Entre deux langues étrangères (ex. espagnol → allemand), installe les deux modèles vers et depuis l'anglais : la traduction passe par l'anglais.</p></div>
      <div class="card"><div class="card-title">${icon("download")}Disponibles</div>
        <div class="search-box" style="margin-bottom:10px">${icon("search")}<input type="search" id="tr-q" placeholder="Chercher une langue" value="${esc(q)}"></div>
        <div class="tr-cat">${list.map(p => {
          const k = `${p.from}_${p.to}`, inst = st.installing[k];
          return `<div class="tr-model ${p.installed ? "done" : ""}"><b>${esc(p.from_name)} → ${esc(p.to_name)}</b>
            ${p.installed || inst?.status === "done" ? `<span class="pill-ok">installé</span>` : inst?.status === "running" ? `<span class="meta">${inst.progress} %</span>`
              : `<button class="btn small ghost" data-inst="${k}">${icon("download")}Installer</button>`}
            ${inst?.status === "error" ? `<small class="msg">${esc(inst.error)}</small>` : ""}</div>`;
        }).join("")}</div></div>`;
    el.innerHTML = html;
    $("#tr-q").oninput = () => { clearTimeout(typing); typing = setTimeout(() => { paint().then(() => { const i = $("#tr-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    el.querySelectorAll("[data-inst]").forEach(b => b.onclick = async () => {
      const [from, to] = b.dataset.inst.split("_");
      try { await api("/api/translate/install", { json: { from, to } }); toast("Téléchargement lancé"); paint(); } catch (err) { toast(err.message, "err"); }
    });
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { await api(`/api/translate/models/${b.dataset.rm}`, { method: "DELETE" }); paint(); });
    clearInterval(timer);
    if (Object.values(st.installing).some(i => i.status === "running")) timer = setInterval(() => { if ($("#tr-q") && document.activeElement?.id !== "tr-q") paint(); }, 2000);
  };
  const name = c => cat.find(p => p.from === c)?.from_name || cat.find(p => p.to === c)?.to_name || c;
  paint();
}

export function leave() { clearInterval(timer); }
