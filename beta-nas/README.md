# Bêta IA : partie NAS

Tout le « cerveau » de Bêta tourne sur le NAS (UGREEN DXP4800, UGOS Pro, Docker).
La tablette s'occupe seulement du « Hey Bêta ». Elle envoie ici l'audio de la commande et la pièce
où elle se trouve. Savoir **qui parle** ne sert que pour les demandes personnelles (mails,
automatisations). Dans ce cas, et seulement dans ce cas, Bêta cherche dans cet ordre :

1. **Les caméras de la maison** : si une seule personne connue a été vue récemment à l'étage de la
   tablette, sans inconnu, c'est elle. Pas de caméra à allumer, pas de question.
2. **La caméra de la tablette** : « Regarde la tablette une seconde ».
3. **« C'est pour qui ? »** : tu réponds par ton prénom.

Créer une automatisation exige toujours l'étape 2 (le visage).

```
Tablette ── audio + "salon" ──→ Bêta (port 8800)
                                   │ 1. Whisper : parole → texte
                                   │ 2. Mails ? → lecture IMAP
                                   │ 3. Home Assistant (intentions locales, < 1 s)
                                   │ 4. Pas compris → petit LLM local (Ollama) qui trie
                                   │ 5. Automatisation → IA web, puis « Tu confirmes ? »
                                   │ 6. Piper : texte → voix
Tablette ←── texte + audio WAV ────┘
```

| Conteneur | Rôle |
|---|---|
| `homeassistant` | Domotique, automatisations, musique |
| `beta-whisper` | Reconnaissance vocale (français) |
| `beta-piper` | Voix de Bêta |
| `beta-ollama` | Petit LLM local (`qwen2.5:3b` par défaut) |
| `beta` | Le routeur, c'est-à-dire l'API appelée par la tablette |
| `beta-presence` | Reconnaît les visages quand une Reolink détecte quelqu'un, et tient à jour qui est où |

---

## Installation

### 1. Préparer le NAS

1. Dans le **Centre d'applications** d'UGOS Pro, installe **Docker**.
2. Active le **SSH** : *Panneau de configuration → Terminal → SSH*. Ce n'est pas obligatoire, mais c'est
   beaucoup plus simple pour créer les fichiers de configuration.

### 2. Copier le dossier sur le NAS

Copie le dossier `beta-nas` dans le dossier partagé `docker` du NAS, par l'explorateur de fichiers
(SMB) ou l'application Fichiers d'UGOS. Le chemin devient par exemple `/volume1/docker/beta-nas`.

Ou, en SSH :

```bash
cd /volume1/docker
git clone https://github.com/Ukiyo2208/Ukiyo2208.git beta-source
cp -r beta-source/beta-nas ./beta-nas
```

### 3. Créer les fichiers de configuration

En SSH :

```bash
cd /volume1/docker/beta-nas
cp .env.example .env
cp config/config.example.yaml config/config.yaml
openssl rand -hex 32        # copie le résultat : ce sera ton BETA_TOKEN
nano .env                   # colle-le après BETA_TOKEN=  (Ctrl+O pour enregistrer, Ctrl+X pour quitter)
nano config/config.yaml     # ton prénom, ton adresse mail...
```

> `HA_TOKEN` reste vide pour l'instant : tu le créeras à l'étape 5.

### 4. Lancer les conteneurs

**Avec l'interface Docker d'UGOS :** *Docker → Projet → Créer*, choisis le dossier
`/volume1/docker/beta-nas`. Le `docker-compose.yml` est détecté tout seul. Clique ensuite sur *Déployer*.

**Ou en SSH :**

```bash
cd /volume1/docker/beta-nas
sudo docker compose up -d --build
```

Le premier démarrage est long (de 5 à 15 minutes). Le NAS télécharge les images, le modèle Whisper
(environ 500 Mo) et le modèle Ollama (environ 2 Go). Pour suivre l'avancement :

```bash
sudo docker logs -f beta          # attends le message « Modèle qwen2.5:3b prêt »
```

### 5. Configurer Home Assistant

1. Ouvre `http://IP_DU_NAS:8123` et crée ton compte. Choisis la **langue française** et le bon fuseau horaire.
2. Ajoute tes appareils (*Paramètres → Appareils et services*) et range-les dans des **pièces**
   (« Salon », « Chambre »...). C'est ce qui permet de dire « allume le salon ».
3. **Expose tes appareils à Assist** : *Paramètres → Assistants vocaux → Exposer*. Home Assistant
   n'obéit qu'aux appareils exposés.
