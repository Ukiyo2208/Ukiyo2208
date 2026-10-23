# Serveur Bêta (NAS)

Petit serveur Node.js **sans dépendance** qui accompagne Bêta OS :

- sert l’application (http://IP-du-NAS:8090) ;
- garde les **sauvegardes** (une par nuit, 30 gardées) et le **journal partagé** entre tous les appareils ;
- **relaie** les services bloqués par les navigateurs (Nextcloud, interface du NAS) et **teste la connexion mail** (IMAP).

## Installation (UGOS Pro)
1. Copiez tout le dossier Bêta OS sur le NAS (par ex. `/volume1/docker/beta-os`).
2. Ouvrez `server/docker-compose.yml` : remplacez la clé `x-cle` (en haut) par une longue phrase secrète, et `MQTT_PASS` par un mot de passe.
3. UGOS Pro › Docker › Projet › Créer › choisissez ce fichier › Lancer.
4. Ouvrez `http://IP-du-NAS:8090`. Pour le https, ajoutez un reverse proxy dans UGOS Pro (nécessaire pour Google/YouTube).
5. Dans Bêta OS › Paramètres › Connexions › « Serveur Bêta » : adresse + même clé › Tester.

Sans Docker : `BETA_KEY=… node server/server.js` (Node 20 ou plus).

## API
| Route | Rôle |
|---|---|
| `GET /api/ping` | état (sans clé) |
| `GET/PUT /api/store/:clé` | données clé/valeur |
| `POST/GET /api/journal` | journal des actions (`?since=`) |
| `POST /api/backup`, `GET /api/backups`, `GET /api/backup/:nom` | sauvegardes |
| `POST /api/proxy` `{url, method, headers, body}` | relais HTTP |
| `POST /api/mail/test` `{imap, port, user, pass}` | test IMAP |
| `GET /api/hub` | marques et leur état (secrets masqués) |
| `PUT /api/hub/:marque` · `POST /api/hub/:marque/test` | réglages d'une marque, test |
| `POST /api/hub/:marque/action/:nom` | appairage Hue, jeton Somfy… |
| `GET /api/hub/:marque/oauth?redirect=…` | début de connexion OAuth (SmartThings, Home Connect) |
| `GET /api/hub/:marque/devices` | appareils trouvés par l'API de la marque |
| `GET /api/hub/states?brands=…` · `POST /api/hub/command` | états en direct, commandes |

Toutes les routes sauf `ping` et `/api/hub/oauth/callback` (retour de la page de connexion de la marque) demandent l’en-tête `X-Beta-Key`.

## Marques (sans Home Assistant)
Les connecteurs sont dans `server/hub/` (un fichier par marque, sans dépendance). Les identifiants sont gardés
dans `data/hub.json` sur le NAS et ne sont jamais renvoyés au navigateur. Réglages et tutos : Bêta OS › **Marques**.
Pour SmartThings, Home Connect et Viessmann, le serveur doit être joignable en **https** (reverse proxy UGOS Pro).
La borne de recharge se connecte en OCPP 1.6J sur `ws://IP-du-NAS:8090/ocpp/<identifiant>` (même port que l'application).

Le projet Docker lance aussi trois services pour les appareils locaux :
- **mqtt** (Mosquitto, port 1883) : LinknLink et autres appareils MQTT. Changez `MQTT_PASS` dans `docker-compose.yml` ; dans Bêta OS, l'adresse est `mqtt://mqtt:1883`.
- **matter** (python-matter-server, port 5580, réseau de l'hôte) : contrôleur Matter pour le Aqara Hub M3, sans Home Assistant. Le Hub s'ajoute depuis Bêta OS › Marques › Aqara avec son code d'appairage.
- **py** (pont Python, port 8099, réseau de l'hôte) : HomePod (pyatv) et Roborock (python-roborock). Protégé par la même clé `x-cle`.
