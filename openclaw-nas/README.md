# OpenClaw sur le NAS UGREEN (UGOS Pro)

OpenClaw tourne dans Docker sur le NAS et utilise **tes modèles locaux** : ceux de l'Ollama déjà
installé pour Bêta (conteneur `beta-ollama`). Rien ne part sur Internet, sauf si tu ajoutes toi-même
une clé d'IA en ligne.

```
Navigateur (PC, téléphone) ──→ OpenClaw (NAS, port 18789) ──→ beta-ollama (NAS) ──→ ton modèle
```

> **À savoir avant de commencer :** OpenClaw est un *agent*. Il garde beaucoup de contexte
> (32 000 tokens par défaut) et appelle des outils. Sur le processeur N100, sans carte graphique,
> une réponse peut prendre **une à plusieurs minutes**. Pour discuter et tester, ça fonctionne.
> Pour un usage confortable, voir « Aller plus vite » en bas.

## 1. Préparer le modèle

Bêta (`beta-nas`) doit déjà tourner. Télécharge un modèle capable d'utiliser des outils
(environ 6 Go, une seule fois) :

```bash
sudo docker exec beta-ollama ollama pull qwen3.5:9b
sudo docker exec beta-ollama ollama list      # tes modèles disponibles
```

Tu as déjà d'autres modèles dans Ollama ? Tu peux les utiliser à la place : remplace
`qwen3.5:9b` par leur nom partout dans ce guide.

## 2. Copier le dossier et créer la configuration

Copie le dossier `openclaw-nas` dans `/volume1/docker/openclaw-nas`, puis, en SSH :

```bash
cd /volume1/docker/openclaw-nas
cp .env.example .env
openssl rand -hex 32               # copie le résultat après OPENCLAW_GATEWAY_TOKEN= dans .env
nano .env
mkdir -p data/config data/workspace data/secrets
sudo chown -R 1000:1000 data       # OpenClaw tourne avec l'utilisateur 1000
sudo docker network ls | grep beta # doit afficher beta-nas_default (sinon, mets le bon nom dans BETA_RESEAU)
```

## 3. Première configuration (une seule fois)

```bash
sudo docker compose pull
sudo docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --no-install-daemon
```

Dans les questions :
- **Fournisseur de modèle** : choisis **Ollama**, *local only*.
- **Adresse d'Ollama** : `http://beta-ollama:11434`. Surtout pas `/v1` à la fin : les outils
  ne marcheraient plus.
- **Modèle** : `qwen3.5:9b` (ou celui que tu as choisi).
- **Messageries** (Telegram, WhatsApp…) : tu peux passer cette étape et les ajouter plus tard.

Ensuite, autorise l'accès à l'interface web depuis ton réseau (remplace `IP_DU_NAS`) :

```bash
sudo docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js config set --batch-json '[
    {"path":"gateway.mode","value":"local"},
    {"path":"gateway.bind","value":"lan"},
    {"path":"gateway.controlUi.allowedOrigins","value":["http://IP_DU_NAS:18789","http://localhost:18789"]}
  ]'
```

Si l'assistant n'a pas trouvé tes modèles, ajoute le bloc du fichier `ollama.json5` dans
`data/config/openclaw.json`. Il contient l'adresse d'Ollama, la taille de contexte et le modèle par défaut.

## 4. Démarrer

```bash
sudo docker compose up -d openclaw-gateway
sudo docker logs -f openclaw          # Ctrl+C pour quitter les logs
```

*Avec l'interface Docker d'UGOS :* une fois l'étape 3 faite en SSH, tu peux aussi gérer le projet
depuis **Docker → Projet** (démarrer, arrêter, voir les logs).

## 5. Ouvrir l'interface

1. Va sur `http://IP_DU_NAS:18789` et colle le jeton (`OPENCLAW_GATEWAY_TOKEN` du `.env`).
2. La première fois, le navigateur doit être **approuvé**. Laisse la page ouverte, puis en SSH :
   ```bash
   sudo docker compose run --rm openclaw-cli devices list
   sudo docker compose run --rm openclaw-cli devices approve <requestId>
   ```
