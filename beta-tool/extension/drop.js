import { upload, openNas } from "./lib.js";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DESTS = { auto: "Automatique", paperasse: "Paperasse", budget: "Budget (relevé)", patrimoine: "Patrimoine (relevé Revolut)", photos: "Album photo", fichiers: "Fichiers (Téléchargements/Navigateur)" };
const opts = Object.entries(DESTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("#dest").innerHTML = opts;
$("#u-dest").innerHTML = opts;

function line(name, html, kind = "") {
  const d = document.createElement("div");
  d.className = "item";
  d.innerHTML = `<span class="grow"><b>${esc(name)}</b><br><span class="meta ${kind}">${html}</span></span>`;
  $("#done").prepend(d);
  return d;
}

async function send(files) {
  for (const f of files) {
    const l = line(f.name, "Envoi…");
    try {
      const r = await upload(f, f.name, $("#dest").value);
      l.querySelector(".meta").innerHTML = `✓ ${esc(r.label)}${r.detail ? " · " + esc(r.detail) : ""} · <a href="#" data-l="${esc(r.link)}">Ouvrir</a>`;
    } catch (e) { l.querySelector(".meta").textContent = "✗ " + e.message; }
  }
}
const zone = $("#zone");
zone.onclick = () => $("#file").click();
$("#file").onchange = e => send([...e.target.files]);
zone.ondragover = e => { e.preventDefault(); zone.classList.add("on"); };
zone.ondragleave = () => zone.classList.remove("on");
zone.ondrop = e => { e.preventDefault(); zone.classList.remove("on"); send([...e.dataTransfer.files]); };
$("#done").onclick = e => { const a = e.target.closest("[data-l]"); if (a) { e.preventDefault(); openNas(a.dataset.l); } };

// Ouvert depuis une notification de téléchargement : renvoyer le fichier depuis son lien
const q = new URLSearchParams(location.search);
if (q.get("url")) {
  $("#fromurl").hidden = false;
  $("#u-name").textContent = q.get("name") || "Fichier téléchargé";
  $("#u-url").textContent = q.get("url");
  $("#u-send").onclick = async () => {
    $("#u-send").disabled = true;
    const r = await new Promise(res => chrome.runtime.sendMessage({ type: "send-link", url: q.get("url"), dest: $("#u-dest").value, name: q.get("name") }, res));
    if (r?.error) line(q.get("name") || "Fichier", "✗ " + esc(r.error) + " : glisse le fichier depuis ton dossier Téléchargements dans la zone ci-dessous.");
    else line(q.get("name") || "Fichier", `✓ ${esc(r.label)}${r.detail ? " · " + esc(r.detail) : ""}`);
    $("#u-send").disabled = false;
  };
}
