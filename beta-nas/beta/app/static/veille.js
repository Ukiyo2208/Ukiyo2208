/* Écran de veille de Bêta (tablette murale ou écran dans un navigateur plein écran).

   Activer une fois sur l'appareil : ouvrir une page de Bêta avec ?veille=1 (désactiver : ?veille=0).
   Options : &minutes=3 (inactivité avant la veille), &piece=Salon (se réveille quand un détecteur de mouvement
   de cette pièce s'allume dans Home Assistant). Les réglages restent sur l'appareil.

   En veille : le fond Japon du moment en plein écran, l'heure, la date et la météo ; l'heure se déplace
   doucement (pas de marquage de l'écran) et tout s'assombrit la nuit. Un toucher réveille la page.
   Au premier réveil du matin (6 h - 11 h), Bêta lit le résumé du matin. */
(() => {
  const memoire = {
    lire(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    ecrire(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} },
  };
  const params = new URLSearchParams(location.search);
  if (params.has("veille")) memoire.ecrire("beta_veille", params.get("veille") === "0" ? null : "1");
  if (params.has("minutes")) memoire.ecrire("beta_veille_minutes", params.get("minutes"));
  if (params.has("piece")) memoire.ecrire("beta_veille_piece", params.get("piece") || null);
  if (memoire.lire("beta_veille") !== "1") return;

  const MINUTES = Math.max(0.5, Number(memoire.lire("beta_veille_minutes")) || 3);
  const PIECE = (memoire.lire("beta_veille_piece") || "").toLowerCase();
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const METEO = { sunny: "☀️", "clear-night": "🌙", cloudy: "☁️", partlycloudy: "⛅", rainy: "🌧️", pouring: "🌧️", snowy: "🌨️",
    "snowy-rainy": "🌨️", fog: "🌫️", windy: "💨", "windy-variant": "💨", lightning: "🌩️", "lightning-rainy": "⛈️", hail: "🌨️" };

  const style = document.createElement("style");
  style.textContent = `
    #beta-veille { position: fixed; inset: 0; z-index: 9999; display: none; color: #fff; cursor: none; overflow: hidden;
      background: #070b24 center bottom / cover no-repeat; font-family: Inter, system-ui, sans-serif; transition: opacity .6s; }
    #beta-veille.on { display: block; }
    #beta-veille .voile { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5, 8, 30, .15), rgba(5, 8, 30, .55)); }
    #beta-veille .bloc { position: absolute; text-align: left; transition: left 3s ease, top 3s ease; text-shadow: 0 2px 24px rgba(0, 0, 0, .55); }
    #beta-veille .heure { font-size: clamp(72px, 16vw, 200px); font-weight: 200; letter-spacing: -.02em; line-height: 1; }
    #beta-veille .date { font-size: clamp(18px, 3vw, 34px); opacity: .9; margin-top: 8px; }
    #beta-veille .meteo { font-size: clamp(18px, 3vw, 32px); margin-top: 14px; opacity: .95; }
    #beta-veille .aide { position: absolute; bottom: 18px; width: 100%; text-align: center; font-size: 14px; opacity: .55; }
    #beta-veille.nuit { opacity: .55; }`;
  document.head.appendChild(style);
  const ecran = document.createElement("div");
  ecran.id = "beta-veille";
  ecran.innerHTML = `<div class="voile"></div><div class="bloc"><div class="heure"></div><div class="date"></div><div class="meteo"></div></div><div class="aide">Touche l'écran pour revenir</div>`;
  document.body.appendChild(ecran);
  const $ = (s) => ecran.querySelector(s);

  const jeton = () => memoire.lire("beta_jeton") || "";
  const api = async (chemin) => {
    const r = await fetch(chemin, { headers: jeton() ? { Authorization: `Bearer ${jeton()}` } : {} });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };

  let enVeille = false, inactifDepuis = Date.now(), dernierMouvement = null;
  function afficherHeure() {
    const d = new Date();
    $(".heure").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const jour = JOURS[d.getDay()];
    $(".date").textContent = `${jour[0].toUpperCase()}${jour.slice(1)} ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
    ecran.classList.toggle("nuit", d.getHours() >= 23 || d.getHours() < 6);
    ecran.style.backgroundImage = `url("${window.betaFond ? window.betaFond() : "/static/fond-japon.svg"}")`;
  }
  function deplacer() {  // l'heure bouge un peu chaque minute
    const bloc = $(".bloc");
    bloc.style.left = `${6 + Math.random() * 30}vw`;
    bloc.style.top = `${8 + Math.random() * 30}vh`;
  }
  async function verifierMaison() {
    try {
      const m = await api("/v1/maison/etat");
      if (m.meteo && m.meteo.temperature != null) {
        $(".meteo").textContent = `${METEO[m.meteo.etat] || "🌡️"} ${Math.round(m.meteo.temperature)}°${m.meteo.humidite != null ? ` · ${m.meteo.humidite} %` : ""}`;
      }
      if (PIECE) {  // un mouvement dans la pièce de l'écran le réveille
        const bouge = (m.appareils || []).some((a) => a.id.startsWith("binary_sensor.") && a.etat === "on"
          && ["motion", "occupancy", "presence"].includes(a.attr?.device_class) && (a.piece || "").toLowerCase() === PIECE);
        if (bouge && dernierMouvement === false && enVeille) reveiller();
        dernierMouvement = bouge;
      }
    } catch (_) { /* hors connexion : on garde l'heure */ }
  }

  async function resumeDuMatin() {
    const h = new Date().getHours(), jour = new Date().toDateString();
    if (h < 6 || h >= 11 || memoire.lire("beta_resume_jour") === jour) return;
    memoire.ecrire("beta_resume_jour", jour);
    if (window.direResume) return window.direResume();  // page Domotique : bulle + voix
    try {
      const r = await api("/v1/resume?voix=1");
      if (r.audio_wav_base64) new Audio(`data:audio/wav;base64,${r.audio_wav_base64}`).play().catch(() => {});
    } catch (_) {}
  }

  function endormir() {
    if (enVeille) return;
    enVeille = true;
    afficherHeure(); deplacer(); verifierMaison();
    ecran.classList.add("on");
  }
  function reveiller() {
    inactifDepuis = Date.now();
    if (!enVeille) return;
    enVeille = false;
    ecran.classList.remove("on");
    resumeDuMatin();
  }
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(ev, (e) => { if (enVeille) { e.preventDefault(); e.stopPropagation(); } reveiller(); }, { capture: true, passive: false });
  }
  window.addEventListener("pointermove", () => { if (!enVeille) inactifDepuis = Date.now(); }, { passive: true });

  setInterval(() => {
    if (!enVeille && Date.now() - inactifDepuis > MINUTES * 60000) endormir();
    if (enVeille) afficherHeure();
  }, 5000);
  setInterval(() => { if (enVeille) deplacer(); }, 60000);
  setInterval(() => { if (enVeille || PIECE) verifierMaison(); }, 15000);
  window.betaVeille = { endormir, reveiller };
})();
