/* Barre commune du site de Bêta (http://IP_DU_NAS:8800), sur chaque page :
   - les onglets Bêta IA (/) · Domotique (/home/) · Papiers du NAS (Paperasse de Bêta Tool) · Bêta Tool (port 8080) ;
   - le fond d'écran « Japon » (static/fonds/), le même partout, avec une teinte par partie : il suit l'heure
     (jour, coucher de soleil, nuit) et la saison (cerisiers, été et lucioles, érables, neige).
     ?fond=nuit garde la nuit de printemps sur cet appareil, ?fond=auto revient au fond qui change ;
   - l'écran de veille (static/veille.js, activé avec ?veille=1). */
(function () {
  if (document.querySelector("nav.beta-sections")) return;
  const chemin = location.pathname;
  const actif = chemin.startsWith("/home") ? "domotique" : chemin.startsWith("/tri") ? "tri" : "ia";
  const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SECTIONS = [
    ["ia", "/", "Bêta IA", ico('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>')],
    ["domotique", "/home/", "Domotique", ico('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>')],
    ["tri", `${location.protocol}//${location.hostname}:8080/#/paperasse/nas`, 'Papiers<span class="long"> du NAS</span>',
      ico('<path d="M4 4h6l2 2h8v4H4z"/><path d="M4 10h16v10H4z"/><path d="M9 15h6"/>')],
    ["tool", `${location.protocol}//${location.hostname}:8080/`, 'Bêta<span class="long"> Tool</span>',
      ico('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>')],
  ];

  // Fond d'écran unifié, teinté selon la partie (et l'onglet de la Domotique)
  const TEINTES = { ia: "123, 91, 255", tri: "47, 208, 192", maison: "47, 139, 255", musique: "255, 95, 162",
    plex: "229, 160, 13", automatisations: "66, 226, 160", energie: "255, 176, 61" };
  const memoire = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (_) { return null; } };
  const choixFond = new URLSearchParams(location.search).get("fond");
  if (choixFond) memoire("beta_fond", choixFond === "nuit" ? "nuit" : "auto");
  function fondDuMoment(d = new Date()) {
    if (memoire("beta_fond") === "nuit") return "/static/fond-japon.svg";
    const m = d.getMonth() + 1, h = d.getHours() + d.getMinutes() / 60;
    const saison = m >= 3 && m <= 5 ? "printemps" : m >= 6 && m <= 8 ? "ete" : m >= 9 && m <= 11 ? "automne" : "hiver";
    const [lever, coucher] = { printemps: [7, 20], ete: [6, 21.5], automne: [7.5, 18.5], hiver: [8.25, 17.25] }[saison];
    const moment = h >= lever + 1 && h < coucher - 1 ? "jour" : h >= lever - 0.75 && h < coucher + 0.75 ? "soir" : "nuit";
    return `/static/fonds/japon-${saison}-${moment}.svg`;
  }
  window.betaFond = fondDuMoment;
  function fond() {
    const vue = actif === "domotique" ? (location.hash.slice(1) || "maison") : actif;
    const teinte = TEINTES[vue] || TEINTES.maison;
    const image = fondDuMoment(), jour = image.endsWith("-jour.svg");
    document.body.style.setProperty("background",
      `radial-gradient(1400px 700px at 50% -15%, rgba(${teinte}, .28), transparent 70%),` +
      `linear-gradient(180deg, rgba(5, 8, 30, ${jour ? .45 : .35}), rgba(5, 8, 30, ${jour ? .78 : .7})),` +
      `url("${image}") center bottom / cover fixed, #070b24`, "important");
  }
  fond();
  window.addEventListener("hashchange", fond);
  setInterval(fond, 10 * 60000);  // le fond suit l'heure
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
    @media (max-width: 480px) { nav.beta-sections a { padding: 8px 10px; font-size: 13px; gap: 5px; }
      nav.beta-sections .barre { max-width: 100%; overflow-x: auto; scrollbar-width: none; } }
    @media (max-width: 400px) { nav.beta-sections .long { display: none; } nav.beta-sections a { padding: 8px 9px; } }`;
  const nav = document.createElement("nav");
  nav.className = "beta-sections";
  nav.setAttribute("aria-label", "Sections de Bêta");
  nav.innerHTML = `<div class="barre">${SECTIONS.map(([id, href, nom, svg]) =>
    `<a href="${href}" class="${id === actif ? "actif" : ""}" ${id === actif ? 'aria-current="page"' : ""}>${svg}${nom}</a>`).join("")}</div>`;
  document.head.append(style);
  document.body.prepend(nav);
  const veille = document.createElement("script");
  veille.src = "/static/veille.js";
  document.body.append(veille);
})();
