// Fenêtre « Avant d'enregistrer » : renommer, convertir (NAS), extraire (zip sur place, autres formats par le NAS).
import { call, config, upload } from "./lib.js";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const id = Number(new URLSearchParams(location.search).get("id"));
const port = chrome.runtime.connect({ name: "save" });
setInterval(() => port.postMessage({ type: "ping", id }), 20000);  // garde le service de fond éveillé
let item = null, info = null, target = null, closing = false, original = null;

const base = n => n.replace(/^.*[\\/]/, "");
const extOf = n => (/\.([a-z0-9]{1,5})$/i.exec(n) || [])[1]?.toLowerCase() || "";
const stem = n => base(n).replace(/\.(tar\.(gz|bz2|xz|zst))$/i, "").replace(/\.[^.]+$/, "");
const size = b => b > 0 ? (b < 1048576 ? `${Math.round(b / 1024)} Ko` : `${(b / 1048576).toFixed(1)} Mo`) : "";
const msg = (t, k = "") => {
  $("#msg").innerHTML = t ? `<div class="msg ${k}">${t}</div>` : "";
  if (k === "err" && original) {  // le téléchargement d'origine a été annulé : on peut toujours garder le fichier
    $("#msg").insertAdjacentHTML("beforeend", `<button class="btn wide" id="orig">Enregistrer le fichier d'origine</button>`);
    $("#orig").onclick = async () => { await saveLocal(original, $("#name").value.trim() || original.name); msg("Fichier d'origine enregistré.", "ok"); closeSoon(); };
  }
};
const busy = (t, v = null) => { $("#work").hidden = !t; $("#step").textContent = t || ""; const b = $("#bar"); v == null ? b.removeAttribute("value") : (b.value = v, b.max = 1); document.querySelectorAll("button").forEach(x => x.disabled = !!t); };
function done(type, extra = {}) { closing = true; port.postMessage({ type, id, ...extra }); }
function closeSoon(ms = 1400) { setTimeout(() => window.close(), ms); }