3. Écris un premier message. Si la réponse tarde, c'est normal la première fois : le modèle se
   charge en mémoire.

Vérifications utiles :

```bash
sudo docker compose run --rm openclaw-cli models list    # le modèle Ollama doit apparaître
sudo docker exec beta-ollama ollama ps                   # le modèle est-il chargé ?
```

## 6. Trier les documents du NAS

OpenClaw lit les documents que tu déposes dans un dossier **`_A_TRIER`**. Pour chacun, il propose
un **titre**, un **dossier** et des **tags**. Rien ne bouge tant que tu n'as pas validé.

```
Tu déposes un fichier          ┌─ trieur : extrait le texte (PDF, scan, Word)
dans Documents/_A_TRIER  ──────┤
                               └─ OpenClaw : lit le texte et écrit une proposition (titre, dossier, tags)
Tu dis « valide » dans le chat ──→ trieur : range le fichier, sans jamais écraser un autre
```

Être dans `_A_TRIER`, c'est le « tag à trier » : OpenClaw sait ainsi quels documents traiter.
Une fois rangé, le document quitte ce dossier, et sa trace (chemin, tags, résumé) va dans
`_A_TRIER/_journal.md` et `Documents/_index_documents.csv`.

**Pourquoi c'est sûr :** OpenClaw voit tes documents en **lecture seule**. Il n'écrit que dans le
dossier des propositions. Le déplacement est fait par un petit programme simple (`trieur/`), qui
refuse tout chemin hors de tes Documents et n'écrase jamais un fichier.

### Installation

1. Dans `.env`, indique ton dossier partagé et ton utilisateur :
   ```bash
   id TON_UTILISATEUR       # affiche uid=… gid=… : à mettre dans PUID et PGID
   nano .env                # DOCUMENTS=/volume1/Documents, PUID=…, PGID=…
   ```
2. Crée la boîte d'entrée :
   ```bash
   sudo mkdir -p /volume1/Documents/_A_TRIER/_traitement/propositions
   sudo chown -R PUID:PGID /volume1/Documents/_A_TRIER        # remplace par tes valeurs
   sudo chmod 777 /volume1/Documents/_A_TRIER/_traitement/propositions   # OpenClaw (utilisateur 1000) y écrit
   ```
3. Donne la consigne de tri à OpenClaw (le « prompt ») :
   ```bash
   cat AGENTS-tri-documents.md | sudo tee -a data/workspace/AGENTS.md > /dev/null
   ```
4. Retire à OpenClaw ce dont il n'a pas besoin : commandes système, navigateur, scripts automatiques.
   ```bash
   sudo docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
     dist/index.js config set --batch-json '[
       {"path":"tools.deny","value":["group:runtime","browser"]},
       {"path":"cron.triggers.enabled","value":false}
     ]'
   ```
5. Démarre le tout :
   ```bash
   sudo docker compose up -d --build
   sudo docker logs -f openclaw-trieur     # « Surveillance de /documents/_A_TRIER »
   ```
6. Optionnel : un tri automatique chaque nuit, une fois par heure de 1 h à 6 h (3 documents à chaque passage) :
   ```bash
   sudo docker compose run --rm openclaw-cli automations add \
     --name "Tri des documents" --cron "0 1-6 * * *" --tz Europe/Paris --session isolated \
     --message "Fais un passage de tri des documents (section « Tri des documents » de AGENTS.md)."
   ```

### Choisir ce qui est trié : tout, sauf ce que tu décoches

Par défaut, **tous tes documents** sont proposés au tri (PDF, Word, textes), en plus de ce que tu
déposes dans `_A_TRIER`.

**La page de réglage : `http://IP_DU_NAS:8802`** (lien aussi sur le tableau de bord de Bêta, jeton = BETA_TOKEN) :
- ton arbre de dossiers avec une case par dossier : **décoche** ce que tu ne veux pas trier (Photos,
  Archives…), puis **Enregistrer**. C'est pris en compte tout de suite ;
- des motifs avancés (`*.mp4`, `*brouillon*`) ;
- la liste des documents que tu as choisi de garder à leur place, avec un bouton **Re-proposer** ;
- le nombre de documents à trier, en attente de validation et déjà rangés.

