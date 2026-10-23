// Outil « QR codes » : créer (lien, Wi-Fi, contact…) et lire (caméra ou image).
import { $, $$, esc, icon, toast } from "../ui.js";
import { pageHead } from "../main.js";
import { svg as qrSvg, canvas as qrCanvas, brandLogo } from "../qrcode.js";

const TYPES = {
  url: ["Lien", "link", [["url", "Adresse", "https://"]]],
  text: ["Texte", "type", [["text", "Texte", "", "textarea"]]],
  wifi: ["Wi-Fi", "wifi", [["ssid", "Nom du réseau"], ["password", "Mot de passe"], ["security", "Sécurité", "WPA", "select:WPA,WEP,nopass"], ["hidden", "Réseau masqué", "", "checkbox"]]],
  contact: ["Contact", "user", [["name", "Nom complet"], ["phone", "Téléphone"], ["email", "E-mail"], ["org", "Société"], ["site", "Site web"]]],
  email: ["E-mail", "mail", [["to", "Destinataire"], ["subject", "Objet"], ["body", "Message", "", "textarea"]]],
  sms: ["SMS", "phone", [["phone", "Numéro"], ["body", "Message", "", "textarea"]]],
  tel: ["Appel", "phone", [["phone", "Numéro"]]],
};
const wifiEsc = s => String(s || "").replace(/([\\;,:"])/g, "\\$1");
let type = "url", logoMode = "brand", customLogo = null;
const LOGOS = [["brand", "Bêta Tool"], ["none", "Aucun"], ["custom", "Le mien"]];

export async function render(root, parts) {
  const tab = parts[0] === "lire" ? "lire" : "creer";
  root.innerHTML = pageHead("qr") + `<nav class="tabs"><a href="#/qr" class="${tab === "creer" ? "on" : ""}">${icon("qr")}Créer</a>
    <a href="#/qr/lire" class="${tab === "lire" ? "on" : ""}">${icon("camera")}Lire un QR code</a></nav><div id="qr-body"></div>`;
  tab === "lire" ? reader($("#qr-body")) : creator($("#qr-body"));
}

// --- Création ---------------------------------------------------------------
function creator(el) {
  el.innerHTML = `<div class="qr-grid">
    <div class="card">
      <div class="chips" id="qr-types">${Object.entries(TYPES).map(([k, [l, ic]]) => `<button class="chip ${k === type ? "on" : ""}" data-type="${k}">${icon(ic)}${l}</button>`).join("")}</div>
      <form id="qr-fields" style="margin-top:16px"></form>
      <label class="field" style="margin-top:14px">Logo au centre</label>
      <div class="seg" id="qr-logos">${LOGOS.map(([v, l]) => `<label><input type="radio" name="qr-logo-mode" value="${v}" ${logoMode === v ? "checked" : ""}>${v === "brand" ? `<img src="/brand/icon-192.png" alt="" class="qr-logo-ic">` : ""}${l}</label>`).join("")}</div>
      <input type="file" id="qr-logo" accept="image/*" hidden><button type="button" class="link-btn meta" id="qr-logo-name" style="margin-left:8px" title="Changer d'image">${customLogo ? "Changer d'image" : ""}</button>
      <details class="formats"><summary>Personnaliser</summary>
        <div class="grid2" style="margin-top:12px">
          <div><label class="field">Couleur</label><input type="color" id="qr-fg" value="#0a1430"></div>
          <div><label class="field">Fond</label><input type="color" id="qr-bg" value="#ffffff"></div>
          <div><label class="field">Résistance aux dégâts</label><select id="qr-ecc" style="width:100%"><option value="L">Faible</option><option value="M" selected>Moyenne</option><option value="Q">Élevée</option><option value="H">Maximale</option></select></div>
          <div><label class="field">Style</label><select id="qr-style" style="width:100%"><option value="square">Carrés</option><option value="round">Points</option></select></div>
        </div>
      </details>
    </div>
    <div class="card qr-out">
      <div id="qr-preview" class="qr-preview"></div>
      <p class="meta center" id="qr-data"></p>
      <div class="row" style="justify-content:center"><button class="btn" id="qr-png">${icon("download")}PNG</button><button class="btn ghost" id="qr-svg">${icon("download")}SVG</button></div>
    </div></div>`;
  el.querySelector("#qr-types").onclick = e => { const b = e.target.closest("[data-type]"); if (b) { type = b.dataset.type; creator(el); } };
  drawFields();
  ["qr-fg", "qr-bg", "qr-ecc", "qr-style"].forEach(id => $("#" + id).addEventListener("input", update));
  $("#qr-logos").onchange = e => {
    logoMode = e.target.value;
    if (logoMode === "custom" && !customLogo) $("#qr-logo").click();
    update();
  };
  $("#qr-logo-name").onclick = () => $("#qr-logo").click();
  $("#qr-logo").onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { customLogo = r.result; $("#qr-logo-name").textContent = `${f.name} · changer`; update(); };
    r.readAsDataURL(f);
  };
  $("#qr-png").onclick = async () => {
    const c = await qrCanvas(data(), opts(1024));
    c.toBlob(b => download(b, "qr-code.png"));
  };
  $("#qr-svg").onclick = async () => {
    const o = opts();
    if (logoMode === "brand") o.logo = await brandLogo();
    download(new Blob([qrSvg(data(), { ...o, px: 10 })], { type: "image/svg+xml" }), "qr-code.svg");
  };
}

function drawFields() {
  $("#qr-fields").innerHTML = TYPES[type][2].map(([k, label, def = "", kind = "text"]) => {
    if (kind === "textarea") return `<label class="field">${label}</label><textarea name="${k}" rows="3" style="min-height:70px;margin-bottom:12px">${esc(def)}</textarea>`;
    if (kind === "checkbox") return `<label class="check" style="margin-bottom:12px"><input type="checkbox" name="${k}"> ${label}</label>`;
    if (kind.startsWith("select:")) return `<label class="field">${label}</label><select name="${k}" style="width:100%;margin-bottom:12px">${kind.slice(7).split(",").map(o =>
      `<option value="${o}">${o === "nopass" ? "Aucune" : o}</option>`).join("")}</select>`;
    return `<label class="field">${label}</label><input type="text" name="${k}" value="${esc(def)}" style="margin-bottom:12px">`;
  }).join("");
  $("#qr-fields").oninput = update;
  update();
}

function data() {
  const f = Object.fromEntries(new FormData($("#qr-fields")));
  const hidden = $("#qr-fields [name=hidden]")?.checked;
  switch (type) {
    case "url": return f.url && f.url !== "https://" ? f.url.trim() : location.origin;
    case "text": return f.text || " ";
    case "wifi": return `WIFI:T:${f.security};S:${wifiEsc(f.ssid)};P:${f.security === "nopass" ? "" : wifiEsc(f.password)};${hidden ? "H:true;" : ""};`;
    case "contact": return ["BEGIN:VCARD", "VERSION:3.0", `FN:${f.name || ""}`, f.org && `ORG:${f.org}`, f.phone && `TEL:${f.phone}`,
                            f.email && `EMAIL:${f.email}`, f.site && `URL:${f.site}`, "END:VCARD"].filter(Boolean).join("\n");
    case "email": return `mailto:${f.to || ""}?subject=${encodeURIComponent(f.subject || "")}&body=${encodeURIComponent(f.body || "")}`;
    case "sms": return `SMSTO:${f.phone || ""}:${f.body || ""}`;
    case "tel": return `tel:${(f.phone || "").replace(/\s/g, "")}`;
  }
  return " ";
}

const logo = () => logoMode === "brand" ? "/brand/icon.png" : logoMode === "custom" ? customLogo : null;
const opts = (size = 600) => ({ fg: $("#qr-fg").value, bg: $("#qr-bg").value, ecc: $("#qr-ecc").value, rounded: $("#qr-style").value === "round", logo: logo(), size });

async function update() {
  try {
    const c = await qrCanvas(data(), opts(600));
    c.className = "qr-canvas";
    $("#qr-preview").replaceChildren(c);
    const d = data();
    $("#qr-data").textContent = d.length > 90 ? d.slice(0, 90) + "…" : d;
  } catch (e) { $("#qr-preview").innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// --- Lecture ------------------------------------------------------------------
let scanner = null;
async function reader(el) {
  el.innerHTML = `<div class="qr-grid">
    <div class="card"><div class="card-title">${icon("camera")}Avec la caméra</div>
      <div class="qr-cam"><video id="qr-video" playsinline muted></video></div>
      <div class="row"><button class="btn" id="qr-start">${icon("camera")}Démarrer la caméra</button><button class="btn ghost" id="qr-stop" hidden>Arrêter</button></div>
      ${isSecureContext ? "" : `<p class="hint">${icon("alert")} Le navigateur n'autorise la caméra que sur une adresse en HTTPS. Utilise plutôt « depuis une image ».</p>`}</div>
    <div class="card"><div class="card-title">${icon("image")}Depuis une image</div>
      <label class="drop" id="qr-img"><input type="file" accept="image/*" hidden><strong>Glisse une capture d'écran ou une photo</strong><small>contenant un QR code</small></label>
      <div id="qr-result"></div></div></div>`;
  const { default: QrScanner } = await import("../../vendor/qr-scanner.min.js");
  QrScanner.WORKER_PATH = new URL("../../vendor/qr-scanner-worker.min.js", import.meta.url).href;
  const show = text => {
    const url = /^https?:\/\//i.test(text);
    const wifi = /^WIFI:/i.exec(text) && Object.fromEntries([...text.matchAll(/([TSPH]):((?:\\.|[^;])*);/g)].map(m => [m[1], m[2].replace(/\\(.)/g, "$1")]));
    $("#qr-result").innerHTML = `<div class="result" style="align-items:flex-start"><span class="tile">${icon("qr")}</span><div class="body">
      ${wifi ? `<b>Réseau Wi-Fi : ${esc(wifi.S)}</b><span class="meta">Mot de passe : ${esc(wifi.P || "aucun")} · ${esc(wifi.T)}</span>` : `<b style="word-break:break-all">${esc(text)}</b>`}
      <div class="actions" style="margin-top:8px">${url ? `<a class="btn small" href="${esc(text)}" target="_blank" rel="noopener noreferrer">${icon("external")}Ouvrir</a>` : ""}
        <button class="btn small ghost" data-copy>${icon("copy")}Copier</button></div></div></div>`;
    $("#qr-result [data-copy]").onclick = async () => { await navigator.clipboard.writeText(wifi ? wifi.P || "" : text).catch(() => {}); toast("Copié"); };
  };
  const z = $("#qr-img"), input = z.querySelector("input");
  const scanFile = async f => {
    try { show((await QrScanner.scanImage(f, { returnDetailedScanResult: true })).data); }
    catch { $("#qr-result").innerHTML = `<p class="msg">Aucun QR code trouvé dans cette image.</p>`; }
  };
  input.onchange = () => input.files[0] && scanFile(input.files[0]);
  z.addEventListener("dragover", e => e.preventDefault());
  z.addEventListener("drop", e => { e.preventDefault(); e.dataTransfer.files[0] && scanFile(e.dataTransfer.files[0]); });
  $("#qr-start").onclick = async () => {
    try {
      scanner ||= new QrScanner($("#qr-video"), r => { show(r.data); stop(); }, { returnDetailedScanResult: true, highlightScanRegion: true });
      await scanner.start();
      $("#qr-start").hidden = true; $("#qr-stop").hidden = false;
    } catch (e) { toast("Caméra indisponible : " + (e.message || e), "err"); }
  };
  const stop = () => { scanner?.stop(); $("#qr-start") && ($("#qr-start").hidden = false); $("#qr-stop") && ($("#qr-stop").hidden = true); };
  $("#qr-stop").onclick = stop;
}

export function leave() { scanner?.destroy(); scanner = null; }
