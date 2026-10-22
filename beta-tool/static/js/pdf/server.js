// Studio PDF · Outils traités par le NAS : compresser, protéger, déverrouiller, OCR.
import { $, icon, toast, dropHTML, dropzone, resultCard, loading, sizeStr } from "../ui.js";
import { toolHead, fileRow, takeHandoff } from "./lib.js";

const TOOLS = {
  compress: {
    url: "/api/pdf/compress", button: "Compresser", ic: "compress", wait: "Compression en cours…",
    options: `<label class="field">Niveau de compression</label>
      <div class="seg">
        <label><input type="radio" name="level" value="legere">Légère</label>
        <label><input type="radio" name="level" value="equilibree" checked>Équilibrée</label>
        <label><input type="radio" name="level" value="forte">Forte</label>
      </div>
      <p class="hint">Légère : qualité impression · Équilibrée : idéal pour l'écran et les mails · Forte : le plus léger possible.</p>`,
    fields: c => ({ level: c.querySelector("[name=level]:checked").value }),
    info: (r, before) => {
      const a = +r.headers.get("X-Size-After"), b = +r.headers.get("X-Size-Before") || before;
      return a >= b ? "déjà optimisé, aucun gain possible" : `${sizeStr(b)} → ${sizeStr(a)} (−${Math.round((1 - a / b) * 100)} %)`;
    },
  },
  protect: {
    url: "/api/pdf/protect", button: "Protéger", ic: "lock", wait: "Chiffrement…",
    options: `<div class="grid2">
        <div><label class="field">Mot de passe d'ouverture</label><input type="password" id="pw" autocomplete="new-password"></div>
        <div><label class="field">Confirmation</label><input type="password" id="pw2" autocomplete="new-password"></div>
      </div>
      <label class="field">Autoriser</label>
      <div class="row" style="margin-top:0">
        <label class="check"><input type="checkbox" id="al-print" checked> L'impression</label>
        <label class="check"><input type="checkbox" id="al-copy" checked> La copie du texte</label>
        <label class="check"><input type="checkbox" id="al-edit"> Les modifications</label>
      </div>
      <p class="hint">Chiffrement AES-256. Garde ton mot de passe précieusement : il est impossible de le retrouver.</p>`,
    fields: c => {
      if (!$("#pw", c).value) throw new Error("Choisis un mot de passe");
      if ($("#pw", c).value !== $("#pw2", c).value) throw new Error("Les deux mots de passe ne correspondent pas");
      return { password: $("#pw", c).value, print: $("#al-print", c).checked ? "1" : "0", copy: $("#al-copy", c).checked ? "1" : "0", edit: $("#al-edit", c).checked ? "1" : "0" };
    },
  },
  unlock: {
    url: "/api/pdf/unlock", button: "Déverrouiller", ic: "unlock", wait: "Déverrouillage…",
    options: `<label class="field">Mot de passe du PDF</label><input type="password" id="pw" autocomplete="off">
      <p class="hint">Laisse vide si le PDF s'ouvre sans code mais bloque l'impression ou la copie.</p>`,
    fields: c => ({ password: $("#pw", c).value }),
  },
  ocr: {
    url: "/api/pdf/ocr", button: "Lancer l'OCR", ic: "scan", wait: "Reconnaissance du texte… (quelques secondes par page)",
    options: `<label class="field">Langue du document</label>
      <div class="seg">
        <label><input type="radio" name="lang" value="fra">Français</label>
        <label><input type="radio" name="lang" value="eng">Anglais</label>
        <label><input type="radio" name="lang" value="fra+eng" checked>Les deux</label>
      </div>
      <label class="check" style="margin-top:14px"><input type="checkbox" id="force"> Refaire l'OCR partout (même sur les pages qui ont déjà du texte)</label>`,
    fields: c => ({ lang: c.querySelector("[name=lang]:checked").value, force: $("#force", c).checked ? "1" : "0" }),
  },
};

export function render(container, tool, kind) {
  container.innerHTML = toolHead(tool) + `<div class="card" id="sv-zone">${dropHTML("sv-drop")}</div>`;
  const z = $("#sv-drop", container);
  dropzone(z, z.querySelector("input"), files => open(container, tool, kind, files[0]));
  const handoff = takeHandoff();
  if (handoff) open(container, tool, kind, handoff);
}

function open(container, tool, kind, file) {
  const t = TOOLS[kind];
  $("#sv-zone", container).innerHTML = fileRow(file, sizeStr(file.size)) + `<div style="margin-top:16px">${t.options}</div>
    <button class="btn wide" id="sv-go" style="margin-top:16px">${icon(t.ic)}${t.button}</button>
    <div id="sv-result"></div>`;
  $("[data-change]", container).onclick = () => render(container, tool, kind);
  $("#sv-go", container).onclick = async () => {
    const out = $("#sv-result", container);
    const btn = $("#sv-go", container);
    let fields;
    try { fields = t.fields(container); } catch (e) { return toast(e.message, "err"); }
    btn.disabled = true;
    loading(out, t.wait);
    try {
      const form = new FormData();
      form.append("file", file);
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      const r = await fetch(t.url, { method: "POST", body: form });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
      const blob = await r.blob();
      resultCard(out, blob, filenameOf(r) || file.name, { info: t.info?.(r, file.size) || "", editable: kind !== "protect" });
    } catch (e) {
      out.innerHTML = "";
      toast(e.message, "err");
    }
    btn.disabled = false;
  };
}

function filenameOf(r) {
  const cd = r.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain && plain[1];
}
