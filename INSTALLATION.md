# Installer Bêta IA de A à Z

Compte environ **1 h 30** au total, dont la moitié à attendre des téléchargements.

| Étape | Où | Durée |
|---|---|---|
| A. Préparer le NAS | interface UGOS | 5 min |
| B. Télécharger et copier le projet | PC | 5 min |
| C. Lancer l'installation | SSH | 15 à 30 min (automatique) |
| D. Vérifier que tout tourne | navigateur | 5 min |
| E. Home Assistant : appareils et personnes | navigateur + téléphones | 15 min |
| F. La tablette | tablette | 10 min |
| G. Les visages | tablette (+ caméras) | 10 min |
| H. Les caméras Reolink (optionnel) | Home Assistant + SSH | 15 min |
| I. Le tri des documents (optionnel) | navigateur | 5 min |
| J. IA cloud ou PC puissant (optionnel) | SSH | 5 min |
| K. « Hey Bêta » personnalisé (optionnel) | Google Colab | 1 h (automatique) |
| L. Afficher les infos sur ton site (optionnel) | SSH | 5 min |

---

## A. Préparer le NAS (interface UGOS)

1. **Docker** : *Centre d'applications* → installe **Docker**. Le dossier partagé `docker` est créé
   automatiquement (`/volume1/docker`).
2. **SSH** : *Panneau de configuration → Terminal* → active **SSH** (port 22).
3. **Dossier des documents** (si tu veux le tri) : vérifie que tu as un dossier partagé `Documents`.
   Sinon, crée-le dans *Panneau de configuration → Dossiers partagés*.
4. Note l'**adresse IP du NAS** : *Panneau de configuration → Réseau* (ex : `192.168.1.20`).

## Le plus simple : `installer-windows.bat` (installation et mises à jour)

Sur un PC Windows 10 ou 11, double-clique sur **`installer-windows.bat`** (dans le zip, ou sur GitHub). Il
demande l'adresse du NAS, ton utilisateur SSH et le dossier (il retient tes réponses), puis :
1. télécharge la dernière version ;
2. l'envoie sur le NAS dans `<dossier>/BetaNova` ;
3. lance l'installateur : avec ses questions la première fois, **sans aucune question** pour une mise à jour
   (tes réglages, comptes et données sont conservés) ;
4. ouvre Bêta dans le navigateur.

Il propose aussi de créer une **clé SSH** : ensuite, plus de mot de passe SSH à taper (seulement celui de `sudo`).
Il faut que SSH soit activé sur le NAS (étape A). Les étapes B et C ci-dessous font la même chose à la main.

## B. Télécharger et copier le projet (sur ton PC)

1. Connecté à GitHub, télécharge le projet :
   https://github.com/Ukiyo2208/Ukiyo2208/archive/refs/heads/claude/beta-ia-local-voice-kd7s5z.zip
2. Dézippe-le, puis **renomme le dossier obtenu en `BetaNova`** (son nom d'origine est
   `Ukiyo2208-claude-beta-ia-local-voice-kd7s5z`). Ce n'est que le dossier téléchargé : l'installation
   elle-même va dans le dossier `beta`, à côté.
3. Copie ce dossier dans le dossier partagé **`docker`** du NAS : explorateur Windows →
   `\\192.168.1.20\docker` (ou l'application Fichiers d'UGOS).

## C. Lancer l'installation (SSH)

1. Sur ton PC, ouvre un terminal (Windows : *PowerShell*) et connecte-toi au NAS :
   ```bash
   ssh TON_UTILISATEUR_UGOS@192.168.1.20
   ```
2. Lance l'installateur :
   ```bash
   cd /volume1/docker/BetaNova
   sudo bash installer.sh
   ```
3. Réponds aux questions. **Entrée** garde la réponse proposée :

| Question | Quoi répondre |
|---|---|
| Dossier d'installation | Entrée (`/volume1/docker/beta`) |
| Ton prénom | ton prénom, ex : `bastien` |
| Pièce de la tablette | `salon` |
| Activer le tri des documents (tous les volumes du NAS) ? | `o` (oui) ou `n` |
| Dossier où ranger les documents triés | Entrée (ton dossier `Document` ou `Documents`) |
| Compte Home Assistant : identifiant | Entrée (ton prénom) |
| Compte Home Assistant : mot de passe | le tien, ou Entrée pour en générer un |
| Clé de l'IA cloud Claude | Entrée pour l'instant (voir étape J) |
| Adresse d'un PC puissant | Entrée pour l'instant (voir étape J) |

