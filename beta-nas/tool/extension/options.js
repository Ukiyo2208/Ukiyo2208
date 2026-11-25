import { config, setOpts, pair, call } from "./lib.js";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const msg = (t, k = "") => { $("#msg").innerHTML = t ? `<div class="msg ${k}">${t}</div>` : ""; };

async function paint() {
  const c = await config();
  const linked = !!c.token;
  $("#linked").hidden = !linked;
  $("#pair").hidden = linked;
  if (linked) { $("#l-site").textContent = c.site || "Bêta Tool"; $("#l-base").textContent = c.base; $("#l-user").textContent = c.user; }
  else if (c.base) $("#pair").base.value = c.base;
  $("#o-downloads").value = c.opts.downloads;
  $("#o-beforeSave").value = c.opts.beforeSave;
  $("#o-prices").checked = c.opts.prices;
  $("#o-pill").checked = c.opts.pill;
  $("#o-video").checked = c.opts.video;
  if (linked) {
    try {
      const s = await call("/api/v1/ext/status");
      $("#v-url").innerHTML = s.vault?.url ? `Adresse de ton Coffre : <code>${esc(s.vault.url)}</code>` : "";
    } catch {}
  }
}

$("#pair").onsubmit = async e => {
  e.preventDefault();
  const f = e.target, b = f.querySelector("button");
  b.disabled = true; msg("Connexion…");
  try {
    const base = f.base.value;
    const d = await pair(base, f.code.value.replace(/\D/g, ""));
    msg(`Reliée à ${esc(d.site)} avec le compte <b>${esc(d.user)}</b>. Tu peux fermer cette page.`, "ok");
    paint();
  } catch (err) { msg(esc(err.message), "err"); }
  b.disabled = false;
};
$("#test").onclick = async () => {
  try { const s = await call("/api/v1/ext/status"); msg(`Connexion OK · ${esc(s.site)} ${esc(s.version)} · compte ${esc(s.user)}`, "ok"); }
  catch (err) { msg(esc(err.message), "err"); }
};
$("#unlink").onclick = async () => {
  if (!confirm("Délier ce navigateur ? Pense aussi à révoquer son accès dans Bêta Tool (Réglages › Extension).")) return;
  await chrome.storage.local.remove(["token", "user", "site"]);
  msg("Navigateur délié.");
  paint();
};
for (const k of ["downloads", "beforeSave", "prices", "pill", "video"]) {
  $("#o-" + k).onchange = e => setOpts({ [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
}
paint();
