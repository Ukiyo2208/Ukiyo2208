![Bêta home](assets/banner.jpg)

# Bêta home — Maison intelligente

Tableau de bord domotique au thème « Japon nocturne » (glassmorphism bleu néon), reproduit d'après les maquettes de référence :
écran verrouillé, Accueil, Extérieur, RDC, Étage 1 — plus Étage 2, Énergie, Multimédia, NAS, Calendrier, Mails, Bêta IA et Paramètres.

## Lancer

Ouvrir `index.html` depuis le **dossier complet** (les images et scripts sont dans `assets/`, `css/`, `js/`).
Idéalement via un petit serveur local : `python3 -m http.server` puis `http://<ip>:8000`.
`dashboard.html` redirige vers `index.html#accueil` (compatibilité anciens raccourcis).

## Mise en page

Chaque écran est une « scène » aux dimensions des maquettes (1536×1024, Accueil 1672×941) mise à l'échelle de la tablette :
les positions des cartes reprennent celles des captures. Sur smartphone / tablette en portrait, l'interface passe en
mode fluide (cartes empilées + dock de navigation en bas).

## Fonctionnel

- Verrouillage : empreinte animée, choix du profil (4 profils + Invité à accès limité), raccourcis Mails/Calendrier/NAS/Musique/Plex.
- Pièces : éclairages (couleur RGB + luminosité), volets (animés), climatisation, appareils, caméras (détections, plein écran), aspirateur, tondeuse, arrosage, store, borne.
- Actions rapides et scènes (tout éteindre, volets fermés, mode soir/jour, éco…).
- Météo réelle Open-Meteo (ville configurable), horloge en direct.
- Musique : radios en direct (Radio France, NRJ, FG), playlists YouTube éditables, favoris, Media Session iOS.
- Calendrier mensuel (ajout/modification/suppression, import .ics), mails de démonstration, NAS.
- Bêta IA : assistant local en français (« éteins le RDC », « ferme les volets étage 1 », « mets 21 degrés », « météo »…), dictée vocale si le navigateur la permet.
- **Home Assistant** (optionnel) : Paramètres › Home Assistant → URL + jeton longue durée, puis « Associer les entités ».
  Ajouter l'origine de Bêta home à `http: cors_allowed_origins` dans `configuration.yaml`. Sans configuration, tout fonctionne en mode démo.
- Sauvegarde/restauration JSON des réglages (stockés dans le navigateur).

## Structure

```
index.html            application (une seule page, routes #accueil, #rdc…)
css/beta.css          thème et mises en page
js/icons.js           icônes SVG, torii, logo Bêta IA, Plex
js/data.js            profils, appareils, caméras, médias, mails
js/core.js            état, rendu réactif, routeur, météo, Home Assistant, musique
js/components.js      barre latérale, en-têtes, tuiles d'appareils, caméras, Plex, musique
js/pages-*.js         pages
assets/               fonds, photos des pièces, caméras, avatars, médias
```

## Nouveautés 5.1

- Accueil : widgets avec pastilles d’icônes et nouveaux noms, énergie lisible, Musique et Plex séparés (favoris de l’utilisateur, film à reprendre).
- Musique : radios (logo + titre en direct quand la station le publie), liens YouTube (vidéo ou playlist) lus dans l’application via le lecteur officiel, fichiers audio du NAS par lien, ♥ favoris par profil, reprise à la même position.
- Plex : page dédiée, sélection du film, écran de lecture, connexion optionnelle à votre serveur (adresse + X-Plex-Token).
- Bêta IA : réponse en bulle au-dessus de la barre, conversation accessible partout (bouton cerveau en haut, bouton central sur mobile), liens YouTube collés directement.
- Calendrier : ajout de fichiers .ics, agenda en ligne par lien, export ; les mails contenant un rendez-vous proposent « Ajouter à l’agenda ».
- Étage 2 : 2 pièces (2 éclairages RGB, 2 volets, 1 clim). Les pièces peuvent être renommées et changer de photo (chevron › de la carte).
- Verrouillage : prochain rendez-vous, alerte sonnette, mini-lecteur, pétales de sakura, code à 4 chiffres facultatif par profil.
- Mobile : météo à côté du logo, dock avec bouton Bêta IA, panneaux en feuille glissante.

Limites : la lecture YouTube en arrière-plan (écran éteint / application quittée) dépend d’iOS et de YouTube et n’est pas garantie ; la radio continue en général. Le titre en direct des radios n’est disponible que pour les stations qui le publient (Radio France).

## Nouveautés 5.2

- YouTube : le lecteur est préparé au démarrage pour que ▶ lance la vidéo avec le son ; si iOS bloque, la vidéo s’affiche et un toucher suffit.
- Home Assistant : connexion en temps réel (WebSocket), assistant « Relier automatiquement » (appareils, caméras, détecteurs de mouvement, sonnette, capteurs d’énergie, vigilance Météo-France), caméras en direct.
- Énergie réelle : puissance, solaire, batterie et graphiques Jour / Semaine / Mois depuis Home Assistant.
- Pièces & appareils : ajout/suppression/masquage réservé aux administrateurs (Paramètres › Maison & sauvegarde), page « Pièces ».
- Routines (Je pars, Je rentre, Bonne nuit, Réveil programmable) et automatismes « Quand… alors… » (coucher du soleil, sonnette, mouvement, pluie, heure).
- Ambiances jour/nuit et saisons (pétales, lucioles, feuilles, neige) — choix manuel dans Paramètres › Ambiance & saisons ; sons et vibrations discrets.
- Météo : pluie et température heure par heure, alertes, arrosage annulé automatiquement s’il va pleuvoir.
- Écran verrouillé : salutation, routines en un geste, alerte météo/sonnette, glisser vers le haut, animation de déverrouillage.

## Nouveautés 5.3

- Écran verrouillé : seule l’empreinte déverrouille ; profils et raccourcis préparent l’ouverture. Carte horloge lisible sur iPhone.
- Transparence du verre réglable (Paramètres › Ambiance & saisons), plus transparente par défaut.
- Photos des pièces, caméras, médias et fonds d’écran agrandis ×2 et affinés.
- YouTube : connexion du compte Google (playlists YouTube / YouTube Music, titres aimés, recherche) — nécessite un ID client OAuth gratuit (assistant dans Musique › YouTube › Connecter) et une adresse https.
- Musique › Enceintes : pilotage des lecteurs Home Assistant ; avec Music Assistant + YouTube Music Premium, recherche et lecture sur les enceintes de la maison.