La page ne fait qu'écrire deux fichiers, que tu peux aussi modifier à la main (dans `Document/_A_TRIER/`) :

- **`_a_surveiller.txt`** : les dossiers à trier, un par ligne. `.` = **tous** tes documents.
  ```
  .
  ```
- **`_a_exclure.txt`** : ce que tu ne veux **pas** trier, un dossier ou un motif par ligne.
  ```
  Photos
  Travail/Archives
  *.mp4
  ```

Dans ces dossiers, le trieur prend les **PDF, Word (`.docx`) et textes**. Les images ne sont triées que
si tu les déposes dans `_A_TRIER`.

Ne sont jamais reproposés :
- les documents déjà rangés par Bêta ;
- ceux pour lesquels tu as répondu « **garde-le** » (liste dans `_A_TRIER/_traitement/gardes.txt`,
  supprime une ligne pour qu'un document soit à nouveau proposé).

**Rythme :** environ 18 documents par nuit sur le N100, plus ceux que tu fais trier à la demande. Si tu as
des milliers de documents, commence par les dossiers les plus en désordre (Téléchargements, Scans…) :
`a_traiter.txt` indique combien attendent leur tour.

### Au quotidien

1. Dépose tes fichiers dans `Document/_A_TRIER` (depuis ton PC, l'application UGREEN du téléphone,
   ou ton scanner s'il sait « numériser vers un dossier réseau »), **ou** laisse le trieur trouver les
   nouveaux documents des dossiers surveillés.
2. Dans OpenClaw, écris **« Trie les documents »** (ou attends le passage de la nuit).
3. Il répond avec une liste numérotée de propositions. Réponds par exemple :
   - « valide tout » ;
   - « valide 1 et 3, pour le 2 mets plutôt dans Banque » ;
   - « garde le 4 » : il reste où il est et ne sera plus proposé.
4. Les documents validés sont rangés dans la minute.
5. Ensuite, tu peux demander : « qu'est-ce qui reste à trier ? », ou « retrouve ma dernière facture
   EDF » (il cherche dans l'index).

**Formats pris en charge :** PDF (avec du texte ou scanné), images (JPG, PNG, TIFF), Word (`.docx`)
et texte. Pour un scan, la reconnaissance de texte (OCR) lit les 3 premières pages.

**Vitesse :** sur le N100, compte **1 à 3 minutes par document** avec un modèle 9B. C'est pour ça
que le tri se fait par paquets de 3, et que le passage de nuit est pratique.

## Sécurité

- OpenClaw peut exécuter des actions (outils, fichiers de son espace de travail). Il ne voit que
  `./data/workspace`, plus tes Documents **en lecture seule** si tu as fait l'étape 6. Ne lui donne
  pas d'autre dossier en écriture.
- **N'ouvre pas le port 18789 sur ta box Internet.** Pour y accéder de l'extérieur, utilise un
  VPN (Tailscale par exemple).
- L'interface est en `http://` sur ton réseau local : c'est prévu par OpenClaw, mais tout passe
  en clair sur le Wi-Fi. Utilise-la chez toi uniquement.

## Mettre à jour

```bash
sudo docker compose pull && sudo docker compose up -d openclaw-gateway
```

OpenClaw met à jour sa configuration tout seul au démarrage de la nouvelle image.

## Aller plus vite

Par ordre d'efficacité :
1. **Faire tourner Ollama sur un PC avec carte graphique** (RTX 3060 12 Go ou mieux). Dans
   `openclaw.json`, remplace `baseUrl` par `http://IP_DU_PC:11434`. Sur ce PC, Ollama doit écouter
   le réseau : `OLLAMA_HOST=0.0.0.0:11434`.
2. **Un modèle plus petit** : plus rapide, mais moins fiable pour utiliser les outils.
3. **Réduire le contexte** : `contextTokens` et `num_ctx` à 16384 dans `ollama.json5`. Plus rapide,
   mais OpenClaw oublie plus vite le début de la conversation.

Documentation officielle : `docs/install/docker.md` et `docs/providers/ollama/` du dépôt
GitHub `openclaw/openclaw`.