4. **Attends** : l'installateur télécharge et démarre tout (environ 8 Go de modèles d'IA).
5. À la fin, il affiche :
   - les adresses (Bêta, tri des documents, Home Assistant) ;
   - **le mot de passe Home Assistant** s'il l'a généré : **note-le** ;
   - **un QR code** pour la tablette : laisse le terminal ouvert, ou retrouve-le à l'étape F.

> Ça bloque ou il y a un ✘ rouge ? Voir « Dépannage » en bas.

## D. Vérifier que tout tourne (navigateur)

1. Ouvre **`http://192.168.1.20:8800`** : c'est la page d'accueil de Bêta (accueil, discussion, maison).
   À la maison, **aucun jeton n'est demandé**. Hors de chez toi, la page demande le **BETA_TOKEN**
   (`sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh --secrets`).
2. Dans **Services**, les points doivent être verts : Home Assistant, IA locale, écoute, voix, présence
   et tri des documents. Juste après l'installation, l'IA locale peut rester rouge une ou deux minutes.
3. L'état détaillé (chaque requête, temps de réponse) est sur **`http://192.168.1.20:8800/tableau`**.

Un test rapide en ligne de commande : `sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh tester`.

## E. Home Assistant : appareils et personnes

1. Ouvre **`http://192.168.1.20:8123`** et connecte-toi (identifiant = ton prénom, mot de passe de l'étape C).
2. **Ajoute tes appareils** : *Paramètres → Appareils et services → Ajouter une intégration*
   (Philips Hue, Tuya, Shelly, Sonos, Reolink…).
3. **Range-les dans des pièces** : sur chaque appareil, choisis sa **Pièce** (Salon, Chambre…).
   C'est ce qui permet de dire « allume le salon ».
4. **Rends-les accessibles à la voix** : *Paramètres → Assistants vocaux → Exposer* → coche tes appareils.
5. **Les personnes de la maison** : *Paramètres → Personnes → Ajouter*, une par personne, avec
   « Autoriser la connexion ». Pour chacune, ajoute dans `/volume1/docker/beta/beta-nas/config/config.yaml` :
   ```yaml
   personnes:
     bastien:
       role: admin
       companion: person.bastien
     lea:
       role: adulte
       companion: person.lea
   ```
   Puis relance Bêta : `cd /volume1/docker/beta/beta-nas && sudo docker compose up -d beta`.
6. **Application Companion** : sur le téléphone de chaque personne, installe **Home Assistant**
   (Play Store / App Store), connecte-toi à `http://192.168.1.20:8123` avec son compte, et accepte la
   localisation. Bêta sait ainsi qui est à la maison.
7. Teste dans le tableau de bord : demande « allume la lumière du salon » avec `/v1/texte`, ou attends
   d'avoir la tablette.

## F. La tablette (Android)

1. **Télécharge l'APK** : https://github.com/Ukiyo2208/Ukiyo2208/actions/workflows/apk-tablette.yml
   → clique sur la dernière exécution verte → en bas, **Artifacts** → **beta-tablette-apk**.
   Dézippe-le pour obtenir le fichier `.apk`.
2. **Copie l'APK sur la tablette** (câble USB, Google Drive…) et ouvre-le. Autorise « installer des
   applications inconnues » quand Android le demande.
3. **Ouvre Bêta.** Autorise le **micro**, la **caméra** et les **notifications**.
4. L'écran **« Connexion au NAS »** s'ouvre : montre-lui le **QR code**. Il est dans le terminal de
   l'étape C, ou sur le tableau de bord (`http://192.168.1.20:8800/tableau` → **Afficher le QR
   d'appairage**, mets `salon` comme pièce).
5. **Batterie** : *Paramètres Android → Applications → Bêta → Batterie → Non restreinte*. Sinon,
   Android coupe l'écoute.
6. **Mode kiosque** (conseillé) : dans l'app, *Réglages → Mode kiosque*, puis appuie sur le bouton
   Accueil et choisis **Bêta → Toujours**. La tablette redémarre ainsi toujours sur Bêta.
7. **Test** : dis **« Hey Jarvis »** (mot provisoire, voir étape K), attends le bip, puis
   « quelle heure est-il ».

## G. Les visages

1. Dans l'app : **Visages** → écris ton prénom **exactement comme dans config.yaml** (`bastien`) →
   mets-toi face à la tablette → **Enregistrer ce visage**.
2. Recommence avec et sans lunettes, et le soir avec la lumière du soir.
3. Fais de même pour chaque personne de la maison.
4. Appuie sur **Envoyer les visages au NAS** : les caméras Reolink pourront aussi vous reconnaître.

## H. Les caméras Reolink (optionnel)

1. Dans Home Assistant : *Ajouter une intégration* → **Reolink** → ajoute chaque caméra.
2. Pour chaque caméra, active le flux **« Clair »** (pleine résolution) : *Paramètres → Entités*,
   cherche `clair`, ouvre l'entité, puis **Activer**.
3. Note les noms exacts : l'entité caméra « Clair » (ex : `camera.salon_clair`) et le capteur
   « Personne » (ex : `binary_sensor.salon_personne`).
4. Ajoute-les dans `/volume1/docker/beta/beta-nas/config/config.yaml` (un modèle complet est dans
   `config.example.yaml`), par exemple :
   ```yaml
   cameras:
     - { camera: camera.salon_clair, detection: binary_sensor.salon_personne, piece: salon }
     - { camera: camera.sejour_clair, detection: binary_sensor.sejour_personne, piece: sejour }
     - { camera: camera.entree_clair, detection: binary_sensor.entree_personne, piece: entree }
     - { camera: camera.couloir_etage_clair, detection: binary_sensor.couloir_etage_personne, piece: couloir-etage }
   ```
5. Relance : `cd /volume1/docker/beta/beta-nas && sudo docker compose up -d`.
6. Vérifie : `sudo docker logs -f beta-presence` doit afficher « À l'écoute de N caméras ». Passe devant
   une caméra : une ligne comme « salon : bastien » apparaît.
7. Plus fiable : enregistre aussi ton visage **vu par une caméra**. Ouvre `http://192.168.1.20:8801/docs`
   → *Authorize* (BETA_TOKEN) → `POST /visages/{nom}/capturer` → nom `bastien`,
   `{"camera": "camera.salon_clair"}` → reste **seul** devant la caméra, à 1 ou 2 m, pendant 15 secondes.

## I. Le tri des documents (si tu as répondu « o »)

Le trieur voit **tous les volumes du NAS** (`volume1`, `volume3`…, y compris les dossiers personnels) et
cherche les PDF, Word et fichiers texte partout. Les dossiers `Docker` et `Application` sont laissés de
côté par défaut. Les documents validés sont rangés dans ton dossier `Document`. Ses fichiers de travail
(propositions, journal, index) restent dans l'installation de Bêta : rien n'est écrit dans tes dossiers.

1. Ouvre **`http://192.168.1.20:8800/tri/`** (ou le bouton **Valider les propositions** de l'accueil).
2. Dans **Ce qui est trié**, ouvre `volume1`, `volume3`… et décoche les dossiers à laisser de côté
   (Photos, Films, Archives…), puis **Enregistrer**.
3. Clique sur **Tout traiter** : le modèle analyse tous les documents à la suite, à toute heure, jusqu'au
   dernier (1 à 2 minutes chacun). Tu peux fermer la page. **Arrêter** le stoppe après le document en
   cours. Pour un simple essai : **Préparer 5 documents**.
4. Les propositions apparaissent avec un titre, un dossier et des tags. Corrige-les si besoin, puis
   **Valider** (le fichier est rangé dans la minute) ou **Garder où il est** (il ne sera plus proposé).
5. Ensuite, le trieur avance tout seul **chaque nuit** : tu n'as plus qu'à valider sur la page.
   - **Il n'oublie rien** : chaque document rangé ou gardé est retenu par une empreinte de son contenu.
     Déplacé, renommé, restauré d'une sauvegarde ou après une réorganisation du NAS, il est reconnu et
     n'est jamais reproposé (chiffre « Reconnus » sur la page). Rien n'est écrit dans tes fichiers.
   - **Il apprend de toi** : pour chaque nouveau document, le modèle voit les documents déjà rangés qui lui
     ressemblent le plus, avec le titre et le dossier que tu as validés, et reprend la même forme. Quand tu
     corriges une proposition, les propositions en attente du même genre sont refaites avec ta correction.
     Plus tu valides, plus il devient juste.
6. **Notifications** (conseillé) : Bêta te prévient quand un « Tout traiter » est fini, le matin s'il a
   préparé des propositions dans la nuit, et si le tri est bloqué. Le plus simple : l'application Home
   Assistant de ton téléphone. Dans Home Assistant, *Outils de développement → Actions*, tape
   `notify.mobile_app` pour trouver le nom de ton téléphone (ex : `notify.mobile_app_pixel_8`), puis :
   ```bash
   sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler NOTIFICATIONS ha:mobile_app_pixel_8
   ```
   Autres possibilités (plusieurs à la fois, séparées par des espaces) : un webhook **Discord**
   (*Modifier le salon → Intégrations → Webhooks → Copier l'URL*), **ntfy**
   (`ntfy:https://ntfy.sh/un-nom-long-secret`) ou n'importe quel webhook. Vérifie avec le bouton
   **Envoyer une notification de test** de la page du tri.

## I bis. Bêta home : maison, musique, Plex, Alexa et HomeKit

**Bêta home** : **`http://192.168.1.20:8800/home/`** (onglet **Bêta home** de la page de Bêta). Trois vues, avec le
design de Bêta home, et rien à configurer : tout passe par la connexion Home Assistant de Bêta.
- **Maison** : pièces avec photo, rangées par étage, tuiles pour les lumières, prises, volets, clim, télé, scènes,
  aspirateur. Range tes appareils dans des **pièces** et tes pièces dans des **étages** dans Home Assistant.
  Serrures, portes de garage et portails sont affichés mais ne se commandent pas.
- **Musique** : tes enceintes de Home Assistant (Sonos, Google Cast, Music Assistant…) avec pochette, lecture,
  morceau suivant, volume ; et les radios (France Inter, FIP, NRJ…) à écouter sur la tablette ou sur une enceinte.
- **Plex** : en cours, à reprendre, ajouts récents ; toucher une affiche l'ouvre dans Plex. À relier une fois :
  ```bash
  sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler PLEX_URL http://192.168.1.20:32400
  sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler PLEX_TOKEN ton_jeton
  ```
  Le jeton : sur app.plex.tv, ouvre un film › **⋯** › **Infos multimédias** › **Afficher le XML** : il est à la fin
  de l'adresse, après `X-Plex-Token=`.

Deux tuiles apparaissent toutes seules en haut de la vue Maison, dès que Home Assistant a les infos :
- **Voiture** : quand tu ajoutes l'intégration **FordPass** (HACS) dans Home Assistant. Carburant ou batterie,
  autonomie, kilométrage, portes, pneus, verrouillée ou non, à la maison ou pas ; boutons **Verrouiller** et
  **Démarrer** (préchauffage, avec confirmation). Jamais « déverrouiller » depuis la page. Nom affiché :
  `fiche-api.sh regler VOITURE_NOM "Ford Explorer"`. Autre marque : `regler VOITURE_MOTIF` avec le mot présent
  dans les identifiants de ses entités.
- **Famille** : une carte avec la position de chacun (appli Home Assistant des téléphones, localisation
  autorisée), sa distance de la maison, et la voiture. Le fond de carte vient d'OpenStreetMap / CARTO ; les
  positions ne quittent pas ta maison.

La barre du bas parle à **Bêta IA**.

**Alexa et HomeKit**, chacun avec sa liste d'appareils (conteneur `beta-ponts`) :
- **Choisir ce que voient Alexa et HomeKit** (dans Bêta home) : chaque appareil a deux pastilles, « Alexa » et
  « HomeKit ». Par défaut : lumières, prises, volets et scènes. Jamais les serrures, le garage ni le portail.
- **Alexa** (Matter, sans skill) : il faut une **Echo compatible Matter** et l'**IPv6** sur le réseau du NAS
  (UGOS : *Panneau de configuration → Réseau → la carte réseau → IPv6 : Auto*). Bouton **Alexa** en haut de
  Bêta home → QR code → appli Alexa → **+** → **Ajouter un appareil** → **Matter** → scanne.
- **HomeKit** (app Maison d'Apple, Siri) : bouton **HomeKit** en haut de Bêta home → QR code → app **Maison** →
  **+** → **Ajouter un accessoire** → scanne → « Ajouter quand même » (pont non certifié, c'est normal).
  L'iPhone doit être sur le même réseau ; un HomePod ou une Apple TV permet de piloter de l'extérieur.

## J. IA cloud ou PC puissant pour la discussion (optionnel)

La discussion (« raconte-moi… », « explique-moi… ») est bien meilleure avec une grosse IA :
- **IA cloud (Claude)** : crée une clé sur https://console.anthropic.com, puis :
  ```bash
  sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler ANTHROPIC_API_KEY sk-ant-…
  ```
- **PC avec carte graphique** : installe Ollama sur ce PC, règle `OLLAMA_HOST=0.0.0.0:11434`, télécharge
  un modèle (`ollama pull qwen3.5:27b`), puis sur le NAS :
  ```bash
  sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler PUISSANT_URL http://IP_DU_PC:11434
  sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh regler PUISSANT_MODELE qwen3.5:27b
  ```

Le tableau de bord affiche ensuite quelle IA fait quoi. Pour changer l'ordre, ou imposer une seule IA
par tâche, modifie la section `ia` de `config.yaml`.

## K. « Hey Bêta » personnalisé (optionnel)

L'app utilise « Hey Jarvis » en attendant ton propre mot d'activation :
1. Ouvre le notebook d'entraînement d'openWakeWord sur Google Colab (dépôt GitHub
   `dscripka/openWakeWord`, dossier `notebooks`, fichier `automatic_model_training.ipynb`).
2. Phrase cible : **`hey bayta`**. Lance toutes les cellules (environ 1 h), puis télécharge le `.onnx`.
3. Copie-le sur la tablette. Dans l'app : *Réglages → Importer hey_beta.onnx → Enregistrer*.

## L. Afficher les infos du NAS sur ton site (optionnel)

1. Récupère le **BETA_LECTURE_TOKEN** (`fiche-api.sh --secrets`). Il ne sert qu'à lire.
2. **Site sur ton réseau** : `sudo …/fiche-api.sh regler BETA_CORS http://ADRESSE_DU_SITE`, puis utilise
   l'exemple `beta-nas/exemples/site/infos-nas.html`.
3. **Site sur Internet** : `sudo …/fiche-api.sh regler PUBLICATION_URL https://monsite.fr/api/nas` et
   `regler PUBLICATION_JETON un_jeton`. Côté site, utilise l'exemple `recevoir-nas.mjs`.

---

## Au quotidien

| Pour… | Commande ou adresse |
|---|---|
| **Le site de Bêta**, trois onglets en haut de chaque page : **Bêta IA** (accueil, discussion), **Domotique**, **Tri automatique** | `http://192.168.1.20:8800` |
| **Bêta home** : le tableau de bord de la maison | `http://192.168.1.20:8800/home/` |
| Voir l'état détaillé et l'utilisation | `http://192.168.1.20:8800/tableau` |
| Tous les codes et commandes | `sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh` |
| Suivre l'API en direct | `sudo …/fiche-api.sh suivre` |
| Voir les journaux | `sudo …/fiche-api.sh logs` |
| Changer un réglage | `sudo …/fiche-api.sh regler CLE valeur` |
| Mettre à jour | Télécharge la nouvelle version (étape B), puis `sudo bash installer.sh` depuis son dossier. Tes réglages, comptes et données sont conservés. |

## Dépannage

| Problème | Solution |
|---|---|
| « Docker est introuvable » | Installe Docker depuis le Centre d'applications (étape A) |
| « Jeton Home Assistant non créé » | Ton compte HA existait déjà avec un autre mot de passe. Dans HA : Profil → Sécurité → Jetons d'accès longue durée → Créer, puis `sudo …/fiche-api.sh regler HA_TOKEN <jeton>` |
| Un service est rouge | `sudo …/fiche-api.sh logs`, ou `sudo docker logs <nom>` (beta, beta-whisper, beta-ollama…) |
| La tablette dit « Jeton refusé » | Rescanne le QR code (Réglages → Scanner le QR code du NAS) |
| « Hey Jarvis » ne se déclenche pas | Réglages de l'app → Sensibilité 0,3 ou 0,4. La barre de l'écran principal montre le score |
| Bêta ne te reconnaît jamais | Le prénom doit être identique dans l'app et dans `config.yaml`. Réenregistre ton visage. Sinon, essaie « Rotation caméra » = 90, 180 ou 270 |
| Les réponses sont lentes | Normal sur le N100 pour la discussion : ajoute l'IA cloud ou un PC puissant (étape J) |
| Aucune tuile dans Domotique | `sudo …/fiche-api.sh maison` : il dit combien d'appareils Bêta lit et pourquoi les pièces manquent. Le plus souvent : le compte du jeton `HA_TOKEN` n'est pas administrateur dans Home Assistant (Paramètres › Personnes › ton compte › Administrateur), puis crée un nouveau jeton et `regler HA_TOKEN` |
| Des invités utilisent ton Wi-Fi | À la maison, Bêta ne demande pas de jeton. Mets tes invités sur le **réseau invité** de ta box, ou exige le jeton partout : `sudo …/fiche-api.sh regler BETA_LOCAL_LIBRE non` |
