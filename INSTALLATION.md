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

## B. Télécharger et copier le projet (sur ton PC)

1. Connecté à GitHub, télécharge le projet :
   https://github.com/Ukiyo2208/Ukiyo2208/archive/refs/heads/claude/beta-ia-local-voice-kd7s5z.zip
2. Dézippe-le. Tu obtiens le dossier `Ukiyo2208-claude-beta-ia-local-voice-kd7s5z`.
3. Copie ce dossier dans le dossier partagé **`docker`** du NAS : explorateur Windows →
   `\\192.168.1.20\docker` (ou l'application Fichiers d'UGOS).

## C. Lancer l'installation (SSH)

1. Sur ton PC, ouvre un terminal (Windows : *PowerShell*) et connecte-toi au NAS :
   ```bash
   ssh TON_UTILISATEUR_UGOS@192.168.1.20
   ```
2. Lance l'installateur :
   ```bash
   cd /volume1/docker/Ukiyo2208-claude-beta-ia-local-voice-kd7s5z
   sudo bash installer.sh
   ```
3. Réponds aux questions. **Entrée** garde la réponse proposée :

| Question | Quoi répondre |
|---|---|
| Dossier d'installation | Entrée (`/volume1/docker/beta`) |
| Ton prénom | ton prénom, ex : `bastien` |
| Pièce de la tablette | `salon` |
| Installer OpenClaw et le tri des documents ? | `o` (oui) ou `n` |
| Dossier des documents | Entrée (`/volume1/Documents`) |
| Compte Home Assistant : identifiant | Entrée (ton prénom) |
| Compte Home Assistant : mot de passe | le tien, ou Entrée pour en générer un |
| Clé de l'IA cloud Claude | Entrée pour l'instant (voir étape J) |
| Adresse d'un PC puissant | Entrée pour l'instant (voir étape J) |

4. **Attends** : l'installateur télécharge et démarre tout (environ 8 Go de modèles d'IA).
5. À la fin, il affiche :
   - les adresses (tableau de bord, Home Assistant, OpenClaw) ;
   - **le mot de passe Home Assistant** s'il l'a généré : **note-le** ;
   - **un QR code** pour la tablette : laisse le terminal ouvert, ou retrouve-le à l'étape F.

> Ça bloque ou il y a un ✘ rouge ? Voir « Dépannage » en bas.

## D. Vérifier que tout tourne (navigateur)

1. Ouvre **`http://192.168.1.20:8800/tableau`**.
2. Il demande un jeton. Pour l'obtenir, dans le terminal SSH :
   ```bash
   sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh --secrets
   ```
   Copie le **BETA_TOKEN** et colle-le dans la page.
3. Dans **Services**, les points doivent être verts : home assistant, ollama, whisper, piper, presence
   (et openclaw). Juste après l'installation, ollama peut rester rouge une ou deux minutes.

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

1. Ouvre **`http://192.168.1.20:8802`** et colle le **BETA_TOKEN**.
2. Dans **Ce qui est trié**, décoche les dossiers à laisser de côté (Photos, Archives…), puis **Enregistrer**.
3. Clique sur **Préparer 5 documents maintenant**. Compte 1 à 2 minutes par document.
4. Les propositions apparaissent avec un titre, un dossier et des tags. Corrige-les si besoin, puis
   **Valider** (le fichier est rangé dans la minute) ou **Garder où il est** (il ne sera plus proposé).
5. Ensuite, le trieur avance tout seul **chaque nuit** : tu n'as plus qu'à valider sur la page.

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
| **La page d'accueil de Bêta** : discuter, piloter la maison, suivre le tri | `http://192.168.1.20:8800` |
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
