# Serveur Bêta (NAS)

Petit serveur Node.js **sans dépendance** qui accompagne Bêta OS :

- sert l’application (http://IP-du-NAS:8090) ;
- garde les **sauvegardes** (une par nuit, 30 gardées) et le **journal partagé** entre tous les appareils ;
- **relaie** les services bloqués par les navigateurs (Nextcloud, interface du NAS) et **teste la connexion mail** (IMAP).

## Installation (UGOS Pro)
1. Copiez tout le dossier Bêta OS sur le NAS (par ex. `/volume1/docker/beta-os`).
2. Ouvrez `server/docker-compose.yml` et remplacez `BETA_KEY` par une longue phrase secrète.
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

Toutes les routes sauf `ping` demandent l’en-tête `X-Beta-Key`.
