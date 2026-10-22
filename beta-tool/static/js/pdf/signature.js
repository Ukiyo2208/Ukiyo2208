// Fenêtre « Ma signature » : dessiner, taper ou importer, avec signatures mémorisées.
import { $, $$, icon, modal, closePanel, toast } from "../ui.js";

const KEY = "bt-signatures";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const store = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))); } catch {} };

/** Ouvre la fenêtre ; résout avec une image PNG (data URL) ou null si annulé. */
export function chooseSignature() {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = modal("Ma signature", `
      <div id="sig-saved"></div>
      <div class="seg" style="margin-bottom:14px">
        <label><input type="radio" name="sig-tab" value="draw" checked>${icon("pencil")}Dessiner</label>
        <label><input type="radio" name="sig-tab" value="type">${icon("type")}Taper</label>
        <label><input type="radio" name="sig-tab" value="import">${icon("image")}Importer</label>
      </div>
      <div data-tab="draw">
        <canvas class="sig-pad" id="sig-pad"></canvas>
        <div class="row" style="margin:10px 0 0">
          <div class="seg"><label><input type="radio" name="sig-ink" value="#0a1f66" checked>Bleu</label><label><input type="radio" name="sig-ink" value="#111111">Noir</label></div>
          <button class="btn small ghost" id="sig-clear">${icon("trash")}Effacer</button>
        </div>
      </div>
      <div data-tab="type" hidden>
        <input type="text" id="sig-text" placeholder="Ton nom" maxlength="40">
        <div class="sig-typed" id="sig-preview" style="margin-top:10px">&nbsp;</div>
      </div>
      <div data-tab="import" hidden>
        <label class="drop" id="sig-drop"><input type="file" accept="image/*" hidden>
          <span class="tile rose">${icon("upload")}</span><strong>Photo ou scan de ta signature</strong><small>Le fond blanc est retiré automatiquement</small></label>
        <img id="sig-imported" alt="" style="max-height:120px;margin-top:10px;display:none;background:#fff;border-radius:12px;padding:8px">
      </div>
      <label class="check" style="margin-top:14px"><input type="checkbox" id="sig-remember" checked> Mémoriser dans ce navigateur</label>
      <div class="modal-foot">
        <button class="btn ghost" data-close>Annuler</button>
        <button class="btn" id="sig-use">${icon("check")}Utiliser cette signature</button>
      </div>`, { tile: "rose", ic: "signature" });
    m.addEventListener("closed", () => finish(null));

    // Signatures mémorisées
    const renderSaved = () => {
      const list = load();
      $("#sig-saved", m).innerHTML = list.length ? `<label class="field">Mes signatures</label><div class="saved-sigs">${list.map((s, i) =>
        `<div class="s" data-i="${i}"><img src="${s}" alt=""><button class="x" data-del="${i}" title="Oublier">✕</button></div>`).join("")}</div>
        <p class="hint" style="margin-bottom:14px">Clique sur une signature pour la réutiliser, ou crée-en une nouvelle :</p>` : "";
    };
    renderSaved();
    $("#sig-saved", m).addEventListener("click", e => {
      const del = e.target.closest("[data-del]");
      if (del) { const l = load(); l.splice(+del.dataset.del, 1); store(l); return renderSaved(); }
      const s = e.target.closest(".s");
      if (s) { finish(load()[+s.dataset.i]); closePanel(); }
    });

    // Onglets
    let tab = "draw";
    $$("[name=sig-tab]", m).forEach(r => r.addEventListener("change", () => {
      tab = r.value;
      $$("[data-tab]", m).forEach(d => { d.hidden = d.dataset.tab !== tab; });
      if (tab === "draw") sizePad();
    }));

    // Dessin
    const pad = $("#sig-pad", m);
    const ctx = pad.getContext("2d");
    let drawn = false;
    const sizePad = () => {
      const r = pad.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      pad.width = r.width * dpr; pad.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawn = false;
    };
    setTimeout(sizePad, 250);
    pad.addEventListener("pointerdown", e => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      ctx.strokeStyle = $("[name=sig-ink]:checked", m).value;
      ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
      const move = ev => {
        for (const p of ev.getCoalescedEvents?.() || [ev]) ctx.lineTo(p.clientX - r.left, p.clientY - r.top);
        ctx.stroke();
        drawn = true;
      };
      pad.addEventListener("pointermove", move);
      pad.addEventListener("pointerup", () => pad.removeEventListener("pointermove", move), { once: true });
    });
    $("#sig-clear", m).onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; };

    // Texte
    $("#sig-text", m).addEventListener("input", e => { $("#sig-preview", m).textContent = e.target.value || " "; });

    // Import
    let imported = null;
    const drop = $("#sig-drop", m);
    const onFile = f => {
      const img = new Image();
      img.onload = () => { imported = cleanBackground(img); $("#sig-imported", m).src = imported; $("#sig-imported", m).style.display = "block"; };
      img.src = URL.createObjectURL(f);
    };
    drop.querySelector("input").addEventListener("change", e => e.target.files[0] && onFile(e.target.files[0]));
    drop.addEventListener("dragover", e => e.preventDefault());
    drop.addEventListener("drop", e => { e.preventDefault(); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); });

    $("#sig-use", m).onclick = async () => {
      let src = null;
      if (tab === "draw" && drawn) src = trim(pad);
      if (tab === "type" && $("#sig-text", m).value.trim()) src = await typed($("#sig-text", m).value.trim());
      if (tab === "import") src = imported;
      if (!src) return toast("Crée d'abord ta signature", "err");
      if ($("#sig-remember", m).checked) store([src, ...load().filter(s => s !== src)]);
      finish(src);
      closePanel();
    };
  });
}

/** Recadre un canvas sur son contenu non transparent et renvoie un PNG. */
function trim(canvas) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < x0) return null;
  const pad = 6, out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
  out.getContext("2d").drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

async function typed(text) {
  await document.fonts.load('700 96px "Signature"');
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = '700 96px "Signature"';
  c.width = Math.ceil(ctx.measureText(text).width) + 40; c.height = 150;
  ctx.font = '700 96px "Signature"';
  ctx.fillStyle = "#0a1f66";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, 78);
  return trim(c);
}

/** Rend transparent le fond clair d'une photo de signature. */
function cleanBackground(img) {
  const c = document.createElement("canvas");
  const k = Math.min(1, 1200 / Math.max(img.width, img.height));
  c.width = img.width * k; c.height = img.height * k;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = .299 * d.data[i] + .587 * d.data[i + 1] + .114 * d.data[i + 2];
    d.data[i + 3] = lum > 200 ? 0 : lum > 150 ? Math.round((200 - lum) / 50 * 255) : 255;
  }
  ctx.putImageData(d, 0, 0);
  return trim(c);
}