## Nouveautés 6

- **Nouvelles photos** des pièces et de l’extérieur (agrandies ×4).
- **Niveaux, pièces, appareils** (administrateurs) : créer/supprimer des étages et des pièces, ajouter tous les types d’appareils Home Assistant (éclairage, RGB, prise, volet, store, garage, clim, TV, enceinte, ordinateur, ventilateur, vanne, serrure, alarme Verisure, chauffe-eau, robots, électroménager, capteurs, scènes). Import depuis Home Assistant (zones = pièces). Pages d’étage automatiques avec **mode édition** (ordre, largeur, photo, icône).
- **Bouton « ⋯ » sur chaque tuile** : panneau flottant déplaçable avec tous les réglages du type (luminosité, couleur, blanc, effets, position, lames, modes de clim, sources, volume, minuterie…), graphique 24 h des capteurs et **historique du jour** (actions, durée, kWh estimés).
- **Droits par utilisateur** : par défaut, seuls les administrateurs commandent la porte du garage ; réglable appareil par appareil (Paramètres › Profils › Droits).
- **Journal** : chaque action avec utilisateur, date, heure, météo, température, saison et origine ; filtres, export CSV/JSON ; **habitudes repérées** → automatisme en un geste.
- **Connexions** : Home Assistant, serveur Bêta, NAS UGREEN, Nextcloud, mails, Plex, Google, météo, adresses IP — avec boutons « Tester ».
- **Serveur Bêta** (dossier `server/`, Docker) : sauvegardes nocturnes, journal partagé, relais Nextcloud/NAS, test mail. Voir `server/README.md`.

## Nouveautés 6.1

- **Pièces** : les « … » sont sur les pièces (plus sur chaque appareil). Ils ouvrent un panneau avec tous les réglages de la pièce, comme dans Home Assistant : cadran de thermostat qu'on fait glisser, modes (Chaud, Froid, Sec, Ventilation…), préréglages, ventilation, oscillation, humidité ; pour les lumières, luminosité, roue de couleurs, blanc chaud/froid, couleurs favorites et effets ; pour les volets, une fenêtre qu'on fait glisser et l'inclinaison.
- **Google Agenda** : synchronisation dans les deux sens, avec le même compte Google que YouTube. Il faut activer *Google Calendar API* dans Google Cloud. Vous pouvez toujours importer et exporter des fichiers .ics.
- **Visite guidée** : elle s'ouvre au premier lancement de chaque profil existant (pas pour l'invité). On peut la revoir depuis Paramètres › Général.
- **Recherche globale** : loupe dans la barre latérale ou en haut sur mobile, ou `Ctrl K` / `/`. Elle trouve les appareils (avec interrupteur), les pièces, les pages, les routines, les radios, les playlists, les films, les mails et l'agenda.
- **Mode nuit automatique** : l'écran s'assombrit après un moment sans toucher et les sons sont coupés (sauf la sonnette). Le premier toucher rallume l'écran. Réglages dans Paramètres › Ambiance › Mode nuit.
- **Bêta IA** : elle comprend plusieurs ordres à la suite (« éteins le salon et ferme les volets, puis lance FIP ») et garde le contexte (« et dans la cuisine ? »). Elle répond aussi aux questions sur le journal (« qui a ouvert le garage hier ? », « quand a été allumée la cuisine ? ») et sur la température d'une pièce.
- **Absence & sécurité** : nouvelle page (menu Plus et recherche) avec les caméras, l'alarme, les serrures, la porte du garage, les ouvertures, les mouvements, qui est à la maison, ce qui est encore allumé (avec « Tout éteindre »), le bouton « Je pars » et une simulation de présence.

## Notifications (6.4)

Les notifications passent par l'application **Home Assistant** installée sur les téléphones (service `notify.mobile_app_…`).
Connexions › « Notifications sur les téléphones » › Configurer :
- choisir qui reçoit (un service par personne) et tester ;
- choisir les alertes : sonnette (avec photo), personne détectée en absence, garage resté ouvert, fuite d'eau et alarme (critiques), poubelles la veille au soir, machine terminée, alerte météo, mode absent ;
- **recommandé** : « Créer les automatisations » génère le YAML à coller dans Home Assistant. Ces alertes tournent alors 24 h/24, même si aucun écran n'est allumé ;
- les poubelles et la météo sont envoyées par l'écran choisi comme « émetteur » (une tablette toujours allumée).

## Voiture (6.5)

Page **Voiture** (menu › Domotique) : batterie ou carburant, autonomie, recharge, verrouillage, position, portes, fenêtres, pneus, batterie 12 V, kilométrage, et les commandes verrouiller, ouvrir, préchauffer/clim et actualiser.
- Données réelles via l'intégration **FordPass** (HACS) de Home Assistant : Voiture › Réglages › « Relier FordPass » détecte les entités. Sans elle, la page est en mode démo.
- **Départs automatiques** : pour chaque rendez-vous avec un **lieu** (nouveau champ dans le calendrier), Bêta home calcule le trajet (OpenStreetMap), l'heure de départ (trajet + marge) et, quelques minutes avant, lance le préchauffage (froid) ou la clim (chaud) si la voiture est à la maison.
- Une notification Home Assistant part avec un bouton **Itinéraire** (Plans, Google Maps ou Waze) qui s'affiche dans CarPlay / Android Auto.
- Réglable par rendez-vous : Auto / Toujours / Jamais.

## Mode vocal (6.6)

Touchez un micro (barre IA, page Bêta IA, conversation) ou faites un appui long sur le bouton Bêta IA du dock. Vous parlez, Bêta IA répond à voix haute puis réécoute (conversation continue). Dites « merci » pour terminer.
Réglages (roue dentée) : choix de la voix française, vitesse, et lecture des réponses écrites. Sans reconnaissance vocale (certaines applis), le mode vocal propose la dictée du clavier.

## Installation pour votre maison (7.0)

Au tout premier démarrage, un assistant propose 4 façons de commencer :
- **Démo** : la maison d'exemple ;
- **Manuel** : vous choisissez vos niveaux, puis créez les pièces (modèle, image, appareils à cocher avec leur nombre) ;
- **Assisté** : Bêta home lit Home Assistant (étages, zones, appareils, caméras) et propose un placement que vous vérifiez ;
- **Automatique** : tout est repris tel quel de Home Assistant.