port.onMessage.addListener(async m => {
  if (m.type !== "info") return;
  item = m.item;
  if (!item) { msg("Ce téléchargement n'attend plus de réponse.", "err"); return; }
  const name = base(item.filename) || "fichier";
  $("#name").value = name;
  $("#from").textContent = (() => { try { return new URL(item.url).hostname; } catch { return ""; } })();
  $("#size").textContent = size(item.size);
  const dot = name.lastIndexOf(".");
  $("#name").focus(); $("#name").setSelectionRange(0, dot > 0 ? dot : name.length);
  try { info = await call("/api/v1/ext/convert/targets?name=" + encodeURIComponent(name)); } catch (e) { msg(esc(e.message), "err"); info = { targets: [], archive: false }; }
  if (info.targets.length) {
    $("#conv").hidden = false;
    $("#targets").innerHTML = info.targets.map(t => `<button class="btn" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  }
  $("#arc").hidden = !info.archive;
});
port.postMessage({ type: "info", id });

// Nom : changer l'extension ne convertit pas le fichier
$("#name").oninput = () => {
  const a = extOf(base(item?.filename || "")), b = extOf($("#name").value);
  const w = $("#ext-warn");
  w.hidden = !(a && b && a !== b);
  if (!w.hidden) w.innerHTML = info?.targets?.includes(b)
    ? `Changer seulement l'extension ne transforme pas le fichier (.${esc(a)} reste du .${esc(a)}). <a href="#" id="do-conv">Le convertir vraiment en .${esc(b)}</a>`
    : `Attention : changer l'extension (.${esc(a)} → .${esc(b)}) ne convertit pas le fichier, il risque de ne plus s'ouvrir.`;
  $("#do-conv")?.addEventListener("click", e => { e.preventDefault(); pick(b); $("#convert").click(); });
};
$("#name").onkeydown = e => { if (e.key === "Enter") $("#save").click(); };
$("#save").onclick = () => {
  const n = $("#name").value.trim();
  if (!n) return;
  done(n === base(item.filename) ? "keep" : "rename", { filename: n });
  window.close();
};
$("#keep").onclick = () => { done("keep"); window.close(); };

function pick(t) {
  target = t;
  document.querySelectorAll("#targets .btn").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  $("#convert").disabled = false;
  $("#convert").textContent = `Convertir en ${t.toUpperCase()}`;
}
$("#targets").onclick = e => { const b = e.target.closest("[data-t]"); if (b) pick(b.dataset.t); };

// Récupère le fichier depuis le site (avec ta session), puis annule le téléchargement d'origine
async function grab() {
  busy("Récupération du fichier…");
  let r;
  try { r = await fetch(item.url, { credentials: "include" }); } catch { r = null; }
  if (!r || !r.ok) {
    busy("");
    throw new Error("Le site ne redonne pas le fichier (téléchargement généré à la volée). Enregistre-le tel quel, puis glisse-le dans la page « Déposer » de l'extension.");
  }
  const blob = await r.blob();
  if (/text\/html/.test(blob.type) && !/\.html?$/i.test(item.filename)) { busy(""); throw new Error("Le site a renvoyé une page au lieu du fichier (session expirée ?)."); }
  done("handled");
  original = new File([blob], base(item.filename) || "fichier", { type: blob.type });
  return original;
}

async function saveLocal(blob, filename) {
  const url = URL.createObjectURL(blob);
  const name = filename.replace(/[:*?"<>|]+/g, "_");
  await chrome.storage.session.set({ ["name:" + url]: name });
  await chrome.downloads.download({ url, filename: name, conflictAction: "uniquify" });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function authed(path) {
  const c = await config();
  const r = await fetch(c.base + path, { headers: { Authorization: "Bearer " + c.token } });
  if (!r.ok) throw new Error("Le NAS n'a pas renvoyé le fichier");
  return r.blob();
}

$("#convert").onclick = async () => {
  if (!target) return;
  try {
    const file = await grab();
    const where = document.querySelector("[name=cw]:checked").value;
    busy("Envoi au NAS…");
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("target", target);
    form.append("nas", where === "nas" ? "1" : "0");
    const { id: job } = await call("/api/v1/ext/convert", { form });
    let j;
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      j = await call("/api/v1/ext/convert/" + job);
      if (j.status === "done" || j.status === "error") break;
      busy(`Conversion en ${target.toUpperCase()}…`, j.progress != null ? j.progress / 100 : null);
    }
    if (j.status === "error") throw new Error(j.error || "La conversion a échoué");
    if (where === "pc") { busy("Enregistrement…"); await saveLocal(await authed(`/api/v1/ext/convert/${job}/file`), j.output || `${stem(file.name)}.${target}`); }
    busy(""); msg(where === "nas" ? `Converti et rangé sur le NAS : ${esc(j.saved || "Conversions/Navigateur")}` : `Converti en ${esc(target.toUpperCase())} et enregistré.`, "ok");
    closeSoon(where === "nas" ? 2500 : 1400);
  } catch (e) { busy(""); msg(esc(e.message), "err"); }
};

$("#extract").onclick = async () => {
  try {
    const file = await grab();
    const where = document.querySelector("[name=aw]:checked").value;
    const folder = stem(file.name) || "archive";
    if ($("#keep-arc").checked) await saveLocal(file, file.name);
    // ZIP sans mot de passe vers l'ordinateur : extrait ici, sans passer par le NAS
    if (where === "pc" && /\.zip$/i.test(file.name) && !$("#pwd").value) {
      try {
        busy("Lecture de l'archive…");
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter(f => !f.dir && !f.name.split("/").includes(".."));
        let n = 0;
        for (const f of entries) {
          busy(`Extraction : ${f.name}`, n / entries.length);
          await saveLocal(await f.async("blob"), `${folder}/${f.name}`);
          n++;
        }
        busy(""); msg(`${n} fichier${n > 1 ? "s" : ""} extrait${n > 1 ? "s" : ""} dans Téléchargements/${esc(folder)}.`, "ok");
        return closeSoon(2200);
      } catch (e) { if (!/encrypt|password|Corrupted|unsupported/i.test(e.message)) throw e; }  // chiffré ou format exotique : le NAS prend le relais
    }
    busy("Envoi au NAS…");
    const form = new FormData();
    form.append("file", file, file.name);
    let a = await call("/api/v1/ext/archive", { form });
    if (a.need_password) {
      const pwd = $("#pwd").value || prompt("Cette archive a un mot de passe :") || "";
      a = await call(`/api/v1/ext/archive/${a.id}/password`, { json: { password: pwd } });
      if (a.need_password) throw new Error("Mot de passe incorrect");
    }
    const pwd = $("#pwd").value || undefined;
    if (where === "nas") {
      busy("Extraction sur le NAS…");
      const r = await call(`/api/v1/ext/archive/${a.id}/extract`, { json: { dest: "server", password: pwd } });
      busy(""); msg(`${r.count} fichier${r.count > 1 ? "s" : ""} extrait${r.count > 1 ? "s" : ""} sur le NAS dans Décompressés/${esc(r.saved)}.`, "ok");
      return closeSoon(2500);
    }
    const files = a.entries.filter(e => !e.dir);
    if (files.length > 40) throw new Error(`L'archive contient ${files.length} fichiers : choisis « Sur le NAS », ou garde l'archive et ouvre-la dans le Décompresseur.`);
    let n = 0;
    for (const f of files) {
      busy(`Extraction : ${f.path || f.name}`, n / files.length);
      const r = await call(`/api/v1/ext/archive/${a.id}/extract`, { json: { dest: "download", paths: [f.path], password: pwd } });
      await saveLocal(await authed(r.download), `${folder}/${f.path}`);
      n++;
    }
    busy(""); msg(`${n} fichier${n > 1 ? "s" : ""} extrait${n > 1 ? "s" : ""} dans Téléchargements/${esc(folder)}.`, "ok");
    closeSoon(2200);
  } catch (e) { busy(""); msg(esc(e.message), "err"); }
};

$("#nas").onclick = async () => {
  try {
    const file = await grab();
    busy("Envoi au NAS…");
    const r = await upload(file, file.name, "auto", item.url);
    busy(""); msg(`Envoyé dans ${esc(r.label)}${r.detail ? " · " + esc(r.detail) : ""}.`, "ok");
    closeSoon(2000);
  } catch (e) { busy(""); msg(esc(e.message), "err"); }
};

// Fenêtre fermée sans choix : le fichier est enregistré tel quel (géré par le service de fond)
addEventListener("beforeunload", () => { if (!closing) port.postMessage({ type: "keep", id }); });
