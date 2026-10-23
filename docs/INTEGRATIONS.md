# Intégrations domotique — connexion directe, sans Home Assistant

Architecture : le **serveur Bêta** (Node.js, Docker sur le NAS, voir `server/`) gagne un
connecteur par marque, et Bêta OS ne parle qu'à ce serveur.

```
Appareils / clouds des marques ──> Backend (connecteurs par marque) ──> API unique ──> Dashboard
```

Le backend est nécessaire : les secrets (tokens OAuth, mots de passe) ne doivent pas
être dans le navigateur, et les API locales (TaHoma, TV, HomePod) ne sont joignables
que depuis le réseau de la maison.

Les connecteurs sont écrits en Node.js pour rester dans `server/server.js`. Pour les
marques dont seule une bibliothèque Python existe (HomePod via pyatv, Roborock, Verisure),
un petit conteneur Python séparé pourra être ajouté au `docker-compose.yml`.

## Avancement dans Bêta OS (page « Marques »)

| Marque | État |
|---|---|
| Somfy TaHoma, Philips Hue, Elgato, Govee, Samsung SmartThings, Siemens Home Connect | ✅ Connecteur disponible (`server/hub/`) |
| Schneider Charge (OCPP 1.6J : suivi, départ, arrêt, limite en A), Viessmann (lecture) | ✅ Connecteur disponible |
| Aqara, LinknLink, TV Philips, HomePod, Roborock, Navimow, Verisure, Ford | ⏳ Tuto « à préparer » en place, connecteur à venir |

## Matériel confirmé

- Somfy **TaHoma switch** (réf. 1870595)
- Aqara **Hub M3**

## Connexion par appareil

| Appareil | Méthode directe | Type | À faire de ton côté | Fiabilité |
|---|---|---|---|---|
| Somfy volets + garage | API locale TaHoma (« mode développeur ») | Local | Activer le mode développeur sur somfy.fr, générer un token | ✅ Officielle |
| Aqara lumières | Matter (le M3 sert de pont Matter) ou Aqara Open API | Local / Cloud | Code d'appairage Matter du M3, ou compte developer.aqara.com | ✅ |
| LinknLink (télécommande IR eRemote, capteurs) | MQTT natif vers un broker local (Mosquitto) | Local | Firmware « HA » via l'app LinknLink, puis saisir l'adresse du broker | ✅ |
| TV Samsung | SmartThings API (+ API locale Samsung TV en option) | Cloud / Local | App OAuth SmartThings (les tokens perso expirent en 24 h) | ✅ Officielle |
| Samsung lave-linge + clim | SmartThings API | Cloud | Même app OAuth que la TV | ✅ Officielle |
| TV Philips | API JointSpace (port 1926) | Local | Appairage par PIN affiché sur la TV | ✅ |
| Apple HomePod | pyatv (AirPlay / Companion) | Local | Appairage au premier lancement | ✅ Média + volume |
| Siemens lave-linge | Home Connect API | Cloud officiel | Compte developer.home-connect.com, activer « démarrage à distance » | ✅ Officielle |
| Philips Hue lumières | API locale du Hue Bridge (CLIP v2, événements en temps réel) | Local | Appuyer sur le bouton du Bridge pour générer une clé | ✅ Officielle |
| Elgato lumières (Key Light / Light Strip) | API HTTP locale (port 9123) | Local | Rien, détection automatique sur le réseau | ✅ |
| Viessmann chauffage | API ViCare officielle (OAuth) | Cloud | Compte developer.viessmann.com ; offre gratuite limitée à 1 450 appels/jour | ✅ Officielle |
| Govee lumières | Govee API (clé dans l'app) + API LAN | Cloud / Local | Demander la clé API, activer « Contrôle LAN » par lampe | ✅ Officielle |
| Roborock aspirateur | python-roborock | Cloud + local | Compte Roborock | ⚠️ Non officielle |
| Segway Navimow tondeuse | Navimow OpenAPI (accès développeur via l'app) | Cloud | Demande d'accès développeur dans l'app Navimow | ⚠️ À vérifier selon modèle |
| Verisure alarme | API GraphQL Verisure (vsure) | Cloud | Compte Verisure + code SMS (2FA) | ⚠️ Non officielle |
| Schneider Charge (borne VE) | OCPP 1.6J : le backend joue le rôle de serveur OCPP | Local | Pointer l'URL OCPP de la borne vers le backend (peut couper le lien avec l'app Wiser) | ✅ Standard |
| Ford voiture | FordConnect API (lecture seule) | Cloud | App sur le portail développeur Ford, compte FordPass dédié | ❌ Fragile |

## Sécurité

- Tous les secrets dans `.env`, jamais commités.
- Désarmement Verisure : code demandé à chaque fois, jamais stocké.
- Dashboard accessible uniquement sur le réseau local (ou via VPN), avec authentification.
