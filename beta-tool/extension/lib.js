// Connexion au NAS : adresse, jeton (stocké dans ce navigateur uniquement) et appels à l'API.
export async function config() {
  const c = await chrome.storage.local.get(["base", "token", "user", "site", "opts"]);
  c.opts = { downloads: "ask", beforeSave: "smart", prices: true, pill: true, video: true, ...(c.opts || {}) };
  return c;
}

export async function setOpts(patch) {
  const c = await config();
  await chrome.storage.local.set({ opts: { ...c.opts, ...patch } });
}

export function cleanBase(u) {
  u = String(u || "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//.test(u)) u = "http://" + u;
  return u;
}

export async function call(path, { method, json, form, signal } = {}) {
  const c = await config();
  if (!c.base || !c.token) throw new Error("Extension pas encore reliée à ton NAS : ouvre les options");
  const headers = { Authorization: "Bearer " + c.token };
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  let r;
  try { r = await fetch(c.base + path, { method: method || (body ? "POST" : "GET"), headers, body, signal, credentials: "omit" }); }
  catch { throw new Error("NAS injoignable : es-tu à la maison, ou sur Tailscale / le VPN ?"); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Jeton refusé : relie de nouveau l'extension (options)");
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

export async function pair(base, code) {
  base = cleanBase(base);
  const browser = /OPR\//.test(navigator.userAgent) ? "Opera" : /Edg\//.test(navigator.userAgent) ? "Edge" : /Vivaldi/.test(navigator.userAgent) ? "Vivaldi" : /Brave/.test(navigator.userAgent) ? "Brave" : "Chrome";
  let r;
  try { r = await fetch(base + "/api/ext-pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, browser }), credentials: "omit" }); }
  catch { throw new Error("Adresse injoignable : vérifie l'adresse du NAS (ex. http://192.168.1.20:8099)"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  await chrome.storage.local.set({ base, token: d.token, user: d.user, site: d.site });
  return d;
}

export async function upload(blob, name, dest = "auto", source = "") {
  const form = new FormData();
  form.append("file", blob, name);
  form.append("dest", dest);
  form.append("source", "navigateur");
  if (source) form.append("source_url", source);
  return call("/api/v1/ext/upload", { form });
}

export async function openNas(hash = "") {
  const c = await config();
  if (c.base) chrome.tabs.create({ url: c.base + "/" + hash });
}

export function nameFromUrl(url, type = "") {
  try {
    const u = new URL(url);
    let n = decodeURIComponent(u.pathname.split("/").pop() || "");
    if (!n || !/\.\w{2,5}$/.test(n)) {
      const ext = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "text/csv": ".csv", "application/x-ofx": ".ofx" }[type.split(";")[0]] || "";
      n = (n || u.hostname.replace(/^www\./, "")) + ext;
    }
    return n.slice(0, 150);
  } catch { return "fichier"; }
}

export const eur = n => n == null ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