Les profils (prénom, avatar, administrateur, code) sont créés dans l'assistant.
**Paramètres › Maison & sauvegarde › Réinitialiser** relance l'assistant, en gardant ou non les connexions.
**Cet écran** (menu du téléphone › Personnaliser, ou Paramètres › Général) : page de départ et boutons épinglés, propres à chaque appareil.

## Carte (7.3)

Menu › Outils › **Carte** :
- **Famille** : position de chaque utilisateur. Elle vient de l'application Home Assistant (person.* / device_tracker.*), ou du partage depuis le téléphone. Distance de la maison, voiture et zone de la maison.
- **Trajets** : enregistrement en direct par GPS (moto, voiture, vélo…), import et export **GPX** (Calimoto, Strava, Komoot…). Distance, durée, vitesses moyenne et maximale, kilomètres du mois.
- **Véhicules** : nom, couleur et kilomètres totaux de chacun.
- Bêta IA : « où est Sarah ? », « combien de km à moto ce mois ? ».

Les positions et les trajets restent sur l'appareil. Seul le fond de carte (OpenStreetMap / CARTO) vient d'internet. La bibliothèque Leaflet est incluse dans le projet (assets/vendor/leaflet, licence BSD-2).

## Découvrir le réseau, caméras et HomeKit (7.4)

Connexions › **Découvrir** (et page Marques) : le serveur Bêta cherche les appareils du réseau local.
- **Caméras** : par ONVIF (presque toutes les caméras IP) et par le port RTSP. « Ajouter » récupère automatiquement l'adresse vidéo avec l'identifiant de la caméra. L'adresse et le mot de passe restent sur le NAS.
- **Ponts et box** (Hue, TaHoma, Elgato) : « Relier » ouvre la fiche de la marque avec l'adresse préremplie.
- **Shelly, ESPHome, Sonos, Google Cast** : « Relier » ajoute l'adresse dans la fiche de la marque (page Marques). Ces appareils sont ensuite pilotés **directement, sans Home Assistant ni compte**.
- Matter, HomeKit et AirPlay sont signalés ; le module Matter du serveur est la prochaine étape.

**Caméras & HomeKit** : un interrupteur par caméra la publie dans l'app Maison d'Apple, avec son code à 8 chiffres. Ce pont ne concerne que les caméras. Il passe par **go2rtc** (gratuit, libre), qui fournit aussi le direct vidéo dans Bêta home. Le fichier `server/docker-compose.yml` lance Bêta home et go2rtc en réseau « hôte », indispensable pour la découverte et HomeKit.

## Connecteurs locaux sans Home Assistant (7.5)

Page **Marques** : quatre nouveaux connecteurs 100 % locaux, sans compte.
- **Shelly** (génération 1, 2 et +) : prises, relais, variateurs, volets.
- **ESPHome** : interrupteurs, lumières, volets, capteurs et détecteurs. Il faut ajouter `web_server:` dans le YAML du module.
- **Sonos** : lecture/pause, volume, titre en cours, et lecture des radios de Bêta home.
- **Google Cast** (Chromecast, Nest, TV) : volume, lecture/pause, arrêt, et diffusion des radios.

Les enceintes Sonos et Google Cast apparaissent dans **« Où écouter ? »**.

## Encore plus de marques en local (7.6)

Page **Marques**, sans Home Assistant ni cloud :
- **Zigbee2MQTT** : tous les appareils Zigbee (Aqara, IKEA, Xiaomi, Philips, Lidl, Tuya…) par le broker MQTT. Mosquitto et Zigbee2MQTT sont prévus dans le docker-compose ; un client MQTT minimal est intégré au serveur, sans dépendance.
- **Denon / Marantz** (marche, volume, source), **Roku** (TV).
- **Fully Kiosk** (tablettes murales) : écran, luminosité, annonces vocales, ouverture d'une page.
- **WLED**, **Nanoleaf**, **Yeelight**, **Philips WiZ** (lumières), **Tasmota** (prises et modules), **Daikin** (clims avec adaptateur Wi-Fi local).

La découverte reconnaît aussi WLED, Nanoleaf, Denon/Marantz (HEOS), Roku et les brokers MQTT.

## Tout sans Home Assistant (7.7)

**Nouvelles marques** (page Marques, en local) :
- **TP-Link Kasa** (prises, multiprises, ampoules) et **Tapo** (P100, P110, L530… : identifiants Tapo gardés sur le NAS, connexion locale KLAP).
- **LIFX** (ampoules), **Broadlink** (télécommandes infrarouges : on apprend un bouton de la vraie télécommande, il devient un bouton Bêta).
- **TV Philips** (appairage par code PIN), **TV Samsung** (« Autoriser » sur la TV), **TV LG** (webOS) : marche, volume, lecture ; allumage par le réseau (Wake-on-LAN).
- **Matter** (contrôleur, conteneur `matter-server`) : n'importe quel appareil Matter, ou tous ceux d'un Aqara Hub M3, avec un code de partage.
- **Music Assistant** (serveur seul) : tous ses lecteurs deviennent des enceintes Bêta, les radios y sont jouées.

La découverte trouve aussi les TV Samsung, LG et Philips, et (par diffusion UDP) les prises Kasa, ampoules LIFX et Broadlink.

**Notifications sans Home Assistant** (Paramètres › Notifs, mode « ntfy ») : le serveur du NAS envoie lui-même, 24 h/24, avec l'appli gratuite **ntfy** (un sujet secret par personne). Il surveille les appareils reliés en direct : sonnette, fuite d'eau, garage resté ouvert, machine terminée, mouvement ou ouverture pendant une absence. Quand on sonne : photo de la caméra sur les téléphones, **annonce vocale et caméra à l'écran sur les tablettes** (Fully Kiosk), message sur la TV LG. Un bouton qui ne sait qu'appeler une adresse (Shelly Button, ESPHome) peut faire sonner via `/api/notify/ring?k=…`. Votre propre serveur ntfy est prêt dans le docker-compose.

**Positions avec OwnTracks** (Carte › Relier les téléphones) : chaque téléphone envoie sa position au NAS (lien « Ouvrir dans OwnTracks » qui configure l'appli d'un coup). Historique sur 24 h, arrivées et départs notifiés. Il faut que le téléphone joigne le NAS hors de la maison (VPN, Tailscale, accès à distance).