4. Crée le jeton : clique sur ton **profil** (en bas à gauche) → onglet **Sécurité** →
   *Jetons d'accès longue durée → Créer un jeton*. Colle-le dans `.env` après `HA_TOKEN=`.
5. Redémarre Bêta pour qu'il prenne le jeton :
   ```bash
   sudo docker compose up -d beta
   ```

*Optionnel :* pour que Home Assistant puisse aussi utiliser Whisper et Piper (dans son application mobile, par exemple),
va dans *Appareils et services → Ajouter une intégration → Wyoming Protocol*. Ajoute `127.0.0.1` port
`10300` (Whisper), puis `127.0.0.1` port `10200` (Piper).

### 6. Tester

Remplace `TON_TOKEN` et `IP_DU_NAS` par tes valeurs :

```bash
# Tout est en ligne ?
curl http://IP_DU_NAS:8800/sante

# Une commande en texte (sans la tablette)
curl -X POST http://IP_DU_NAS:8800/v1/texte \
  -H "Authorization: Bearer TON_TOKEN" -H "Content-Type: application/json" \
  -d '{"texte": "allume la lumière du salon", "personne": "bastien", "confiance": 0.9}'
```

La réponse indique par où la demande est passée (`route`) et combien de temps ça a pris (`duree_ms`) :

```json
{"texte_reconnu": "allume la lumière du salon", "reponse": "Lumière allumée", "route": "home_assistant", "duree_ms": 180}
```

Tu peux aussi tester depuis un navigateur : `http://IP_DU_NAS:8800/docs`. Clique sur *Authorize*
et colle ton jeton.

### 7. Activer l'IA web (optionnel)

Elle sert uniquement à **créer des automatisations** (« tous les jours à 6h, ouvre les volets »).

1. Crée une clé API sur https://console.anthropic.com et colle-la dans `.env` après `ANTHROPIC_API_KEY=`.
2. Lance `sudo docker compose up -d beta`.

Ce qui part sur Internet : ta phrase et la liste des appareils (type, pièce, et le nom si
`envoyer_noms_appareils: true`). Les vrais identifiants sont remplacés par des alias, et aucun jeton
ni accès à Home Assistant n'est transmis. L'IA renvoie une proposition. Bêta la vérifie (seulement tes
appareils, pas de script ni de commande système), puis te demande « Tu confirmes ? ». Rien n'est créé tant
que tu n'as pas dit « oui ».

### 8. Présence avec les caméras Reolink (optionnel)

Le service `beta-presence` écoute les détections de personne de tes Reolink dans Home Assistant.
À chaque détection, il prend 3 à 5 captures, reconnaît les visages et met à jour
`sensor.beta_position_<prénom>` dans Home Assistant (la pièce, ou `inconnue` après 15 minutes).
Tu peux aussi utiliser ces capteurs dans tes propres automatisations. Les images ne sont jamais
enregistrées : seules les empreintes des visages enregistrés sont gardées (`data/presence/visages.json`).

1. **Les caméras dans Home Assistant** : ajoute l'intégration **Reolink**
   (*Paramètres → Appareils et services → Ajouter une intégration*). Pour chaque caméra, active le flux
   **Clair** (pleine résolution, souvent désactivé par défaut) : les visages y sont bien plus nets.
2. **Le fichier `config/config.yaml`** :
   - section `maison.zones` : l'étage de chaque pièce. La pièce de la tablette doit y être, même sans caméra ;
   - section `cameras` : le nom **exact** de chaque entité (*Paramètres → Entités*, cherche « Personne »).
     L'exemple contient tes 8 caméras avec des noms probables, à vérifier ;
   - pour chaque personne, `companion: person.xxx` (app Home Assistant Companion). Bêta ignore ainsi
     quelqu'un qui est sorti de la maison.
3. **Les visages** :
   - le plus simple : dans l'app de la tablette, écran **Visages**, appuie sur **Envoyer les visages au NAS** ;
   - le plus fiable : ajoute aussi des captures prises par les Reolink elles-mêmes (vues d'en haut,
     de plus loin). Ouvre `http://IP_DU_NAS:8801/docs`, clique sur *Authorize* et colle ton jeton.
     Dans `POST /visages/{nom}/capturer`, mets ton prénom et `{"camera": "camera.salon_clair"}`, puis
     reste **seul** face à cette caméra, à 1 ou 2 mètres, pendant 15 secondes.
4. Relance : `sudo docker compose up -d --build`. Dans `sudo docker logs -f beta-presence`, tu dois
   voir « À l'écoute de 8 caméras », puis par exemple « salon : bastien » quand tu passes devant.

