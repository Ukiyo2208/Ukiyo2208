/* Bêta home 7.13 — Modules : chaque service s'active ou se coupe sans toucher aux autres.
   - un module coupé disparaît du menu, de ses raccourcis et (côté NAS) arrête de tourner
   - « Appareils » : en direct (Marques), par Home Assistant, ou les deux ; le NAS peut aussi piloter ceux de Home Assistant
   Paramètres › Modules. Chargé en dernier : il filtre ce que les autres modules ajoutent. */
(function () {
  const B = window.BOS, { S, esc, RENDER } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  // [id, nom, description, icône, pages, tourne aussi sur le NAS]
  const MODS = [
    ['Maison', [
      ['regles', 'Règles « Si… alors… »', 'Automatismes exécutés par le NAS 24 h/24', 'sparkle', [], true],
      ['scenes', 'Scènes', 'Ambiances par pièce, lumière adaptative', 'sunGear', ['scenes'], true],
      ['chauffage', 'Chauffage intelligent', 'Zones, planning, éco automatique', 'flame', ['chauffage'], true],
      ['energie', 'Énergie', 'Solaire, consommation, coûts en euros', 'boltPlain', ['energie'], true],
      ['arrosage', 'Arrosage selon la météo', 'Annule s’il a plu ou s’il va pleuvoir', 'sprinkler', [], true],
      ['services', 'Tempo, vigilance, collectes', 'Infos EDF, Météo-France, poubelles', 'sun2', [], false],
      ['sante', 'Santé de la maison', 'Hors ligne, piles faibles', 'heart', ['sante'], false],
      ['reseau', 'Réseau', 'Box, Wi-Fi Deco, inconnus, coupures, Wi-Fi invités, contrôle parental', 'wifi', ['reseau'], true],
      ['reveil', 'Réveil en douceur', 'Lumière, volets, radio et météo au réveil', 'sun', [], true],
      ['matin', 'Tableau du matin', 'Météo, agenda, trajets, bus, tram et TER', 'sunGear', ['matin'], false],
      ['interphone', 'Interphone', 'Annonces vers une tablette ou toutes', 'mic', ['interphone'], false],
      ['rappels', 'Rappels d’entretien', 'Filtres, chaudière, contrôle technique…', 'history', [], true],
      ['admin', 'Administration', 'État du serveur, stockage, erreurs', 'server', ['admin'], false]]],
    ['Sécurité', [
      ['securite', 'Alarme et présence', 'Alarme maison, qui est là, absent automatique', 'shieldCheck', ['securite'], false],
      ['simulation', 'Simulation de présence', 'Lumières pendant les vacances', 'bulb', [], true],
      ['detection', 'Détection caméras', 'Personnes et voitures avec Frigate', 'cctv', [], true],
      ['sonnette', 'Sonnette : visiteurs et réponses', 'Photo du visiteur, réponses rapides', 'bellFill', [], false],
      ['parental', 'Contrôle parental par la Bbox', 'Inutile si le Deco est en mode routeur (app Deco)', 'lock', [], false]]],
    ['Famille et loisirs', [
      ['listes', 'Listes et messages', 'Courses, tâches, mots sur les tablettes', 'check', ['listes'], false],
      ['missions', 'Missions des enfants', 'Tâches, points, récompenses, baby-sitter', 'heart', ['missions'], false],
      ['colis', 'Colis', 'Suivi depuis les mails', 'download', [], false],
      ['photos', 'Cadre photo', 'Photos du NAS ou d’Immich en veille', 'photo', [], false],
      ['bilan', 'Bilan du mois', 'La maison en chiffres', 'chart', ['bilan'], false],
      ['musique', 'Musique', 'Enceintes, radios, YouTube', 'musicFill', ['musique'], false],
      ['plex', 'Plex', 'Films et séries', 'plex', ['plex'], false],
      ['calendrier', 'Calendrier', 'Agenda de la famille', 'calendar', ['calendrier'], false],
      ['mails', 'Mails', 'Boîte mail', 'mail', ['mails'], false],
      ['carte', 'Carte et positions', 'Où est la famille', 'map', ['carte'], false],
      ['voiture', 'Voiture', 'Batterie, recharge', 'car', ['voiture'], false],
      ['nas', 'NAS', 'Stockage et fichiers', 'nas', ['nas'], false],
      ['ia', 'Bêta IA', 'Assistant et commandes vocales', 'ai', ['ia'], false],
      ['journal', 'Journal', 'Historique de la maison', 'journal', ['journal'], false]]]
  ];
  const ALL = MODS.flatMap(g => g[1]);
  const off = () => (S.settings.modsOff = S.settings.modsOff || {});
  if (!S.settings.modsInit715) { off().parental = true; S.settings.modsInit715 = true; }   // contrôle parental : app Deco par défaut
  const modOn = id => !off()[id];
  B.modOn = modOn;
  const hiddenRoutes = () => ALL.filter(m => !modOn(m[0])).flatMap(m => m[4]);

  /* ---------- effets : menu, pages, raccourcis ---------- */
  const nl0 = B.navList;
  B.navList = NAV => { const h = hiddenRoutes(); return (nl0 ? nl0(NAV) : NAV).filter(n => !h.includes(n[0])); };
  const nh0 = B.navHidden; B.navHidden = r => (nh0 ? nh0(r) : false) || hiddenRoutes().includes(r);   // barre du haut
  const guard = () => { const r = location.hash.slice(1); if (hiddenRoutes().includes(r)) { setTimeout(() => B.go('accueil'), 0); B.toast('Module coupé (Paramètres › Modules)', 'grid9'); } };
  window.addEventListener('hashchange', guard); setTimeout(guard, 500);
  const bl = RENDER.blist; if (bl) RENDER.blist = () => modOn('regles') ? bl() : (RENDER.alist0 ? RENDER.alist0() : '');
  const sfx = RENDER.sfx; if (sfx) RENDER.sfx = s => { let h = sfx(s); if (!modOn('services')) h = h.replace(/<button class="btn sm" data-act="svcOpen">.*?<\/button>/, ''); return h.replace('<button class="btn sm" data-act="toolsOpen">', '<button class="btn sm" data-act="modOpen">' + ico('layers') + 'Modules</button><button class="btn sm" data-act="toolsOpen">'); };
  const wx = B.wxAlerts; if (wx) B.wxAlerts = () => wx().filter(a => !(a.tempo || a.vig) || modOn('services')).filter(a => !a.board || modOn('listes'));

  /* ---------- le NAS suit les mêmes choix ---------- */
  async function pushOff() {
    if (!srv() || !isAdmin()) return;
    const list = ALL.filter(m => m[5] && !modOn(m[0])).map(m => m[0]);
    try { await B.Server.req('/api/plus', { off: list }, 'PUT'); } catch (e) { }
  }

  /* ---------- Home Assistant sur le NAS ---------- */
  async function haNas(on) {
    if (on) {
      if (!S.settings.haUrl || !S.settings.haToken) return B.toast('Configurez d’abord Home Assistant (Paramètres › Home Assistant)', 'homeFill');
      try {
        await B.Server.req('/api/hub/homeassistant', { url: S.settings.haUrl, token: S.settings.haToken }, 'PUT');
        const r = await B.Server.post('/api/hub/homeassistant/test', {}); if (r.status !== 'ok') throw new Error(r.info || 'Home Assistant injoignable depuis le NAS');
        S.settings.haNas = true; B.toast('Le NAS pilote aussi Home Assistant : ' + r.info, 'check');
      } catch (e) { return B.toast(e.message, 'info'); }
    } else S.settings.haNas = false;
    B.save(); if (B.brainSync) B.brainSync(true); draw();
  }

  /* ---------- fenêtre Modules ---------- */
  function body() {
    const ha = B.HA && B.HA.enabled && B.HA.enabled(), nHub = Object.keys(S.settings.hubMap || {}).length;
    return '<h2>' + ico('layers') + 'Modules</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Activez seulement ce que vous utilisez. Chaque module marche seul : en couper un ne gêne pas les autres (il disparaît du menu et, sur le NAS, arrête de tourner). Vos réglages sont gardés si vous le rallumez.</p>' +
      '<section class="svsec"><h4 class="rlh">' + ico('plug') + 'Vos appareils</h4><div class="modsrc"><div class="' + (nHub ? 'on' : '') + '">' + ico('link') + '<b>En direct</b><small>' + (nHub ? nHub + ' appareil(s) reliés par les marques' : 'Aucun : Marques') + '</small></div><div class="' + (ha ? 'on' : '') + '">' + ico('homeFill') + '<b>Home Assistant</b><small>' + (ha ? 'relié' : 'non utilisé (facultatif)') + '</small></div></div>' +
      (ha ? '<label class="row tbsw"><button type="button" class="sw sm' + (S.settings.haNas ? ' on' : '') + '" data-act="modHa"' + (srv() ? '' : ' disabled') + '></button><span><b>Le NAS pilote aussi les appareils Home Assistant</b> : règles, scènes, chauffage, alarme, Siri marchent avec eux même écrans éteints' + (srv() ? '' : ' (serveur Bêta nécessaire)') + '</span></label>' : '<p class="muted" style="font-size:12.5px;margin:6px 0 0">Sans Home Assistant, tout passe par les marques reliées en direct. Avec, les deux se complètent : un appareil peut venir de l’un ou de l’autre.</p>') + '</section>' +
      MODS.map(g => '<h4 class="rlh">' + esc(g[0]) + '</h4><div class="mods">' + g[1].map(m => '<label class="mod' + (modOn(m[0]) ? ' on' : '') + '"><span class="mic">' + ico(m[3]) + '</span><span><b>' + esc(m[1]) + '</b><small>' + esc(m[2]) + (m[5] ? ' · NAS' : '') + '</small></span><button type="button" class="sw sm' + (modOn(m[0]) ? ' on' : '') + '" data-act="modTog" data-arg="' + m[0] + '" role="switch" aria-label="' + esc(m[1]) + '"></button></label>').join('') + '</div>').join('');
  }
  const draw = () => { const m = document.querySelector('.modmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + body(); m.scrollTop = sc; } };
  B.act('modOpen', () => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); B.modal(body(), 'wide modmodal'); });
  B.act('modTog', el => { const id = el.dataset.arg; if (modOn(id)) off()[id] = true; else delete off()[id]; B.save(); draw(); pushOff(); B.show(); });
  B.act('modHa', () => haNas(!S.settings.haNas));
  setTimeout(pushOff, 6000);
})();
