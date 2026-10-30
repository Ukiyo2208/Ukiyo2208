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
    { id: 'matter', name: 'Matter', sub: 'Tous les appareils Matter : Aqara, Eve, Nanoleaf, IKEA, Meross, TP-Link…', icon: 'link', ready: true,
      fields: [['host', 'Adresse du serveur Matter', { ph: '192.168.1.20:5580' }], ['pairCode', 'Code d’appairage Matter', { ph: '3497-011-2332', tmp: 1 }]],
      actions: [['commission', 'Ajouter cet appareil', 'plus']],
      steps: ['Lancez le conteneur <b>matter-server</b> (bloc prêt à décommenter dans le docker-compose de Bêta home), puis saisissez l’adresse du NAS et <b>Tester</b>.', 'Appareil déjà dans une autre appli (Aqara Home, Alexa, Google Home, Maison) : dans cette appli, choisissez <b>« Activer le mode d’association » / « Partager »</b> pour obtenir un code à 11 chiffres.', 'Saisissez le code, <b>Ajouter cet appareil</b> (jusqu’à 2 min), puis <b>Ajouter les appareils</b>.', 'Aqara Hub M3 : app Aqara › Hub › <b>Matter</b> › Partager : tous les appareils du hub arrivent d’un coup.'],
      note: 'Contrôle 100 % local. Les appareils neufs en Wi-Fi/Thread s’ajoutent d’abord dans l’appli du fabricant (le NAS n’a pas de Bluetooth), puis sont partagés vers Bêta home.' },
    { id: 'musicassistant', name: 'Music Assistant', sub: 'Toute votre musique sur toutes vos enceintes', icon: 'music', ready: true,
      fields: [['host', 'Adresse du serveur', { ph: '192.168.1.20:8095' }], ['token', 'Jeton (si demandé)', { pw: 1 }]],
      steps: ['Lancez le conteneur <b>music-assistant</b> (bloc prêt à décommenter dans le docker-compose de Bêta home) et ouvrez <code>http://NAS:8095</code> pour y ajouter vos services (Spotify, Deezer, Tidal, Plex, radios…) et vos enceintes.', 'Ici : adresse du NAS, puis <b>Tester</b> et <b>Ajouter les appareils</b> : chaque lecteur Music Assistant devient une enceinte Bêta.', 'Les radios de Bêta home et « Où écouter ? » passent alors par Music Assistant.'],
      note: 'Fonctionne sans Home Assistant (API locale du serveur Music Assistant, port 8095). Versions récentes : créez un jeton dans Paramètres › Profil.' },
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
    { id: 'kasa', name: 'TP-Link Kasa', sub: 'Prises, multiprises, interrupteurs, ampoules Kasa', icon: 'plug', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.71, 192.168.1.72' }]],
      steps: ['<b>Découvrir</b> trouve vos Kasa, ou relevez leur IP dans votre box.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : chaque prise (et chaque sortie d’une multiprise) devient une tuile.'],
      note: 'Protocole local Kasa, sans compte. Les prises avec mesure (KP115, HS110) remontent leur consommation.' },
    { id: 'tapo', name: 'TP-Link Tapo', sub: 'Prises et ampoules Tapo (P100, P110, L530…)', icon: 'plug', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.73' }], ['email', 'E-mail du compte Tapo'], ['password', 'Mot de passe Tapo', { pw: 1 }]],
      steps: ['Les Tapo exigent les identifiants de votre compte Tapo, mais ils restent sur le NAS : la connexion est 100 % locale (protocole KLAP).', 'App Tapo › Moi › Services tiers › activez <b>Compatibilité tierce</b> si l’option existe.', 'Relevez l’IP de chaque appareil, puis <b>Tester</b> et <b>Ajouter les appareils</b>.'],
      note: 'Le mot de passe est enregistré uniquement sur le serveur Bêta (jamais renvoyé au navigateur).' },
    { id: 'lifx', name: 'LIFX', sub: 'Ampoules et rubans LIFX', icon: 'bulbFill', ready: true,
      fields: [['hosts', 'Adresses IP des ampoules', { ph: '192.168.1.74' }]],
      steps: ['Relevez l’IP de chaque ampoule (app LIFX › ampoule › Infos, ou votre box).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : marche, luminosité et couleur.'], note: 'Protocole local LIFX (UDP), sans compte.' },
    { id: 'broadlink', name: 'Broadlink', sub: 'Télécommandes infrarouges RM mini / RM4', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP du Broadlink', { ph: '192.168.1.75' }], ['codeName', 'Nom du bouton à apprendre', { ph: 'TV marche', tmp: 1 }]],
      actions: [['learn', 'Apprendre un code', 'plus'], ['forget', 'Oublier ce code', 'trash']],
      steps: ['Installez le Broadlink avec l’app Broadlink puis <b>quittez</b> l’app (inutile de créer une « pièce »). Réservez son IP.', 'Donnez un nom au bouton (ex. « Clim chambre on »), appuyez sur <b>Apprendre un code</b>, puis visez le Broadlink avec la vraie télécommande et appuyez sur le bouton dans les 20 s.', 'Répétez pour chaque bouton, puis <b>Ajouter les appareils</b> : chaque code devient un bouton à lancer (aussi dans les automatisations).'],
      note: 'Idéal pour les vieilles TV, clims sans Wi-Fi, ventilateurs, barres de son.' },
    { id: 'philipstv', name: 'TV Philips', sub: 'Android TV Philips : marche, volume, lecture', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP de la TV', { ph: '192.168.1.60' }], ['pinCode', 'Code affiché sur la TV', { ph: '1234', tmp: 1 }]],
      actions: [['pin', 'Afficher le code', 'link'], ['grant', 'Valider le code', 'check']],
      steps: ['TV allumée, réservez son IP dans votre box.', '<b>Afficher le code</b> : un code à 4 chiffres apparaît sur la TV.', 'Saisissez-le puis <b>Valider le code</b>, et <b>Ajouter les appareils</b>.'],
      note: 'API locale JointSpace (TV Android Philips 2016 et +).' },
    { id: 'samsungtv', name: 'TV Samsung', sub: 'TV Tizen : marche, volume, lecture', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP de la TV', { ph: '192.168.1.61' }], ['mac', 'Adresse MAC (pour l’allumer)', { ph: 'auto après « Autoriser »' }]],
      actions: [['pair', 'Autoriser', 'link']],
      steps: ['TV allumée, réservez son IP dans votre box.', '<b>Autoriser</b>, puis acceptez la fenêtre qui apparaît sur la TV avec la télécommande.', 'Réglages TV › Général › Gestion des appareils externes › <b>Allumer avec mobile</b> : activé (pour l’allumage par le réseau).', '<b>Ajouter les appareils</b>.'],
      note: 'Télécommande locale Samsung (2016 et +). L’allumage passe par le Wake-on-LAN.' },
    { id: 'lgtv', name: 'TV LG', sub: 'TV webOS : marche, volume, lecture, messages', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP de la TV', { ph: '192.168.1.62' }], ['mac', 'Adresse MAC (pour l’allumer)', { ph: 'aa:bb:cc:dd:ee:ff' }], ['name', 'Nom de la TV', { ph: 'TV salon' }]],
      actions: [['pair', 'Appairer', 'link']],
      steps: ['TV allumée, réservez son IP dans votre box et relevez son adresse MAC (Réglages › Réseau).', 'Réglages › Général › Appareils › <b>LG Connect Apps</b> et <b>Allumer via Wi-Fi</b> : activés.', '<b>Appairer</b> puis acceptez la demande sur la TV, et <b>Ajouter les appareils</b>.'],
      note: 'API locale webOS. Les annonces (sonnette…) peuvent s’afficher en message sur la TV.' },
    { id: 'frigate', name: 'Frigate', sub: 'Détection de personnes sur toutes les caméras (NVR local)', icon: 'camera', ready: true,
      fields: [['host', 'Adresse de Frigate', { ph: '192.168.1.20:5000' }], ['user', 'Utilisateur (Frigate 0.14+, port 8971)'], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Installez <b>Frigate</b> sur le NAS (conteneur Docker) et ajoutez-y vos caméras.', 'Ici : adresse du NAS et port 5000 (ou 8971 avec identifiant), puis <b>Tester</b> et <b>Ajouter les appareils</b>.', 'Chaque caméra devient un détecteur « personne / voiture / animal » : utilisez-le dans Notifs (alerte pendant l’absence) ou les automatismes.'],
      note: 'Détection 100 % locale par IA, sans abonnement.' },
    { id: 'reolink', name: 'Reolink', sub: 'Caméras et sonnette vidéo : mouvement, personne, appui', icon: 'camera', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.60, 192.168.1.61' }], ['user', 'Utilisateur', { ph: 'admin' }], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Appli Reolink › caméra › Paramètres › Réseau › Avancé › <b>Configuration des ports</b> : activez HTTP (ou HTTPS).', 'Créez de préférence un utilisateur « invité » pour Bêta home.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>. La sonnette Reolink devient un bouton : choisissez-le dans Notifs › Bouton de la sonnette.'],
      note: 'API locale, sans cloud. L’image et le direct passent par « Découvrir » (go2rtc).' },
    { id: 'unifiprotect', name: 'UniFi Protect', sub: 'Caméras et sonnettes Ubiquiti', icon: 'camera', ready: true,
      fields: [['host', 'Adresse de la console UniFi', { ph: '192.168.1.1' }], ['user', 'Utilisateur local'], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['UniFi OS › Admins › <b>Ajouter un admin local</b> (rôle « Lecture seule » pour Protect).', 'Saisissez l’adresse de la console (UDM, Cloud Key, UNVR), l’utilisateur et le mot de passe.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : mouvement par caméra et appui sur les sonnettes G4.'],
      note: 'Local, sans compte Ubiquiti en ligne.' },
    { id: 'hikvision', name: 'Hikvision', sub: 'Caméras et NVR : mouvement, ligne franchie, intrusion', icon: 'camera', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.64' }], ['user', 'Utilisateur', { ph: 'admin' }], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Dans la caméra : Configuration › Évènement › cochez <b>Notifier le centre de surveillance</b> pour les détections voulues.', 'Saisissez IP, utilisateur, mot de passe, puis <b>Tester</b> et <b>Ajouter les appareils</b>.'],
      note: 'Flux d’évènements ISAPI tenu ouvert par le serveur : réaction en moins d’une seconde. Aussi HiLook, Annke.' },
    { id: 'dahua', name: 'Dahua / Amcrest', sub: 'Caméras, NVR et interphones VTO', icon: 'camera', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.65' }], ['user', 'Utilisateur', { ph: 'admin' }], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Saisissez IP, utilisateur et mot de passe de la caméra ou de l’interphone.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : mouvement / personne, et appui sur l’interphone (à choisir comme bouton de sonnette).'],
      note: 'Flux d’évènements local. Aussi Imou en mode local, Lorex.' },
    { id: 'nuki', name: 'Nuki', sub: 'Serrure connectée et Opener', icon: 'lock', ready: true,
      fields: [['host', 'Adresse IP du Nuki Bridge', { ph: '192.168.1.70' }], ['token', 'Jeton API du bridge', { pw: 1 }]],
      steps: ['Appli Nuki › Bridge › <b>Gérer le bridge</b> › activez l’<b>API HTTP</b> et notez le jeton.', 'Saisissez IP et jeton, <b>Tester</b> puis <b>Ajouter les appareils</b> : serrure (verrouiller / ouvrir), capteur de porte, batterie.'],
      note: 'API locale du bridge. Les serrures Nuki 4.0 Pro en Matter passent aussi par la fiche Matter.' },
    { id: 'freebox', name: 'Freebox', sub: 'Qui est à la maison, Wi-Fi marche/arrêt', icon: 'wifi', ready: true,
      fields: [['host', 'Adresse de la Freebox', { ph: 'mafreebox.freebox.fr' }], ['presence', 'Appareils à suivre (noms ou adresses MAC)', { ph: 'iPhone de Bastien, iPhone de Sarah' }]],
      actions: [['pair', 'Autoriser', 'link']],
      steps: ['<b>Autoriser</b>, puis appuyez dans les 90 s sur la <b>flèche ›</b> de l’écran de la Freebox Server.', 'Freebox OS › Paramètres › Gestion des accès › Applications › Bêta home : cochez <b>Modification des réglages</b> (pour couper le Wi-Fi).', 'Notez le nom des téléphones de la famille (tels qu’affichés dans Freebox OS), <b>Ajouter les appareils</b> : une « présence » par téléphone.'],
      note: 'API locale officielle. Sert de détection de présence sans GPS (téléphone connecté au Wi-Fi = à la maison).' },
    { id: 'livebox', name: 'Livebox', sub: 'Qui est à la maison, Wi-Fi marche/arrêt', icon: 'wifi', ready: true,
      fields: [['host', 'Adresse de la Livebox', { ph: '192.168.1.1' }], ['password', 'Mot de passe admin de la Livebox', { pw: 1 }], ['presence', 'Appareils à suivre (noms ou MAC)', { ph: 'iPhone-de-Bastien' }]],
      steps: ['Le mot de passe est celui de l’interface de la Livebox (par défaut : les 8 premiers caractères de la clé Wi-Fi).', 'Notez le nom des téléphones (Mes équipements), <b>Tester</b> puis <b>Ajouter les appareils</b>.'],
      note: 'API locale de la box.' },
    { id: 'bbox', name: 'Bbox', sub: 'Qui est à la maison, Wi-Fi marche/arrêt', icon: 'wifi', ready: true,
      fields: [['host', 'Adresse de la Bbox', { ph: 'mabbox.bytel.fr' }], ['password', 'Mot de passe admin (pour le Wi-Fi)', { pw: 1 }], ['presence', 'Appareils à suivre (noms ou MAC)', { ph: 'iPhone-Bastien' }]],
      steps: ['La liste des appareils se lit sans mot de passe ; il faut celui de l’interface pour couper le Wi-Fi.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'API locale de la box.' },
    { id: 'linky', name: 'Linky', sub: 'Consommation électrique (Enedis)', icon: 'boltPlain', ready: true,
      fields: [['prm', 'Numéro de compteur (PRM, 14 chiffres)'], ['token', 'Jeton conso.boris.sh', { pw: 1 }]],
      steps: ['Sur <b>conso.boris.sh</b>, connectez-vous avec votre compte Enedis et autorisez le partage : un jeton s’affiche.', 'Le numéro PRM figure sur la facture ou sur le compteur (touche +).', 'Dans votre espace Enedis, activez la <b>courbe de charge</b> (puissance par 30 min).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : consommation de la veille et puissance.'],
      note: 'Gratuit. Enedis publie les données le lendemain. Pour le direct, un module TIC Zigbee (Lixee) passe par Zigbee2MQTT.' },
    { id: 'solaire', name: 'Panneaux solaires', sub: 'Fronius, Enphase, SMA, Huawei : production en direct', icon: 'sun', ready: true,
      fields: [['type', 'Onduleur (fronius, enphase, sma, huawei)', { ph: 'fronius' }], ['host', 'Adresse IP de l’onduleur / Envoy'], ['token', 'Jeton Enphase (Envoy récents)', { pw: 1 }], ['port', 'Port Modbus (SMA / Huawei)', { ph: '502' }]],
      steps: ['<b>Fronius</b> : rien à faire (Solar API activée par défaut). <b>Enphase</b> : jeton sur entrez.enphaseenergy.com (Envoy firmware 7+).', '<b>SMA</b> et <b>Huawei</b> : activez <b>Modbus TCP</b> dans l’onduleur (Sunny Portal / appli FusionSolar).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : production, échange avec le réseau, consommation.'],
      note: 'Lecture locale, toutes les 10 s.' },
    { id: 'ocpp', name: 'Borne OCPP', sub: 'Toute borne compatible : Schneider, ABB, Alfen, Keba, Zaptec…', icon: 'charger', ready: true,
      fields: [['port', 'Port d’écoute du serveur', { ph: '9220' }]],
      steps: ['<b>Enregistrer</b> : le serveur Bêta attend les bornes sur <code>ws://IP-du-NAS:9220/nom-de-la-borne</code>.', 'Dans l’outil de configuration de la borne (Schneider : eSetup / EVlink Pro AC), réglez le <b>serveur OCPP 1.6J</b> sur cette adresse.', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : état, puissance, énergie, départ / arrêt de la charge.'],
      note: 'Sans cloud. Attention : la borne ne parle qu’à un seul serveur OCPP (l’appli du fabricant peut perdre le contrôle).' },
    { id: 'wallbox', name: 'Wallbox', sub: 'Bornes Pulsar, Commander, Copper', icon: 'charger', ready: true,
      fields: [['email', 'E-mail myWallbox'], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Saisissez le compte de l’appli <b>myWallbox</b>, <b>Tester</b> puis <b>Ajouter les appareils</b> : charge en cours, puissance, pause / reprise.'], note: 'API du compte Wallbox (cloud).' },
    { id: 'easee', name: 'Easee', sub: 'Bornes Easee Home / Charge', icon: 'charger', ready: true,
      fields: [['email', 'E-mail ou téléphone Easee'], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Saisissez le compte de l’appli <b>Easee</b>, <b>Tester</b> puis <b>Ajouter les appareils</b>.'], note: 'API officielle Easee (cloud).' },
    { id: 'cozytouch', name: 'Cozytouch', sub: 'Atlantic, Thermor, Sauter : radiateurs, chauffe-eau', icon: 'hotWater', ready: true,
      fields: [['email', 'E-mail Cozytouch'], ['password', 'Mot de passe', { pw: 1 }]],
      steps: ['Les appareils doivent être dans l’appli <b>Cozytouch</b> (bridge Cozytouch ou appareils Wi-Fi).', 'Saisissez le compte, <b>Tester</b> puis <b>Ajouter les appareils</b> : consignes des radiateurs, chauffe-eau, températures.'],
      note: '⚠️ API non officielle (la même que l’appli), lue toutes les minutes. Avec une box TaHoma, la fiche Somfy TaHoma les pilote en local.' },
    { id: 'netatmo', name: 'Netatmo / Legrand', sub: 'Thermostat, vannes, station météo, Legrand with Netatmo', icon: 'therm', ready: true, oauth: true,
      fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', { pw: 1 }]],
      steps: ['Sur <b>dev.netatmo.com</b> › My apps › <b>Create</b> : nom « Bêta home », adresse de retour : <code>{callback}</code>', 'Copiez Client ID et secret, <b>Enregistrer</b>, puis <b>Se connecter</b> avec votre compte Netatmo (ou Legrand Home + Control).', '<b>Ajouter les appareils</b> : chauffage par pièce, prises et interrupteurs Céliane / dooxie, volets, station météo.'],
      note: 'API officielle et gratuite.' },
    { id: 'tado', name: 'tado°', sub: 'Thermostats, têtes de radiateur, Smart AC', icon: 'therm', ready: true,
      fields: [], actions: [['login', 'Se connecter', 'link'], ['finish', 'Terminer', 'check']],
      steps: ['<b>Se connecter</b> : un lien s’affiche sous le titre. Ouvrez-le, connectez-vous à tado° et validez.', 'Revenez ici et cliquez <b>Terminer</b>.', '<b>Ajouter les appareils</b> : une tuile par pièce (consigne, température, humidité).'],
      note: 'Aucun mot de passe enregistré. Attention au quota gratuit de tado° (100 requêtes par jour sans abonnement) : lecture toutes les 15 min recommandée.' },
    { id: 'sensibo', name: 'Sensibo', sub: 'Clims infrarouges connectées', icon: 'snow', ready: true,
      fields: [['apiKey', 'Clé API Sensibo', { pw: 1 }]],
      steps: ['Sur <b>home.sensibo.com</b> › menu › <b>API</b> : créez une clé.', 'Collez-la, <b>Tester</b> puis <b>Ajouter les appareils</b> : marche, consigne, mode, température et humidité de la pièce.'], note: 'API officielle.' },
    { id: 'ecowitt', name: 'Ecowitt', sub: 'Station météo perso (GW1100, GW2000, Froggit)', icon: 'rain', ready: true,
      fields: [['host', 'Adresse IP de la passerelle', { ph: '192.168.1.90' }]],
      steps: ['Relevez l’IP de la passerelle (appli WS View Plus).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : température, humidité, vent, pluie, capteurs des pièces.'], note: 'Lecture locale, sans cloud.' },
    { id: 'tuya', name: 'Tuya (local)', sub: 'Lidl Silvercrest, Moes, Nedis, Konyks, Blitzwolf…', icon: 'plug', ready: true,
      fields: [['devices', 'Appareils : IP, id, clé locale, version, nom (un par ligne)', { ph: '192.168.1.80, bf12…, 1a2b3c…, 3.3, Prise salon', pw: 1 }]],
      steps: ['Récupérez une fois l’<b>id</b> et la <b>clé locale</b> de chaque appareil : compte gratuit sur <b>iot.tuya.com</b> lié à l’appli Smart Life, ou outil <code>python -m tinytuya wizard</code>.', 'Une ligne par appareil : <code>IP, id, clé, 3.3 ou 3.4, nom</code>. Réservez les IP dans votre box.', 'Fermez l’appli Smart Life sur les téléphones (un seul contrôle local à la fois), puis <b>Tester</b> et <b>Ajouter les appareils</b>.'],
      note: 'Ensuite 100 % local (protocoles 3.3 et 3.4). Si vous changez d’appli ou réinitialisez l’appareil, la clé change.' },
    { id: 'dirigera', name: 'IKEA Dirigera', sub: 'Lampes, prises, stores et capteurs IKEA', icon: 'bulbFill', ready: true,
      fields: [['host', 'Adresse IP de la passerelle', { ph: '192.168.1.95' }]], actions: [['pair', 'Appairer', 'link']],
      steps: ['Saisissez l’IP de la passerelle Dirigera (appli IKEA Home smart › Hub).', 'Cliquez <b>Appairer</b>, puis appuyez sur le <b>bouton « action »</b> au dos de la passerelle dans la minute.', '<b>Ajouter les appareils</b> : avec leur pièce IKEA.'], note: 'API locale de la passerelle.' },
    { id: 'zwavejs', name: 'Z-Wave JS', sub: 'Tous vos appareils Z-Wave', icon: 'link', ready: true,
      fields: [['host', 'Adresse du serveur Z-Wave JS', { ph: '192.168.1.20:3000' }]],
      steps: ['Lancez <b>Z-Wave JS UI</b> sur le NAS (conteneur Docker) avec la clé Z-Wave USB, et associez-y vos appareils.', 'Dans Z-Wave JS UI › Réglages › Home Assistant : activez <b>WS Server</b> (port 3000).', 'Ici : adresse du NAS, <b>Tester</b> puis <b>Ajouter les appareils</b>.'], note: 'Local, mises à jour en direct.' },
    { id: 'deconz', name: 'deCONZ / Phoscon', sub: 'Clé ConBee / RaspBee', icon: 'link', ready: true,
      fields: [['host', 'Adresse de la passerelle', { ph: '192.168.1.20:8080' }]], actions: [['pair', 'Appairer', 'link']],
      steps: ['Phoscon › Passerelle › Avancé › <b>Authentifier l’application</b>.', 'Dans les 60 s : <b>Appairer</b> ici, puis <b>Ajouter les appareils</b>.'], note: 'API locale.' },
    { id: 'switchbot', name: 'SwitchBot', sub: 'Bot, rideaux, stores, capteurs, télécommandes IR', icon: 'plug', ready: true,
      fields: [['token', 'Jeton', { pw: 1 }], ['secret', 'Clé secrète', { pw: 1 }]],
      steps: ['Appli SwitchBot › Profil › Préférences › touchez 10 fois <b>Version de l’appli</b> › Options développeur : copiez le jeton et la clé secrète.', 'Il faut un <b>Hub SwitchBot</b> pour les appareils Bluetooth.', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'API officielle (cloud), lue toutes les 2 min à cause du quota de 10 000 appels par jour.' },
    { id: 'mqttha', name: 'MQTT (découverte)', sub: 'LinknLink, OpenBeken, et tout ce qui s’annonce sur MQTT', icon: 'link', ready: true,
      fields: [['host', 'Adresse du broker MQTT', { ph: '192.168.1.20' }], ['port', 'Port', { ph: '1883' }], ['user', 'Utilisateur MQTT'], ['password', 'Mot de passe MQTT', { pw: 1 }], ['prefix', 'Préfixe de découverte', { ph: 'homeassistant' }]],
      steps: ['Le broker <b>Mosquitto</b> du docker-compose suffit.', 'Dans chaque appareil, renseignez l’adresse du broker et activez la <b>découverte « Home Assistant »</b> (LinknLink : firmware HA ; OpenBeken, Tasmota, ESPHome : option MQTT discovery).', '<b>Tester</b>, puis <b>Ajouter les appareils</b> : prises, lumières, volets, capteurs et boutons.'], note: 'Local, sans Home Assistant : Bêta lit les mêmes annonces.' },
    { id: 'spotify', name: 'Spotify', sub: 'Lecture sur vos appareils Spotify Connect', icon: 'music', ready: true, oauth: true,
      fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', { pw: 1 }]],
      steps: ['Sur <b>developer.spotify.com</b> › Dashboard › <b>Create app</b> : API « Web API », adresse de retour : <code>{callback}</code>', 'Copiez Client ID et secret, <b>Enregistrer</b>, puis <b>Se connecter</b> (compte Premium nécessaire pour piloter la lecture).', '<b>Ajouter les appareils</b> : chaque appareil Spotify Connect devient une enceinte (lecture, volume, titre).'],
      note: 'Spotify exige une adresse de retour en https : passez par le reverse proxy d’UGOS (comme SmartThings).' },
    { id: 'musiccast', name: 'Yamaha MusicCast', sub: 'Amplis, barres de son, enceintes', icon: 'speaker', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.31' }]], steps: ['Relevez l’IP de chaque appareil (appli MusicCast › Paramètres).', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'API locale.' },
    { id: 'bose', name: 'Bose SoundTouch', sub: 'Enceintes SoundTouch', icon: 'speaker', ready: true,
      fields: [['hosts', 'Adresses IP', { ph: '192.168.1.32' }]], steps: ['Relevez l’IP de chaque enceinte (appli SoundTouch › Réglages › Infos).', '<b>Tester</b>, puis <b>Ajouter les appareils</b>.'], note: 'API locale (port 8090).' },
    { id: 'bravia', name: 'TV Sony Bravia', sub: 'TV Android / Google TV Sony', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP de la TV', { ph: '192.168.1.63' }], ['psk', 'Clé pré-partagée', { pw: 1 }], ['name', 'Nom de la TV', { ph: 'TV salon' }]],
      steps: ['TV › Paramètres › Réseau › Configuration du réseau domestique › <b>Contrôle IP</b> : Authentification « Normale et clé pré-partagée », choisissez une clé (ex. 0000).', 'Activez aussi <b>Contrôle à distance simple IP</b>.', 'Saisissez IP et clé, <b>Tester</b> puis <b>Ajouter les appareils</b>.'], note: 'API locale.' },
    { id: 'androidtv', name: 'Fire TV / Android TV', sub: 'Fire TV, Google TV, Shield : marche, volume, applis', icon: 'tv', ready: true,
      fields: [['host', 'Adresse IP', { ph: '192.168.1.66' }], ['name', 'Nom', { ph: 'Fire TV salon' }]], actions: [['pair', 'Autoriser', 'link']],
      steps: ['Fire TV : Paramètres › Ma Fire TV › Options pour les développeurs › <b>Débogage ADB : activé</b> (sur Google TV : Paramètres › Système › 7 appuis sur « Build », puis Débogage USB et réseau).', '<b>Autoriser</b>, puis sur la TV cochez <b>Toujours autoriser</b> « beta-home » et validez.', '<b>Ajouter les appareils</b>.'], note: 'Local, par le débogage réseau. Aussi la tablette Fire / Alexa si besoin.' },
    { id: 'jellyfin', name: 'Jellyfin', sub: 'Ce qui est regardé, lecture/pause', icon: 'film', ready: true,
      fields: [['host', 'Adresse du serveur', { ph: '192.168.1.20:8096' }], ['apiKey', 'Clé API', { pw: 1 }]],
      steps: ['Jellyfin › Tableau de bord › <b>Clés API</b> › + : nom « Bêta home ».', 'Collez la clé, <b>Tester</b> puis <b>Ajouter les appareils</b> : chaque appareil qui lit du Jellyfin apparaît.'], note: 'API locale. Fonctionne aussi avec Emby.' },
    { id: 'valetudo', name: 'Valetudo', sub: 'Aspirateurs robots sans cloud (Dreame, Roborock…)', icon: 'robotFill', ready: true,
      fields: [['hosts', 'Adresses IP des robots', { ph: '192.168.1.120' }]], steps: ['Le robot doit tourner sous <b>Valetudo</b> (valetudo.cloud).', 'Saisissez son IP, <b>Tester</b> puis <b>Ajouter les appareils</b> : état, batterie, départ, retour à la base.'], note: 'API locale.' },
    { id: 'husqvarna', name: 'Husqvarna / Gardena', sub: 'Tondeuses Automower, arrosage Gardena smart', icon: 'mowerRobot', ready: true,
      fields: [['appKey', 'Clé d’application'], ['appSecret', 'Secret d’application', { pw: 1 }]],
      steps: ['Sur <b>developer.husqvarnagroup.cloud</b> : connectez-vous avec le compte de l’appli, <b>Create application</b>, puis connectez-y les API « Authentication », « Automower Connect » et/ou « GARDENA smart system ».', 'Copiez la clé et le secret, <b>Tester</b> puis <b>Ajouter les appareils</b> : tondeuses (tondre, garer), vannes d’arrosage, prises, capteurs du sol.'],
      note: 'API officielle et gratuite.' },
    // marques préparées : le tuto dit quoi faire dès maintenant, le connecteur arrive ensuite
    { id: 'viessmann', name: 'Viessmann', sub: 'Chaudière, PAC, eau chaude (ViCare)', icon: 'hotWater', ready: true, oauth: true,
      fields: [['clientId', 'Client ID']],
      steps: ['Sur <b>developer.viessmann.com</b> › API Keys › <b>Add</b> : nom « Bêta home », Google reCAPTCHA désactivé, adresse de retour : <code>{callback}</code>', 'Copiez le <b>Client ID</b>, <b>Enregistrer</b>, puis <b>Se connecter</b> avec votre compte ViCare.', '<b>Ajouter les appareils</b> : températures, eau chaude (consigne, recharge unique).'],
      note: 'Offre gratuite « Basic » : 1 450 appels par jour, lecture toutes les 5 min.' },
    { id: 'homepod', name: 'Apple HomePod', sub: 'Musique et volume', icon: 'speaker',
      steps: ['Réservez l’IP du HomePod dans votre box internet.'], note: 'Déjà possible : ajoutez le HomePod comme lecteur AirPlay dans Music Assistant (fiche Music Assistant). Pilotage complet (pyatv) en préparation.' },
    { id: 'roborock', name: 'Roborock', sub: 'Aspirateur robot', icon: 'robotFill',
      steps: ['Gardez l’e-mail de votre compte Roborock : un code de connexion vous sera envoyé.'], note: 'Déjà possible : les Roborock récents (Saros, Qrevo) s’ajoutent par la fiche Matter, ou par Valetudo. Le cloud Roborock reste en préparation.' },
    { id: 'navimow', name: 'Segway Navimow', sub: 'Tondeuse robot', icon: 'mowerRobot',
      steps: ['App Navimow : demandez l’<b>accès développeur</b> (OpenAPI) pour votre tondeuse.'], note: 'En attente de l’accès développeur Segway.' },
    { id: 'verisure', name: 'Verisure', sub: 'Alarme, détecteurs d’ouverture', icon: 'shieldCheck', ready: true,
      fields: [['email', 'E-mail du compte Verisure'], ['password', 'Mot de passe Verisure', { pw: 1 }], ['smsCode', 'Code reçu par SMS', { tmp: 1 }], ['code', 'Code de l’alarme (option, sinon demandé)', { pw: 1 }]],
      actions: [['login', 'Se connecter', 'link'], ['verify', 'Valider le code', 'check']],
      steps: ['Saisissez e-mail et mot de passe Verisure puis <b>Se connecter</b> : un code arrive par SMS.', 'Saisissez-le puis <b>Valider le code</b> : le serveur devient « appareil de confiance », plus de SMS ensuite.', '<b>Ajouter les appareils</b> : alarme (armer / désarmer), détecteurs d’ouverture et de température.'],
      note: '⚠️ API non officielle (celle de l’appli) : elle peut changer. Sans code d’alarme enregistré, il est demandé à chaque désarmement.' },
    { id: 'ford', name: 'Ford', sub: 'Voiture (lecture seule)', icon: 'carFill',
      steps: ['Créez de préférence un <b>compte FordPass dédié</b>, partagé avec le vôtre pour la voiture.', 'Inscription sur le portail développeur Ford (FordConnect).'], note: 'API fragile, risque de blocage du compte : en préparation, en lecture seule.' }
  ];
  const BR = id => BRANDS.find(b => b.id === id);

  /* ---------- catégories et marques masquées (Paramètres › Marques) ---------- */
  // une marque masquée disparaît de la page, n'est plus interrogée et ses appareils ne reçoivent plus d'ordres
  const CATS = [
    ['lum', 'Éclairage', 'bulbFill', ['hue', 'elgato', 'govee', 'wled', 'nanoleaf', 'yeelight', 'wiz', 'lifx', 'dirigera']],
    ['prise', 'Prises, modules et télécommandes', 'plug', ['shelly', 'esphome', 'tasmota', 'kasa', 'tapo', 'broadlink', 'switchbot', 'tuya']],
    ['pont', 'Ponts et protocoles', 'link', ['matter', 'z2m', 'zwavejs', 'deconz', 'mqttha', 'smartthings', 'tahoma']],
    ['media', 'TV, musique et vidéo', 'tv', ['sonos', 'cast', 'denon', 'musiccast', 'bose', 'musicassistant', 'spotify', 'philipstv', 'samsungtv', 'lgtv', 'bravia', 'androidtv', 'roku', 'jellyfin', 'homepod']],
    ['climat', 'Chauffage et climatisation', 'therm', ['daikin', 'netatmo', 'tado', 'sensibo', 'cozytouch', 'viessmann', 'ecowitt']],
    ['secu', 'Sécurité et caméras', 'camera', ['frigate', 'reolink', 'unifiprotect', 'hikvision', 'dahua', 'nuki', 'verisure']],
    ['energie', 'Énergie, recharge et voiture', 'boltPlain', ['linky', 'solaire', 'ocpp', 'wallbox', 'easee', 'ford']],
    ['reseau', 'Box internet et tablettes', 'wifi', ['freebox', 'livebox', 'bbox', 'fully']],
    ['maison', 'Électroménager, robots et jardin', 'robotFill', ['homeconnect', 'valetudo', 'husqvarna', 'roborock', 'navimow']]
  ];
  const catOf = id => (CATS.find(c => c[3].includes(id)) || CATS[CATS.length - 1]);
  const off = () => (S.settings.brandsOff = S.settings.brandsOff || {});
  const isOff = id => !!off()[id];
  const inUse = id => nDev(id) > 0 || !!(H.list[id] && H.list[id].status === 'ok');

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
    if (isOff(r.brand)) return B.toast(BR(r.brand).name + ' est désactivée (Paramètres › Marques)', 'info');
    if (!B.Server.ok()) return B.toast('Serveur Bêta injoignable : commande non envoyée', 'info');
    call('/api/hub/command', { brand: r.brand, id: r.id, patch, cur: dev(id) }).catch(e => B.toast(BR(r.brand).name + ' : ' + e.message, 'info'));
  };
  // un appareil relié à une marque n'est plus piloté par Home Assistant
  const ent0 = B.HA.entity;
  B.HA.entity = id => map()[id] ? '' : ent0(id);

  /* ---------- états en direct ---------- */
  async function poll() {
    const m = map(), brands = [...new Set(Object.values(m).map(r => r.brand))].filter(b => !isOff(b));
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
  // import automatique (assistant plug & play) : tous les appareils de la marque, rangés par pièce
  async function autoImport(id, floorId) {
    const list = await call('/api/hub/' + id + '/devices'), m = map(), linked = new Set(Object.values(m).filter(r => r.brand === id).map(r => r.id)), added = [];
    const vis = B.floors(), fl = floorId || (vis.find(f => f.level >= 0) || vis[0] || {}).id;   // niveaux visibles seulement (pas ceux de la démo) if (!fl) throw new Error('aucun niveau');
    list.filter(d => !linked.has(d.id) && B.KIND[d.kind] && !d.error).forEach(d => {
      const all = vis.flatMap(f => B.roomsList(f.id, true).map(r => [f, r])), want = (d.room || BR(id).name).trim(), hit = all.find(([f, r]) => r.name.toLowerCase() === want.toLowerCase());
      let room = want, rf = fl;
      if (hit) { rf = hit[0].id; room = hit[1].name; } else C.rooms.push({ id: uid('r'), name: room, floor: fl, icon: 'homeFill' });
      const did = rf + '.c' + uid(''); C.devices.push({ id: did, type: d.kind, name: d.name, room, floor: rf, ha: '' }); m[did] = { brand: id, id: d.id }; added.push([did, d.state]);
    });
    added.forEach(([did]) => { const f = did.split('.')[0], fo = B.floor(f); if (fo && fo.builtin) C.layout[f] = 'auto'; });
    B.registerCustom(); added.forEach(([did, s]) => { if (s && Object.keys(s).length) setDev(did, s, { silent: true }); }); B.save();
    return added.length;
  }
  B.Hub = { load, poll, BRANDS, CATS, BR, call, H, autoImport, isOff, off };

  /* ---------- page ---------- */
  RENDER.hubpage = () => {
    if (B.Server.ok() && !H.loaded && !H.err && !H._t) { H._t = 1; setTimeout(() => { H._t = 0; load(); }, 50); }
    if (!B.Server.ok()) return '<div class="cgrid scroll"><div class="cwarn wide2" style="grid-column:1/-1">' + ico('alert') + '<span><b>Le serveur Bêta du NAS est nécessaire</b> : c’est lui qui parle aux marques et garde les mots de passe. Installez-le puis testez-le dans <a href="#connexions"><b>Connexions</b></a>.</span></div>' + cards() + '</div>';
    if (H.err === 'version') return '<div class="cgrid scroll"><div class="cwarn" style="grid-column:1/-1">' + ico('alert') + '<span><b>Mettez à jour le serveur Bêta</b> : recopiez le dossier <code>server</code> sur le NAS puis relancez le projet Docker.</span></div>' + cards() + '</div>';
    return '<div class="cgrid scroll">' + cards() + '</div>';
  };
  function cards() {
    const nOff = BRANDS.filter(b => isOff(b.id)).length;
    const bar = '<div class="hubbar"><label class="hfind">' + ico('search2') + '<input data-input="hubFind" placeholder="Chercher une marque…" autocomplete="off" spellcheck="false"></label>' +
      '<button type="button" class="btn sm pri" data-act="plugOpen">' + ico('sparkle') + 'Plug & play</button><button type="button" class="btn sm" data-act="brandsCfg">' + ico('grid9') + 'Choisir les marques' + (nOff ? ' · ' + nOff + ' masquée' + (nOff > 1 ? 's' : '') : '') + '</button></div>';
    return bar + CATS.map(cat => {
      const list = cat[3].map(BR).filter(b => b && !isOff(b.id)).sort((a, b) => (b.ready ? 1 : 0) - (a.ready ? 1 : 0) || (inUse(b.id) ? 1 : 0) - (inUse(a.id) ? 1 : 0));   // prêtes et utilisées d'abord
      if (!list.length) return '';
      return '<h3 class="hcat" data-cat="' + cat[0] + '">' + ico(cat[2]) + cat[1] + '<small>' + list.length + '</small></h3>' + card(list);
    }).join('');
  }
  function card(list) {
    return list.map(b => {
      const s = status(b.id), x = H.list[b.id] || {}, n = nDev(b.id);
      return '<div class="ccard tile' + (b.ready ? '' : ' locked') + '" data-b="' + esc((b.name + ' ' + b.sub).toLowerCase()) + '"><div class="cch"><span class="bdg" style="--g1:' + (b.ready ? '#2fe0ff' : '#9fb4d8') + ';--g2:' + (b.ready ? '#1f7dff' : '#4a6aa8') + '">' + ico(b.icon) + '</span><div><b>' + esc(b.name) + '</b><small>' + esc(b.sub) + '</small></div><span class="tag2 ' + s[0] + '">' + esc(s[1]) + '</span></div>' +
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
  // recherche : on filtre les fiches déjà affichées (sans redessiner, le champ garde le focus)
  B.act('hubFind', el => {
    const q = el.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), g = el.closest('.cgrid');
    g.querySelectorAll('.ccard[data-b]').forEach(c => { c.style.display = !q || c.dataset.b.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ? '' : 'none'; });
    g.querySelectorAll('.hcat').forEach(h => { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('hcat')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; } h.style.display = any ? '' : 'none'; });
  });
  /* ---------- fenêtre « Choisir les marques » ---------- */
  function brandsBody() {
    const n = BRANDS.filter(b => !isOff(b.id)).length;
    return '<p class="muted bcintro">Décochez les marques que vous n’avez pas : elles disparaissent de la page Marques, ne sont plus interrogées et leurs appareils sont mis en pause. Rien n’est effacé : recochez pour les retrouver telles quelles.</p>' +
      '<div class="row bcbtns"><button type="button" class="btn sm" data-act="brandsAll" data-arg="on">' + ico('check') + 'Tout afficher</button><button type="button" class="btn sm" data-act="brandsAll" data-arg="used">' + ico('homeFill') + 'Seulement celles que j’utilise</button><span class="muted">' + n + ' / ' + BRANDS.length + ' affichées</span></div>' +
      '<div class="bcgrid">' + CATS.map(cat => '<section><h4><label><input type="checkbox" data-change="brandsCat" data-arg="' + cat[0] + '"' + (cat[3].some(id => !isOff(id)) ? ' checked' : '') + '>' + ico(cat[2]) + cat[1] + '</label></h4>' +
        cat[3].map(BR).filter(Boolean).map(b => '<label class="bcrow' + (inUse(b.id) ? ' used' : '') + '"><input type="checkbox" data-change="brandTog" data-arg="' + b.id + '"' + (isOff(b.id) ? '' : ' checked') + '><span>' + esc(b.name) + (inUse(b.id) ? ' <small class="tag2">utilisée</small>' : !b.ready ? ' <small class="tag2 wait">bientôt</small>' : '') + '</span></label>').join('') + '</section>').join('') + '</div>';
  }
  const brandsOpen = () => B.modal('<h2>' + ico('grid9') + 'Marques affichées</h2>' + brandsBody(), 'wide bcmodal');
  const brandsRedraw = () => { const m = document.querySelector('.bcmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button><h2>' + ico('grid9') + 'Marques affichées</h2>' + brandsBody(); m.scrollTop = sc; } B.save(); B.emit('hub'); };
  B.brandsCfg = brandsOpen;
  B.brandOff = isOff;
  B.act('brandsCfg', brandsOpen);
  B.act('brandTog', el => { const id = el.dataset.arg; if (el.checked) delete off()[id]; else { off()[id] = 1; if (inUse(id)) B.toast(BR(id).name + ' : ses ' + nDev(id) + ' appareil(s) sont en pause', 'info'); } brandsRedraw(); });
  B.act('brandsCat', el => { const c = CATS.find(x => x[0] === el.dataset.arg); c[3].forEach(id => { if (el.checked) delete off()[id]; else if (!inUse(id)) off()[id] = 1; }); if (!el.checked && c[3].some(inUse)) B.toast('Les marques utilisées de cette catégorie restent affichées', 'info'); brandsRedraw(); });
  B.act('brandsAll', el => { BRANDS.forEach(b => { if (el.dataset.arg === 'on' || inUse(b.id)) delete off()[b.id]; else off()[b.id] = 1; }); brandsRedraw(); });
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
    return [{ icon: 'link', v: ok + '/' + ready.length, l: 'Marques reliées', cls: 'c' }, { icon: 'homeFill', v: Object.keys(map()).length, l: 'Appareils en direct' }, { icon: 'server', v: B.Server.ok() ? 'En ligne' : 'À installer', l: 'Serveur Bêta', cls: B.Server.ok() ? 'g' : 'y', go: 'connexions' }, { icon: 'grid9', v: BRANDS.filter(b => isOff(b.id)).length, l: 'Masquées' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('link', 'Marques', isAdmin() ? '' : '<span class="tag2 wait">' + ico('lock') + 'Lecture seule</span>') + T({ t: 'hubpage', keys: ['hub', 'conn'] }) + '</section>'; } });

  // raccourci depuis Connexions
  const conn0 = RENDER.conn;
  RENDER.conn = () => conn0().replace('<div class="cwarn">', '<a class="cwarn" href="#marques" style="grid-column:1/-1;border-color:rgba(47,224,255,.45)">' + ico('link') + '<span><b>Nouveau : Marques</b> — reliez Somfy, Hue, Samsung, Siemens, Govee, Elgato… directement, sans Home Assistant. Un tuto pour chaque marque.</span></a><div class="cwarn">');
  if (B.Server.url()) setTimeout(load, 2500);
})();