**Bon à savoir :**
- La reconnaissance marche bien jusqu'à 3 mètres environ. De dos ou de loin, la caméra voit
  quelqu'un sans le reconnaître.
- Un visage non reconnu à un étage compte comme « quelqu'un d'autre est peut-être là ». Bêta
  préfère alors demander plutôt que de deviner.
- Les caméras reconnaissent tout le monde, invités compris : préviens les gens de la maison.
  Seules les personnes enregistrées sont nommées.

---

## Réglages utiles

| Où | Quoi |
|---|---|
| `config/config.yaml` → `personnes` | Les prénoms **doivent être identiques** à ceux envoyés par la tablette |
| `config/config.yaml` → `roles` | Qui a le droit de faire quoi (`domotique`, `mails`, `questions`, `automatisations`). Sans visage reconnu, c'est le rôle `inconnu` : domotique seulement, par défaut |
| `config/config.yaml` → `maison.validite_minutes` | Durée pendant laquelle une position vue par les caméras compte (15 min) |
| `config/config.yaml` → `seuil_confiance` | En dessous de ce seuil, le visage est considéré comme inconnu |
| `.env` → `OLLAMA_MODEL` | `qwen2.5:1.5b` si le LLM local est trop lent, `qwen2.5:3b` par défaut |
| `.env` → `WHISPER_MODEL` | `base-int8` (plus rapide), `small-int8` (meilleur en français, par défaut) |

Après une modification : `sudo docker compose up -d` (ou *Redéployer* dans l'interface Docker).

**Mails** : pour Gmail, utilise un *mot de passe d'application* (Compte Google → Sécurité →
Mots de passe des applications) et mets-le dans `.env` (`MAIL_BASTIEN_PASSWORD=`).
Bêta lit l'expéditeur et l'objet des mails non lus, sans les marquer comme lus.

**Musique** : installe *Music Assistant* dans Home Assistant. Ensuite, « mets de la musique dans le salon »
passe directement par Home Assistant.

**Sécurité** : n'ouvre **jamais** le port 8800 sur ta box Internet. Whisper, Piper et Ollama ne sont
accessibles que depuis le NAS lui-même.

---

## API pour la tablette

`POST http://IP_DU_NAS:8800/v1/commande` avec l'en-tête `Authorization: Bearer <BETA_TOKEN>`,
au format `multipart/form-data` :

| Champ | Exemple | Description |
|---|---|---|
| `audio` | fichier `.wav` | **16 kHz, mono, 16 bits** : la phrase après « Hey Bêta » |
| `personne` | `bastien` | Nom reconnu par SFace. Vide : la caméra n'a pas été allumée |
| `confiance` | `0.87` | Score de la reconnaissance du visage |
| `sans_voix` | `true` | Optionnel : ne pas générer l'audio de réponse |

Réponse :

```json
{
  "texte_reconnu": "allume le salon",
  "reponse": "Lumière allumée",
  "route": "home_assistant",
  "duree_ms": 1450,
  "audio_wav_base64": "UklGRi..."
}
```

`route` vaut `home_assistant`, `llm_local`, `llm_local+home_assistant`, `ia_web`, `confirmation`,
`mails`, `refus`, `incompris` ou `identification_requise`.

**Caméra à la demande.** La tablette envoie d'abord la commande sans visage. Si la demande dépend
de la personne (mails, automatisation…), la réponse est `identification_requise`. Le champ
`demande_id` est alors rempli et `reponse` vaut « Regarde la tablette une seconde. ». La tablette
allume sa caméra, puis appelle :

`POST /v1/identite` (JSON, même en-tête `Authorization`)

```json
{"demande_id": "…", "personne": "bastien", "confiance": 0.82}
```

Le NAS reprend la phrase mise de côté (sans la retranscrire) et renvoie une réponse normale.
Un `demande_id` ne sert qu'une fois et expire au bout de 60 secondes.

Si la tablette n'a vu personne et que plusieurs personnes sont possibles, la réponse vaut
`qui_requis` (« C'est pour qui ? »), avec un nouveau `demande_id`. La tablette enregistre la réponse
et l'envoie en `multipart/form-data` à `POST /v1/qui` (champs `audio` et `demande_id`).

Le champ `piece` de `/v1/commande` (ex : `salon`) permet à Bêta de savoir à quel étage chercher.

`POST /v1/visages/{nom}` avec `{"empreintes": [[128 valeurs], …]}` transmet au service de présence
les visages enregistrés sur la tablette.

## Développement

```bash
cd beta
pip install -r requirements.txt pytest pytest-asyncio
python -m pytest
```
