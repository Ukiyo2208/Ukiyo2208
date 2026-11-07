/* Barre commune du site de Bêta (http://IP_DU_NAS:8800) : trois onglets, sur chaque page.
   Bêta IA (/) · Domotique (/home/) · Tri automatique (/tri/) */
(function () {
  if (document.querySelector("nav.beta-sections")) return;
  const chemin = location.pathname;
  const actif = chemin.startsWith("/home") ? "domotique" : chemin.startsWith("/tri") ? "tri" : "ia";
  const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SECTIONS = [
    ["ia", "/", "Bêta IA", ico('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>')],
    ["domotique", "/home/", "Domotique", ico('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>')],
    ["tri", "/tri/", 'Tri<span class="long"> automatique</span>', ico('<path d="M4 4h6l2 2h8v4H4z"/><path d="M4 10h16v10H4z"/><path d="M9 15h6"/>')],
  ];
  const style = document.createElement("style");
  style.textContent = `
    nav.beta-sections { position: sticky; top: 0; z-index: 60; display: flex; justify-content: center; padding: 10px 12px 6px;
      pointer-events: none; }
    nav.beta-sections .barre { pointer-events: auto; display: flex; gap: 4px; padding: 5px; border-radius: 999px;
      background: rgba(10, 16, 52, .72); border: 1px solid rgba(110, 160, 255, .25); backdrop-filter: blur(16px) saturate(140%);
      -webkit-backdrop-filter: blur(16px) saturate(140%); box-shadow: 0 8px 24px rgba(0, 0, 0, .35); max-width: 100%; overflow-x: auto; }
    nav.beta-sections a { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; white-space: nowrap;
      color: #aab6e6; text-decoration: none; font: 600 14px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
    nav.beta-sections a:hover { color: #fff; }
    nav.beta-sections a.actif { color: #fff; background: linear-gradient(135deg, #2f8bff, #7b5bff); box-shadow: 0 0 14px rgba(79, 140, 255, .45); }
    nav.beta-sections svg { width: 18px; height: 18px; flex: none; }
    @media (max-width: 480px) { nav.beta-sections a { padding: 8px 12px; font-size: 13px; gap: 6px; } }
    @media (max-width: 400px) { nav.beta-sections .long { display: none; } }`;
  const nav = document.createElement("nav");
  nav.className = "beta-sections";
  nav.setAttribute("aria-label", "Sections de Bêta");
  nav.innerHTML = `<div class="barre">${SECTIONS.map(([id, href, nom, svg]) =>
    `<a href="${href}" class="${id === actif ? "actif" : ""}" ${id === actif ? 'aria-current="page"' : ""}>${svg}${nom}</a>`).join("")}</div>`;
  document.head.append(style);
  document.body.prepend(nav);
})();
