# Bêta IA : partie NAS

Tout le « cerveau » de Bêta tourne sur le NAS (UGREEN DXP4800, UGOS Pro, Docker).
La tablette s'occupe seulement du « Hey Bêta » et de la reconnaissance du visage. Ensuite, elle envoie ici
l'audio de la commande et le nom de la personne.

```
Tablette ── audio + "bastien" ──→ Bêta (port 8800)
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

---

## Réglages utiles

| Où | Quoi |
|---|---|
| `config/config.yaml` → `personnes` | Les prénoms **doivent être identiques** à ceux envoyés par la tablette |
| `config/config.yaml` → `roles` | Qui a le droit de faire quoi (`domotique`, `mails`, `questions`, `automatisations`) |
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
| `personne` | `bastien` | Nom reconnu par SFace (vide si personne n'est reconnu) |
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
`mails`, `refus` ou `incompris`.

## Développement

```bash
cd beta
pip install -r requirements.txt pytest pytest-asyncio
python -m pytest
```