**Alexa par Matter** (Connexions › Alexa par Matter) : le conteneur `matter-bridge` (dossier `bridge/`, basé sur matter.js) expose à Alexa les appareils cochés, les routines Bêta comme des boutons (« Alexa, allume Soirée ciné ») et des déclencheurs (Sonnette, Mode absent) pour lancer des routines Alexa. Sans Home Assistant ni abonnement ; le même code marche pour Google Home et Apple Maison. Les caméras restent sur HomeKit (Alexa n'accepte pas les caméras en Matter), les serrures ne sont pas partagées.

**docker-compose** : blocs prêts à décommenter pour `matter-server`, `music-assistant`, `ntfy` et `matter-bridge`.

Toujours en préparation : Ford (API fragile, lecture seule), Roborock, Verisure, Viessmann, HomePod.

## 64 marques, rangées et masquables (7.8)

**Page Marques** : les marques sont rangées par catégorie (Éclairage, Prises et modules, Ponts, TV et musique, Chauffage, Sécurité et caméras, Énergie, Box internet, Robots et jardin), avec une recherche. **Paramètres › Marques** (ou « Choisir les marques ») : décochez celles que vous n'avez pas. Une marque masquée disparaît de la page, n'est plus interrogée et ses appareils sont mis en pause ; rien n'est effacé. Le bouton « Seulement celles que j'utilise » fait le tri d'un coup.

**35 nouvelles marques** :
- **Caméras et sécurité** : Frigate (détection IA locale), Reolink (caméras et sonnette), UniFi Protect, Hikvision et Dahua (flux d'évènements en direct), Nuki (serrure), Verisure (alarme, API non officielle avec code SMS).
- **Box et présence** : Freebox (API officielle), Livebox, Bbox — qui est à la maison d'après les téléphones connectés, Wi-Fi marche/arrêt.
- **Énergie** : Linky (conso.boris.sh), panneaux solaires (Fronius, Enphase, SMA, Huawei), bornes Wallbox et Easee, et un **serveur OCPP 1.6** intégré pour toute borne compatible (Schneider, ABB, Alfen, Keba…).
- **Chauffage et climat** : Netatmo / Legrand with Netatmo, tado°, Sensibo, Cozytouch (Atlantic, Thermor, Sauter — API non officielle), Viessmann, station Ecowitt.
- **Ponts** : Tuya en local (protocoles 3.3 et 3.4), IKEA Dirigera, Z-Wave JS, deCONZ / Phoscon, SwitchBot, MQTT « découverte » (LinknLink, OpenBeken…).
- **TV et musique** : Spotify, Yamaha MusicCast, Bose SoundTouch, TV Sony Bravia, Fire TV / Android TV (débogage réseau), Jellyfin.
- **Robots et jardin** : Valetudo, Husqvarna Automower et Gardena smart system.

HomePod passe déjà par Music Assistant (AirPlay), les Roborock récents par Matter ou Valetudo. Restent en préparation : Navimow (accès développeur Segway) et Ford (API fragile).

## Plug & play (7.9)

**À la création** (assistant de démarrage, mode « Plug & play », recommandé) : prénoms, adresse et clé du serveur Bêta du NAS, puis Bêta home **cherche vos appareils sur le réseau** (Bonjour, UPnP, caméras ONVIF, diffusion UDP) et :
1. affiche les **marques trouvées** (avec le nombre d'appareils), les **caméras** (un identifiant et un mot de passe communs suffisent) et une liste « **Vous avez aussi… ?** » pour les marques invisibles sur le réseau (comptes en ligne, clés USB) ;
2. ne demande que les **infos importantes** : les adresses sont déjà remplies, les marques sans réglage se connectent seules (« Automatique »), les autres montrent leur bouton d'appairage (Autoriser, Appairer…) et l'astuce utile ;
3. **« Tout connecter »** : enregistre, teste, importe tous les appareils dans leurs pièces (niveau « Maison », pièces au nom de la marque ou de la pièce d'origine), ajoute les caméras ;
4. **masque toutes les autres marques**, pour une page Marques qui ne montre que les vôtres.

L'assistant se relance à tout moment depuis **Marques › Plug & play** (il ajoute alors ce qui est nouveau sans rien effacer). Les comptes à relier par OAuth (Netatmo, Spotify, SmartThings…) se terminent dans leur fiche (« Se connecter »).

## Type, étage et pièce de chaque appareil · Pont Maison (7.10)

**Gérer › Appareils** : chaque appareil a trois menus — **type d'affichage** (éclairage, prise, volet, clim, capteur…), **étage** et **pièce** (ou « + Nouvelle pièce… »). Ça marche aussi pour les appareils d'origine (le changement est réversible) et dans la fiche « Modifier » d'un appareil (bouton … › crayon).

**Connexions › Alexa et Maison** : le conteneur `matter-bridge` publie maintenant **deux ponts** : Matter (Alexa, Google Home) et **HomeKit** (app Maison d'Apple, Siri), comme celui des caméras. Pour chaque appareil relié en direct, routine (« Dis Siri, Soirée ciné ») ou déclencheur (Sonnette, Mode absent), cochez « Alexa » et/ou « Maison ». Dans l'app Maison : + › Ajouter un accessoire › Plus d'options › « Bêta home » › code Maison affiché dans Bêta home. Lumières (luminosité), prises, interrupteurs, ventilateurs, volets, thermostats/clims, serrures (Maison seulement), capteurs de température, humidité, CO₂, ouverture, mouvement et fuite. Le pont HomeKit continue de fonctionner même si Matter ne peut pas démarrer.

## La maison qui réfléchit toute seule (7.11)

Le serveur Bêta du NAS (`server/engine.js`) fait maintenant tourner la maison **même quand aucun écran n'est ouvert** :

- **Routines et automatismes côté serveur** : les routines et règles sont envoyées au NAS, qui les exécute (heures, jours, lever/coucher du soleil calculés pour votre adresse, appareils, « pendant N minutes »). Les routines restent déclenchables depuis Alexa/Siri via le pont.
- **Éditeur « Si… alors… »** (Routines) : *Quand* (appareil, heure, soleil, arrivée/départ, alarme…) · *Si* (nuit, quelqu'un à la maison, mode absent…) · *Alors* (allumer, routine, notification, annonce sur les tablettes…). Chaque règle se relit en français. « Importer » convertit les anciens automatismes.
- **Mode absent automatique** (Sécurité › Présence) : chaque personne est suivie par OwnTracks et/ou par son téléphone vu sur la box. Quand tout le monde est parti depuis N minutes → mode absent, routine de départ, alarme si vous le voulez ; au retour → routine d'arrivée.
- **Alarme maison** (Sécurité) : capteurs d'ouverture/mouvement, temporisations d'entrée/sortie, armement « absent » ou « nuit », sirènes, annonce sur les tablettes, notification critique avec photo. Désarmement par code (vérifié par le NAS).
- **Santé de la maison** (Domotique › Santé) : marques injoignables, piles faibles, appareils silencieux, état du NAS et des ponts.
- **Historique et courbes** : bouton « Historique » dans la fiche de chaque appareil (24 h, 7 jours, 30 jours), données gardées sur le NAS (`data/history`).
- **Services** (Paramètres › Services) :
  - **EDF Tempo** : couleur du jour et du lendemain (api-couleur-tempo.fr, gratuit, sans compte) affichée sur Énergie, notification la veille des jours rouges.
  - **Vigilance Météo-France** du Bas-Rhin (67) : demandez une clé gratuite sur portail-api.meteofrance.fr (API « Données Publiques Vigilance »), collez-la ici. Alerte affichée sur la météo et notification à partir du niveau choisi.
  - **Collectes des déchets** (Fegersheim / Eurométropole) : l'Eurométropole n'a pas d'API publique, donc les jours se saisissent une fois (bouton « Modèle Eurométropole » à ajuster selon votre calendrier de collecte, ou un lien .ics). Les collectes apparaissent dans le calendrier et un rappel part la veille à l'heure choisie.
- **Tablettes murales** (Paramètres › Cet écran) : écran de veille (heure, météo, prochain évènement, photos), luminosité réduite la nuit, réveil par la détection de mouvement de Fully Kiosk, annonces lues à voix haute. **Disposition** : automatique, grand écran, **tablette 8″** (2 colonnes, gros boutons, idéale pour les Fire HD 8) ou téléphone, plus un **mode performance** sans flous ni animations.
- **Comptes et coffre** (Paramètres › Sécurité) : le code PIN de chaque personne est vérifié par le NAS (haché, jamais renvoyé). En **mode sécurisé**, tous les réglages exigent un administrateur. **Associer un écran** : un code à 6 chiffres sur un écran admin suffit à autoriser une tablette, sans recopier la clé BETA_KEY.
- **Application installable** : sur iPhone, Safari › Partager › « Sur l'écran d'accueil » ; sur Android « Installer l'application ».
- **English** : Paramètres › Cet écran › Langue. La traduction couvre l'interface principale ; certaines fiches (tutoriels des marques) restent en français.

### Accès depuis l'extérieur avec Tailscale

1. Créez un compte gratuit sur tailscale.com, une clé d’authentification (Settings › Keys) et activez HTTPS (DNS › HTTPS Certificates).
2. Dans `server/docker-compose.yml`, décommentez le bloc `tailscale`, mettez la clé dans `TS_AUTHKEY`, puis `docker compose up -d`.
3. Installez Tailscale sur l'iPhone : Bêta home est alors joignable en HTTPS à l'adresse `https://beta-home.<votre-réseau>.ts.net` (fichier `server/tailscale/serve.json`), sans ouvrir de port sur la box.

### Images Docker toutes prêtes

À chaque envoi sur GitHub, l'action `.github/workflows/docker.yml` construit `ghcr.io/ukiyo2208/beta-home` et `ghcr.io/ukiyo2208/beta-home-bridge` (x86 et ARM). Sur le NAS UGREEN, `docker compose pull && docker compose up -d` suffit ; `build:` reste disponible pour construire en local. Rendez les paquets publics sur GitHub (Packages › Package settings) ou connectez le NAS avec `docker login ghcr.io`.

## Plus solide, plus pratique (7.12)

Tout se trouve dans **Paramètres › Outils**, et dans trois nouvelles pages : **Scènes**, **Chauffage** et **Listes**.

- **Sauvegarde et restauration** : un seul fichier `.betabak` chiffré (AES-256, mot de passe) avec les réglages de Bêta home, les marques et leurs identifiants, les règles, scènes, chauffage, alarme, codes et l'historique. Pour restaurer sur un NAS neuf, il suffit de choisir le fichier : le serveur redémarre tout seul. **Chaque nuit**, une copie automatique est faite (chiffrée si vous donnez un mot de passe) et peut aller sur une **clé USB** (volume `/backup` dans `docker-compose.yml`).
- **Journal des règles** (Routines › Journal) : pour chaque déclencheur, la règle a agi ou a été « bloquée : pas « il fait nuit » ».
- **Mode test** (Routines › Tester) : simuler un appareil qui change, une arrivée ou un départ, la sonnette, une heure, Tempo, une détection de caméra… Bêta montre quelles règles réagiraient, sans rien exécuter (sauf « pour de vrai »).
- **Mises à jour** : bouton « Mettre à jour maintenant » avec **Watchtower**. Décommentez le service `watchtower` et mettez la même phrase dans `WATCHTOWER_TOKEN` du service `beta-home`. Une sauvegarde est faite avant la mise à jour.
- **Scènes** : une pièce + l'état de chaque appareil (« Salon soir », « Chambre lecture »), des moments (matin, journée, soir, nuit) pour le bouton « Selon l'heure », et une option **adaptative** (lumière vive et froide le matin, chaude et douce le soir). La **lumière adaptative** peut aussi suivre la journée toute seule (une lampe réglée à la main est laissée tranquille 2 h).
- **Chauffage** : des zones (radiateurs, thermostats ou clims, un capteur, des fenêtres) avec un planning confort/éco, l'éco automatique en mode absent, la coupure quand une fenêtre reste ouverte, et 1 à 3 °C de moins les jours rouges Tempo. Boutons Auto, Confort, Éco, Hors-gel, Arrêt et Boost 1 h.
- **Énergie en euros** (Énergie › Coûts en €, ou Outils › Tarif) : kWh et € par jour et par appareil (prises et compteurs qui mesurent la puissance), avec votre tarif (Base, HP/HC ou Tempo avec la couleur de chaque jour), la comparaison avec le mois dernier et une alerte de consommation inhabituelle.
- **Arrosage selon la météo** : aux heures choisies, le NAS regarde la pluie d'hier et celle prévue (Open-Meteo, gratuit). Il arrose zone après zone, ou annule et vous prévient.
- **iPhone : Siri et widgets** : chaque iPhone a son accès révocable. Des adresses toutes prêtes pour l'app Raccourcis (« Dis Siri, je pars », « Dis Siri, ajoute aux courses », « état de la maison »), et un widget d'écran d'accueil avec l'app gratuite Scriptable (alarme, présents, température, Tempo, poubelles, courses).
- **Profils enfants** : seulement leurs pièces, pas de réglages, d'alarme, d'énergie ni de serrures, et un **couvre-feu** exécuté par le NAS (« TV coupée à 21 h » + annonce sur les tablettes).
- **Listes partagées** : les courses et les tâches (pour qui, pour quand), partagées par tous les écrans. On ajoute un article depuis la page, avec Bêta IA (« ajoute du lait à la liste de courses ») ou avec Siri. *Alexa ne permet pas d'envoyer du texte libre à une application sans créer un « skill » Amazon : passez par Siri ou Bêta IA.*
- **Messages sur les tablettes** : un mot (« Je rentre tard ») affiché sur toutes les tablettes, leur écran de veille et l'accueil, annoncé à voix haute, avec une durée.
- **Simulation de présence** (Sécurité) : en mode absent, le NAS rejoue vos vrais gestes de la semaine précédente (lumières, volets), décalés de quelques minutes, du coucher du soleil à l'heure choisie. Tant qu'il n'a rien appris, il suit un scénario de soirée.
- **Détection sur les caméras** (Sécurité, avec Frigate) : notification avec photo seulement pour les personnes, les voitures, les colis… (pas les chats ni les branches), par caméra et par zone, seulement en absence si vous le voulez. Une personne détectée peut déclencher l'alarme. La détection sert aussi de déclencheur dans les règles.

## Chaque service indépendant · Réseau Bbox et TP-Link Deco (7.13)

**Paramètres › Modules** : activez seulement ce que vous utilisez (règles, scènes, chauffage, énergie, arrosage, Tempo/vigilance/collectes, santé, réseau, alarme, simulation, détection, listes, musique, Plex, calendrier, mails, carte, voiture, NAS, Bêta IA, journal). Un module coupé disparaît du menu et de ses raccourcis, et le NAS arrête de le faire tourner. Les autres ne sont pas touchés, et ses réglages sont gardés.

**Avec ou sans Home Assistant** :
- **Sans Home Assistant** : tout passe par les marques reliées en direct (Marques).
- **Avec Home Assistant seulement** : activez « Le NAS pilote aussi les appareils Home Assistant » (Paramètres › Modules). Règles, scènes, chauffage, alarme, simulation et Siri utilisent alors les appareils de Home Assistant, même tablettes éteintes (connecteur `homeassistant` du serveur, jeton longue durée).
- **Les deux** : un appareil peut venir de l'un ou de l'autre, sans doublon.

**Sans serveur, ou avec un serveur partiel** : chaque module du serveur est facultatif. Un module qui plante est désactivé sans arrêter les autres. On peut aussi en couper volontairement avec `BETA_OFF=engine,plus,bridge,geo`. Sans le module concerné, les listes et les scènes restent sur l'écran, les règles reviennent aux automatismes de l'écran, et les pages qui ont besoin du NAS l'indiquent simplement.

**Page Réseau** :
- **Bbox (Bouygues Telecom)** : état de la ligne (fibre, ADSL/VDSL), IP v4/v6, débit en cours et maximum (ou débit de synchro), version, durée depuis l'allumage, Wi-Fi, appareils connectés (Wi-Fi 2,4/5 GHz ou câble) et redémarrage. Le redémarrage et la coupure du Wi-Fi demandent le mot de passe admin.
- **TP-Link Deco** (nouveau connecteur, API locale chiffrée) : bornes principale et satellites (en ligne, IP, firmware), IP internet, processeur et mémoire, appareils connectés avec la bande Wi-Fi et le débit, et redémarrage. Se connecter peut déconnecter l'app Deco ouverte au même moment.
- **Freebox** : mêmes informations.
- Le bouton **Suivre** sur un appareil l'ajoute à la détection de présence de sa box. Ajoutez ensuite son détecteur (Marques › Ajouter les appareils), puis Sécurité › Présence.

## La vie de la maison (7.14)

- **Wi-Fi invités** (Réseau, ou Outils) : un QR code à scanner, affichable en grand sur une tablette, pour le réseau invités et pour celui de la maison. Avec le mot de passe admin de la Bbox, Bêta allume et coupe le Wi-Fi invités tout seul, avec une coupure automatique après 2 h, 4 h, 8 h… (« Dis Siri, Wi-Fi invités »).
- **Contrôle parental** (Réseau) : par enfant, ses appareils, des plages « Internet coupé » (ex. 21 h – 7 h en semaine) et une pause d'un bouton (1 h, jusqu'à demain). Il passe par la **Bbox**. Le Deco ne permet de bloquer un appareil que depuis son app : si les Deco sont en mode routeur, la Bbox ne voit qu'eux, il faut les passer en mode point d'accès.
- **Surveillance du réseau** : notification quand un appareil inconnu se connecte (bouton « Je le connais »), quand Internet coupe (avec la durée, envoyée au retour), et quand le débit maximum chute de moitié. Disponibilité de la ligne sur 7 jours et liste des coupures dans la page Réseau.
- **Réveil en douceur** (Outils) : lumières qui montent de 2200 K à 4500 K, volets qui s'ouvrent petit à petit, radio sur la tablette de la chambre, puis « Bonjour Bastien ! » avec la météo, Tempo et les poubelles. Il se lance à une heure fixe ou par l'alarme de l'iPhone (Raccourcis › Automatisation › Alarme › `/api/quick?do=wake`).
- **Modes** (Scènes) : « Créer les modes Cinéma, À table, Invités ». Chaque scène peut aussi activer un **mode** : ne pas déranger pendant N heures (plus d'annonces ni de notifications, sauf alarme et fuite), une radio, une annonce (« À table ! ») et le Wi-Fi invités.
- **Conseiller Tempo** (Outils) : la veille d'un jour rouge, une notification concrète (chauffage baissé, appareils les plus gourmands de la semaine à décaler, appareils coupés automatiquement). Les appareils « décalables » (chauffe-eau, borne…) peuvent être coupés les jours rouges de 6 h à 22 h, ou ne marcher qu'en heures creuses.
- **Tableau du matin** (page Matin) : heure, météo, Tempo, poubelles, rappels et messages, l'agenda du jour, les **trajets** (bouchons en direct sur l'A35 avec une clé TomTom gratuite, sinon le temps sans trafic) et les **départs** des bus et trams **CTS** (jeton gratuit api.cts-strasbourg.eu) et des **TER** (clé SNCF gratuite, gare de Fegersheim-Lipsheim). Chaque tablette peut l'afficher toute seule le matin (6 h 30 – 9 h).
- **Interphone** (page Interphone) : choisir une tablette ou toute la maison, des phrases toutes prêtes (« À table ! », « On part dans 5 minutes »…) ou son propre texte, avec dictée si le navigateur le permet. Le message est lu par Fully Kiosk et s'affiche sur les écrans visés. Donnez à chaque tablette le même nom dans Paramètres › Cet écran.
- **Rappels de la maison** (Outils, et dans Listes › Tâches) : filtre de la VMC, chaudière, détecteurs de fumée, contrôle technique… Notification le jour venu, bouton « Fait » pour repartir pour un cycle.
- **Mode secours** : si le NAS ne répond plus, un bandeau le signale. Les appareils aussi présents dans Home Assistant restent pilotables directement, et les listes et scènes restent sur l'écran. Si Internet coupe, un bandeau le dit, et la maison continue en local.
- **Administration** (page réservée aux administrateurs) : version, durée depuis le démarrage, mémoire, charge, place libre sur le NAS, taille des données, historique et sauvegardes, modules actifs, état des marques et journal des dernières erreurs du serveur.

Le QR code utilise la bibliothèque libre *qrcode-generator* (Kazuhiko Arase, licence MIT), copiée dans `js/vendor/`.

## Famille et maison (7.15)

- **Calendriers de l'iPhone** (Outils › Calendriers iPhone) : deux façons de les relier.
  - Avec un **lien de calendrier public** (iPhone › Calendrier › ⓘ › Calendrier public).
  - Avec votre **identifiant Apple et un mot de passe pour app** (appleid.apple.com), pour retrouver tous vos calendriers iCloud.
  
  Les évènements, y compris ceux qui se répètent, s'affichent dans le Calendrier, sur les tablettes et sur la page Matin, avec la couleur et le nom de la personne.
- **Colis** (Outils › Colis) : le NAS lit l'objet et le début de vos mails (IMAP, lecture seule) et repère les numéros Colissimo, Chronopost, La Poste, UPS, DHL, GLS, DPD, Mondial Relay et les livraisons Amazon. On peut aussi ajouter un numéro à la main. Avec la clé gratuite de l'API Suivi de La Poste, l'état exact s'affiche. « Livraison aujourd'hui » apparaît sur l'accueil et sur la page Matin.
- **Missions des enfants** (page Missions) : chaque enfant coche ses tâches du jour sur la tablette, gagne des points et les échange contre des récompenses (les parents sont prévenus).
- **Mode baby-sitter** (Outils) : toutes les tablettes passent en profil invité et affichent une fiche avec le prénom, l'heure du coucher, les numéros utiles (plus 15, 18 et 112), les consignes et le Wi-Fi invités. Le mode s'arrête à l'heure prévue, ou avant avec le code d'un parent.
- **Cadre photo** : l'écran de veille fait défiler les photos de famille du NAS (dossier monté sur `/photos`, voir `docker-compose.yml`) ou d'**Immich**, au hasard ou en mode « souvenirs » (ce jour-là, les années passées). Se choisit tablette par tablette, dans Paramètres › Cet écran.
- **Mode vacances** (Sécurité, ou Outils) : en un bouton, mode absent, simulation de présence, chauffage hors-gel, alarme activée et arrosage qui continue. Le chauffage est relancé N heures avant le retour prévu.
- **Pendant votre absence** : au retour, un résumé s'affiche et part en notification (coups de sonnette, colis, passages vus par les caméras, ouvertures, alarmes, coupures internet, consommation en euros).
- **Bilan du mois** (page Bilan, et notification le 1er du mois) : électricité en euros comparée au mois précédent, jours Tempo, coupures internet, sonnette, détections, colis, missions, règles exécutées.
- **Sonnette** : la photo du visiteur s'affiche sur toutes les tablettes avec des réponses rapides (« J'arrive ! », « Laissez le colis… »), lues à voix haute par la tablette de l'entrée. Historique des visiteurs avec photo.
- **Recharge de la voiture** (Outils) : on indique le nombre d'heures de charge et l'heure à laquelle la voiture doit être prête. Bêta choisit les heures les moins chères (heures creuses, jours bleus Tempo) et évite les heures pleines des jours rouges.
- **Grand texte** : dans Paramètres › Cet écran, pour agrandir textes et boutons sur une tablette.
- **Nouvel écran en 30 secondes** : dans Paramètres › Sécurité › Associer un nouvel écran, un QR code s'affiche. Il suffit de le scanner avec la tablette ou le téléphone : Bêta home s'ouvre et se relie tout seul au NAS.
- Le **contrôle parental par la Bbox** est coupé par défaut (Paramètres › Modules) : avec des Deco en mode routeur, il se fait dans l'app Deco.

## Installer, vérifier, régler (7.16)

- **Page Installation** (Réglages › Installation) : les 10 étapes de l'installation dans l'ordre (serveur, clé, écrans, marques, tablettes Fully, notifications, codes PIN, sauvegarde, iPhone, accès extérieur), chacune vérifiée avec ✅, ⚠️ ou ❌ et un bouton pour la régler.
- **Tester toute la maison** : le NAS essaie chaque marque, les tablettes, ntfy, internet, go2rtc, le pont Alexa/Maison, la place disque et le fuseau horaire. Il fait aussi un **contrôle de sécurité** : clé trop courte ou d'exemple, administrateurs sans code, mode sécurisé, écrans oubliés, droits des fichiers de mots de passe, accès extérieur. Cet écran vérifie de son côté sa connexion, https, Fully Kiosk et l'installation en application. « Copier le rapport » donne un texte prêt à envoyer.
- **Page Réglages** : tous les réglages rangés par thème (Maison, Sécurité, Énergie et confort, Famille, Écrans et iPhone, Réseau, Système), avec une recherche (« wifi », « code », « photo »…).
- **Tablettes Fire 8″** :
  - le serveur envoie l'application **en un seul fichier compressé** (≈ 340 Ko au lieu de 45 fichiers et 1,2 Mo) ; les tablettes ne retéléchargent que ce qui a changé ;
  - les images sont allégées (−3 Mo) ;
  - le **mode performance** s'active tout seul sur les tablettes Fire et les appareils modestes (réglable dans Cet écran). `BETA_BUNDLE=0` revient aux fichiers séparés.
- **Sécurité renforcée** :
  - le serveur ne sert plus les dossiers `.git`, `livrable`, `tests`, `tools`, `docs` ni les sources du serveur ;
  - après 30 essais refusés (mauvaise clé ou code d'association), l'adresse est bloquée 10 minutes ;
  - les fichiers de mots de passe sont remis en lecture « serveur seulement » au démarrage ;
  - le `.dockerignore` évite de mettre les archives et l'historique git dans l'image Docker ;
  - en-têtes `nosniff` et `no-referrer`.
- **« Bêta, … »** (Réglages › Commande vocale) : un bouton micro sur l'écran, ou l'écoute permanente du mot « Bêta » sur une tablette murale (« Bêta, allume le salon », « Bêta, état de la maison »). Bêta répond à voix haute. Il faut un navigateur avec reconnaissance vocale (Chrome, Safari) et souvent une adresse https (Tailscale). La WebView de Fully Kiosk sur les Fire peut ne pas la proposer : sur ces tablettes, Alexa reste le plus simple.
- **Page Raccourcis** : une version simple pour l'iPhone, avec l'état de la maison et vos boutons favoris (routines, scènes, appareils, pages). C'est la première page sur un téléphone, sauf si vous en choisissez une autre dans Cet écran.
- **Tests automatiques** : `npm run check` (syntaxe des 139 scripts) et `npm test` (19 tests : connecteurs Deco, Bbox et Home Assistant, énergie et Tempo, chauffage, calendriers, colis, recharge, sauvegarde chiffrée, règles, serveur complet). Ils tournent sur GitHub à chaque envoi (`.github/workflows/tests.yml`), sans aucune dépendance à installer.

## Relecture, conflits et tutoriels (7.17)

**Tutoriels PDF** (dans `docs/`, avec captures d'écran) :
- `docs/Guide-Beta-home.pdf` : guide d'utilisation (pages, réglages, automatismes, enfants et invités, tablettes, iPhone, dépannage).
- `docs/Installer-Beta-home-Docker.pdf` : installation pas à pas sur le NAS UGREEN (docker-compose, clé, fuseau horaire, services facultatifs, Tailscale, Watchtower, sauvegarde USB, Fully Kiosk, ntfy, dépannage).
- Pour les régénérer après une modification : `node docs/tuto/build-pdf.js` (sources HTML dans `docs/tuto`).

**Options qui se gênaient (corrigé)** :
- Un même appareil piloté par plusieurs automatismes : le chauffage, l'arrosage et la recharge de la voiture gardent la main, le décalage Tempo les ignore, et le diagnostic signale le doublon.
- L'éclairage adaptatif ne modifie plus une lampe réglée par une scène ou à la main : il ne corrige qu'une lampe qu'on vient d'allumer, ou qu'il a réglée lui-même.
- Mode vacances : il n'allume plus la simulation de présence si ce module est coupé, et rétablit l'état d'avant au retour (y compris le mode Absent).
- « Ne pas déranger » laisse toujours passer l'alarme, la fuite d'eau et la sonnette.
- Invités et enfants : les pages de réglages, d'installation, de réseau, d'administration et de bilan sont fermées, même par lien direct ; un enfant ne peut plus lancer une routine qui arme ou désarme l'alarme.
- Deux actions portaient le même nom (calendrier iPhone et calendrier) : la seconde écrasait la première.

**Bugs corrigés** :
- go2rtc : le fichier de configuration est désormais dans un dossier (`data/go2rtc/`, monté sur `/config`). Monter un seul fichier faisait créer à Docker un dossier vide à sa place lors d'une première installation. L'ancien fichier est repris automatiquement.
- Version du serveur alignée (7.17 au lieu de 1.0.0).
- Le serveur refuse les réglages mal formés au lieu de planter ; un JSON invalide renvoie une erreur 400 (et non 500) ; OwnTracks ne reste plus bloqué sur une requête GET ; les erreurs de mot de passe OwnTracks comptent dans la protection contre les essais répétés.
- Alarme, contrôle parental, réveil et conseiller Tempo : message clair au lieu d'une erreur quand le serveur est absent.
- Titres de rubriques des fenêtres de réglage mal alignés (icône au-dessus du texte).
- Page Raccourcis : « — » au lieu de « 0 à la maison » quand la présence n'est pas configurée.

**Optimisation** :
- Le cache hors ligne garde une seule copie de `bundle.js` (avant, chaque mise à jour en ajoutait une d'environ 1 Mo sur les tablettes).
- Les appareils se rafraîchissent dès qu'un écran redevient visible, sans attendre le prochain relevé.
- L'image Docker n'embarque plus les tutoriels (`docs/` exclu).

## Tablette debout, iPhone et panneaux des chambres (7.18)

- **Accueil vertical** : quand une tablette est tenue à la verticale (ou sur l'iPhone), l'accueil se réorganise en une colonne qui tient sur l'écran sans défiler (Fire 8″ comprise) : heure, météo, famille, état de la maison, 4 raccourcis, 4 pièces avec interrupteur, 2 caméras, agenda du jour, musique. Barre du bas : Accueil, Pièces, Bêta IA, Sécurité, Énergie, Plus. Les autres pages ne changent pas. Sur l'iPhone, la même page en version compacte qui défile, à la bonne taille du petit iPhone (SE, mini) au grand (Plus, Pro Max), et sur l'iPhone pliable (écran extérieur 5,4″ en version téléphone, écran intérieur 7,6″ déplié avec les grilles de tablette et un texte à taille de téléphone).
  - Les raccourcis sont ceux de la page Raccourcis de l'iPhone ; les pièces et caméras se choisissent par tablette (Paramètres › Cet écran › Accueil vertical).
- **Panneau mural d'une pièce** (DotStarTech Wall Panel CM4, écran carré 720 × 720) : adresse `http://NAS:8090/?panneau=chambre-1` (ajouter `&enfant=leo` pour une chambre d'enfant), ou Paramètres › Cet écran › Panneau mural. Le panneau reste sur sa pièce ; pour en sortir : appui long sur le nom de la pièce puis le code d'un parent.
  - Écrans : la pièce (lumières, volet, chauffage, 2 scènes de la pièce ou Lecture / Dodo), réglage d'une lumière (appui long), volet et chauffage, missions (chambre d'enfant), écran de nuit ambré, réveil en douceur avec « + 10 min » et « Je suis levé ».
  - **Sonnette** : en automatique, elle n'apparaît sur le panneau que si une lumière de la pièce est allumée ou un volet ouvert ; jamais dans une chambre d'enfant ; réglable (toujours / jamais).
  - Le serveur prévient le panneau au début d'un réveil (`wakestart`) ; « + 10 min » reporte le réveil, « Je suis levé » l'arrête et ouvre les volets.
- Correction : le filtre du mode nuit de l'interface n'enferme plus les éléments plein écran.
