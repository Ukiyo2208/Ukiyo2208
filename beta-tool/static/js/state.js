// État partagé de la page (configuration du serveur, utilisateur) et appels API.

export const state = { config: null };

export const isAdmin = () => state.config?.user?.role === "admin";
export const enabled = id => state.config?.tools?.[id] !== false;

/** fetch JSON avec message d'erreur lisible. */
export async function api(url, opts = {}) {
  if (opts.json !== undefined) {
    opts = { ...opts, body: JSON.stringify(opts.json), headers: { "Content-Type": "application/json", ...(opts.headers || {}) } };
    delete opts.json;
    opts.method ||= "POST";
  }
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = "/login"; throw new Error("Connexion requise"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

export const ago = t => {
  const s = Date.now() / 1000 - t;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
  return new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
};
