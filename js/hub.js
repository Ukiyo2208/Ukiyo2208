/* Bêta home — « Marques » : connexion directe aux appareils sans Home Assistant (via le serveur Bêta du NAS).
   Une fiche par marque avec un petit tuto, test, import des appareils trouvés par l'API, commandes et états en direct. */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev, T, RENDER, box } = B;
  const BG = 'assets/bg/generic.jpg';
  const C = B.custom;
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const map = () => (S.settings.hubMap = S.settings.hubMap || {});   // appareil Bêta home → { brand, id }
  const callback = () => B.Server.url() + '/api/hub/oauth/callback';

  /* ---------- catalogue des marques ---------- */
  // fields : [clé, libellé, options] — tmp : envoyé au serveur pour une action mais jamais enregistré
  const BRANDS = [
    { id: 'tahoma', name: 'Somfy TaHoma', sub: 'Volets, store, porte de garage', icon: 'blindsWin', ready: true,
      fields: [['host', 'Adresse IP de la box', { ph: '192.168.1.40' }], ['pin', 'PIN de la box', { ph: '1234-5678-9012' }], ['email', 'E-mail du compte Somfy', { tmp: 1 }], ['password', 'Mot de passe Somfy', { tmp: 1, pw: 1 }]],
      actions: [['token', 'Créer le jeton', 'lock']],
      steps: ['Sur <b>somfy.fr</b>, connectez-vous à votre compte puis, dans la partie TaHoma, activez le <b>Mode développeur</b>.',
        'Relevez le <b>PIN</b> collé sous la box (format <code>1234-5678-9012</code>).',
        'Trouvez l’<b>adresse IP</b> de la box dans la liste des appareils de votre box internet. Réservez-la (IP fixe) pour qu’elle ne change pas.',
        'Renseignez IP, PIN, e-mail et mot de passe Somfy puis <b>Créer le jeton</b>. L’e-mail et le mot de passe servent une seule fois et ne sont pas gardés.',
        '<b>Tester</b>, puis <b>Ajouter les appareils</b> : volets, store et garage sont trouvés automatiquement.'],
      note: 'Tout passe ensuite en local par la box. Les moteurs RTS (télécommande sans retour) s’ouvrent et se ferment mais n’indiquent pas leur position.' },
    { id: 'hue', name: 'Philips Hue', sub: 'Lampes et pièces Hue', icon: 'bulbFill', ready: true,
      fields: [['host', 'Adresse IP du pont Hue', { ph: '192.168.1.41' }]],
      actions: [['discover', 'Trouver le pont', 'search2'], ['pair', 'Appairer', 'link']],
      steps: ['Le pont Hue doit être branché sur la même box que le NAS.',
        'Cliquez <b>Trouver le pont</b> (ou saisissez son IP, visible dans l’app Hue › Paramètres › Ponts Hue).',
        'Appuyez sur le <b>gros bouton rond</b> du pont, puis cliquez <b>Appairer</b> dans les 30 secondes.',
        '<b>Ajouter les appareils</b> : les lampes arrivent avec le nom de leur pièce Hue.'],
      note: '100 % local, mises à jour toutes les 3 secondes.' },
    { id: 'elgato', name: 'Elgato', sub: 'Key Light, Light Strip', icon: 'bulbFill', ready: true,
      fields: [['hosts', 'Adresses IP des lampes', { ph: '192.168.1.50, 192.168.1.51' }]],
      steps: ['Ouvrez <b>Elgato Control Center</b> › réglages de chaque lampe : notez son <b>adresse IP</b>.',
        'Réservez ces IP dans votre box internet pour qu’elles ne changent pas.',
        'Saisissez les adresses séparées par des virgules, <b>Enregistrer</b>, <b>Tester</b> puis <b>Ajouter les appareils</b>.'],
      note: 'Aucun compte nécessaire : API locale sur le port 9123.' },
    { id: 'govee', name: 'Govee', sub: 'Lampes et rubans LED Wi-Fi', icon: 'bulbFill', ready: true,
      fields: [['apiKey', 'Clé API Govee', { pw: 1 }]],
      steps: ['App <b>Govee Home</b> › Profil › ⚙️ Réglages › <b>Demander une clé API</b> (Apply for API Key).',
        'La clé arrive par e-mail en quelques minutes : collez-la ici puis <b>Enregistrer</b>.',
        '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'],
      note: 'Gratuit. Seuls les modèles Wi-Fi sont visibles (pas ceux en Bluetooth seul). Quota Govee : l’état est relu toutes les 2 minutes, les commandes partent tout de suite.' },
    { id: 'smartthings', name: 'Samsung SmartThings', sub: 'TV, lave-linge, climatisation', icon: 'tv', ready: true, oauth: true,
      fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', { pw: 1 }]],
      steps: ['Les appareils Samsung doivent déjà être dans l’app <b>SmartThings</b>.',
        'Le serveur Bêta doit être joignable en <b>https</b> (reverse proxy d’UGOS Pro) : Samsung renvoie vers cette adresse.',
        'Sur un ordinateur, installez <b>SmartThings CLI</b> (github.com/SmartThingsCommunity/smartthings-cli) puis lancez <code>smartthings apps:create</code>.',
        'Choisissez <b>OAuth-In App</b>, nom « Bêta home », droits <code>r:devices:*</code> <code>x:devices:*</code> <code>r:locations:*</code>, adresse de retour : <code>{callback}</code>',
        'Copiez le <b>Client ID</b> et le <b>Client secret</b> (affiché une seule fois), <b>Enregistrer</b>, puis <b>Se connecter</b> et autorisez avec votre compte Samsung.',
        '<b>Ajouter les appareils</b> : TV, lave-linge et clim arrivent avec leur pièce SmartThings.'],
      note: 'Gratuit. Le jeton se renouvelle tout seul (les jetons personnels SmartThings expirent en 24 h, d’où OAuth).' },
    { id: 'homeconnect', name: 'Siemens Home Connect', sub: 'Lave-linge (aussi Bosch, Neff)', icon: 'washer', ready: true, oauth: true,
      fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', { pw: 1 }]],
      steps: ['Créez un compte gratuit sur <b>developer.home-connect.com</b>.',
        'Applications › <b>Register Application</b> : nom « Bêta home », flux <b>Authorization Code Grant Flow</b>, adresse de retour : <code>{callback}</code>',
        'Copiez le <b>Client ID</b> et le <b>Client secret</b>, <b>Enregistrer</b>, puis <b>Se connecter</b> avec le compte de l’app Home Connect.',
        '<b>Ajouter les appareils</b>.'],
      note: 'Gratuit. Lecture de l’état (en cours, temps restant, terminé) toutes les 3 minutes à cause du quota de 1 000 appels par jour. Le départ à distance reste sur la machine.' },
    { id: 'shelly', name: 'Shelly', sub: 'Prises, relais, variateurs, volets', icon: 'plug', ready: true,
      fields: [['hosts', 'Adresses IP des Shelly', { ph: '192.168.1.70, 192.168.1.71' }], ['password', 'Mot de passe (si protégé)', { pw: 1 }]],
      steps: ['Le plus simple : <b>Découvrir</b> trouve vos Shelly et remplit les adresses.', 'Sinon : app Shelly › appareil › Paramètres › Infos : relevez l’<b>adresse IP</b> et réservez-la dans votre box.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : chaque sortie (prise, relais, variateur, volet) devient une tuile.'],
      note: '100 % local, sans compte. Shelly de génération 1 et 2 et + (Plus, Pro, Gen3).' },
    { id: 'esphome', name: 'ESPHome', sub: 'Vos modules ESP32 / ESP8266', icon: 'plug', ready: true,
      fields: [['hosts', 'Adresses IP des modules', { ph: '192.168.1.90' }], ['user', 'Identifiant web_server (option)'], ['password', 'Mot de passe web_server (option)', { pw: 1 }]],
      steps: ['Dans le YAML de chaque module, ajoutez <code>web_server:</code> (port 80) et reflashez-le.', '<b>Découvrir</b> remplit les adresses, ou saisissez-les.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : interrupteurs, lumières, volets, capteurs et détecteurs arrivent avec leur nom ESPHome.'],
      note: 'Local, sans Home Assistant. Si vous protégez le web_server, renseignez son identifiant et son mot de passe.' },
    { id: 'sonos', name: 'Sonos', sub: 'Enceintes : lecture, volume, radios', icon: 'speaker', ready: true,
      fields: [['hosts', 'Adresses IP des enceintes', { ph: '192.168.1.85, 192.168.1.86' }]],
      steps: ['<b>Découvrir</b> trouve vos enceintes, ou relevez leur IP dans l’app Sonos › Paramètres › Système › À propos.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : une tuile par pièce Sonos.', 'Elles apparaissent dans « Où écouter ? » : les radios de Bêta home y sont jouées directement.'],
      note: 'API locale de l’enceinte (port 1400), sans compte Sonos.' },
    { id: 'cast', name: 'Google Cast', sub: 'Chromecast, Nest, TV et enceintes « Chromecast built-in »', icon: 'tv', ready: true,
      fields: [['hosts', 'Appareils (IP:nom, un par ligne ou virgule)', { ph: '192.168.1.80:Salon TV, 192.168.1.82:Nest cuisine' }]],
      steps: ['<b>Découvrir</b> remplit les appareils trouvés avec leur nom.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.', 'Volume, lecture/pause, arrêt, et diffusion des radios de Bêta home depuis « Où écouter ? ».'],
      note: 'Protocole Cast local, sans compte Google. YouTube et Netflix se lancent toujours depuis leurs applis.' },
    { id: 'z2m', name: 'Zigbee2MQTT', sub: 'Tous vos appareils Zigbee : Aqara, IKEA, Xiaomi, Philips, Lidl, Tuya…', icon: 'link', ready: true,
      fields: [['host', 'Adresse du broker MQTT', { ph: '192.168.1.20' }], ['port', 'Port', { ph: '1883' }], ['user', 'Utilisateur MQTT'], ['password', 'Mot de passe MQTT', { pw: 1 }], ['base', 'Préfixe Zigbee2MQTT', { ph: 'zigbee2mqtt' }]],
      steps: ['Il faut une <b>clé Zigbee USB</b> (Sonoff ZBDongle, SLZB…) branchée sur le NAS, et les conteneurs <b>Mosquitto</b> et <b>Zigbee2MQTT</b> (prêts dans le docker-compose de Bêta home).', 'Associez vos appareils Zigbee depuis l’interface de Zigbee2MQTT (« Permit join »).', 'Ici : adresse du NAS, port 1883, identifiants MQTT, puis <b>Tester</b> et <b>Ajouter les appareils</b>.'],
      note: 'Local, sans cloud ni Home Assistant. Lumières, prises, volets, thermostats, serrures, capteurs d’ouverture, de mouvement, de fuite, de température et d’humidité.' },
    { id: 'denon', name: 'Denon / Marantz', sub: 'Amplis et home-cinéma : marche, volume, source', icon: 'speaker', ready: true,
      fields: [['hosts', 'Adresses IP des amplis', { ph: '192.168.1.30' }]],
      steps: ['Réservez l’IP de l’ampli dans votre box (menu Réseau de l’ampli pour la voir).', 'Dans le menu de l’ampli : Réseau › <b>Contrôle réseau : Toujours actif</b>, pour l’allumer même en veille.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'],
      note: 'API locale des amplis Denon et Marantz (modèles réseau, AVR, NR, SR, Cinema…).' },
    { id: 'fully', name: 'Fully Kiosk', sub: 'Tablettes murales : écran, luminosité, annonces', icon: 'monitor', ready: true,
      fields: [['hosts', 'Tablettes (IP:nom)', { ph: '192.168.1.120:Cuisine, 192.168.1.121:Entrée' }], ['password', 'Mot de passe de la télécommande', { pw: 1 }]],
      steps: ['Sur chaque tablette, dans Fully Kiosk : Réglages › Remote Administration › <b>activer</b> et choisir un mot de passe (le même partout).', 'Réservez l’IP de chaque tablette dans votre box.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : l’écran de chaque tablette devient une tuile (allumer, luminosité).'],
      note: 'Sert aussi aux annonces vocales et à afficher la caméra quand on sonne (prochaines étapes).' },
    { id: 'wled', name: 'WLED', sub: 'Rubans et contrôleurs LED', icon: 'bulbFill', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.95' }]], steps: ['<b>Découvrir</b> trouve vos WLED, ou relevez l’IP dans l’app WLED.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'API locale, couleurs et luminosité.' },
    { id: 'nanoleaf', name: 'Nanoleaf', sub: 'Panneaux et formes lumineuses', icon: 'bulbFill', ready: true,
      fields: [['host', 'Adresse IP des panneaux', { ph: '192.168.1.96' }]], actions: [['pair', 'Appairer', 'link']],
      steps: ['Saisissez l’adresse IP (app Nanoleaf › appareil › Infos).', 'Maintenez le <b>bouton marche</b> des panneaux 5 à 7 s (la LED clignote), puis <b>Appairer</b> dans les 30 s.', '<b>Ajouter les appareils</b>.'], note: 'API locale, sans compte.' },
    { id: 'yeelight', name: 'Yeelight', sub: 'Lampes Xiaomi Yeelight', icon: 'bulbFill', ready: true,
      fields: [['hosts', 'Adresses IP des lampes', { ph: '192.168.1.97' }]], steps: ['App Yeelight › lampe › ⚙️ › activez <b>Contrôle LAN</b>.', 'Relevez l’IP de la lampe, puis <b>Tester</b> et <b>Ajouter les appareils</b>.'], note: 'Protocole local Yeelight.' },
    { id: 'wiz', name: 'Philips WiZ', sub: 'Ampoules et luminaires WiZ', icon: 'bulbFill', ready: true,
      fields: [['hosts', 'Adresses IP des ampoules', { ph: '192.168.1.98' }]], steps: ['App WiZ › Paramètres › <b>Autoriser la communication locale</b>.', 'Relevez l’IP de chaque ampoule dans votre box, puis <b>Tester</b> et <b>Ajouter les appareils</b>.'], note: 'Protocole local WiZ.' },
    { id: 'tasmota', name: 'Tasmota', sub: 'Prises et modules reprogrammés', icon: 'plug', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.99' }], ['password', 'Mot de passe web (si protégé)', { pw: 1 }]], steps: ['Relevez l’IP de chaque module (page web Tasmota).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : chaque relais devient une tuile.'], note: 'API HTTP locale de Tasmota.' },
    { id: 'daikin', name: 'Daikin', sub: 'Climatisations (adaptateur Wi-Fi local)', icon: 'snow', ready: true,
      fields: [['hosts', 'Adresses IP des clims', { ph: '192.168.1.110' }]], steps: ['Relevez l’IP de l’adaptateur Wi-Fi de chaque unité (app Daikin ou box internet).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : marche, consigne, modes, température de la pièce.'], note: 'Adaptateurs BRP069 et similaires. Les adaptateurs récents « Onecta » (cloud uniquement) ne sont pas pris en charge.' },
    { id: 'roku', name: 'Roku', sub: 'TV et lecteurs Roku', icon: 'tv', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.115' }]], steps: ['Roku › Paramètres › Système › Paramètres système avancés › <b>Contrôle par applis mobiles : Par défaut</b>.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'Marche/arrêt, volume, lecture.' },
    // marques préparées : le tuto dit quoi faire dès maintenant, le connecteur arrive ensuite
    { id: 'aqara', name: 'Aqara (Hub M3)', sub: 'Lumières, capteurs', icon: 'bulbFill',
      steps: ['App Aqara Home › Hub M3 › <b>Matter</b> : activez le pont Matter et notez le <b>code d’appairage</b>.', 'Le serveur Bêta pilotera ensuite les appareils Aqara en local via Matter.'],
      note: 'Connecteur Matter en préparation (il demande un module supplémentaire sur le NAS).' },
    { id: 'linknlink', name: 'LinknLink', sub: 'Télécommande IR eRemote, capteurs', icon: 'tv',
      steps: ['App LinknLink › appareil › mettez à jour le firmware en version <b>HA / MQTT</b>.', 'Le serveur Bêta fournira l’adresse MQTT à saisir dans l’app (… › Connexion MQTT).'],
      note: 'Connecteur MQTT en préparation (petit serveur Mosquitto ajouté au docker-compose).' },
    { id: 'schneider', name: 'Schneider Charge', sub: 'Borne de recharge', icon: 'charger',
      steps: ['Relevez le modèle et l’accès installateur de la borne (app Wiser / eSetup).', 'La borne sera reliée au serveur Bêta par <b>OCPP 1.6J</b> : suivi de la charge, départ, arrêt, limite de puissance.'],
      note: 'Connecteur OCPP en préparation. Attention : rediriger l’OCPP peut couper le lien avec l’app Wiser.' },
    { id: 'viessmann', name: 'Viessmann', sub: 'Chauffage (ViCare)', icon: 'hotWater',
      steps: ['Créez un compte sur <b>developer.viessmann.com</b> et une application (Client ID).', 'L’offre gratuite permet de lire températures et état ; régler le thermostat demande l’offre payante « Advanced ».'],
      note: 'Connecteur en préparation.' },
    { id: 'philipstv', name: 'TV Philips', sub: 'Allumage, volume, sources', icon: 'tv',
      steps: ['Réservez l’IP de la TV dans votre box internet.', 'L’appairage se fera par un code PIN affiché sur la TV.'], note: 'Connecteur en préparation (API locale JointSpace).' },
    { id: 'homepod', name: 'Apple HomePod', sub: 'Musique et volume', icon: 'speaker',
      steps: ['Réservez l’IP du HomePod dans votre box internet.'], note: 'Nécessite un petit module Python (pyatv) à côté du serveur Bêta : en préparation.' },
    { id: 'roborock', name: 'Roborock', sub: 'Aspirateur robot', icon: 'robotFill',
      steps: ['Gardez l’e-mail de votre compte Roborock : un code de connexion vous sera envoyé.'], note: 'API non officielle (python-roborock) : en préparation.' },
    { id: 'navimow', name: 'Segway Navimow', sub: 'Tondeuse robot', icon: 'mowerRobot',
      steps: ['App Navimow : demandez l’<b>accès développeur</b> (OpenAPI) pour votre tondeuse.'], note: 'En attente de l’accès développeur Segway.' },
    { id: 'verisure', name: 'Verisure', sub: 'Alarme, serrure', icon: 'shieldCheck',
      steps: ['Préparez l’e-mail du compte Verisure : un code SMS sera demandé (double authentification).', 'Le code de l’alarme sera demandé à chaque désarmement et jamais enregistré.'], note: 'API non officielle : en préparation.' },
    { id: 'ford', name: 'Ford', sub: 'Voiture (lecture seule)', icon: 'carFill',
      steps: ['Créez de préférence un <b>compte FordPass dédié</b>, partagé avec le vôtre pour la voiture.', 'Inscription sur le portail développeur Ford (FordConnect).'], note: 'API fragile, risque de blocage du compte : en préparation, en lecture seule.' }
  ];
  const BR = id => BRANDS.find(b => b.id === id);

  /* ---------- client du serveur ---------- */
  // comme B.Server.req, mais remonte le message d'erreur du serveur (ex. « appuyez sur le bouton du pont »)
  async function call(path, body, method) {
    const r = await fetch(B.Server.url() + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Beta-Key': S.conn.server.key || '' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
    return j;
  }
  const H = { list: {}, loaded: false, err: '' };
  async function load() {
    if (!B.Server.ok()) { H.err = 'serveur'; B.emit('hub'); return; }
    try { (await call('/api/hub')).forEach(x => { H.list[x.id] = x; }); H.loaded = true; H.err = ''; }
    catch (e) { H.err = /404|route inconnue/.test(e.message) ? 'version' : e.message; }
    B.emit('hub');
  }
  const status = id => { const x = H.list[id], b = BR(id); if (!b.ready) return ['wait', 'Bientôt']; if (!x) return ['wait', '—']; if (x.status === 'ok') return ['', 'Connecté']; if (x.status === 'err') return ['off', 'Erreur']; return ['wait', 'À configurer']; };
  const nDev = id => Object.values(map()).filter(r => r.brand === id).length;

  /* ---------- commandes : remplace Home Assistant pour les appareils reliés à une marque ---------- */
  const push0 = B.HA.push.bind(B.HA);
  B.HA.push = function (id, patch) {
    const r = map()[id]; if (!r) return push0(id, patch);
    if (!B.Server.ok()) return B.toast('Serveur Bêta injoignable : commande non envoyée', 'info');
    call('/api/hub/command', { brand: r.brand, id: r.id, patch, cur: dev(id) }).catch(e => B.toast(BR(r.brand).name + ' : ' + e.message, 'info'));
  };
  // un appareil relié à une marque n'est plus piloté par Home Assistant
  const ent0 = B.HA.entity;
  B.HA.entity = id => map()[id] ? '' : ent0(id);

  /* ---------- états en direct ---------- */
  async function poll() {
    const m = map(), brands = [...new Set(Object.values(m).map(r => r.brand))];
    if (!brands.length || !B.Server.ok() || document.hidden) return;
    let res; try { res = await call('/api/hub/states?brands=' + brands.join(',')); } catch (e) { return; }
    for (const id in m) {
      const r = m[id], s = res[r.brand] && res[r.brand].s[r.id];
      if (!s || !DATA.DEVICES[id]) continue;
      const cur = dev(id), p = {};
      for (const k in s) if (k !== 'color' || cur.rgb) if (cur[k] !== s[k]) p[k] = s[k];
      if (cur.moving) delete p.pos;
      if (Object.keys(p).length) { B.src = 'hub'; setDev(id, p, { silent: true }); B.src = null; }
    }
    brands.forEach(b => { if (H.list[b]) H.list[b].live = res[b] ? res[b].err || 'ok' : ''; });
  }
  setInterval(poll, 4000);
  B.Hub = { load, poll, BRANDS };

  /* ---------- page ---------- */
  RENDER.hubpage = () => {
    if (B.Server.ok() && !H.loaded && !H.err && !H._t) { H._t = 1; setTimeout(() => { H._t = 0; load(); }, 50); }
    if (!B.Server.ok()) return '<div class="cgrid scroll"><div class="cwarn wide2" style="grid-column:1/-1">' + ico('alert') + '<span><b>Le serveur Bêta du NAS est nécessaire</b> : c’est lui qui parle aux marques et garde les mots de passe. Installez-le puis testez-le dans <a href="#connexions"><b>Connexions</b></a>.</span></div>' + cards() + '</div>';
    if (H.err === 'version') return '<div class="cgrid scroll"><div class="cwarn" style="grid-column:1/-1">' + ico('alert') + '<span><b>Mettez à jour le serveur Bêta</b> : recopiez le dossier <code>server</code> sur le NAS puis relancez le projet Docker.</span></div>' + cards() + '</div>';
    return '<div class="cgrid scroll">' + cards() + '</div>';
  };
  function cards() {
    return BRANDS.map(b => {
      const s = status(b.id), x = H.list[b.id] || {}, n = nDev(b.id);
      return '<div class="ccard tile' + (b.ready ? '' : ' locked') + '"><div class="cch"><span class="bdg" style="--g1:' + (b.ready ? '#2fe0ff' : '#9fb4d8') + ';--g2:' + (b.ready ? '#1f7dff' : '#4a6aa8') + '">' + ico(b.icon) + '</span><div><b>' + esc(b.name) + '</b><small>' + esc(b.sub) + '</small></div><span class="tag2 ' + s[0] + '">' + esc(s[1]) + '</span></div>' +
        '<p class="muted" style="margin:0;font-size:12.5px;line-height:1.45">' + (x.info && b.ready ? esc(x.info) + (n ? ' · ' + n + ' dans Bêta home' : '') : esc(b.note || '')) + '</p>' +
        '<div class="row" style="gap:8px;margin-top:auto;flex-wrap:wrap"><button type="button" class="btn sm' + (b.ready && s[1] !== 'Connecté' ? ' pri' : '') + '" data-act="hubOpen" data-arg="' + b.id + '">' + ico(b.ready ? 'gear' : 'info') + (b.ready ? 'Configurer' : 'Tuto') + '</button>' +
        (b.ready ? '<button type="button" class="btn sm" data-act="hubTest" data-arg="' + b.id + '">' + ico('refresh') + 'Tester</button>' : '') +
        (b.ready && x.status === 'ok' ? '<button type="button" class="btn sm" data-act="hubImport" data-arg="' + b.id + '">' + ico('download') + 'Appareils</button>' : '') + '</div></div>';
    }).join('');
  }

  /* ---------- fiche d'une marque : tuto + réglages ---------- */
  function sheet(id) {
    const b = BR(id), x = H.list[id] || { cfg: {} }, cfg = x.cfg || {}, s = status(id);
    const steps = '<ol class="steps">' + b.steps.map(t => '<li>' + t.replace('{callback}', esc(callback())) + '</li>').join('') + '</ol>';
    if (!b.ready) return B.modal('<h2>' + ico(b.icon) + esc(b.name) + '</h2><p class="muted" style="margin:-6px 0 12px;font-size:13px">' + esc(b.sub) + '</p><h4 style="margin:0 0 8px">À préparer dès maintenant</h4>' + steps + '<p class="muted" style="font-size:12.5px;margin:12px 0 0;line-height:1.5">' + esc(b.note) + '</p>', 'sm');
    const fld = f => '<label class="field">' + f[1] + '<input name="' + f[0] + '" value="' + esc(f[2] && f[2].tmp ? '' : cfg[f[0]] == null ? '' : cfg[f[0]]) + '"' + (f[2] && f[2].pw ? ' type="password"' : '') + (f[2] && f[2].ph ? ' placeholder="' + esc(f[2].ph) + '"' : '') + ' spellcheck="false" autocomplete="off"' + (f[2] && f[2].tmp ? ' data-tmp="1"' : '') + '></label>';
    B.modal('<h2>' + ico(b.icon) + esc(b.name) + ' <span class="tag2 ' + s[0] + '" style="margin-left:8px">' + esc(s[1]) + '</span></h2>' +
      '<p class="muted" style="margin:-6px 0 12px;font-size:13px">' + esc(b.sub) + (x.info ? ' · ' + esc(x.info) : '') + '</p>' +
      '<h4 style="margin:0 0 8px">Tuto</h4>' + steps +
      '<form data-submit="hubSave" data-arg="' + id + '" style="margin-top:14px"><div class="grid2">' + b.fields.map(fld).join('') + '</div>' +
      (b.oauth ? '<p class="muted" style="font-size:12.5px;margin:6px 0 0">Adresse de retour à déclarer : <code>' + esc(callback()) + '</code>' + (/^https:/.test(callback()) ? '' : ' — <b>doit être en https</b> (reverse proxy UGOS)') + '</p>' : '') +
      '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn pri">' + ico('check') + 'Enregistrer</button>' +
      (b.actions || []).map(a => '<button type="button" class="btn" data-act="hubAction" data-arg="' + id + ':' + a[0] + '">' + ico(a[2]) + a[1] + '</button>').join('') +
      (b.oauth ? '<button type="button" class="btn" data-act="hubOauth" data-arg="' + id + '">' + ico('link') + (x.linked ? 'Se reconnecter' : 'Se connecter') + '</button>' : '') +
      '<button type="button" class="btn" data-act="hubTest" data-arg="' + id + '">' + ico('refresh') + 'Tester</button>' +
      (x.status === 'ok' ? '<button type="button" class="btn" data-act="hubImport" data-arg="' + id + '">' + ico('download') + 'Ajouter les appareils</button>' : '') + '</div></form>' +
      '<p class="muted" style="font-size:12.5px;margin:12px 0 0;line-height:1.5">' + esc(b.note) + ' Les identifiants sont gardés sur le NAS, jamais dans le navigateur.</p>', 'wide');
  }
  const formData = (el, all) => { const f = el.closest('.box').querySelector('form'), o = {}; f.querySelectorAll('input[name]').forEach(i => { if (all || !i.dataset.tmp) o[i.name] = i.value.trim(); }); return o; };
  const guard = () => { if (!isAdmin()) { B.toast('Réservé aux administrateurs', 'lock'); return false; } if (!B.Server.ok()) { B.toast('Installez d’abord le serveur Bêta (Connexions)', 'server'); return false; } return true; };
  const reopen = id => { if (document.querySelector('.modal .box')) sheet(id); B.emit('hub'); };

  B.act('hubOpen', el => sheet(el.dataset.arg));
  B.act('hubSave', async el => {
    if (!guard()) return; const id = el.dataset.arg;
    try { H.list[id] = await call('/api/hub/' + id, formData(el), 'PUT'); B.toast('Réglages enregistrés sur le NAS', 'check'); reopen(id); } catch (e) { B.toast('Enregistrement impossible : ' + e.message, 'info'); }
  });
  B.act('hubAction', async el => {
    if (!guard()) return; const [id, a] = el.dataset.arg.split(':');
    el.disabled = true;
    try { H.list[id] = await call('/api/hub/' + id + '/action/' + a, formData(el, true)); B.toast('C’est fait', 'check'); reopen(id); }
    catch (e) { B.toast(BR(id).name + ' : ' + e.message, 'info'); el.disabled = false; }
  });
  B.act('hubTest', async el => {
    if (!guard()) return; const id = el.dataset.arg;
    try { const x = H.list[id] = await call('/api/hub/' + id + '/test', {}); B.toast(BR(id).name + ' : ' + x.info, x.status === 'ok' ? 'check' : 'info'); reopen(id); }
    catch (e) { B.toast(e.message, 'info'); }
  });
  B.act('hubOauth', async el => {
    if (!guard()) return; const id = el.dataset.arg;
    try {
      const r = await call('/api/hub/' + id + '/oauth?redirect=' + encodeURIComponent(callback()));
      window.open(r.url, '_blank');
      B.toast('Autorisez Bêta home dans la page qui s’ouvre, puis revenez ici et cliquez « Tester »', 'link');
    } catch (e) { B.toast(e.message, 'info'); }
  });

  /* ---------- import des appareils trouvés par l'API ---------- */
  let imp = null;
  const kindOpts = k => Object.keys(B.KIND).map(t => '<option value="' + t + '"' + (t === k ? ' selected' : '') + '>' + esc(B.KIND[t][0]) + '</option>').join('');
  async function importer(id) {
    if (!guard()) return;
    B.modal('<h2>' + ico('download') + 'Appareils ' + esc(BR(id).name) + '</h2><p class="muted">Lecture des appareils…</p>', 'wide');
    let list; try { list = await call('/api/hub/' + id + '/devices'); } catch (e) { B.closeModal(); return B.toast('Lecture impossible : ' + e.message, 'info'); }
    const linked = new Set(Object.values(map()).filter(r => r.brand === id).map(r => r.id));
    imp = { id, list: list.filter(d => !linked.has(d.id) && B.KIND[d.kind]) };
    const all = B.floors(true).flatMap(f => B.roomsList(f.id, true).map(r => [f, r]));
    const match = room => { const n = (room || '').toLowerCase(); const hit = all.find(([f, r]) => r.name.toLowerCase() === n || r.label.toLowerCase() === n); return hit ? hit[1].key : ''; };
    const body = !imp.list.length ? '<p class="muted">' + (list.length ? 'Tous les appareils ' + esc(BR(id).name) + ' sont déjà dans Bêta home.' : 'Aucun appareil trouvé sur ce compte.') + '</p>' :
      '<p class="muted" style="margin:0 0 10px;font-size:13px">' + imp.list.length + ' appareil(s) trouvé(s) par l’API. Les pièces de la marque sont associées aux pièces du même nom ; vérifiez puis importez.</p><form data-submit="hubImportGo"><div class="implist">' +
      imp.list.map((d, i) => '<label class="imrow"><input type="checkbox" name="on' + i + '" checked><span><b>' + esc(d.name) + '</b><small>' + esc(B.KIND[d.kind][0] + (d.info ? ' · ' + d.info : '')) + (d.room ? ' · pièce « ' + esc(d.room) + ' »' : '') + (d.error ? ' · ' + esc(d.error) : '') + '</small></span><select name="k' + i + '">' + kindOpts(d.kind) + '</select>' +
        '<select name="r' + i + '"><option value="new:' + esc(d.room || BR(id).name) + '">Nouvelle pièce : ' + esc(d.room || BR(id).name) + '</option>' + all.map(([f, r]) => '<option value="' + esc(r.key) + '"' + (match(d.room) === r.key ? ' selected' : '') + '>' + esc(f.name + ' · ' + r.label) + '</option>').join('') + '</select></label>').join('') +
      '</div><div class="row" style="justify-content:flex-end;margin-top:12px;gap:8px;flex-wrap:wrap"><select class="search" name="newfloor" style="flex:0 0 200px" aria-label="Niveau des nouvelles pièces">' + B.floors(true).map(f => '<option value="' + f.id + '">' + esc(f.name) + '</option>').join('') + '</select><button class="btn pri">' + ico('download') + 'Importer la sélection</button></div></form>';
    B.modal('<h2>' + ico('download') + 'Appareils ' + esc(BR(id).name) + '</h2>' + body, 'wide');
  }
  B.act('hubImport', el => importer(el.dataset.arg));
  B.act('hubImportGo', el => {
    const f = new FormData(el), nf = f.get('newfloor'), m = map(), added = []; let n = 0;
    imp.list.forEach((d, i) => {
      if (!f.get('on' + i)) return;
      let rk = f.get('r' + i), fl, room;
      if (rk.startsWith('new:')) { room = rk.slice(4); fl = nf; if (!B.roomsList(fl, true).some(r => r.name === room)) C.rooms.push({ id: uid('r'), name: room, floor: fl, icon: 'homeFill' }); }
      else { fl = rk.split('|')[0]; room = rk.split('|').slice(1).join('|'); }
      const did = fl + '.c' + uid('');
      C.devices.push({ id: did, type: f.get('k' + i), name: d.name, room, floor: fl, ha: '' });
      m[did] = { brand: imp.id, id: d.id }; added.push([did, d.state]); n++;
    });
    added.forEach(([did]) => { const fl = did.split('.')[0], fo = B.floor(fl); if (fo && fo.builtin) C.layout[fl] = 'auto'; });
    B.registerCustom();
    added.forEach(([did, s]) => { if (s && Object.keys(s).length) setDev(did, s, { silent: true }); });
    imp = null; B.save(); B.closeModal(); B.show(); B.toast(n + ' appareil' + (n > 1 ? 's ajoutés' : ' ajouté') + ' — pilotés en direct, sans Home Assistant', 'download');
  });
  // un appareil supprimé ne garde pas son lien avec la marque
  setInterval(() => { const m = map(); let ch = false; for (const id in m) if (!DATA.DEVICES[id]) { delete m[id]; ch = true; } if (ch) B.save(); }, 30000);

  B.route('marques', { title: 'Marques', bg: BG, render: () => { if (B.Server.ok() && !H._t) { H._t = 1; setTimeout(() => { H._t = 0; load(); }, 50); } return B.side('parametres') + B.header({ id: 'marques', title: 'Marques', sub: 'En direct, sans Home Assistant', icon: 'link', info: { t: 'infobox', keys: ['hub', 'conn'], items: () => {
    const ready = BRANDS.filter(b => b.ready), ok = ready.filter(b => H.list[b.id] && H.list[b.id].status === 'ok').length;
    return [{ icon: 'link', v: ok + '/' + ready.length, l: 'Marques reliées', cls: 'c' }, { icon: 'homeFill', v: Object.keys(map()).length, l: 'Appareils en direct' }, { icon: 'server', v: B.Server.ok() ? 'En ligne' : 'À installer', l: 'Serveur Bêta', cls: B.Server.ok() ? 'g' : 'y', go: 'connexions' }, { icon: 'sparkle', v: BRANDS.length - ready.length, l: 'Bientôt' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('link', 'Marques', isAdmin() ? '' : '<span class="tag2 wait">' + ico('lock') + 'Lecture seule</span>') + T({ t: 'hubpage', keys: ['hub', 'conn'] }) + '</section>'; } });

  // raccourci depuis Connexions
  const conn0 = RENDER.conn;
  RENDER.conn = () => conn0().replace('<div class="cwarn">', '<a class="cwarn" href="#marques" style="grid-column:1/-1;border-color:rgba(47,224,255,.45)">' + ico('link') + '<span><b>Nouveau : Marques</b> — reliez Somfy, Hue, Samsung, Siemens, Govee, Elgato… directement, sans Home Assistant. Un tuto pour chaque marque.</span></a><div class="cwarn">');
  if (B.Server.url()) setTimeout(load, 2500);
})();
